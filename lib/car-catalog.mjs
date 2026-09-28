// Справочник полей «Марка», «Модель», «Поколение» формы «Разместить объявление».
//
// Заказчик 2026-09-28: «сделай стили раскрытия списки как на блоке поиск авто, а также проверь
// выбор марки авто, плохо выбирается, работает криво, не подтягивается модель и выбор поколения».
// Поэтому списки формы строятся из того же каталога, что и блок «Поиск по параметрам»: марки и
// модели — по опубликованным объявлениям (cars), поколения — из карточек машин. Дополнительно к
// маркам каталога идут 166 марок av.by (lib/car-brands.mjs) — продавец может выставить машину,
// которой у дилера ещё не было, а поле остаётся свободным для ручного ввода.
//
// Зависимостей нет: только `all` из db.mjs (страница /sell и так обращается к базе).
import { all } from './db.mjs';
import { AVBY_BRANDS } from './car-brands.mjs';

/* Ключ сравнения, устойчивый к регистру и диакритике: «Citroen» и «Citroën» — одна марка,
   «LADA» и «Lada» — тоже. Так в подсказках не бывает двух почти одинаковых строк, а поиск
   моделей находит каталог дилера, даже если марка набрана без умляута. */
export function catalogKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/* Справочник формы: brands — подсказки марки, models/generations — общие списки для <datalist>
   (так поля работают без JS), tree — марка → модель → поколения (каскад для скрипта). */
/* В базе у части машин в «поколении» стоит заглушка: прочерк или латинская «X» (её ставили,
   когда поколение уже вписано в модель — «X5 G05», «X50»). В подсказках такие значения не нужны:
   они ничего не значат и только удлиняют список. Сами данные не трогаем. */
function realGeneration(value) {
  const g = String(value || '').trim();
  if (!g) return '';
  if (/^[-–—xX]+$/.test(g)) return '';
  return g;
}

export function sellCatalog() {
  const rows = all(`SELECT brand, model, generation, COUNT(*) AS n FROM cars
    WHERE status='published'
    GROUP BY brand, model, generation
    ORDER BY n DESC, brand, model`);
  const tree = {};
  const models = new Set();
  const generations = new Set();
  const dbBrands = [];
  const seenBrand = new Set();

  for (const r of rows) {
    const brand = String(r.brand || '').trim();
    if (!brand) continue;
    const model = String(r.model || '').trim();
    const generation = realGeneration(r.generation);
    const bk = catalogKey(brand);
    if (!seenBrand.has(bk)) { seenBrand.add(bk); dbBrands.push(brand); }
    if (!tree[brand]) tree[brand] = {};
    if (model) {
      models.add(model);
      if (!tree[brand][model]) tree[brand][model] = [];
      if (generation && !tree[brand][model].includes(generation)) {
        tree[brand][model].push(generation);
      }
    }
    if (generation) generations.add(generation);
  }

  /* Марки из базы идут первыми: у них в подсказках есть модели. Дальше — словарь av.by,
     без повторов (сравнение по catalogKey). */
  const brands = dbBrands.slice();
  const have = new Set(dbBrands.map(catalogKey));
  for (const raw of AVBY_BRANDS) {
    const brand = String(raw || '').trim();
    if (!brand) continue;
    const key = catalogKey(brand);
    if (have.has(key)) continue;
    have.add(key);
    brands.push(brand);
  }
  brands.sort((a, b) => a.localeCompare(b, 'ru'));

  const ru = (a, b) => String(a).localeCompare(String(b), 'ru');
  for (const brand of Object.keys(tree)) {
    for (const model of Object.keys(tree[brand])) tree[brand][model].sort(ru);
  }

  return { brands, models: [...models].sort(ru), generations: [...generations].sort(ru), tree };
}
