// База данных «Автонова с пробегом» — SQLite через встроенный node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_DISCOUNT_SQL, SPECIAL_OFFER_LIMIT, SPECIAL_OFFER_ORDER, SPECIAL_OFFER_WHERE } from './special-offer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = process.env.AUTONOVA_DB || path.join(DATA_DIR, 'autonova.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
/* WAL разрешает читателям и писателю работать одновременно, но двух писателей — нет:
   без busy_timeout второй писатель сразу получает SQLITE_BUSY («database is locked»).
   Так падал живой сервер, когда рядом писал скрипт (тесты, посев, импорт фото).
   Ждём до 5 с вместо мгновенной ошибки. */
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    phone TEXT DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    city TEXT DEFAULT 'Гомель',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    generation TEXT DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    mileage INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'BYN',
    transmission TEXT NOT NULL DEFAULT 'at',
    volume REAL NOT NULL DEFAULT 0,
    fuel TEXT NOT NULL DEFAULT 'petrol',
    body TEXT NOT NULL DEFAULT 'sedan',
    drive TEXT NOT NULL DEFAULT 'fwd',
    color TEXT DEFAULT '',
    power INTEGER NOT NULL DEFAULT 0,
    fuel_use REAL NOT NULL DEFAULT 0,
    vin TEXT DEFAULT '',
    description TEXT DEFAULT '',
    equipment TEXT DEFAULT '',
    trim TEXT DEFAULT '',
    interior_color TEXT DEFAULT '',
    interior_material TEXT DEFAULT '',
    options TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published',
    is_new INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    vin_checked INTEGER NOT NULL DEFAULT 1,
    city TEXT NOT NULL DEFAULT 'Гомель',
    source_url TEXT DEFAULT '',
    source_id TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS car_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, car_id)
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'call',
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    city TEXT DEFAULT 'Гомель',
    rating INTEGER NOT NULL DEFAULT 5,
    text TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT DEFAULT '',
    body TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    tag TEXT DEFAULT 'Автожурнал',
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    section TEXT NOT NULL DEFAULT 'services',
    title TEXT NOT NULL,
    excerpt TEXT DEFAULT '',
    body TEXT DEFAULT '',
    icon TEXT DEFAULT 'shield',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sold_cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    mileage INTEGER NOT NULL DEFAULT 0,
    sold_at TEXT NOT NULL DEFAULT (datetime('now')),
    photo TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_cars_status ON cars(status);
  CREATE INDEX IF NOT EXISTS idx_cars_brand ON cars(brand);
  CREATE INDEX IF NOT EXISTS idx_cars_price ON cars(price);
  CREATE INDEX IF NOT EXISTS idx_photos_car ON car_photos(car_id, sort);
  `);

  /* Колонка cars.discount («Скидка», руб.) появилась после первой версии схемы. CREATE TABLE
     IF NOT EXISTS уже существующую таблицу не меняет, поэтому для баз, созданных раньше, колонку
     дописываем через ALTER TABLE — но только если её ещё нет: повторный ALTER TABLE упал бы. */
  ensureColumn('cars', 'discount', 'discount INTEGER NOT NULL DEFAULT 0');

  /* Выбор комплектации в форме объявления (заказчик 2026-09-27: «чтобы можно было выбирать
     комплектацию и её содержимое»). Название комплектации, салон и отмеченные опции храним
     отдельными колонками — их видно на странице автомобиля отдельным блоком, а собранный из них
     текст по-прежнему лежит в cars.equipment, поэтому старые карточки и поиск не меняются.
     Значения опций — подписи из справочника av.by (lib/car-options.mjs), через запятую. */
  ensureColumn('cars', 'trim', "trim TEXT DEFAULT ''");
  ensureColumn('cars', 'interior_color', "interior_color TEXT DEFAULT ''");
  ensureColumn('cars', 'interior_material', "interior_material TEXT DEFAULT ''");
  ensureColumn('cars', 'options', "options TEXT DEFAULT ''");

  /* Журнал продаж: карточка уходит с сайта — машина попадает в «Проданные автомобили» (заказчик
     2026-09-30: «когда карточка авто исчезает с сайта, то есть авто продали и карточку удалили,
     этот авто появлялся в продажах как реальная продажа»). Запись делает server.mjs при удалении.
     photo (колонка была в схеме с самого начала, но не заполнялась) хранит снимок машины из
     карточки — его таблица проданных показывает маленьким кадром; source_slug — слаг удалённой
     карточки, по нему видно автоматическую продажу и не задваивается повторная вставка. */
  ensureColumn('sold_cars', 'source_slug', "source_slug TEXT DEFAULT ''");
  backfillDiscounts();
}

function hasColumn(table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);
}

function ensureColumn(table, name, ddl) {
  if (!hasColumn(table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/* Скидки: демонстрационная сумма живёт только у машин спецпредложения.
   Заказчик сначала просил показывать в «Горящей продаже» скидку «например от 2000 до 4000 руб.» —
   отсюда сумма по id (2 000 / 2 500 / 3 000 / 3 500 / 4 000, детерминированно: при каждом запуске у
   одной и той же машины одна и та же скидка, вёрстка и проверки не «дрожат»). Но заполнялась она
   всем машинам базы, поэтому плашка «Скидка −N руб.» и зачёркнутое «было» стояли на странице
   каждого объявления. Заказчик 2026-09-30: «с большей частью объявлений которые не задействованы в
   спецпрограммах удалить скидку» — значит, скидка остаётся ровно у пятёрки блока «Горящая продажа»
   (отбор — lib/special-offer.mjs, тот же, что рисует блок на главной), у остальных её нет.

   Скидка, выставленная менеджером вручную в админке (поле «Скидка, руб.»), не трогается: уборка
   снимает ровно демонстрационные суммы и делается один раз — отметка в settings. Без отметки
   повторный запуск затирал бы и ручную скидку, если менеджер поставил ровно такую же сумму. */
export function backfillDiscounts() {
  const ids = specialOfferIds();
  const inOffer = ids.length ? ids.join(', ') : '0';
  if (getSetting('discount_demo_scope') !== 'special-offer') {
    run(`UPDATE cars SET discount = 0
      WHERE discount = ${DEMO_DISCOUNT_SQL} AND id NOT IN (${inOffer})`);
    setSetting('discount_demo_scope', 'special-offer');
  }
  /* Дальше как раньше, только для машин спецпредложения: заполняются только нулевые значения — если
     скидку когда-нибудь поправят вручную, повторный запуск её не перезапишет. */
  run(`UPDATE cars SET discount = ${DEMO_DISCOUNT_SQL}
    WHERE (discount = 0 OR discount IS NULL) AND id IN (${inOffer})`);
}

/* Машины спецпредложения по возрастанию цены — тот же отбор, что рисует блок «Горящая продажа»
   на главной и даёт плашку «Горящая продажа» на странице автомобиля (lib/pages.mjs: hotCars).
   Запрос нужен здесь, в базе, чтобы демонстрационная скидка доставалась ровно этим машинам. */
function specialOfferIds() {
  return all(`SELECT c.id FROM cars c WHERE ${SPECIAL_OFFER_WHERE}
    ORDER BY ${SPECIAL_OFFER_ORDER} LIMIT ${SPECIAL_OFFER_LIMIT}`).map((r) => Number(r.id));
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const num = (sql, ...p) => Object.values(db.prepare(sql).get(...p) || {})[0] ?? 0;

export function getSetting(key, fallback = '') {
  const r = one('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
