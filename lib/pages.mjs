// Страницы сайта.
import { all, one, num, run, getSetting } from './db.mjs';
import {
  listCars, carBySlug, carById, decorate, fmt, brands, popularModels, similar,
  facetCounts, incrementViews, carStats, buildQuery, PER_PAGE, SORTS, SORT_LABEL,
  BODY_LABEL, FUEL_LABEL, TRANS_LABEL, DRIVE_LABEL, brandSlug, bynHtml, BYN_TEXT,
} from './cars.mjs';
import { layout, esc, ico, carGrid, carCard, carCards, breadcrumbs, carsMore, section, tile, leadForm, photoImg, photoTag, thumb, plural, paramSearch, brandLine, dealerRow, siteBase, carContactModalHtml, sellCatalogMarkup } from './view.mjs';
import {
  CAR_COLORS, INTERIOR_COLORS, INTERIOR_MATERIALS, CAR_OPTIONS, TRIMS,
  BODY_CHOICES, FUEL_CHOICES, TRANS_CHOICES, DRIVE_CHOICES, interiorText, groupOptions,
} from './car-options.mjs';
import { YANDEX_ORG, YANDEX_REVIEWS } from './yandex.mjs';
import { RATE_PERCENT, MONTHS_MAX, SHARE_DEFAULT, SHARE_MIN, SHARE_MAX, monthlyPayment, creditFor, carPagePayment } from './finance.mjs';
import { SPECIAL_OFFER_LIMIT, SPECIAL_OFFER_WHERE, SPECIAL_OFFER_ORDER } from './special-offer.mjs';
import { socialIcon } from './social.mjs';

const BODY_ICON = { suv: 'car', sedan: 'car', wagon: 'car', minivan: 'car', hatchback: 'car', liftback: 'car', coupe: 'car', van: 'car' };
const SERVICE_ICON = { komissiya: 'handshake', obmen: 'swap', vykup: 'wallet', credit: 'percent', lizing: 'doc' };

/* Цена без разметки: cars.price_text несёт знак рубля как HTML (<span class="byn">Б</span>),
   а там, где строка уходит в текст (заголовок окна, описание, карточка «Поделиться»), нужен
   обычный неразрывный пробел со знаком. */
const plainPrice = (t) => String(t).replace('<span class="byn">Б</span>', BYN_TEXT);

function ctxOf(state) {
  return {
    user: state.user,
    settings: state.settings,
    counts: { favorites: state.favorites.length, compare: state.compare.length, ...state.counts },
    path: state.path,
    services: all("SELECT slug, title FROM pages WHERE section='services' ORDER BY sort") || [],
    brands: brands(),
  };
}

// Из opts перекрывается только brands: главная передаёт brands: [] — полосы марок под шапкой
// там нет, список марок стоит верхней строкой карточки «Поиск по параметрам» (brandChips).
function page(state, opts) {
  const ctx = ctxOf(state);
  return layout({ ...opts, ...ctx, brands: opts.brands === undefined ? ctx.brands : opts.brands });
}

function qs(params, patch = {}, base = '/cars') {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return base + (s ? '?' + s : '');
}

function paramsFrom(url) {
  const p = {};
  for (const [k, v] of url.searchParams) if (v !== '') p[k] = v;
  return p;
}

/* Строка запроса для партии карточек (`GET /api/cars/cards`): текущие фильтры страницы плюс
   режим каталога («all» не пишем — он и так по умолчанию), но без номера страницы: его
   дописывает клиент, запрашивая следующую партию. Ту же строку получает ссылка в <noscript>,
   поэтому с выключенным скриптом адрес остаётся чистым: /cars?page=2. */
function moreQuery(params, mode) {
  const p = mode && mode !== 'all' ? { ...params, mode } : { ...params };
  return qs(p, { page: '' }, '').replace(/^\?/, '');
}

/* ── Правая колонка титульной страницы: поиск по параметрам ── */

function homeTopProps() {
  const ranges = one(`SELECT MIN(year) AS y0, MAX(year) AS y1, MIN(price) AS p0, MAX(price) AS p1,
    MIN(mileage) AS m0, MAX(mileage) AS m1 FROM cars WHERE status='published'`) || {};
  const volumes = all("SELECT DISTINCT volume AS v FROM cars WHERE status='published' AND volume > 0 ORDER BY v").map(r => r.v);
  const models = popularModels(60).map(m => ({ brand: m.brand, model: m.model }));
  const years = [Number(ranges.y0) || 2005, Number(ranges.y1) || new Date().getFullYear()];
  const prices = [Number(ranges.p0) || 0, Number(ranges.p1) || 0];
  const m1 = Number(ranges.m1) || 0;
  const mileages = [20000, 50000, 100000, 150000, 200000, 250000, 300000].filter(v => v < m1).concat(m1 > 300000 ? [m1] : []);
  return { years, volumes, prices, mileages, models };
}

/* Марки: список марок (brandLine — марка + количество, без заголовка и без «Все марки») стоит
   светлой строкой НАД панелью поиска. Заказчик 2026-09-27: «убери после шапки на всех страницах
   на сером фоне. Сделай … как на титульной на страницах Автомобили с пробегом, Новые, Электро» —
   тёмная полоса марок в шапке (brandStrip) убрана со всех страниц, а список марок показывается
   на главной (homeBrands) и на всех четырёх страницах каталога (brandsTop ниже). Сначала на «Все
   авто» (/cars) списка не было (так выбрал заказчик), затем он его попросил: «В /cars добавь —
   Alfa Romeo 1 Audi 2 … как на домашней странице». Список строится по ВСЕМ опубликованным авто
   (brands() в lib/cars.mjs), поэтому на всех пяти страницах он одинаковый. На остальных страницах
   (Автожурнал, Услуги, Контакты, Отзывы, Продать, Калькулятор, Продано) марок нет вообще. */

/* Классическая панель «Поиск по параметрам» во всю ширину .wrap — та же колонка, что у
   блоков «Выбор дилера» и «Новые поступления». Разметка одна на главной и в каталоге
   (шапка, компактный режим и подвал одинаковые): extra передаёт то, чем каталог от
   главной отличается — режимы выдачи, текущий фильтр и адрес формы, см. catalog(). */
function searchBand(brands, props, extra = {}) {
  return `<section class="ps-band" aria-label="Поиск по параметрам"><div class="wrap">
  ${paramSearch({
    brands,
    models: props.models || [],
    years: props.years,
    vols: props.volumes,
    prices: props.prices,
    mileages: props.mileages,
    head: true,
    foot: true,
    more: true,
    count: props.total,
    ...extra,
  })}
</div></section>`;
}

/* Список марок главной вровень с панелью поиска (тот же .wrap и та же колонка 1220 px),
   стоит над ней, без заголовка «Марки N» и без плашки «Все марки N» (заказчик: «Все марки 57 —
   убери»): только марки по алфавиту и их количество рядом с названием. */
function homeBrands(brands) {
  return `<div class="wrap home-brands">${brandLine(brands, { head: false, all: false })}</div>`;
}

/* Тот же список марок — над панелью поиска на всех страницах каталога: «Все авто», «Автомобили с
   пробегом», «Новые» и «Электро» (заказчик 2026-09-27: «Сделай … как на титульной на страницах
   Автомобили с пробегом, Новые, Электро»; тёмная полоса марок в шапке убрана; позже список
   добавлен и на /cars: «В /cars добавь … как на домашней странице»). Разметка и класс те же, что на
   главной, поэтому оформление (.home-brands — прозрачный список без карточки, 9 колонок = два ряда,
   воздух до панели поиска 16 px) одно на всех пяти страницах, отдельных правил в site.css не нужно. */
function brandsTop(brands, listUrl = '/cars') {
  /* Ссылки марок ведут на ту же выдачу, что открыта сейчас: с «С пробегом» марка не сбрасывает
     режим на «Все авто», а фильтрует внутри раздела (заказчик 02.10.2026, с телефона: «при нажатии
     на авто из блока выбора авто и их количества … не происходит фильтр в кнопке — Показать
     автомобили 57»). Счётчик на кнопке сервер считает по тем же условиям, что и выдачу, поэтому
     после перехода на «?brand=…» он показывает число машин выбранной марки. */
  const href = (b) => (b ? listUrl + '?brand=' + encodeURIComponent(b) : listUrl);
  return `<div class="wrap home-brands brands-top">${brandLine(brands, { head: false, all: false, href })}</div>`;
}

/* ── Отзывы: снимок Яндекс.Карт ─────────────────────────── */

