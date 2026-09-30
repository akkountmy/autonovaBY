// Выборки по автомобилям: фильтры, сортировки, карточки, сравнение.
import { all, one, num, run } from './db.mjs';

export const SORTS = {
  'new_desc': 'c.created_at DESC, c.id DESC',
  /* авто «цена по запросу» (price = 0) в сортировке по цене уходят в конец списка */
  'price_asc': 'CASE WHEN c.price > 0 THEN 0 ELSE 1 END, c.price ASC, c.id DESC',
  'price_desc': 'CASE WHEN c.price > 0 THEN 0 ELSE 1 END, c.price DESC, c.id DESC',
  'year_desc': 'c.year DESC, c.id DESC',
  'mileage_asc': 'c.mileage ASC, c.id DESC',
  'popular': 'c.views DESC, c.id DESC',
};
export const SORT_LABEL = {
  'new_desc': 'Сначала новые', 'price_asc': 'Цена: по возрастанию', 'price_desc': 'Цена: по убыванию',
  'year_desc': 'Год: новее', 'mileage_asc': 'Пробег: меньше', 'popular': 'Популярные',
};
export const TRANS_LABEL = { at: 'Автомат', mt: 'Механика', amt: 'Робот / вариатор' };
/* hybrid — из формы «Разместить объявление» (заказчик 2026-09-30, «Тип двигателя … гибрид
   (бензин)»): значение своё, у av.by в справочнике двигателей гибрида нет. */
export const FUEL_LABEL = { petrol: 'Бензин', diesel: 'Дизель', electric: 'Электро', cng: 'Метан', hybrid: 'Гибрид (бензин)' };

/* Знак белорусского рубля (утверждён Нацбанком 27.01.2026, постановление № 25): кириллическая «Б»
   с чертой по центру. Кодовой точки в Юникоде у знака нет, в шрифтах Windows его тоже нет —
   поэтому в разметке ставим саму букву, а черту дорисовывает CSS (.byn в public/assets/css/site.css).
   Цифра и знак разделены неразрывным пробелом: «41 500 Б» не должно разрываться по строке.
   bynHtml возвращает готовый HTML, поэтому её результат нельзя прогонять через esc(); там, где
   нужен чистый текст (title, description, JSON-LD), к числу добавляется BYN_TEXT. */
export const bynHtml = (n) => `${fmt(n)}<span class="byn">Б</span>`;
export const BYN_TEXT = '\u00A0Б';
export const BODY_LABEL = { sedan: 'Седан', suv: 'Внедорожник', wagon: 'Универсал', minivan: 'Минивэн', hatchback: 'Хэтчбек', liftback: 'Лифтбек', coupe: 'Купе', van: 'Фургон' };
export const DRIVE_LABEL = { fwd: 'Передний', awd: 'Полный', rwd: 'Задний' };
const TRANS_SHORT = { at: 'AT', mt: 'MT', amt: 'AT' };
const DRIVE_SHORT = { fwd: 'FWD', awd: 'AWD', rwd: 'RWD' };

/* Сколько карточек каталог отдаёт за раз. Заказчик 2026-09-28: «и показывай 20 карточек авто» —
   было 12. Это же число стоит в подписи у кнопки («На странице 20 объявлений из 57») и в
   подгрузке следующей партии по клику (см. carsMore в view.mjs и initInfinite в site.js). */
export const PER_PAGE = 20;

/* «Новый автомобиль» — не то же самое, что «новое поступление». Заказчик 2026-09-27: «новые
   поступления не равно новый автомобиль, убери с раздела новый если по сайту нету нового
   автомобиля по году выпуска или в описании или пробег до 500 км». Флаг is_new (свежее
   объявление: плашка «Новый» и место в «Новых поступлениях» на главной) этот раздел больше не
   наполняет — в разделе «Новые автомобили» (/cars-new) остаются машины, у которых:
     • год выпуска не старше текущего (2026-й в 2026-м — новый, 2025-й — уже нет);
     • либо пробег до 500 км;
     • либо в описании прямо сказано, что автомобиль новый.
   По описанию ищем фразу про сам автомобиль («новый автомобиль», «новая машина», «новое авто»),
   а не подстроку «нов»: она ловит название дилера «Автонова» — так нашлись бы 56 машин из 57.
   Условие одно на страницу и на ленту карточек (catalogFilter режима new), поэтому счётчик в
   панели поиска, первая страница и догрузка всегда про одно и то же. */