function stars(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// Дробная полоса звёзд: заливка ровно по среднему (4,7 → 94 %), без округления до целой.
// Разметка — две наложенные строки звёзд: серая подложка <i> и золотая <b> шириной --fill.
function starBar(rating, size = 15) {
  const v = Math.max(0, Math.min(5, Number(rating) || 0));
  const fill = ((v / 5) * 100).toFixed(1);
  return `<span class="star-bar" style="--fill:${fill}%;font-size:${size}px" role="img" aria-label="${String(v).replace('.', ',')} из 5"><i>★★★★★</i><b>★★★★★</b></span>`;
}

// Минималистичная строка рейтинга: без карточки, рамки, тени и подложки — логотип 24 px,
// оценка, дробная полоса звёзд, счётчик и подпись источника в одну линию.
function yandexBadge() {
  const y = YANDEX_ORG;
  return `<a class="yx-badge" href="${esc(y.url)}" target="_blank" rel="noopener noreferrer" title="Открыть отзывы на Яндекс.Картах">
    <span class="yx-logo" aria-hidden="true">Я</span>
    <b class="yx-rating">${String(y.rating).replace('.', ',')} из 5</b>
    ${starBar(y.rating, 13)}
    <span class="yx-cnt">${y.ratings} ${plural(y.ratings, 'оценка', 'оценки', 'оценок')} · ${y.reviews} ${plural(y.reviews, 'отзыв', 'отзыва', 'отзывов')}</span>
    <span class="yx-src">Яндекс Карты</span>
  </a>`;
}

/* Строка под отзывом — только имя и город (просьба заказчика: «в низу оставь только Имя и город,
   где города нет, ставь по умолчанию Гомель»). Дата и метка «Яндекс» из карточки убраны: они
   были в блоке отзывов с Яндекс.Карт (` · 12 ноября 2025 · Яндекс`), источник и так виден в
   шапке раздела — бейдж «Яндекс Карты» и ссылка «Все отзывы на Яндексе». Город берём из данных,
   а если его нет (в снимке Яндекс.Карт города не отдаются) — подставляем Гомель: площадка одна,
   все отзывы о ней. Разделитель «·» одинаковый у обоих видов карточек, иначе отзывы с базы и с
   Карт, стоящие в одной сетке на главной, выглядели бы по-разному. */
const REVIEW_CITY_DEFAULT = 'Гомель';
function reviewWho(author, city) {
  return `<div class="who">${esc(author)} · ${esc(city || REVIEW_CITY_DEFAULT)}</div>`;
}

function yandexReviewCard(r) {
  return `<div class="review yx-review">
    <div class="stars">${stars(r.rating)}</div>
    <p style="margin:0">${esc(r.text)}</p>
    ${reviewWho(r.author, r.city)}
  </div>`;
}

/* Короткие подписи для «таблеток» в маленькой карточке: «Автомат» и «Робот / вариатор» в 190 px
   не влезают, латинские AT/MT (как в .car-price small у каталожной карточки) в ряду русских
   подписей читаются хуже, а amt в общем словаре сокращений вообще сводится к AT и врёт про
   коробку. Привод — словом: рядом с «АКПП» этого достаточно, «полный привод» заняло бы строку. */
const HOT_TRANS = { at: 'АКПП', mt: 'МКПП', amt: 'Робот' };

/* Скидка и цена «до скидки» — из cars.discount (2 000–4 000 руб.), в шаблоне не выдумываются.
   Считаем только там, где есть от чего считать: у машин «цена по запросу» (price = 0) и сумма
   скидки, и зачёркнутое «было» были бы выдумкой. Одна функция на карточку спецпредложения, на
   страницу автомобиля и на проверки — чтобы сумма нигде не разошлась. */
function discountInfo(c) {
  const amount = c.price > 0 ? (Number(c.discount) || 0) : 0;
  return { amount, before: amount > 0 ? c.price + amount : 0 };
}

/* Отбор «Горящей продажи» — один на героя главной, на страницу автомобиля и на демонстрационные
   скидки в базе: плашка «Горящая продажа» на странице машины обязана совпадать с тем, что человек
   видел в блоке, а скидка — стоять ровно у этих машин (см. lib/special-offer.mjs, там же критерий
   и его обоснование: опубликованные авто с настоящей ценой и фото, по возрастанию цены, первым
   ключом featured; пять карточек). Сам запрос оставлен здесь, а куски SQL (что за машина и в каком
   порядке) — общие, поэтому менять отбор нужно в одном месте.
   Было три карточки, стало пять — заказчик 2026-09-27: «добавь ещё на свой выбор две карточки из
   имеющихся авто». Выбор сделан тем же правилом, а не вручную: к прежней тройке добавились
   следующие по цене машины с фото — Honda Jazz II (15 900) и Hyundai Tucson I (16 900). Пятёрка
   получается разнообразной сама собой: Ford, Chevrolet, Peugeot, Honda, Hyundai — пять разных
   марок, у каждой 12 фото. Скидка 2 000–4 000 руб. из cars.discount есть только у этих пяти машин:
   заказчик 2026-09-30 «с большей частью объявлений которые не задействованы в спецпрограммах
   удалить скидку» — у остальных объявлений плашки «Скидка» и зачёркнутого «было» нет. */
function hotCars(limit = SPECIAL_OFFER_LIMIT) {
  return all(`SELECT c.* FROM cars c WHERE ${SPECIAL_OFFER_WHERE}
    ORDER BY ${SPECIAL_OFFER_ORDER} LIMIT ${Math.max(1, Number(limit) || SPECIAL_OFFER_LIMIT)}`).map(decorate);
}
const HOT_DRIVE = { fwd: 'передний', awd: 'полный', rwd: 'задний' };

/* Карточка «Горящей продажи» в герое главной: листающиеся фото, скидка и плашка «Горящая
   продажа» на самом кадре. Отдельная разметка, а не carCard(): карточка шириной ~190 px,
   каталоговые бейджи, «избранное» и «сравнить» туда не помещаются.
   Заказчик: «Горящая продажа — перенеси на фото авто справа внизу и выдели её чем-то, чтобы было
   заметно, и чтобы как диммер подсвечивалась, и должны листаться фотки, и должна быть видна
   скидка, например от 2000 до 4000 руб.». Отсюда: подпись над блоком убрана, плашка живёт в
   правом нижнем углу кадра (пульсирующее свечение — в CSS, .hot-hot), скидка — плашкой в левом
   верхнем углу кадра плюс зачёркнутой ценой «до скидки» рядом с ценой, а кадры листаются сами
   (data-autoplay) и по стрелкам/точкам — тот же обработчик initCarousels в site.js, что и в
   каталоге. Сумма скидки берётся из cars.discount (2 000–4 000 руб.) — не выдумывается в шаблоне
   и есть только у машин спецпредложения: остальным объявлениям демонстрационную скидку база не
   ставит (lib/db.mjs: backfillDiscounts), поэтому в блоке скидка стоит у всех пяти карточек, а на
   страницах остальных машин её нет.
   Вся карточка, кроме кнопок карусели, остаётся ссылкой на автомобиль: поверх кадра лежит
   «хит»-ссылка .hot-hit.
   Под названием, годом с пробегом и ценой стоит ряд параметров .hot-specs (объём, коробка,
   привод, мощность, топливо, кузов) — заказчик: «Добавь больше параметров авто в карточки
   спецпредложения, там есть место». Название ужимается в одну строку с многоточием: «сокращай,
   чтобы не было переносов на следующую строчку» (правило — в CSS, .hot-body b).
   У новой машины (флаг is_new — тот же, что даёт красную плашку «Новый» в каталоге) на кадре
   появляется такая же красная плашка в правом верхнем углу: заказчик просил, чтобы слово «Новый»
   было видно и в спецпредложении. Сегодня в тройке таких машин нет (это три самых доступных
   автомобиля с фото), но правило общее для любой карточки блока. */
function hotCard(c) {
  const photos = (c.photos || []).slice(0, 6);
  const title = c.brand + ' ' + c.model;
  const href = `/car/${esc(c.slug)}`;
  const alt = esc(title + ', ' + c.year);
  /* Скидку показываем только там, где есть от чего считать: у машин «цена по запросу» (price = 0)
     зачёркнутое «было» и сумма скидки были бы выдумкой, поэтому такие карточки в блок не попадают
     (price > 0 в отборе hotCars) — здесь остаётся страховка на случай ручной правки данных. */
  const { amount: discount, before } = discountInfo(c);

  const media = photos.length > 1
    ? `<div class="carousel" data-carousel data-autoplay="4000">
        <div class="carousel-track" data-track>${photos.map((p, i) => photoTag(p, alt, i ? ' data-slide fetchpriority="low"' : ' data-slide')).join('')}</div>
        <button class="carousel-btn prev" type="button" data-prev aria-label="Предыдущее фото">${ico('chevL', 22)}</button>
        <button class="carousel-btn next" type="button" data-next aria-label="Следующее фото">${ico('chevR', 22)}</button>
        <div class="carousel-dots" data-dots>${photos.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
      </div>`
    : photoImg(photos[0], title);

  /* Параметры авто — строкой под названием: объём, коробка, привод, мощность, топливо, кузов.
     Всё из базы (decorate() в lib/cars.mjs), ничего не додумывается: чего у машины нет — той
     подписи и нет, ряд просто становится короче. Год и пробег остаются строкой .hot-meta.
     Заказчик 2026-09-27: «в самих карточках параметры авто сделай без фона» — «таблетки» с серой
     подложкой убраны, параметры идут одним текстом через тонкую точку-разделитель (правило и
     разделитель — .hot-specs в site.css). Разметка при этом не изменилась: те же <span>, поэтому
     проверки, которые считают параметры, продолжают работать.
     Почему обычно пять подписей, а не шесть: мощность заполнена у 10 авто из 57, цвет — тоже у 10,
     расход (fuel_use) — у 3, комплектация хотя и есть у всех, но это длинный текст (до 1024 знаков
     вплоть до «Салон тёмный, комбинированные материалы») — ни то, ни другое «таблеткой» не станет.
     Коробка, привод, топливо и кузов заполнены у всех 57, объём — у 55 (проверено
     _ref/diag-param-coverage.mjs), поэтому ряд никогда не пустой. */
  const specs = [
    c.volume ? `<span class="num">${esc(String(c.volume).replace('.', ','))} л</span>` : '',
    c.transmission ? `<span>${esc(HOT_TRANS[c.transmission] || c.trans_label || '')}</span>` : '',
    c.drive ? `<span>${esc(HOT_DRIVE[c.drive] || c.drive_label || '')}</span>` : '',
    c.power ? `<span class="num">${esc(String(c.power))} л.с.</span>` : '',
    c.fuel ? `<span>${esc(String(c.fuel_label || '').toLowerCase())}</span>` : '',
    c.body ? `<span>${esc(String(c.body_label || '').toLowerCase())}</span>` : '',
  ].filter(Boolean).join('');

  return `<div class="hot-card" data-hot-card>
    <div class="hot-media">
      <a class="hot-hit" href="${href}" aria-label="${esc(title + ', ' + c.year + ' — открыть карточку автомобиля')}"></a>
      ${media}
      ${c.is_new ? '<span class="hot-new">Новый</span>' : ''}
      ${discount > 0 ? `<span class="hot-disc num">−${bynHtml(discount)}</span>` : ''}
      <span class="hot-hot"><i class="dot"></i>Горящая продажа</span>
    </div>
    <a class="hot-body" href="${href}" title="${esc(title + ', ' + c.year)}">
      <b>${esc(title)}</b>
      <span class="hot-meta">${c.year} г. · ${fmt(c.mileage)} км</span>
      ${specs ? `<span class="hot-specs">${specs}</span>` : ''}
      <span class="hot-price num">${c.price_text}${before ? `<s class="hot-old">${bynHtml(before)}</s>` : ''}</span>
    </a>
  </div>`;
}

/* ── Главная ────────────────────────────────────────────── */
export function home(state) {
  /* Раздел «Выбор дилера» — четыре карточки. Заказчик сначала просил восемь («В разделе Выбор дилера
     — сделай показ только 8 карточек авто»), затем 2026-09-27: «оставь в нем 4 первые 4 карточки
     авто, последующие 4 карточки убери» — в блоке остались первые четыре по цене (BMW X5 G05 2022,
     Geely Monjaro 2024, Belgee X70 I 2024, Audi A5 F5 2018), у остальных четырёх флаг featured снят
     (и в базе, и в ленте `data/seed-cars.json`, скрипт `_ref/deploy/dealer-4.mjs`): галка в кабинете
     называется «Показывать в блоке „Выбор дилера“», и помеченная машина, которой в блоке нет, врала бы
     владельцу. Потолок LIMIT 4 совпадает с числом помеченных машин, `slice(0, 4)` — страховка на
     случай, если выборка когда-нибудь станет шире. */
  const featured = all(`SELECT c.* FROM cars c WHERE c.status='published' AND c.featured=1 ORDER BY c.price DESC LIMIT 4`).map(decorate);
  /* Раздел «Новые поступления» — машины с флагом «Новое объявление» (is_new): тот же флаг даёт
     красную плашку «Новый» на карточке и плашку «Новое объявление» на странице авто, поэтому в
     разделе не может быть карточки без плашки. Заказчик: «Сделай авто новый в 4 карточках, и
     показывай в разделе только эти 4 карточки» — значит в базе помечены ровно четыре последних
     поступления, а не восемь последних по дате (как было раньше). Флаг ставят при добавлении
     машины (сид, форма админки, заявка с сайта), в кабинете его можно снять — тогда машина уходит
     из раздела. Потолок 8 оставлен как страховка от разрастания блока. */
  const fresh = all(`SELECT c.* FROM cars c WHERE c.status='published' AND c.is_new=1 ORDER BY c.created_at DESC, c.id DESC LIMIT 8`).map(decorate);
  const bl = brands();
  const total = num("SELECT COUNT(*) FROM cars WHERE status='published'");
  const topProps = homeTopProps();

  /* Карточки «Горящая продажа» в правой части героя (заказчик: «На месте где были кнопки,
     размести 3 маленькие карточки со спецпредложением и назови их — Горящая продажа»; из
     предложенных вариантов выбрал «3 автомобиля из каталога — самые доступные с фото»).
     Заказчик 2026-09-27: «блок с горящим предложением на титульный наверху сделай как Centered
     Slider и добавь ещё на свой выбор две карточки из имеющихся авто» — карточек стало пять
     (см. hotCars), а сам блок стал каруселью с центральной карточкой: активная стоит по центру
     правой колонки, соседние выглядывают по краям уменьшёнными и приглушёнными, листается
     стрелками, точками, свайпом и сама (initHotSliders в site.js). Разметка блока — ниже в
     body; сам отбор живёт в hotCars() выше — он один на герой и на страницу автомобиля, чтобы
     плашка «Горящая продажа» на странице машины совпадала с блоком. */
  const hot = hotCars(5);

  /* Блок «Лидеры продаж» — заказчик 2026-09-27: «перед блоком Выбор дилера, сделай блок Лидеры
     продаж и размести рондомно из карточек авто которые не участвуют в других разделах».
     «Не участвуют в других разделах» прочитано как «не показаны в других блоках главной»: из
     выборки вычтены «Выбор дилера» (флаг featured), «Новые поступления» (флаг is_new) и
     «Горящая продажа» (тройка hotCars в герое) — иначе один и тот же автомобиль стоял бы на
     странице дважды. После вычитания остаётся около сорока машин.
     Вторая правка того же дня: «в лидерах продаж убери Geely электрическую и Alfa Romeo это не
     сильно ликвидные автомобили Замени на самые популярные. В блоке лидеры продаж Оставь 4
     карточки авто, а не 8» — случайная восьмёрка заменена рейтингом популярности и четырьмя
     карточками. «Geely электрическая» — это Geely EX5 (в базе топливо electric) и её же
     электрическая модель Geely Geometry C (в базе у неё топливо petrol, поэтому одного условия
     по топливу мало), Alfa Romeo — единственная 159-я.
     Третья правка (2026-09-27, заказчик выбрал вариант «заменить карточки без цены на ликвидные с
     ценой»): чистый рейтинг по просмотрам ставил в блок Belgee X50 и BMW 5 серии F07 (GT) — обе
     «Цена по запросу», 43 и 4 просмотра. В пуле просмотры почти плоские: 303 и 200 у первых двух,
     дальше 43, 5 и по 3–4 у всех остальных, поэтому «самые популярные» по счётчику — лотерея из
     машин по три просмотра. Состав блока теперь список ходовых моделей (LEADERS ниже): Geely
     Emgrand II, Hyundai Creta I, Renault Kaptur I, Renault Sandero Stepway II. Внутри модели берётся
     самая просматриваемая машина, а если модели нет в наличии (продана, ушла в «Выбор дилера» или
     «Новые поступления»), слот добирается верхом рейтинга по просмотрам — блок не остаётся с
     тремя карточками. Машины без цены из блока убраны: «лидер продаж» без цены читается как
     недоделанная карточка. Кнопка «Популярные» по-прежнему ведёт на сортировку каталога по
     просмотрам, а не на этот список.
     Четвёртая правка (2026-09-27): «Из раздела - лидеры продаж, убери Ауди Q5 8R и замени на другой
     авто, который не используется в других блоках» — Audi Q5 8R 2010 (39 900 ₽, 375 860 км, 201
     просмотр) заменён на Hyundai Creta I 2018 (35 900 ₽, 198 892 км) — самый популярный кроссовер
     в Беларуси, в других блоках главной не показан (ни featured, ни is_new, ни в герое), 12 фото.
     Кандидаты из того же пула, если заказчик захочет другой: Nissan Qashqai II 2015 (41 900 ₽),
     Ford Escape IV 2019 (59 900 ₽, 81 000 км), Geely Atlas I 2021 (44 900 ₽).
     Внутри рейтинга оставляем по одной машине на модель: без этого в блок вставали две Belgee X50
     подряд (одна модель, разные годы) и четвёрка выглядела как дубль, а не как список лидеров. */
  const LEADERS = [
    ['Geely', 'Emgrand II'],
    ['Hyundai', 'Creta I'],
    ['Renault', 'Kaptur I'],
    ['Renault', 'Sandero Stepway II'],
  ];
  const hotIds = hot.map((c) => Number(c.id));
  const rated = all(`SELECT * FROM (
      SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.brand, c.model ORDER BY c.views DESC, c.id DESC) AS rn
      FROM cars c WHERE c.status='published' AND c.featured=0 AND c.is_new=0 AND c.price > 0
        AND c.id NOT IN (${hotIds.join(',') || 0})
        AND NOT (c.brand = 'Alfa Romeo')
        AND NOT (c.brand = 'Geely' AND (c.fuel = 'electric' OR lower(c.model) LIKE '%geometry%'))
    ) WHERE rn = 1
    ORDER BY views DESC, id DESC`).map(decorate);
  const ratedByModel = new Map(rated.map((c) => [`${c.brand}\u0000${c.model}`, c]));
  const leaders = LEADERS.map(([brand, model]) => ratedByModel.get(`${brand}\u0000${model}`)).filter(Boolean);
  for (const c of rated) {
    if (leaders.length >= LEADERS.length) break;
    if (!leaders.includes(c)) leaders.push(c);
  }

  for (const c of featured.concat(fresh, leaders)) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', c.id).map(p => p.path);
  for (const c of hot) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', c.id).map(p => p.path);

  /* Кнопки героя, заказчик 2026-10-02: «Убери кнопку - Заказать звонок, а в кнопке - разместить
     объявление, добавь иконку по типу как в кнопке - Поставить авто на продажу». Кнопок две,
     значок у обеих: верхняя («Разместить объявление» → /sell, полная форма с фотографиями) несёт
     лист объявления ico('doc'), нижняя («Поставить авто на продажу») — бирку ico('tag') и короткое
     окно заявки (data-sale-modal, lib/view.mjs: saleModalHtml). Кнопка «Заказать звонок» и её окно
     (data-call-modal, lib/view.mjs: callModalHtml) убраны с главной; разметка окна и её обработчик
     в public/assets/js/site.js остались, поэтому вернуть кнопку можно одной строкой с data-call-open.
     Пояснение намеренно в JS-комментарии, а не в HTML: всё, что попадает в разметку, уходит в ответ
     сервера и в публичную статичную копию. */
  const body = `
  <section class="hero"><div class="wrap hero-in">
    <div class="hero-copy">
      <div class="hero-main">
        <h1>Автомобили с пробегом и проверенной историей</h1>
        <!-- Лид собран из смысловых кусков (span.lead-line): на телефоне каждый кусок встаёт своей
             строкой и внутри себя не переносится — просьба заказчика 2026-09-29 «сделай, что бы не
             переносились на следующие вниз строчки». Границы кусков выбраны так, чтобы строка
             обрывалась на запятой или на предлоге, а не на одном висящем слове. Кегль на телефоне
             и ширины кусков — правило .hero p.lead .lead-line в site.css (блок ≤640 px). -->
        <p class="lead"><span class="lead-line">Каждый автомобиль проходит диагностику</span> <span class="lead-line">по 42 пунктам и проверку по VIN.</span> <span class="lead-line">Гарантия юридической чистоты, кредит</span> <span class="lead-line">и лизинг — оформление на месте.</span></p>
        <div class="hero-dealer">${dealerRow()}</div>
        <div class="hero-cta">
          <a class="btn btn-lg" href="/sell">${ico('doc', 17)} Разместить объявление</a>
          <button class="btn btn-lg btn-sale" type="button" data-sale-open>${ico('tag', 17)} Поставить авто на продажу</button>
        </div>
      </div>
      <div class="hero-hot">
        <div class="hot-slider" data-hot-slider data-autoplay="7000"
             role="group" aria-roledescription="карусель" aria-label="Горящая продажа: пять автомобилей каталога со скидкой">
          <div class="hot-cards" data-hot-track>${hot.map(hotCard).join('')}</div>
          <button class="hot-nav prev" type="button" data-hot-prev aria-label="Предыдущий автомобиль">${ico('chevL', 22)}</button>
          <button class="hot-nav next" type="button" data-hot-next aria-label="Следующий автомобиль">${ico('chevR', 22)}</button>
          <div class="hot-dots" data-hot-dots>${hot.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
        </div>
      </div>
    </div>
  </div></section>

  ${homeBrands(bl)}
  ${searchBand(bl, { ...topProps, total })}

  ${leaders.length ? section('Лидеры продаж', 'Автомобили, которые выбирают чаще всего: диагностика по 42 пунктам, проверка по VIN, готовы к выдаче.', carGrid(leaders, { favorites: state.favoritesSet, compare: state.compareSet }),
    `<a class="btn btn-ghost" href="${qs({ sort: 'popular' })}">Популярные</a>`) : ''}

  ${section('Выбор дилера', 'Автомобили, которые прошли полную предпродажную подготовку и готовы к выдаче сегодня.', carGrid(featured.slice(0, 4), { favorites: state.favoritesSet, compare: state.compareSet }),
    '<a class="btn btn-ghost" href="/cars">Весь каталог</a>')}

  ${section('Новые поступления', 'Каталог пополняется несколько раз в неделю. Настройте фильтр и подпишитесь на обновления.', carGrid(fresh, { favorites: state.favoritesSet, compare: state.compareSet }),
    `<a class="btn btn-ghost" href="${qs({ sort: 'new_desc' })}">Все поступления</a>`)}

  ${false ? section('Как купить автомобиль у нас', 'Четыре шага от выбора до выдачи ключей.', `
    <div class="tiles">
      ${['Выберите автомобиль в каталоге или приезжайте на площадку — покажем наличие',
         'Проверьте историю по VIN и пройдите тест-драйв',
         'Оформите сделку: наличные, кредит, лизинг или trade-in',
         'Получите автомобиль с полным пакетом документов'].map((t, i) => `
        <div class="tile"><div class="ico num" style="font-size:18px;font-weight:700">${i + 1}</div><b>Шаг ${i + 1}</b><span>${esc(t)}</span></div>`).join('')}
    </div>`) : ''}

  ${section('Отзывы покупателей', '', `
    <div class="reviews-head">${yandexBadge()}</div>
    <div class="reviews">${all('SELECT * FROM reviews WHERE published=1 ORDER BY id DESC LIMIT 3').map(reviewCard).join('')}
      ${YANDEX_REVIEWS.slice(0, 3).map(yandexReviewCard).join('')}</div>`,
    `<a class="btn btn-ghost" href="${YANDEX_ORG.url}" target="_blank" rel="noopener noreferrer">Все отзывы на Яндексе</a>`)}
  `;

  return page(state, {
    title: 'Автонова с пробегом — автомобили с пробегом в Гомеле | Каталог, кредит, trade-in',
    description: `Каталог автомобилей с пробегом от официального дилера «Автонова» в Гомеле: ${total} автомобилей, проверка по VIN, гарантия юридической чистоты, кредит и лизинг на месте.`,
    body,
    brands: [],
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'AutoDealer',
      name: 'Автонова с пробегом', image: siteBase() + '/assets/logo/logo.png',
      telephone: getSetting('phone_1'), address: { '@type': 'PostalAddress', addressCountry: 'BY', addressLocality: 'Гомель', streetAddress: 'ул. Мазурова, 112' },
      openingHours: 'Mo-Fr 09:00-19:00, Sa-Su 10:00-18:00', priceRange: 'BYN',
    },
  });
}

function reviewCard(r) {
  return `<div class="review">
    <div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
    <p style="margin:0">${esc(r.text)}</p>
    ${reviewWho(r.author, r.city)}
  </div>`;
}

/* ── Каталог ────────────────────────────────────────────── */
/* Режим каталога → опции выборки. Одна правда и для страницы, и для партии карточек
   (`carsBatch`): иначе бесконечная лента подгружала бы не то, что показывает страница.
   У «Новых» это не флаг «Новое объявление», а критерий нового автомобиля — год выпуска не
   старше текущего, пробег до 500 км или слово «новый» в описании (NEW_CAR_SQL в cars.mjs).
   Заказчик 2026-09-27: «новые поступления не равно новый автомобиль». */
export function catalogFilter(mode, params = {}) {
  const opts = {};
  if (mode === 'new') opts.newCar = true;
  if (mode === 'electric') params.fuel = 'electric';
  return opts;
}

/* Число автомобилей под текущий набор условий — для счётчика на кнопке «Показать автомобили N».
   Заказчик 2026-09-27: «при изменении переменных в поиске сделай, чтобы в кнопке показать
   автомобили счётчик менялся соответствующие выбранным параметрам». Условия берём ровно те же,
   что у страницы и ленты карточек (`catalogFilter`), поэтому число на кнопке не расходится с
   выдачей: и панель поиска, и лента, и этот счётчик ходят через один фильтр. Считаем только
   COUNT — карточки здесь не нужны, а панель спрашивает счётчик на каждое изменение поля. */
export function carsCount(state, params = {}) {
  const p = { ...params };
  const mode = p.mode || 'all';
  delete p.mode;
  const { where, args } = buildQuery(p, catalogFilter(mode, p));
  return { status: 'ok', total: num(`SELECT COUNT(*) FROM cars c WHERE ${where}`, ...args) };
}

/* Выдача каталога вместе с фотографиями карточек — то, что нужно и сетке `.cars`, и ленте. */
export function carsRows(state, params, opts = {}) {
  const data = listCars(params, opts);
  const rows = data.rows.map(decorate);
  for (const c of rows) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', c.id).map(p => p.path);
  return { data, rows };
}

/* Партия карточек для нескончаемой ленты каталога (`GET /api/cars/cards`). Отвечаем готовым
   HTML карточек и сведениями о выдаче, чтобы клиенту не пришлось собирать карточки самому;
   `mode` приходит параметром, потому что у `/cars-new` и `/electric` один и тот же путь API. */
export function carsBatch(state, params = {}) {
  const p = { ...params };
  const mode = p.mode || 'all';
  delete p.mode;
  const { data, rows } = carsRows(state, p, catalogFilter(mode, p));
  return {
    status: 'ok',
    html: carCards(rows, { favorites: state.favoritesSet, compare: state.compareSet }),
    page: data.page, pages: data.pages, total: data.total, per_page: data.per_page, sort: data.sort,
  };
}

export function catalog(state, url, mode = 'all') {
  const params = paramsFrom(url);
  const opts = catalogFilter(mode, params);
  /* Условия, которые режим страницы задаёт сам (на «Электро» — топливо, см. catalogFilter):
     в панели поиска это не выбор посетителя, поэтому блок «Параметры» из-за них не
     раскрывается — остаётся свёрнутым, как на «Все авто» и «Новых». */
  const preset = mode === 'electric' ? ['fuel'] : [];
  let title = 'Автомобили в наличии';
  let lead = 'Полный каталог площадки «Автонова с пробегом».';
  let crumb = [{ href: '/', label: 'Главная' }, { label: 'Автомобили' }];
  if (mode === 'used') { title = 'Автомобили с пробегом'; lead = 'Проверенные автомобили с историей обслуживания и юридической чистотой.'; crumb = [{ href: '/', label: 'Главная' }, { label: 'Автомобили с пробегом' }]; }
  if (mode === 'new') { title = 'Новые автомобили'; lead = 'Автомобили текущего года выпуска, без пробега или с пробегом до 500 км.'; crumb = [{ href: '/', label: 'Главная' }, { label: 'Новые автомобили' }]; }
  if (mode === 'electric') { title = 'Электроавто'; lead = 'Электромобили в наличии: тише, дешевле в обслуживании, зарядка дома.'; crumb = [{ href: '/', label: 'Главная' }, { label: 'Электроавто' }]; }

  const { data, rows } = carsRows(state, params, opts);
  const bl = brands();
  const props = homeTopProps();
  const listUrl = mode === 'used' ? '/cars-used' : mode === 'new' ? '/cars-new' : mode === 'electric' ? '/electric' : '/cars';
  const modes = [
    { label: 'Все авто', href: '/cars', on: mode === 'all' },
    { label: 'С пробегом', href: '/cars-used', on: mode === 'used' },
    { label: 'Новые', href: '/cars-new', on: mode === 'new' },
    { label: 'Электро', href: '/electric', on: mode === 'electric' },
  ];
  const pluralWord = plural(data.total, 'автомобиль', 'автомобиля', 'автомобилей');

  const body = `
  ${breadcrumbs(crumb)}
  <div class="wrap">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">${esc(title)}</h1><p>${esc(lead)}</p></div></div>
  </div>
  ${brandsTop(bl, listUrl)}
  ${searchBand(bl, props, { action: listUrl, params, modes, resetHref: listUrl, count: data.total || '', preset, mode })}
  <div class="wrap page-pb">
    <div class="list-head" id="list">
      <h2>Найдено <b class="num">${fmt(data.total)}</b> ${pluralWord}</h2>
      <div class="sort-box">
        <span class="small muted">Сортировка</span>
        <select data-sort style="width:auto;min-width:210px">
          ${Object.keys(SORTS).map(k => `<option value="${k}"${data.sort === k ? ' selected' : ''}>${esc(SORT_LABEL[k])}</option>`).join('')}
        </select>
      </div>
    </div>
    ${carGrid(rows, { favorites: state.favoritesSet, compare: state.compareSet })}
    ${carsMore({ query: moreQuery(params, mode), page: data.page, pages: data.pages, total: data.total, perPage: PER_PAGE })}
  </div>`;

  return page(state, {
    title: `${title} — Автонова с пробегом`,
    description: `${title}: ${data.total} автомобилей в каталоге «Автонова с пробегом», Гомель. Проверка по VIN, кредит, лизинг, trade-in.`,
    body,
  });
}