export const NEW_CAR_SQL = `(c.year >= CAST(strftime('%Y','now') AS INTEGER)
  OR c.mileage <= 500
  OR (' ' || lower(c.description)) LIKE '% новый автомобил%'
  OR (' ' || lower(c.description)) LIKE '% новая машин%'
  OR (' ' || lower(c.description)) LIKE '% новое авто%'
  OR lower(c.description) LIKE '%новинка%')`;

export function buildQuery(params = {}, opts = {}) {
  const w = [];
  const args = [];
  const add = (sql, ...v) => { w.push(sql); for (const x of v) args.push(x); };
  add("c.status = 'published'");
  if (params.brand) add('c.brand = ?', params.brand);
  if (params.model) add('c.model = ?', params.model);
  if (params.body) add('c.body = ?', params.body);
  if (params.fuel) add('c.fuel = ?', params.fuel);
  if (params.transmission) add('c.transmission = ?', params.transmission);
  if (params.drive) add('c.drive = ?', params.drive);
  if (params.year_from) add('c.year >= ?', Number(params.year_from));
  if (params.year_to) add('c.year <= ?', Number(params.year_to));
  if (params.price_from) add('c.price >= ?', Number(params.price_from));
  if (params.price_to) add('c.price <= ?', Number(params.price_to));
  if (params.mileage_to) add('c.mileage <= ?', Number(params.mileage_to));
  if (params.volume_from) add('c.volume >= ?', Number(params.volume_from));
  if (params.volume_to) add('c.volume <= ?', Number(params.volume_to));
  if (params.power_from) add('c.power >= ?', Number(params.power_from));
  if (opts.isNew !== undefined && opts.isNew !== null) add('c.is_new = ?', Number(opts.isNew));
  if (opts.newCar) add(NEW_CAR_SQL);
  if (opts.electric) add("c.fuel = 'electric'");
  if (opts.featured) add('c.featured = 1');
  if (opts.ownerId) add('c.owner_id = ?', Number(opts.ownerId));
  if (params.q) {
    const q = `%${String(params.q).trim().toLowerCase()}%`;
    add('(lower(c.brand) LIKE ? OR lower(c.model) LIKE ? OR lower(c.generation) LIKE ? OR lower(c.description) LIKE ? OR lower(c.color) LIKE ?)', q, q, q, q, q);
  }
  const sort = SORTS[params.sort] ? params.sort : (opts.defaultSort || 'new_desc');
  return { where: w.join(' AND '), args, order: SORTS[sort], sort };
}

export function listCars(params = {}, opts = {}) {
  const { where, args, order, sort } = buildQuery(params, opts);
  const page = Math.max(1, Number(params.page) || 1);
  /* страниц на выдачу: по умолчанию 12, но открытый API принимает per_page (1…50) */
  const per = perPageOf(params, opts);
  const total = num(`SELECT COUNT(*) FROM cars c WHERE ${where}`, ...args);
  const pages = Math.max(1, Math.ceil(total / per));
  const rows = all(
    `SELECT c.* FROM cars c WHERE ${where} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`,
    ...args,
  );
  return { rows, total, page, pages, sort, per_page: per };
}
function perPageOf(params, opts) {
  const raw = opts.perPage !== undefined ? opts.perPage : params.per_page;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PER_PAGE;
  return Math.min(100, Math.max(1, Math.trunc(n)));
}

export function facetCounts(where, args) {
  const q = (col) => all(`SELECT ${col} AS k, COUNT(*) AS n FROM cars c WHERE ${where} GROUP BY ${col} ORDER BY n DESC`, ...args);
  return {
    brand: q('c.brand'), body: q('c.body'), fuel: q('c.fuel'),
    transmission: q('c.transmission'), drive: q('c.drive'),
  };
}

export function carPhotos(carId) {
  return all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort, id', carId).map(r => r.path);
}