export function brandPage(state, brandKey) {
  const bl = brands();
  const found = bl.find(b => brandSlug(b.brand) === brandKey) || bl.find(b => b.brand.toLowerCase() === brandKey);
  if (!found) return notFound(state);
  const params = paramsFrom(new URL('http://x/' + (state.query || '')));
  const { data, rows } = carsRows(state, { ...params, brand: found.brand });
  const models = all("SELECT model, COUNT(*) n FROM cars WHERE status='published' AND brand=? GROUP BY model ORDER BY n DESC", found.brand);
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { href: '/cars', label: 'Автомобили' }, { label: found.brand }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">${esc(found.brand)} с пробегом</h1><p>${found.n} ${plural(found.n, 'автомобиль', 'автомобиля', 'автомобилей')} марки ${esc(found.brand)} в наличии на площадке в Гомеле.</p></div></div>
    <div class="chips" style="margin-bottom:22px">
      ${models.map(m => `<a class="chip" href="/cars?brand=${encodeURIComponent(found.brand)}&model=${encodeURIComponent(m.model)}">${esc(m.model)}<i class="cnt num">${m.n}</i></a>`).join('')}
    </div>
    ${carGrid(rows, { favorites: state.favoritesSet, compare: state.compareSet })}
    ${carsMore({ query: moreQuery({ ...params, brand: found.brand }, 'all'), page: data.page, pages: data.pages, total: data.total, perPage: PER_PAGE })}
  </div>`;
  return page(state, {
    title: `${found.brand} с пробегом — купить в Гомеле | Автонова`,
    description: `${found.brand} с пробегом: ${found.n} автомобилей в наличии у официального дилера «Автонова», Гомель.`,
    body,
  });
}

/* ── Карточка автомобиля ────────────────────────────────── */

/* Объём двигателя в записи av.by: «1,8», «2,0», «1,5». Одна цифра после запятой — как в каталоге:
   «2 л» в модификации читалось бы как литраж без десятых («2 Автомат»). */
function vol(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1).replace('.', ',') : '';
}

/* «опубликовано 26 сентября» — как мета-строка объявления на av.by, где рядом с номером стоят
   дата публикации и поднятия. Число года не показываем: объявления живут неделями, и «26 сентября
   2026» длиннее строки, ничего не добавляя. Месяцы — в родительном падеже (26 сентября, 3 марта). */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function ruDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  const day = Number(m[3]);
  const month = MONTHS_GEN[Number(m[2]) - 1];
  return month ? `${day} ${month}` : '';
}

/* «Поделиться» — рядом значков на главном фото объявления (заказчик 2026-09-30: «Поделиться
   Telegram Viber WhatsApp Скопировать ссылку, — сделай на фото в карточках авто, — значками»;
   в уточнении выбрано большое фото на странице автомобиля и постоянная видимость значков).
   Значки лежат на кадре в правом верхнем углу и видны всегда: на телефоне наведения нет, а
   прятать их до наведения заказчик не просил. Заказчик 2026-10-01: «на странице автомобиля на
   фотографии кнопки четыре штуки внизу с левой стороны, размести их справа вверху на фотографии»
   — угол задан стилями `.gal-share` в public/assets/css/site.css. Подписи остались в title и
   aria-label — сеть
   узнаётся по фирменному знаку (знаки сетей — lib/social.mjs, значок копирования — иконка
   ico('copy') из view.mjs). Адрес объявления собираем от siteBase(), чтобы у внешних сервисов
   был абсолютный URL, а «Скопировать ссылку» работает и на локальной отладке: скрипт
   (public/assets/js/site.js, initCarExtras) берёт адрес из data-copy-link. */
function shareStrip(carUrl, title) {
  const u = encodeURIComponent(carUrl);
  const t = encodeURIComponent(title);
  return `<div class="gal-share" role="group" aria-label="Поделиться объявлением">
    <a class="gal-soc" href="https://t.me/share/url?url=${u}&text=${t}" target="_blank" rel="noopener nofollow" title="Поделиться в Telegram" aria-label="Поделиться в Telegram">${socialIcon('telegram')}</a>
    <a class="gal-soc" href="viber://forward?text=${t}%20${u}" title="Поделиться в Viber" aria-label="Поделиться в Viber">${socialIcon('viber')}</a>
    <a class="gal-soc" href="https://api.whatsapp.com/send?text=${t}%20${u}" target="_blank" rel="noopener nofollow" title="Поделиться в WhatsApp" aria-label="Поделиться в WhatsApp">${socialIcon('whatsapp')}</a>
    <button class="gal-soc" type="button" data-copy-link="${esc(carUrl)}" title="Скопировать ссылку" aria-label="Скопировать ссылку">${ico('copy', 18)}</button>
  </div>`;
}

export function carPage(state, slug, url) {
  /* Блок цены показывает кредит, а не лизинг — по правилу заказчика (2026-09-29): «на странице
     автомобилей написано лизинг и платёж от. сделай так чтобы там был не лизинг а кредит и платёж
     считают от цены машины на максимальный срок и участие клиента 20%». Раньше там стояло «Лизинг
     от … руб. в месяц» (примерно 1,9 % от цены). Считает lib/finance.mjs (carPagePayment) — та же
     арифметика, что в /kalkulyator, поэтому числа в карточке и в калькуляторе сходятся: полная
     цена, максимальный срок 84 месяца, участие клиента 20 %. Слово «от» оставляем: 20 % — нижняя
     граница участия, при большем взносе платёж меньше. Услугу «Лизинг» и строку «Кредит / лизинг»
     в параметрах не трогаем — они вне блока цены. */
  const car = carBySlug(slug);
  if (!car || car.status !== 'published') return notFound(state);
  incrementViews(car.id);
  const c = decorate(car);
  const sim = similar(car, 4).map(decorate);
  for (const s of sim) s.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', s.id).map(p => p.path);
  const photos = c.photos || [];

  /* Данные для мета-строки объявления — как у av.by под заголовком: дата публикации, номер
     объявления и просмотры. Номер берём из source_id (это номер объявления av.by, с которого
     машина приехала в базу) и только при его отсутствии — локальный id: покупатель, который
     нашёл машину на av.by, узнаёт тот же номер, что видел там. */
  const sent = /[?&]sent=1/.test(url && url.search ? url.search : '');
  const carUrl = siteBase() + '/car/' + c.slug;
  const adNo = String(c.source_id || c.id);
  const published = ruDate(c.created_at);
  const phoneRaw = String(getSetting('phone_1') || '').replace(/[^\d+]/g, '');

  /* Статус автомобиля на его странице. Заказчик: «сделай, когда переходишь на страницу, было
     видно скидки и что это горящая продажа или новое объявление». Отсюда три плашки под
     заголовком слева — над сгибом, рядом с названием, — и зачёркнутая цена «до скидки» в
     ценовом блоке справа:
       • «Новое объявление» — флаг is_new: он же даёт красную плашку «Новый» в каталоге и на
         карточке раздела «Новые поступления» (то есть машина оттуда), он же ставится галочкой в
         админке при добавлении машины — одна причина, три места;
       • «Горящая продажа» — машина входит в пятёрку спецпредложения главной, тот же отбор
         hotCars(), что рисует блок в герое: пометка не выдумана шаблоном, человек видит ту же
         акцию, из которой пришёл по ссылке;
       • «Скидка −N руб.» — сумма из cars.discount, ровно та же, что в карточке спецпредложения
         (общий расчёт discountInfo), и только у машин с настоящей ценой. Демонстрационную скидку
         база ставит лишь машинам спецпредложения (lib/db.mjs: backfillDiscounts), поэтому у
         остальных объявлений ни этой плашки, ни зачёркнутого «было» — заказчик 2026-09-30:
         «с большей частью объявлений которые не задействованы в спецпрограммах удалить скидку».
     Плашки — те же «таблетки», что бейджи каталога (.tag), чтобы новая пометка читалась как часть
     системы, а не как отдельный элемент. Пустых плашек нет: чего у машины нет — того и не видно. */
  const { amount: save, before } = discountInfo(c);
  const hotIds = new Set(hotCars(5).map((h) => h.id));
  const flags = [
    c.is_new ? '<span class="flag new">Новое объявление</span>' : '',
    hotIds.has(c.id) ? '<span class="flag hot"><i class="dot"></i>Горящая продажа</span>' : '',
    save > 0 ? `<span class="flag save num">Скидка −${bynHtml(save)}</span>` : '',
  ].filter(Boolean).join('');

  /* Таблицы «Характеристики» на карточке больше нет. Заказчик 2026-09-30: «Убери под фотографиями
     авто блок — Характеристики. Они у нас есть справа от фоток». Убран именно дубль в левой
     колонке под галереей: тот же набор параметров покупатель видит в правой колонке — в сводке под
     ценой (год, коробка, объём, топливо, пробег / кузов, привод, цвет / мощность, расход) и в VIN
     строке «Условий покупки». Вместе с таблицей ушла и ссылка «Все параметры» из сводки: вести ей
     стало некуда. */

  /* Краткая сводка под ценой — три строки, как на av.by («1998 г., автомат, 1,8 л, бензин,
     180 000 км» / «купе, передний привод, красный» / «170 л.с., расход 8,7 л»). Это теперь
     единственный перечень параметров объявления, но сжатый: по нему покупатель решает, звонить ли
     продавцу.
     Пустые части выпадают — у электромобиля не будет «0 л», у машины без данных о расходе нет
     третьей строки целиком. */
  const brief = [
    [`${c.year} г.`, (c.trans_label || '').toLowerCase(), c.volume ? vol(c.volume) + ' л' : '',
      (c.fuel_label || '').toLowerCase(), fmt(c.mileage) + ' км'].filter(Boolean).join(', '),
    [String(c.body_label || '').toLowerCase(), String(c.drive_label || '').toLowerCase(),
      String(c.color || '').toLowerCase()].filter(Boolean).join(', '),
    [c.power ? c.power + ' л.с.' : '', c.fuel_use ? 'расход ' + String(c.fuel_use).replace('.', ',') + ' л' : '']
      .filter(Boolean).join(', '),
  ].filter(Boolean);

  /* Ссылка-модификация под заголовком («Автомат (218 л.с.)» — как «1,8 AT (170 л.с.)» на av.by)
     убрана по просьбе заказчика 2026-09-28: «в карточках автомобилей убери — Автомат (218 л.с.)».
     Вместе с ней ушли vol() из этой строки и правило .car‑mod из оформления: дублировать коробку и
     мощность незачем — коробка, объём, привод и мощность и так стоят в сводке под ценой. */
  /* VIN раньше стоял в таблице «Характеристики» — той самой, что убрана 2026-09-30. Чтобы номер не
     пропал со страницы (av.by тоже держит его в параметрах объявления), он переехал в строку
     «Условий покупки» правой колонки: у машины с известным VIN — сам номер, у машины без него —
     понятная подсказка «запросите у продавца», как делает av.by, когда VIN не опубликован. */
  const vinNote = c.vin
    ? `<div><span>VIN</span><b class="num">${esc(c.vin)}</b></div>`
    : '<div><span>VIN</span><b>не указан — запросите у продавца</b></div>';

  /* Комплектация со страницы объявления (заказчик 2026-09-27: «чтобы можно было выбирать
     комплектацию и её содержимое»): название набора, салон и отмеченные опции лежат отдельными
     колонками, а собранный из них текст — по-прежнему в cars.equipment. Блок показываем, когда
     есть что показать: у машин из сида структурных полей нет, и там работает прежняя строка
     «Комплектация: …» в описании.
     Опции показаны разделами (groupOptions в lib/car-options.mjs) — как «Салон» и «Системы
     безопасности» на av.by, а не одним длинным списком: у максимальной комплектации опций под
     девяносто, и в плоском списке покупатель их не читает. Первые восемь видны сразу, остальные
     раскрывает кнопка «Показать все опции» (public/assets/js/site.js: initEquipMore). */
  const equipOptions = String(c.options || '').split(',').map((s) => s.trim()).filter(Boolean);
  const equipTrim = String(c.trim || '').trim();
  const interior = interiorText(c.interior_color, c.interior_material);
  const EQUIP_VISIBLE = 8;
  const optionGroups = groupOptions(equipOptions);
  let opSeen = 0;
  const equipGroups = optionGroups.map((g) => `
            <div class="equip-group">
              <h4>${esc(g.label)}</h4>
              <ul class="equip-opts">${g.items.map((o) => {
                const extra = ++opSeen > EQUIP_VISIBLE;
                return `<li${extra ? ' class="is-extra"' : ''}>${esc(o)}</li>`;
              }).join('')}</ul>
            </div>`).join('');
  const equipPanel = (equipTrim || equipOptions.length) ? `
        <div class="panel">
          <h3>Комплектация</h3>
          <div class="spec-list">
            ${equipTrim ? `<div><span>Комплектация</span><b>${esc(equipTrim)}</b></div>` : ''}
            ${interior ? `<div><span>Салон</span><b>${esc(interior.replace(/^Салон /, ''))}</b></div>` : ''}
            ${equipOptions.length ? `<div><span>Опций в комплектации</span><b class="num">${equipOptions.length}</b></div>` : ''}
          </div>
          ${equipGroups ? `<div class="equip-groups" data-equip>${equipGroups}</div>` : ''}
          ${equipOptions.length > EQUIP_VISIBLE ? `<button class="btn btn-ghost btn-block equip-more" type="button" data-equip-more>Показать все опции (${equipOptions.length})</button>` : ''}
        </div>` : '';

  /* Значки «Поделиться» лежат на самом кадре — и когда фотографии есть, и когда их нет (тогда
     кадр занимает заглушка «Фотографии — по запросу»): без кадра объявление не должно терять
     возможность поделиться. Подписи-кнопки под описанием убраны — заказчик 2026-09-30 выбрал
     перенос на большое фото. */
  const share = shareStrip(carUrl, `${c.brand} ${c.model}, ${c.year} — ${plainPrice(c.price_text)}`);
  /* Стрелки галереи — те же стрелки-шевроны, что у карусели карточки (ico('chevL'/'chevR', 22)), и
     то же прозрачное оформление (public/assets/css/site.css, «Стрелки перелистывания фото»):
     заказчик 2026-09-30 попросил сделать кнопки на карточках авто и на странице авто одинаковыми,
     а затем — «кнопки пролистывания все-таки сделай стрелочками». Здесь стояли
     ico('chevron-left'/'chevron-right', 22) — таких имён в ICONS нет, и ico() отдавал запасной
     значок, машину (lib/view.mjs: `ICONS[name] || ICONS.car`): у большого фото вместо стрелки
     крутилась «машинка». */
  const gallery = photos.length
    ? `<div class="gallery">
        <div class="gallery-main" data-gallery-main>
          <img src="${esc(photos[0])}" alt="${esc(c.brand + ' ' + c.model)}" data-gallery-img>
          ${photos.length > 1 ? `
          <button class="gal-nav prev" type="button" data-gal-nav="-1" aria-label="Предыдущее фото">${ico('chevL', 22)}</button>
          <button class="gal-nav next" type="button" data-gal-nav="1" aria-label="Следующее фото">${ico('chevR', 22)}</button>` : ''}
          <span class="counter num" data-gallery-counter>1 / ${photos.length}</span>
          <span class="gal-hint">Открыть во весь экран</span>
          ${share}
        </div>
        <div class="thumbs" data-thumbs>
          ${photos.map((p, i) => `<img src="${esc(thumb(p))}" data-full="${esc(p)}" alt="Фото ${i + 1}" loading="lazy" decoding="async" class="${i === 0 ? 'on' : ''}" data-thumb="${i}" onerror="this.onerror=null;this.src='${esc(p)}'">`).join('')}
        </div>
      </div>`
    : `<div class="gallery"><div class="gallery-main">${photoImg(null, c.brand + ' ' + c.model)}${share}</div></div>`;

  /* Платёж в блоке цены считается от полной цены: см. комментарий в начале carPage. */
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { href: '/cars', label: 'Автомобили' }, { href: '/cars?brand=' + encodeURIComponent(c.brand), label: c.brand }, { label: c.brand + ' ' + c.model }])}
  <div class="wrap" style="padding-bottom:20px">
    ${sent ? `<div class="alert alert-ok">Заявка отправлена — менеджер свяжется с вами в рабочее время.</div>` : ''}
    <div class="sec-head"><div>
      <h1 style="font-size:clamp(22px,2.4vw,30px);margin-bottom:8px">Продажа ${esc(c.brand)} ${esc(c.model)}, ${c.year} г. в ${esc(c.city)}</h1>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
      <div class="row muted small car-meta">
        <span>${ico('pin', 14)} ${esc(c.city)}</span>
        ${published ? `<span>${ico('clock', 14)} опубликовано ${esc(published)}</span>` : ''}
        <span>${ico('chart', 14)} ${fmt(c.views)} ${plural(c.views, 'просмотр', 'просмотра', 'просмотров')}</span>
        <span class="car-no num">№ ${esc(adNo)}</span>
      </div>
    </div></div>
    <div class="detail">
      ${/* Две строки карточки (заказчик 2026-10-01: «нижняя граница блока проверка по VIN была
           симметрична нижней границе блока фотографий; нижняя и верхняя границы блока — условия
           покупки — симметричны верхней и нижней границам блока — описание»). Верхняя пара строк:
           фотографии ↔ цена + связь с продавцом + проверка по VIN; нижняя: описание ↔ условия
           покупки. Строки общие для обеих колонок (subgrid в стилях), поэтому оба блока правой
           колонки кончаются там же, где левые: «Проверка по VIN» — по низу галереи, «Условия
           покупки» — по верху и низу «Описания». Панель «Комплектация» (у опубликованных машин не
           показывается — нет ни комплектации, ни опций) остаётся в верхней паре вместе с галереей,
           чтобы число строк не поехало. */ ''}
      <div class="detail-main">
        <div class="detail-media">
          ${gallery}${equipPanel}
        </div>
        <div class="panel">
          <h3>Описание</h3>
          <div class="prose">${esc(c.description || '')}</div>
          ${c.equipment && !equipPanel ? `<p style="margin-top:14px"><b>Комплектация:</b> ${esc(c.equipment)}</p>` : ''}
        </div>
        ${/* Заявка на автомобиль из карточки убрана (заказчик 2026-09-30: «Блок — Заявка на
             автомобиль в карточках авто, убери»). Своё место в правой колонке она уступила
             «Проверке по VIN» и «Условиям покупки» ещё 29.09, а теперь ушла совсем: левая колонка
             заканчивается «Описанием». Формы заявок на других страницах (услуга, кредит, контакты,
             подбор, отзыв) и окна брони/звонка/связи с продавцом остались на месте. */ ''}
      </div>
      <aside>
        ${/* Первая строка карточки в правой колонке: цена → связь с продавцом → проверка по VIN.
             Эти три панели — одна строка общей сетки, «Проверка по VIN» тянется по её низу, поэтому
             её нижняя граница совпадает с низом галереи. */ ''}
        <div class="side-stack">
          ${/* Заказчик 2026-10-01: «на странице авто кнопку лайк и сравнить перенести в правый верхний
               часть». Прежде «В избранное» и «сравнить» стояли отдельной строкой между ценой и сводкой
               характеристик (в середине панели); теперь они в правом верхнем углу той же панели — на
               строке с ценой, у её правого края (.price-head / .price-tools в стилях). Отдельной
               строки в панели больше нет, поэтому «лайк» слева от «сравнить» ставится тем же
               порядком, что и было. Строку кредита из .price-col вынесли: в углу она задавала ширину
               всей паре «цена + значки» и значки уезжали под цену уже на 1200 px, хотя цене там
               места хватает. */ ''}
          <div class="price-box">
            <div class="price-head">
              <div class="price-col">
                <div class="price num">${c.price_text}</div>
                ${before ? `<div class="was num">было ${bynHtml(before)}</div>` : ''}
              </div>
              <div class="price-tools">
                <button class="icon-btn" type="button" data-fav="${c.id}" aria-label="В избранное">${ico('heart', 18)}</button>
                <label class="check" style="padding:0 8px"><input type="checkbox" data-compare="${c.id}"><span class="small">сравнить</span></label>
              </div>
            </div>
            ${c.price ? `<div class="month">Кредит от ${bynHtml(carPagePayment(c.price))} в месяц · <a href="/kalkulyator">расчёт</a></div>` : ''}
            ${brief.length ? `<ul class="car-brief">
              ${brief.map((line) => `<li>${esc(line)}</li>`).join('')}
            </ul>` : ''}
          </div>
          ${/* Заказчик 2026-09-30: «Позвонить продавцу, сделай, чтобы был только набор номера,
               раскрывающееся окно оставь только для — отправить сообщение и предложить цену».
               Поэтому «Позвонить продавцу» — обычная ссылка tel: без JS и без окна (нажатие сразу
               набирает номер), а окно с вкладками (lib/view.mjs: carContactModalHtml) открывают
               только «Отправить сообщение» и «Предложить цену». */ ''}
          <div class="panel">
            <h4>Связаться с продавцом</h4>
            <div class="car-contact">
              <a class="btn btn-block" href="tel:${esc(phoneRaw)}">${ico('phone', 18)} Позвонить продавцу</a>
              <button class="btn btn-ghost btn-block" type="button" data-car-contact-open="message">Отправить сообщение</button>
              <button class="btn btn-ghost btn-block" type="button" data-car-contact-open="offer">Предложить цену</button>
            </div>
          </div>
          <div class="panel vin-panel">
            <h4>Проверка по VIN</h4>
            <ul class="vin-check">
              <li>${ico('check', 16)} Участие в ДТП и расчётная стоимость ремонта</li>
              <li>${ico('check', 16)} Залоги, ограничения и запреты на регистрацию</li>
              <li>${ico('check', 16)} Реальный пробег по данным техосмотров</li>
            </ul>
          </div>
        </div>
        ${/* Заказчик 2026-10-01: «в блоке — Проверка по VIN, убери — Число владельцев и история
             регистраций, Работа в такси, каршеринге и залоговых программах, VIN указан в условиях
             покупки — отчёт покажем при осмотре». Убраны обе строки списка и пояснение под ним —
             вместе с пояснением ушёл и класс `no-vin` (он выравнивал панель у машины без VIN: без
             пояснения та была ниже ценового блока). Теперь обе панели одинаковы, а высоту добирает
             subgrid-строка. Строк в списке три — ДТП, залоги, пробег. */ ''}
        <div class="panel car-cond">
          <h4>Условия покупки</h4>
          <div class="spec-list">
            ${vinNote}
            <div><span>Обмен (trade-in)</span><b>Возможен</b></div>
            <div><span>Кредит / лизинг</span><b>Оформление на месте</b></div>
            <div><span>Тест-драйв</span><b>Перед покупкой</b></div>
            <div><span>Документы</span><b>Полный пакет</b></div>
          </div>
          <a class="btn btn-ghost btn-block" style="margin-top:14px" href="/kalkulyator">Рассчитать кредит</a>
        </div>
        ${/* Контакты дилера (адрес, режим работы, телефон и кнопка «Все контакты») из карточки убраны
             (заказчик 2026-09-30: «Автонова с пробегом — Адрес / Режим работы / Телефон / Все контакты
             в карточках авто — убери»). Правую колонку заканчивают «Условия покупки»; те же данные
             остались на странице /contacts, в подвале сайта и в контактах на других страницах. */ ''}
      </aside>
    </div>
  </div>
  ${sim.length ? section('Похожие автомобили', 'Похожие по цене и классу — сравните перед покупкой.', carGrid(sim, { favorites: state.favoritesSet, compare: state.compareSet })) : ''}`;

  return page(state, {
    title: `${c.brand} ${c.model}${c.generation ? ' ' + c.generation : ''}, ${c.year} — ${plainPrice(c.price_text)} | Автонова с пробегом`,
    description: [`${c.brand} ${c.model} ${c.year}, ${fmt(c.mileage)} км`, (c.trans_label || '').toLowerCase(),
      vol(c.volume) ? vol(c.volume) + ' л' : '', (c.fuel_label || '').toLowerCase()].filter(Boolean).join(', ')
      + `. ${plainPrice(c.price_text)}. Проверка по VIN, кредит и trade-in в Гомеле.`,
    body,
    carContactModal: carContactModalHtml({
      carId: c.id,
      carTitle: `${c.brand} ${c.model}${c.generation ? ' ' + c.generation : ''}, ${c.year} г.`,
    }),
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Car',
      name: `${c.brand} ${c.model} ${c.year}`, brand: { '@type': 'Brand', name: c.brand },
      model: c.model, vehicleModelDate: String(c.year), mileageFromOdometer: { '@type': 'QuantitativeValue', value: c.mileage, unitCode: 'KMT' },
      color: c.color || undefined, vehicleIdentificationNumber: c.vin || undefined,
      offers: c.price ? { '@type': 'Offer', price: c.price, priceCurrency: 'BYN', availability: 'https://schema.org/InStock' } : undefined,
      image: photos.length ? siteBase() + photos[0] : undefined,
    },
  });
}

/* ── Услуги ─────────────────────────────────────────────── */
export function servicesPage(state) {
  const pages = all("SELECT * FROM pages WHERE section='services' ORDER BY sort");
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Услуги' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Услуги</h1><p>Полный цикл работы с автомобилем: подбор, проверка, оформление сделки, сервис после покупки.</p></div></div>
    <div class="tiles">
      ${pages.map(p => tile({ href: '/services/' + p.slug, icon: SERVICE_ICON[p.slug] || p.icon, title: p.title, text: p.excerpt })).join('')}
    </div>
    <div class="panel" style="margin-top:26px">
      <h3>Не знаете, какая услуга подходит?</h3>
      <p class="muted">Позвоните — подскажем по вашей ситуации без обязательств. ${esc(getSetting('phone_1'))}, ${esc(getSetting('hours'))}.</p>
      <a class="btn" href="/contacts">Связаться с нами</a>
    </div>
  </div>`;
  return page(state, { title: 'Услуги — Автонова с пробегом', description: 'Кредит, лизинг, trade-in, выкуп и комиссионная продажа автомобилей с пробегом «Автонова».', body });
}

export function servicePage(state, slug) {
  const p = one("SELECT * FROM pages WHERE slug = ? AND section='services'", slug);
  if (!p) return notFound(state);
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { href: '/services', label: 'Услуги' }, { label: p.title }])}
  <div class="wrap page-pb">
    <div class="side-layout serv-layout">
      <div class="side-nav">
        ${all("SELECT * FROM pages WHERE section='services' ORDER BY sort").map(x => `<a href="/services/${x.slug}"${x.slug === slug ? ' class="on"' : ''}>${esc(x.title)}</a>`).join('')}
      </div>
      <div class="serv-main">
        <div class="serv-head">
          <h1 style="font-size:clamp(24px,2.6vw,34px)">${esc(p.title)}</h1>
        </div>
        <div class="prose serv-prose">${esc(p.body)}</div>
      </div>
      <!-- Окно заявки идёт в разметке после описания: в одну колонку (≤1100 px) заказчик просил
           «сначала было описание потом заявка» (2026-09-29), и порядок в DOM делает это сам.
           Переставлять grid-областями не стали нарочно: это переставило бы только картинку, а
           обход по Tab и озвучка шли бы за DOM, то есть заявка всё равно оказалась бы раньше
           описания. Место формы на широком экране задаёт grid-area:form (правая колонка), см.
           .serv-layout в site.css. -->
      <div class="panel serv-form">
        ${leadForm({ kind: p.slug, title: 'Оставить заявку: ' + p.title, text: 'Специалист свяжется с вами в рабочее время.' })}
      </div>
    </div>
  </div>`;
  return page(state, { title: `${p.title} — Автонова с пробегом`, description: p.excerpt, body });
}

/* ── Автожурнал ─────────────────────────────────────────── */
export function newsPage(state) {
  const arts = all('SELECT * FROM articles ORDER BY published_at DESC, id DESC');
  /* Обложка статьи в списке — ссылка на статью (заказчик 2026-09-30: «В разделе Автожурнал — добавь
     возможность перехода на статью при нажатии на картинку»). Накладка .car-photo-hit — тот же
     приём, что и в карточке авто (`lib/view.mjs`, `carCard`): обёртка вокруг <img> сломала бы
     раскладку кадра (.car-media держит пропорцию 4/3), а невидимая ссылка поверх снимка ничего не
     двигает, работает с клавиатуры (Tab + Enter) и видна поисковику. Заголовок карточки и кнопка
     «Читать» тоже ведут на статью — как и раньше. */
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Автожурнал' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Автожурнал</h1><p>Практические материалы о покупке, проверке и обслуживании автомобилей с пробегом.</p></div></div>
    <div class="cars">
      ${arts.map(a => `<article class="car">
        <div class="car-media">${a.cover
          ? `<img src="${esc(a.cover)}" alt="${esc(a.title)}" loading="lazy" decoding="async">`
          : `<div class="photo-empty" style="background:linear-gradient(135deg,#1C2129,#3A1E22)"><div><b>${esc(a.tag)}</b><span class="small">Автожурнал «Автонова»</span></div></div>`}
          <a class="car-photo-hit" href="/news/${esc(a.slug)}" aria-label="${esc(a.title)} — читать статью"></a></div>
        <div class="car-body">
          <a class="car-title" href="/news/${esc(a.slug)}">${esc(a.title)}</a>
          <p class="small muted" style="margin:0">${esc(a.excerpt)}</p>
          <div class="car-foot"><span class="car-loc">${ico('clock', 14)} ${esc(String(a.published_at).slice(0, 10))}</span><a class="btn btn-sm btn-ghost" href="/news/${esc(a.slug)}">Читать</a></div>
        </div>
      </article>`).join('')}
    </div>
  </div>`;
  return page(state, { title: 'Автожурнал — Автонова с пробегом', description: 'Статьи о покупке автомобиля с пробегом: проверка по VIN, кредит, лизинг, trade-in, обслуживание.', body });
}

export function articlePage(state, slug) {
  const a = one('SELECT * FROM articles WHERE slug = ?', slug);
  if (!a) return notFound(state);
  const others = all('SELECT * FROM articles WHERE slug <> ? ORDER BY published_at DESC LIMIT 3', slug);
  /* Заголовок статьи — в одну строку (заказчик 2026-09-30: «В странице статьи, название статей, типа
     „Комиссионная продажа: как продать авто быстрее“, — сделай в одну строчку, сильно крупный
     шрифт»). Было `clamp(24px,2.8vw,38px)`: при 1440 px название занимало два ряда. Замер
     (_ref/diag-h1.mjs, колонка текста 820 px) показал, в каком размере каждое из восьми названий
     Автожурнала ложится в одну строку: при 30 px — семь из восьми (самое длинное 848 px), при 28 px —
     все восемь (788 px, запас 32 px). Ниже 1000 px окна название всё равно переносится: колонка
     сужается до 614 px на 1024 px, а одной строкой такое название уместилось бы только кеглем
     ~22 px, и оно стало бы мельче подзаголовков. Поэтому 28 px — потолок для широких окон, а
     нижняя граница 24 px (телефон) не менялась. */
  /* Раскладка статьи — сетка `.art-main` (public/assets/css/site.css): левая колонка двумя
     строками (`.art-head` — тег, название, дата; `.art-body` — обложка и текст), правая — «Читайте
     также» (`.art-aside`), которая тянется по обеим строкам и повторяет их сетку (subgrid): её
     заголовок ложится в строку заголовка статьи, а плитки — ровно в строку тела, поэтому фото первой
     ссылки встаёт вровень с фото статьи. Просьба заказчика 2026-09-30: «Блок — Читайте также, смести
     вниз, что бы фото этого блока и левого блока со статьей, были на одном уровне, примени ко всем
     статьям». */
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { href: '/news', label: 'Автожурнал' }, { label: a.title }])}
  <div class="wrap page-pb">
    <article class="art-main">
      <div class="art-head">
        <span class="tag" style="background:var(--accent-soft);color:var(--accent)">${esc(a.tag)}</span>
        <h1 style="margin-top:14px;font-size:clamp(24px,2.8vw,28px)">${esc(a.title)}</h1>
        <div class="row muted small" style="margin-bottom:20px">${ico('clock', 14)} ${esc(String(a.published_at).slice(0, 10))}</div>
      </div>
      <div class="art-body">
        ${a.cover ? `<img class="art-cover" src="${esc(a.cover)}" alt="${esc(a.title)}" decoding="async">` : ''}
        <div class="prose">${esc(a.body)}</div>
      </div>
      <aside class="art-aside">
        <h3 class="art-aside-h">Читайте также</h3>
        <div class="tiles">${others.map(o => tile({ href: '/news/' + o.slug, icon: 'doc', title: o.title, text: o.excerpt, photo: o.cover, photoAlt: o.title })).join('')}</div>
      </aside>
    </article>
  </div>`;
  return page(state, { title: `${a.title} — Автожурнал «Автонова»`, description: a.excerpt, body });
}