export function carBySlug(slug) {
  const c = one('SELECT * FROM cars WHERE slug = ?', slug);
  if (!c) return null;
  c.photos = carPhotos(c.id);
  return c;
}
export function carById(id) {
  const c = one('SELECT * FROM cars WHERE id = ?', id);
  if (!c) return null;
  c.photos = carPhotos(c.id);
  return c;
}

export function decorate(c) {
  if (!c) return c;
  const t = String(c.transmission || 'at').toUpperCase();
  const parts = [];
  if (c.volume) parts.push(String(c.volume).replace('.', ',') + ' ' + (TRANS_SHORT[c.transmission] || t));
  if (c.drive) parts.push(DRIVE_SHORT[c.drive]);
  if (c.power) parts.push(`(${c.power} л.с.)`);
  return {
    ...c,
    engine_label: `${String(c.volume).replace('.', ',')} ${TRANS_SHORT[c.transmission] || t}${c.drive ? ' ' + DRIVE_SHORT[c.drive] : ''}${c.power ? ` (${c.power} л.с.)` : ''}`,
    params: [
      `${c.year} г.`,
      `${TRANS_LABEL[c.transmission] || c.transmission}, ${String(c.volume).replace('.', ',')} л, ${(FUEL_LABEL[c.fuel] || c.fuel).toLowerCase()}, ${(BODY_LABEL[c.body] || c.body).toLowerCase()}`,
      `${fmt(c.mileage)} км`,
    ],
    photo: (c.photos && c.photos[0]) || null,
    hidden_photos: Math.max(0, (c.photos ? c.photos.length : 0) - 1),
    price_text: c.price ? `${fmt(c.price)}<span class="byn">Б</span>` : 'Цена по запросу',
    body_label: BODY_LABEL[c.body] || c.body,
    fuel_label: FUEL_LABEL[c.fuel] || c.fuel,
    trans_label: TRANS_LABEL[c.transmission] || c.transmission,
    drive_label: DRIVE_LABEL[c.drive] || c.drive,
  };
}

export const fmt = (n) => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/* Марки — по алфавиту (просьба заказчика: «название размести согласно алфавита»).
   Раньше порядок задавала SQLite («ORDER BY brand»), а она сравнивает строки побайтово:
   прописные буквы идут раньше строчных, из-за чего «BMW» вставал перед «Belgee», а
   «Citroën» мог оказаться не там, где ждёт читатель. Поэтому порядок наводим в JS тем же
   сравнением, что и в полосе марок (`brandStrip` в view.mjs) — с учётом русского алфавита.
   По этому списку строятся «Марки» главной (brandLine), полоса марок в шапке внутренних
   страниц, список в фильтре «Марка» и страницы марок. */
export function brands() {
  return all("SELECT brand, COUNT(*) AS n FROM cars WHERE status='published' GROUP BY brand")
    .sort((a, b) => String(a.brand).localeCompare(String(b.brand), 'ru'));
}
export function popularModels(limit = 12) {
  return all(`SELECT brand, model, COUNT(*) AS n FROM cars WHERE status='published'
              GROUP BY brand, model ORDER BY n DESC, brand LIMIT ?`, limit);
}
export function similar(car, limit = 4) {
  return all(`SELECT c.* FROM cars c WHERE c.status='published' AND c.id <> ?
              AND (c.body = ? OR c.brand = ?) ORDER BY abs(c.price - ?) ASC LIMIT ?`,
    car.id, car.body, car.brand, car.price, limit);
}
export function incrementViews(id) {
  run('UPDATE cars SET views = views + 1 WHERE id = ?', id);
}
export function carStats() {
  return {
    total: num("SELECT COUNT(*) FROM cars WHERE status='published'"),
    brands: num("SELECT COUNT(DISTINCT brand) FROM cars WHERE status='published'"),
    featured: num("SELECT COUNT(*) FROM cars WHERE status='published' AND featured=1"),
    pending: num("SELECT COUNT(*) FROM cars WHERE status='pending'"),
    users: num('SELECT COUNT(*) FROM users'),
    leads: num('SELECT COUNT(*) FROM leads WHERE is_read=0'),
  };
}
export function photoCount(carId) {
  return num('SELECT COUNT(*) FROM car_photos WHERE car_id = ?', carId);
}
export function brandSlug(b) {
  return String(b).toLowerCase().replace(/\s+/g, '-');
}