/* ── Калькулятор ────────────────────────────────────────── */
export function calculatorPage(state) {
  /* Все поля расчёта — ползунки. Просьба заказчика: «В кредитном калькуляторе — Стоимость
     автомобиля, руб. 60000 / Первоначальный взнос, руб. — сделай ползунком как в месяцах».
     Верхняя граница стоимости — самая дорогая машина в продаже, выровненная по шагу ползунка
     (иначе последняя ступенька недостижима: у ползунка значение берётся из сетки min + k·step).
     Участие клиента переехало из рублей в проценты (заказчик 2026-09-29: «в блок кредитный
     калькулятор добавь ползунок участие клиента от 5% до 80%»), поэтому теперь ползунки
     «Стоимость» и «Участие клиента, %» независимы, а сумма взноса в рублях выводится в подписи.
     Ставки и границы живут в lib/finance.mjs — оттуда же их берёт карточка автомобиля, чтобы
     платёж в карточке и в калькуляторе считался одинаково. */
  const step = 500;
  const topPrice = num("SELECT MAX(price) FROM cars WHERE status='published'") || 160000;
  const maxPrice = Math.floor((topPrice - 1000) / step) * step + 1000;
  const price = Math.min(60000, maxPrice);
  /* Участие клиента по умолчанию 20 %, срок — максимальный: тот же сценарий, что показан в
     карточке автомобиля («Кредит от …»), поэтому числа на странице машины и в калькуляторе
     сходятся без пересчёта. */
  const share = SHARE_DEFAULT;
  const months = MONTHS_MAX;
  const digits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Кредитный калькулятор' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Кредитный калькулятор</h1><p>Точные условия банк подтверждает после рассмотрения заявки.</p></div></div>
    <div class="side-layout calc-layout">
      <form class="panel calc-fields" data-calc data-rate="${RATE_PERCENT}">
        <label class="field calc-slider"><span>Стоимость автомобиля, <span class="byn">Б</span></span><input type="range" name="price" min="1000" max="${maxPrice}" step="${step}" value="${price}"><output data-price>${digits(price)}</output></label>
        <label class="field calc-slider"><span>Участие клиента, %</span><input type="range" name="share" min="${SHARE_MIN}" max="${SHARE_MAX}" step="1" value="${share}"><output data-share>${share} % · ${digits(Math.round((price * share) / 100))}${BYN_TEXT}</output></label>
        <label class="field calc-slider"><span>Срок, месяцев</span><input type="range" name="months" min="6" max="${MONTHS_MAX}" step="6" value="${months}"><output data-months>${months}</output></label>
      </form>
      <div class="calc-out"><div class="big num"><b data-payment>—</b>&nbsp;<span class="byn">Б</span> <span class="num">/ месяц</span></div>
        <div class="spec-list">
          <div><span>Сумма кредита</span><b class="num"><i data-credit>—</i></b>&nbsp;<span class="byn">Б</span></div>
          <div><span>Переплата</span><b class="num"><i data-over>—</i></b>&nbsp;<span class="byn">Б</span></div>
          <div><span>Итого к возврату</span><b class="num"><i data-total>—</i></b>&nbsp;<span class="byn">Б</span></div>
        </div>
      </div>
      <div class="panel calc-lead">
        ${leadForm({ kind: 'credit', title: 'Отправить заявку на кредит', text: 'Рассмотрим заявку и подберём банк с лучшей ставкой.' })}
      </div>
    </div>
  </div>`;
  return page(state, { title: 'Кредитный калькулятор — Автонова с пробегом', description: 'Рассчитайте ежемесячный платёж по кредиту на автомобиль с пробегом и отправьте заявку дилеру «Автонова».', body });
}

/* ── Контакты ───────────────────────────────────────────── */
/* Заказчик 2026-09-30: «убери блок реквизиты, блок — написать нам, — вмести справа от блока —
   Станция технического обслуживания, сделай симметрично». Отсюда две правки страницы:
   1) панель «Реквизиты» (организация, два телефона, e-mail, адрес, режим работы) удалена целиком —
      всё это и так стоит в подвале каждой страницы, а на самой странице контактов дублировало
      адреса и часы работы плиток;
   2) форма «Написать нам» переехала из нижнего ряда в правую колонку — ровно справа от плитки
      «Станция технического обслуживания»: четыре адреса стоят сеткой 2×2, форма занимает вторую
      колонку той же высоты, поэтому лист заполнен без пустой полосы справа (раньше форма шириной
      560 px оставляла справа от себя пустое место). Раскладка — public/assets/css/site.css
      (.contacts-layout / .contacts-tiles): колонка формы 420 px, как у заявки на странице
      «Продано»; до 1080 px колонки складываются, форма встаёт под плитками и снова ограничена
      560 px, до 560 px плитки идут по одной. Плитки остались прежними (.tile с иконкой «pin»). */
export function contactsPage(state) {
  const points = [
    ['Автонова с пробегом', 'ул. Мазурова, 112', 'пн–пт 9:00–19:00, сб–вс 10:00–18:00'],
    ['Автосалон Geely, Shineray', 'ул. Хатаевича, 32', 'пн–пт 9:00–19:00, сб–вс 9:00–17:00'],
    ['Автосалон Belgee', 'ул. Хатаевича, 2', 'пн–пт 9:00–19:00, сб–вс 9:00–17:00'],
    ['Станция технического обслуживания', 'ул. Хатаевича, 32', 'пн–вс 8:00–20:00'],
  ];
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Контакты' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Контакты</h1><p>Приезжайте на площадку — автомобили находятся в наличии и доступны для осмотра и тест-драйва.</p></div></div>
    <div class="contacts-layout">
      <div class="tiles contacts-tiles">
        ${points.map(([t, a, h]) => `<div class="tile"><div class="ico">${ico('pin', 22)}</div><b>${esc(t)}</b><span>${esc(a)}</span><br><span class="small muted">${esc(h)}</span></div>`).join('')}
      </div>
      <div class="panel">
        ${leadForm({ kind: 'contact', title: 'Написать нам', text: 'Ответим на вопрос по конкретному автомобилю или условиям покупки.' })}
      </div>
    </div>
  </div>`;
  return page(state, { title: 'Контакты — Автонова с пробегом, Гомель', description: 'Адреса, телефоны и режим работы площадки «Автонова с пробегом» и автосалонов «Автонова» в Гомеле.', body });
}

/* ── Продано / отзывы ───────────────────────────────────── */
export function soldPage(state) {
  const items = all('SELECT * FROM sold_cars ORDER BY sold_at DESC');
  /* Заказчик 2026-09-30: «Проданные автомобили — сделай там соответствующую одну маленькую фото
     авто, добавь дальше по тексту — Проданные автомобили в этом месяце и реально сделай, чтобы
     когда карточка авто исчезает с сайта, то есть авто продали и карточку удалили, этот авто
     появлялся в продажах как реальная продажа». Отсюда две вещи на странице:
     1) первая колонка — маленький кадр (sold_cars.photo): у продаж из журнала это снимок самой
        удалённой карточки, у демонстрационных записей — снимок машины того же поколения;
     2) продажи из журнала появляются сами: запись пишет server.mjs, когда карточку удаляют.
     Заказчик 2026-10-01 (тот же, кто просил подпись) уточнил: «в блоке проданные автомобили
     удали — Проданные автомобили в этом месяце 7 автомобилей». Подпись месяца стояла строкой под
     шапкой и повторяла заголовок страницы, поэтому строки-группы этого месяца больше нет: свежие
     продажи идут сразу под шапкой таблицы. Группа «Проданные ранее» осталась единственным
     разделителем — она отличает прошлые месяцы, иначе старые продажи слились бы со свежими.
     Заодно по его же просьбе отцентрирована колонка «Дата продажи» (класс .tbl-ctr, правило в
     public/assets/css/site.css): «заголовок — Дата продажи, а под ним даты, так вот фактические
     даты продажи сдвинуты влево, а надо по середине». Центрируются и заголовок, и значения: иначе
     даты стояли бы в середине колонки, но всё равно левее своего заголовка.
     Раскладка (.sold-layout, две колонки) не менялась — просьба заказчика от 2026-09-29.
     Две колонки: слева таблица проданных авто, справа сверху — заявка на подбор. Раньше заявка
     стояла под таблицей во всю ширину листа, и справа от таблицы оставалась пустая полоса.
     Раскладка — public/assets/css/site.css (.sold-layout): таблица занимает остаток ширины
     (minmax(0,1fr)), поэтому её правый край ровно там, где начинается колонка заявки; ширина
     колонки заявки та же, что у окна заявки на страницах услуг и в калькуляторе. До 1080 px
     колонки складываются, заявка уходит под таблицу и снова ограничена 560 px. */
  const month = new Date().toISOString().slice(0, 7);
  const inMonth = items.filter((s) => String(s.sold_at).slice(0, 7) === month);
  const before = items.filter((s) => String(s.sold_at).slice(0, 7) !== month);
  const soldRow = (s) => `<tr>
            <td data-label="Автомобиль"><div class="sold-car">${s.photo
    ? `<img class="sold-photo" src="${esc(s.photo)}" alt="${esc(`${s.brand} ${s.model}, ${s.year}`)}" width="64" height="48" loading="lazy" decoding="async">`
    : `<span class="sold-photo sold-photo-empty" aria-hidden="true">${ico('car', 20)}</span>`}<b>${esc(s.brand)} ${esc(s.model)}</b></div></td>
            <td data-label="Год">${s.year}</td>
            <td class="num" data-label="Пробег">${fmt(s.mileage)} км</td><td class="num" data-label="Цена"><span class="sold-price">${bynHtml(s.price)}</span></td>
            <td class="num tbl-ctr" data-label="Продано">${esc(String(s.sold_at).slice(0, 10))}</td></tr>`;
  const count = (n) => `${n} ${plural(n, 'автомобиль', 'автомобиля', 'автомобилей')}`;
  const groupRow = (label, note) => `<tr class="tbl-group"><td colspan="5"><b>${label}</b><span class="small">${note}</span></td></tr>`;
  const rows = [
    ...inMonth.map(soldRow),
    before.length ? groupRow('Проданные ранее', count(before.length)) : '',
    ...before.map(soldRow),
  ].join('') || groupRow('Продаж пока нет', 'первая проданная машина появится здесь');
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Продано' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Проданные автомобили</h1><p>Автомобили, которые уже нашли новых владельцев на нашей площадке.</p></div></div>
    <div class="sold-layout">
      <div class="sold-main">
        <div class="tbl-wrap">
        <table class="tbl tbl-cards">
          <thead><tr><th>Автомобиль</th><th>Год</th><th>Пробег</th><th>Цена</th><th class="tbl-ctr">Дата продажи</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
        <p class="form-note" style="margin-top:14px">Не нашли подходящий автомобиль? Оставьте заявку — сообщим, когда появится нужная комплектация.</p>
      </div>
      <div class="sold-side">
        <div class="panel">
          ${leadForm({ kind: 'request', title: 'Заявка на подбор автомобиля', text: 'Уточним требования и предложим варианты из поступлений.' })}
        </div>
      </div>
    </div>
  </div>`;
  return page(state, { title: 'Проданные автомобили — Автонова с пробегом', description: 'Список автомобилей, проданных на площадке «Автонова с пробегом» в Гомеле.', body });
}

export function reviewsPage(state) {
  const items = all('SELECT * FROM reviews WHERE published=1 ORDER BY id DESC');
  const avg = items.length ? (items.reduce((s, r) => s + r.rating, 0) / items.length) : 0;
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Отзывы' }])}
  <div class="wrap page-pb">
    <div class="sec-head rev-head">
      <div>
        <h1 style="font-size:clamp(24px,2.6vw,36px)">Отзывы покупателей</h1>
        <div class="rev-lead">${starBar(avg, 17)}
          <b class="num rev-avg">${avg.toFixed(1)}</b>
          <span>из 5 — средняя оценка на сайте по ${items.length} ${plural(items.length, 'отзыву', 'отзывам', 'отзывам')}.
          Публикуем все отзывы без правок.</span>
        </div>
      </div>
      ${yandexBadge()}
    </div>
    <div class="reviews reviews-all">${items.map(reviewCard).join('')}</div>
    <div class="panel" style="max-width:640px;margin-top:26px">
      <h3>Оставить отзыв</h3>
      <form class="lead-form" method="post" action="/review">
        <label class="field"><span>Имя</span><input type="text" name="author" required></label>
        <label class="field"><span>Город</span><input type="text" name="city" value="Гомель"></label>
        <label class="field"><span>Оценка</span><select name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${n} — ${'★'.repeat(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Отзыв</span><textarea name="text" required minlength="20" placeholder="Расскажите о покупке или обслуживании"></textarea></label>
        <button class="btn" type="submit">Опубликовать отзыв</button>
      </form>
    </div>
  </div>`;
  return page(state, { title: 'Отзывы — Автонова с пробегом', description: 'Отзывы покупателей о площадке автомобилей с пробегом «Автонова» в Гомеле.', body });
}

/* ── Избранное / сравнение ──────────────────────────────── */
export function favoritesPage(state) {
  const ids = state.favorites;
  const rows = ids.length ? ids.map(id => carById(id)).filter(Boolean).map(decorate) : [];
  for (const c of rows) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', c.id).map(p => p.path);
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Избранное' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Избранное</h1><p>Автомобили, которые вы отметили. Список сохраняется в этом браузере.</p></div></div>
    ${rows.length ? carGrid(rows, { favorites: state.favoritesSet, compare: state.compareSet })
      : `<div class="empty"><h3>Список пуст</h3><p>Отмечайте автомобили значком сердца — они появятся здесь.</p><a class="btn" href="/cars">В каталог</a></div>`}
  </div>`;
  return page(state, { title: 'Избранное — Автонова с пробегом', description: 'Отмеченные автомобили в каталоге «Автонова с пробегом».', body });
}

export function comparePage(state) {
  const ids = state.compare.slice(0, 4);
  const cars = ids.map(id => carById(id)).filter(Boolean).map(decorate);
  for (const c of cars) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort', c.id).map(p => p.path);
  if (!cars.length) {
    return page(state, {
      title: 'Сравнение — Автонова с пробегом', description: 'Сравните до 4 автомобилей по характеристикам.',
      body: `${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Сравнение' }])}
      <div class="wrap page-pb"><h1 style="font-size:clamp(24px,2.6vw,36px)">Сравнение автомобилей</h1>
      <div class="empty"><h3>Пока нечего сравнивать</h3><p>Отметьте галочку «сравнить» на карточках каталога — до 4 автомобилей.</p><a class="btn" href="/cars">В каталог</a></div></div>`,
    });
  }
  const specRows = [
    ['Цена', c => plainPrice(c.price_text)], ['Год', c => c.year], ['Пробег', c => fmt(c.mileage) + ' км'],
    ['Коробка', c => c.trans_label], ['Двигатель', c => String(c.volume).replace('.', ',') + ' л'],
    ['Топливо', c => c.fuel_label], ['Кузов', c => c.body_label], ['Привод', c => c.drive_label],
    ['Мощность', c => c.power ? c.power + ' л.с.' : '—'], ['Цвет', c => c.color || '—'], ['Город', c => c.city],
  ];
  /* Страница сравнения: на широком экране — таблица (строка = характеристика, колонка = машина),
     на телефоне — колонки-карточки. Заказчик 2026-10-02 (с телефона): «На странице - Сравнения
     авто в мобильной версии, сделай, что бы били показаны минимум два автомобиля без прокрутки
     содержимого блока в право». Прежняя разметка была инлайновой
     (`style="min-width:${'$'}{180 + cars.length * 220}px"`): при трёх машинах таблица 840 px, на 390 px
     экране от первой колонки видно 246 px, от второй — 26 px, содержимое блока уезжало вбок.

     Почему не перекроили саму таблицу: колонка «подпись + 4 машины» на 320–390 px физически не
     даёт двух читаемых колонок (цена «41 500 руб.» сама по себе ~90 px). Поэтому таблица осталась
     как была, а для телефона рядом с ней добавлен блок .cmp-cards — те же данные колонками-
     карточками (grid: repeat(auto-fit,minmax(150px,1fr))). Видимостью управляет один media-запрос
     (см. .cmp-cards / .cmp-cards-only в site.css), таблицу и карточки он не дублирует на экране. */
  const cards = cars.map(c => `<article class="cmp-card">
    ${c.photos[0] ? `<img class="cmp-photo" src="${esc(thumb(c.photos[0]))}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(c.photos[0])}'">` : ''}
    <a class="cmp-name" href="/car/${esc(c.slug)}">${esc(c.brand)} ${esc(c.model)}</a>
    <button class="btn btn-sm btn-ghost" type="button" data-compare-remove="${c.id}">Убрать</button>
    <dl class="cmp-list">${specRows.map(([label, fn]) => `<div><dt>${esc(label)}</dt><dd>${esc(fn(c))}</dd></div>`).join('')}</dl>
    <a class="btn btn-sm cmp-open" href="/car/${esc(c.slug)}">Открыть</a></article>`).join('');
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Сравнение' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,36px)">Сравнение автомобилей</h1><p>До 4 автомобилей одновременно.</p></div></div>
    <div class="demo-cars-host">
      <div class="cmp-cards-only cmp-cards">${cards}</div>
      <div class="cmp-scroll">
        <table class="tbl cmp-table" style="min-width:${180 + cars.length * 220}px">
          <thead><tr><th></th>${cars.map(c => `<th><div class="cmp-head">
            ${c.photos[0] ? `<img class="cmp-photo" src="${esc(thumb(c.photos[0]))}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(c.photos[0])}'">` : ''}
            <a class="cmp-name" href="/car/${esc(c.slug)}">${esc(c.brand)} ${esc(c.model)}</a>
            <button class="btn btn-sm btn-ghost" type="button" data-compare-remove="${c.id}">Убрать</button></div></th>`).join('')}</tr></thead>
          <tbody>${specRows.map(([label, fn]) => `<tr><td class="muted">${esc(label)}</td>${cars.map(c => `<td>${esc(fn(c))}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr><td></td>${cars.map(c => `<td><a class="btn btn-sm" href="/car/${esc(c.slug)}">Открыть</a></td>`).join('')}</tr></tfoot>
        </table>
      </div>
      <p class="cmp-clear"><button class="btn btn-ghost" type="button" data-compare-clear>Очистить сравнение</button></p>
    </div>
  </div>`;
  return page(state, { title: 'Сравнение автомобилей — Автонова с пробегом', description: 'Сравните выбранные автомобили по характеристикам и цене.', body });
}

/* ── Продажа своего авто ────────────────────────────────── */
/* Просьба заказчика 2026-09-27: «блок разместить объявление сделай уже и на всю страницу, а
   также сделай чтобы он был полностью виден при загрузке странице» и «переработай кнопку
   выбрать файлы по стилю сайта, а также предусмотри возможность перетягивания файлов с папок
   компьютера». Панель формы больше не колонка 900 px с пустотой справа — она занимает всю
   ширину листа, поля идут в четыре колонки (`.sell-fields`), а вместе с подтянутыми отступами
   форма целиком попадает в первый экран. Вместо системного «Выбрать файлы» — зона `.upload`
   с кнопкой в стиле сайта и приёмом перетащенных файлов (public/assets/js/site.js: initUploads). */
export function sellPage(state, { error = '', ok = '' } = {}) {
  /* Поля «Марка», «Модель» и «Поколение» — связанные подсказки из того же каталога, что и блок
     «Поиск по параметрам» (lib/car-catalog.mjs): марка и модель по объявлениям дилера, поколение
     из карточек. Заказчик 2026-09-28: «проверь выбор марки авто, плохо выбирается, работает
     криво, не подтягивается модель и выбор поколения». Списком управляет site.js (initCombos):
     он строит раскрывающийся список тем же классом .sel-pop, что и панель поиска. Без JS поля
     остаются обычными текстовыми с <datalist> — как было раньше. Разметку подсказок даёт
     sellCatalogMarkup() из lib/view.mjs — тот же код, что и у окна «Поставить авто на продажу». */
  /* Поля формы идут блоками, как карточка объявления на av.by: «Автомобиль» → «Характеристики»
     → «Комплектация» → фото и описание → «Контакты». Наполнение списков (цвет кузова, салон,
     опции, кузов, двигатель, привод, коробка) — справочники av.by из lib/car-options.mjs;
     коды значений при этом прежние, поэтому каталог и фильтры не меняются. */
  const optionTags = (list) => list.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const selectField = (label, name, list) => `<label class="field"><span>${label}</span><select name="${name}">${optionTags(list)}</select></label>`;
  const pairs = (arr) => arr.map((v) => [v, v]);
  const colorChoices = [['', 'не указан'], ...pairs(CAR_COLORS)];
  const interiorColorChoices = [['', 'не указан'], ...pairs(INTERIOR_COLORS)];
  const interiorMaterialChoices = [['', 'не указан'], ...pairs(INTERIOR_MATERIALS)];
  const trimChoices = TRIMS.map((t) => [t.id, t.name]);
  const optionBoxes = CAR_OPTIONS.map((o) => `<label class="sell-opt"><input type="checkbox" name="options" value="${esc(o.label)}"><span>${esc(o.label)}</span></label>`).join('');
  const trimJson = JSON.stringify(TRIMS.map((t) => ({ id: t.id, name: t.name, options: t.options }))).replace(/</g, '\\u003c');
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Разместить объявление' }], { tight: true })}
  <div class="wrap page-pb sell-wrap">
    <div class="sec-head sell-head"><div><h1>Разместить объявление</h1>
      <p>Заполните карточку — после проверки модератором автомобиль появится в каталоге. Регистрация занимает минуту.</p></div></div>
    ${error ? `<div class="alert alert-err">${esc(error)}</div>` : ''}
    ${ok ? `<div class="alert alert-ok">${esc(ok)}</div>` : ''}
    ${state.user ? '' : `<div class="alert alert-warn">Вы не авторизованы — <a href="/login?next=/sell"><b>войдите</b></a> или <a href="/register?next=/sell"><b>зарегистрируйтесь</b></a>, чтобы отслеживать статус объявления.</div>`}
    <form class="panel sell-form" method="post" action="/sell" enctype="multipart/form-data">
      <div class="sell-block">
        <h2 class="sell-block-head">Автомобиль</h2>
        <div class="grid sell-fields">
          <label class="field" data-combo="brand"><span>Марка *</span><input type="text" name="brand" required autocomplete="off" list="brandlist" placeholder="Geely" data-combo-input></label>
          <label class="field" data-combo="model"><span>Модель *</span><input type="text" name="model" required autocomplete="off" list="modellist" placeholder="Monjaro" data-combo-input></label>
          <label class="field" data-combo="generation"><span>Поколение</span><input type="text" name="generation" autocomplete="off" list="genlist" placeholder="I рестайлинг" data-combo-input></label>
          <label class="field"><span>Год выпуска *</span><input type="number" name="year" min="1950" max="2030" required placeholder="2022"></label>
        </div>
        ${sellCatalogMarkup('', { generations: true })}
      </div>
      <div class="sell-block">
        <h2 class="sell-block-head">Характеристики</h2>
        <div class="grid sell-fields">
          <label class="field"><span>Пробег, км *</span><input type="number" name="mileage" min="0" step="100" required placeholder="45000"></label>
          <label class="field"><span>Цена, <span class="byn">Б</span></span><input type="number" name="price" min="0" step="100" placeholder="50000"></label>
          ${selectField('Коробка передач', 'transmission', TRANS_CHOICES)}
          <label class="field"><span>Объём двигателя, л</span><input type="number" name="volume" min="0" max="9" step="0.1" placeholder="2.0"></label>
          ${selectField('Тип двигателя', 'fuel', FUEL_CHOICES)}
          ${selectField('Кузов', 'body', BODY_CHOICES)}
          ${selectField('Привод', 'drive', DRIVE_CHOICES)}
          <label class="field"><span>Мощность, л.с.</span><input type="number" name="power" min="0" max="2000" placeholder="177"></label>
          ${selectField('Цвет кузова', 'color', colorChoices)}
          <label class="field"><span>VIN</span><input type="text" name="vin" maxlength="17" placeholder="17 символов"></label>
        </div>
      </div>
      <div class="sell-block" data-sell-trim>
        <h2 class="sell-block-head">Комплектация</h2>
        <div class="grid sell-fields">
          <label class="field"><span>Комплектация</span><select name="trim" data-trim-select>${optionTags([['', 'Не выбрана'], ...trimChoices])}</select></label>
          <label class="field"><span>Своё название</span><input type="text" name="trim_name" maxlength="60" placeholder="X Line" data-trim-name></label>
          ${selectField('Цвет салона', 'interior_color', interiorColorChoices)}
          ${selectField('Материал салона', 'interior_material', interiorMaterialChoices)}
        </div>
        <div class="sell-options" data-sell-options>
          <div class="sell-options-top">
            <span class="sell-options-title">Содержимое комплектации</span>
            <span class="sell-options-count" data-options-count>Опции не выбраны</span>
            <button class="btn btn-ghost btn-sm" type="button" data-options-all>Выбрать все</button>
            <button class="btn btn-ghost btn-sm" type="button" data-options-none>Снять все</button>
          </div>
          <p class="sell-options-sum small muted" data-options-sum>Выберите комплектацию — её опции отметятся сами, дальше список можно поправить.</p>
          <div class="sell-options-grid" data-options-grid>${optionBoxes}</div>
        </div>
        <script type="application/json" data-sell-trims="1">${trimJson}</script>
      </div>
      <div class="sell-media">
        <label class="field sell-desc"><span>Описание</span><textarea name="description" rows="2" placeholder="Состояние, комплектация, история обслуживания"></textarea></label>
        <div class="upload" data-upload>
          <span class="upload-label">Фотографии</span>
          <div class="upload-zone" data-upload-zone role="button" tabindex="0"
               aria-label="Добавить фотографии: перетащите файлы сюда или выберите их на компьютере">
            <span class="upload-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg></span>
            <span class="upload-text"><b>Перетащите фотографии сюда</b>
              <span>или выберите на компьютере — до 10 штук, JPG, PNG или WebP</span></span>
            <span class="btn btn-ghost btn-sm upload-pick">Выбрать файлы</span>
            <span class="upload-count" data-upload-count>0 из 10</span>
          </div>
          <input class="upload-input" type="file" name="photos" accept="image/*" multiple data-upload-input>
          <p class="upload-err hide" data-upload-err></p>
          <ul class="upload-list" data-upload-list></ul>
          <!-- Снимки поколений в списках марки/модели/поколения — из свободных источников
               (Wikimedia Commons). По лицензиям CC BY / CC BY-SA автора указывать обязательно.
               Ссылка стояла в подвале, но заказчик 2026-10-02 попросил её убрать
               («Убери в подвале Фотографии каталога…»), поэтому страница атрибуции теперь
               указана здесь — там же, где эти фотографии и появляются (см. tests: ссылка на
               /data/avby-img/credits.html обязана остаться на сайте). -->
          <p class="small muted" style="margin:10px 0 0">Снимки поколений для списков марки, модели и поколения взяты из свободных источников — <a href="/data/avby-img/credits.html">авторы и лицензии фотографий каталога</a>.</p>
        </div>
      </div>
      <div class="sell-block">
        <h2 class="sell-block-head">Контакты</h2>
        <div class="grid sell-fields">
          <label class="field"><span>Город</span><input type="text" name="city" value="${esc(state.user?.city || 'Гомель')}"></label>
          <label class="field"><span>Телефон для связи</span><input type="tel" name="phone" value="${esc(state.user?.phone || '')}"></label>
        </div>
      </div>
      <div class="sell-send">
        <label class="check"><input type="checkbox" name="agree" required><span class="small muted">Подтверждаю, что данные достоверны, и согласен с обработкой персональных данных</span></label>
        <button class="btn btn-lg" type="submit">Отправить на модерацию</button>
      </div>
    </form>
  </div>`;
  return page(state, { title: 'Разместить объявление — Автонова с пробегом', description: 'Разместите объявление о продаже автомобиля на площадке «Автонова с пробегом».', body });
}

/* ── Авторизация ────────────────────────────────────────── */
export function loginPage(state, { error = '', next = '/', modal = false } = {}) {
  const body = `
  <div class="wrap page-pb" style="padding-top:50px;max-width:520px">
    <h1 style="font-size:32px">Вход</h1>
    <p class="muted">Войдите, чтобы управлять объявлениями и избранным.</p>
    ${error ? `<div class="alert alert-err">${esc(error)}</div>` : ''}
    <form class="panel" method="post" action="/login">
      <input type="hidden" name="next" value="${esc(next)}">
      <label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="field" style="margin-top:12px"><span>Пароль</span><input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn btn-lg btn-block" style="margin-top:16px" type="submit">Войти</button>
    </form>
    <p class="center" style="margin-top:16px">Нет аккаунта? <a href="/register" style="color:var(--accent)"><b>Зарегистрируйтесь</b></a></p>
  </div>`;
  return page(state, { title: 'Вход — Автонова с пробегом', description: 'Вход в личный кабинет площадки «Автонова с пробегом».', body, authModal: modalOpts(state, 'login', error, modal) });
}

/* окно входа/регистрации открывается поверх страницы, если пришёл флаг m=1 (ошибка входа) */
function modalOpts(state, tab, error = '', force = false) {
  const p = state.url ? state.url.searchParams : null;
  return { open: force || !!(p && p.get('m') === '1'), tab, error };
}

export function registerPage(state, { error = '', next = '/', modal = false } = {}) {
  const body = `
  <div class="wrap page-pb" style="padding-top:50px;max-width:560px">
    <h1 style="font-size:32px">Регистрация</h1>
    <p class="muted">Три поля — и вы можете размещать объявления и сохранять избранное.</p>
    ${error ? `<div class="alert alert-err">${esc(error)}</div>` : ''}
    <form class="panel" method="post" action="/register">
      <input type="hidden" name="next" value="${esc(next)}">
      <label class="field"><span>Имя *</span><input type="text" name="name" required autocomplete="name"></label>
      <label class="field" style="margin-top:12px"><span>E-mail *</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="field" style="margin-top:12px"><span>Пароль * (минимум 6 символов)</span><input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
      <label class="field" style="margin-top:12px"><span>Телефон</span><input type="tel" name="phone" placeholder="+375 __ ___ __ __"></label>
      <label class="field" style="margin-top:12px"><span>Город</span><input type="text" name="city" value="Гомель"></label>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="agree" required><span class="small muted">Согласен с обработкой персональных данных</span></label>
      <button class="btn btn-lg btn-block" style="margin-top:16px" type="submit">Создать аккаунт</button>
    </form>
    <p class="center" style="margin-top:16px">Уже есть аккаунт? <a href="/login" style="color:var(--accent)"><b>Войти</b></a></p>
  </div>`;
  return page(state, { title: 'Регистрация — Автонова с пробегом', description: 'Быстрая регистрация на площадке «Автонова с пробегом»: размещайте объявления и сохраняйте избранное.', body, authModal: modalOpts(state, 'register', error, modal) });
}

export function accountPage(state, { ok = '' } = {}) {
  const my = all('SELECT * FROM cars WHERE owner_id = ? ORDER BY id DESC', state.user.id).map(decorate);
  for (const c of my) c.photos = all('SELECT path FROM car_photos WHERE car_id = ? ORDER BY sort LIMIT 1', c.id).map(p => p.path);
  const body = `
  ${breadcrumbs([{ href: '/', label: 'Главная' }, { label: 'Личный кабинет' }])}
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:clamp(24px,2.6vw,34px)">Личный кабинет</h1><p>${esc(state.user.name)} · ${esc(state.user.email)}</p></div>
      <div class="row"><a class="btn" href="/sell">Добавить объявление</a><a class="btn btn-ghost" href="/favorites">Избранное</a></div></div>
    ${ok ? `<div class="alert alert-ok">${esc(ok)}</div>` : ''}
    <h3>Мои объявления (${my.length})</h3>
    ${my.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Автомобиль</th><th>Цена</th><th>Статус</th><th>Просмотры</th><th></th></tr></thead>
      <tbody>${my.map(c => `<tr>
        <td><b>${esc(c.brand)} ${esc(c.model)}</b>, ${c.year}</td>
        <td class="num">${c.price_text}</td>
        <td>${statusTag(c.status)}</td>
        <td class="num">${fmt(c.views)}</td>
        <td><a class="btn btn-sm btn-ghost" href="/car/${esc(c.slug)}">Открыть</a></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><h3>Объявлений пока нет</h3><p>Разместите первое — карточка появится в каталоге после проверки модератором.</p><a class="btn" href="/sell">Разместить</a></div>`}
  </div>`;
  return page(state, { title: 'Личный кабинет — Автонова с пробегом', description: 'Управление объявлениями и избранным.', body });
}

export function statusTag(s) {
  const map = { published: ['green', 'Опубликовано'], pending: ['amber', 'На модерации'], rejected: ['red', 'Отклонено'], sold: ['light', 'Продано'] };
  const [cls, label] = map[s] || ['light', s];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

/* ── Админка ────────────────────────────────────────────── */
export function adminPage(state, { tab = 'cars', ok = '', error = '' } = {}) {
  const st = carStats();
  const cars = all('SELECT * FROM cars ORDER BY id DESC LIMIT 200');
  const users = all('SELECT id, email, name, phone, city, role, created_at FROM users ORDER BY id DESC LIMIT 200');
  const leads = all('SELECT l.*, c.brand, c.model FROM leads l LEFT JOIN cars c ON c.id = l.car_id ORDER BY l.id DESC LIMIT 200');
  const reviews = all('SELECT * FROM reviews ORDER BY id DESC LIMIT 200');
  const tabs = [['cars', 'Автомобили'], ['leads', 'Заявки'], ['users', 'Пользователи'], ['reviews', 'Отзывы'], ['settings', 'Настройки']];

  let content = '';
  if (tab === 'cars') {
    content = `<form class="panel" method="post" action="/admin/car" style="margin-bottom:22px">
      <input type="hidden" name="action" value="create">
      <b style="display:block;margin-bottom:6px">Добавить автомобиль в базу вручную</b>
      <p class="muted small" style="margin:0 0 14px">Карточка создаётся сразу опубликованной. Фото можно добавить позже — в каталоге появится заглушка с маркой и моделью.</p>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <label class="field" style="flex:1 1 180px"><span>Марка *</span><input name="brand" required maxlength="60"></label>
        <label class="field" style="flex:1 1 180px"><span>Модель *</span><input name="model" required maxlength="60"></label>
        <label class="field" style="flex:1 1 180px"><span>Поколение</span><input name="generation" maxlength="80"></label>
        <label class="field" style="flex:0 1 120px"><span>Год *</span><input type="number" name="year" min="1950" max="${new Date().getFullYear() + 1}" value="${new Date().getFullYear()}" required></label>
        <label class="field" style="flex:1 1 140px"><span>Пробег, км</span><input type="number" name="mileage" min="0" value="0"></label>
        <label class="field" style="flex:1 1 140px"><span>Цена, <span class="byn">Б</span></span><input type="number" name="price" min="0" value="0"></label>
        <label class="field" style="flex:1 1 140px"><span>Скидка, <span class="byn">Б</span></span><input type="number" name="discount" min="0" step="100" value="0"></label>
        <label class="field" style="flex:1 1 140px"><span>КПП</span><select name="transmission">${Object.entries(TRANS_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field" style="flex:0 1 110px"><span>Объём, л</span><input type="number" step="0.1" name="volume" min="0" value="1.6"></label>
        <label class="field" style="flex:1 1 140px"><span>Топливо</span><select name="fuel">${Object.entries(FUEL_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1 1 140px"><span>Кузов</span><select name="body">${Object.entries(BODY_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1 1 140px"><span>Привод</span><select name="drive">${Object.entries(DRIVE_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1 1 120px"><span>Мощность, л.с.</span><input type="number" name="power" min="0" value="0"></label>
        <label class="field" style="flex:1 1 140px"><span>Цвет</span><input name="color" maxlength="40"></label>
        <label class="field" style="flex:1 1 160px"><span>Город</span><input name="city" value="Гомель" maxlength="60"></label>
        <label class="field" style="flex:1 1 200px"><span>VIN (17 символов)</span><input name="vin" maxlength="17"></label>
      </div>
      <label class="field" style="margin-top:10px"><span>Описание</span><textarea name="description" rows="3" maxlength="4000"></textarea></label>
      <div class="row" style="gap:16px;margin-top:10px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="featured" value="1"><span>Показывать в блоке «Выбор дилера»</span></label>
        <label class="check"><input type="checkbox" name="is_new" value="1" checked><span>Новое объявление — плашка «Новый» и место в «Новых поступлениях»</span></label>
        <label class="check"><input type="checkbox" name="vin_checked" value="1"><span>Проверен по VIN</span></label>
        <label class="check"><input type="checkbox" name="status" value="pending"><span>Оставить на модерации</span></label>
      </div>
      <p class="small" style="margin:8px 0 0">Раздел «Новые автомобили» (/cars-new) наполняется сам, по машинам, а не по объявлениям: год выпуска не старше текущего, пробег до 500 км или слово «новый» в описании.</p>
      <button class="btn" type="submit" style="margin-top:14px">Добавить в базу</button>
    </form>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Автомобиль</th><th>Владелец</th><th>Цена</th><th>Статус</th><th>Действия</th></tr></thead>
    <tbody>${cars.map(c => `<tr>
      <td class="num">${c.id}</td>
      <td><b>${esc(c.brand)} ${esc(c.model)}</b>, ${c.year}</td>
      <td>${c.owner_id ? 'пользователь #' + c.owner_id : '<span class="muted">сайт</span>'}</td>
      <td class="num">${fmt(c.price)}${c.discount ? `<span class="muted small"> −${fmt(c.discount)}</span>` : ''}</td>
      <td>${statusTag(c.status)}</td>
      <td><div class="row" style="gap:6px">
        <form method="post" action="/admin/car"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="action" value="publish"><button class="btn btn-sm" type="submit">Опубл.</button></form>
        <form method="post" action="/admin/car"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="action" value="pending"><button class="btn btn-sm btn-ghost" type="submit">Скрыть</button></form>
        <form method="post" action="/admin/car"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="action" value="delete"><button class="btn btn-sm btn-ghost" type="submit" title="${c.status === 'published' ? 'Карточка уйдёт с сайта, автомобиль попадёт в «Продано»' : 'Удалить черновик'}" onclick="return confirm('${c.status === 'published' ? 'Удалить карточку? Автомобиль уйдёт с сайта и появится в «Продано» как проданный.' : 'Удалить автомобиль безвозвратно?'}')">Удалить</button></form>
        <a class="btn btn-sm btn-ghost" href="/car/${esc(c.slug)}">Открыть</a>
      </div>
      <form method="post" action="/admin/car" class="row" style="gap:6px;margin-top:6px;align-items:center">
        <input type="hidden" name="id" value="${c.id}">
        <input type="hidden" name="action" value="flags">
        <label class="check" style="padding:0 4px"><input type="checkbox" name="is_new" value="1"${c.is_new ? ' checked' : ''}><span class="small">Новый</span></label>
        <label class="field" style="flex:0 1 96px;margin:0"><span class="small">скидка, <span class="byn">Б</span></span><input type="number" name="discount" min="0" step="100" value="${Number(c.discount) || 0}"></label>
        <button class="btn btn-sm" type="submit">ОК</button>
      </form></td></tr>`).join('')}</tbody></table></div>`;
  } else if (tab === 'leads') {
    content = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Тип</th><th>Автомобиль</th><th>Имя</th><th>Телефон</th><th>Текст</th></tr></thead>
    <tbody>${leads.map(l => `<tr><td class="num small">${esc(String(l.created_at).slice(0, 16))}</td><td>${esc(l.kind)}</td>
      <td>${l.brand ? esc(l.brand + ' ' + l.model) : '—'}</td><td>${esc(l.name)}</td><td class="num">${esc(l.phone)}</td>
      <td class="small muted">${esc(l.text || '')}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (tab === 'users') {
    content = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Имя</th><th>E-mail</th><th>Телефон</th><th>Роль</th><th>Регистрация</th></tr></thead>
    <tbody>${users.map(u => `<tr><td class="num">${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td class="num">${esc(u.phone || '—')}</td><td>${esc(u.role)}</td><td class="num small">${esc(String(u.created_at).slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (tab === 'reviews') {
    content = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Автор</th><th>Оценка</th><th>Отзыв</th><th>Действия</th></tr></thead>
    <tbody>${reviews.map(r => `<tr><td class="num">${r.id}</td><td>${esc(r.author)}, ${esc(r.city)}</td><td>${r.rating}</td>
      <td class="small">${esc(r.text.slice(0, 120))}${r.text.length > 120 ? '…' : ''}</td>
      <td><form method="post" action="/admin/review"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="action" value="delete"><button class="btn btn-sm btn-ghost" type="submit">Удалить</button></form></td></tr>`).join('')}</tbody></table></div>`;
  } else {
    content = `<form class="panel" method="post" action="/admin/settings" style="max-width:640px">
      ${['site_name', 'phone_1', 'phone_2', 'email', 'address', 'hours', 'company'].map(k => `
        <label class="field" style="margin-bottom:12px"><span>${esc(k)}</span><input type="text" name="${k}" value="${esc(getSetting(k))}"></label>`).join('')}
      <button class="btn" type="submit">Сохранить настройки</button>
    </form>`;
  }

  const body = `
  <div class="wrap page-pb">
    <div class="sec-head"><div><h1 style="font-size:28px">Администрирование</h1><p>${esc(state.user.name)} · ${esc(state.user.email)}</p></div></div>
    <div class="stat-grid" style="margin-bottom:26px">
      <div class="stat"><b class="num">${fmt(st.total)}</b><span>Автомобилей опубликовано</span></div>
      <div class="stat"><b class="num">${fmt(st.pending)}</b><span>На модерации</span></div>
      <div class="stat"><b class="num">${fmt(st.users)}</b><span>Пользователей</span></div>
      <div class="stat"><b class="num">${fmt(st.leads)}</b><span>Новых заявок</span></div>
    </div>
    <div class="chips" style="margin-bottom:18px">
      ${tabs.map(([k, v]) => `<a class="chip${tab === k ? ' on' : ''}" href="/admin?tab=${k}">${esc(v)}</a>`).join('')}
    </div>
    ${ok ? `<div class="alert alert-ok">${esc(ok)}</div>` : ''}
    ${error ? `<div class="alert alert-err">${esc(error)}</div>` : ''}
    <div style="overflow:auto">${content}</div>
  </div>`;
  return page(state, { title: 'Администрирование — Автонова с пробегом', description: 'Панель управления сайтом.', body });
}

/* ── Ошибка ─────────────────────────────────────────────── */
export function notFound(state) {
  const body = `<div class="wrap page-pb" style="padding-top:80px;text-align:center">
    <h1 style="font-size:60px;margin-bottom:6px">404</h1>
    <p class="muted">Страница не найдена или автомобиль уже продан.</p>
    <div class="row" style="justify-content:center;margin-top:16px">
      <a class="btn" href="/cars">Каталог автомобилей</a>
      <a class="btn btn-ghost" href="/">На главную</a>
    </div>
  </div>`;
  return page(state, { title: 'Страница не найдена — Автонова с пробегом', description: 'Запрашиваемая страница не найдена.', body });
}

export { qs, paramsFrom };
