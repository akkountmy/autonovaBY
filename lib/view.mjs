// Макет и компоненты страниц.
import { fmt, BODY_LABEL, FUEL_LABEL, TRANS_LABEL, DRIVE_LABEL } from './cars.mjs';
import { socialRow } from './social.mjs';
import { sellCatalog } from './car-catalog.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;

/* Канонический адрес сайта для canonical/og:url, JSON-LD, robots.txt и sitemap.xml.
   Задаётся переменной окружения PUBLIC_BASE (например, https://autonova.by); локально
   остаётся адрес отладочного сервера. Раньше часть адресов была вписана как
   http://127.0.0.1:8100 прямо в код — на боевом домене это давало неверные canonical
   и карту сайта. На облачных площадках домен выдаётся уже после создания службы, поэтому
   PUBLIC_BASE не обязателен: Render присылает адрес в RENDER_EXTERNAL_URL, Railway — в
   RAILWAY_PUBLIC_DOMAIN. Без этих запасных вариантов в ссылках остался бы 127.0.0.1. */
export function siteBase() {
  const fromHost = process.env.RENDER_EXTERNAL_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
  return (process.env.PUBLIC_BASE || fromHost || 'http://127.0.0.1:8110').replace(/\/+$/, '');
}

// Русское склонение: plural(53, 'автомобиль', 'автомобиля', 'автомобилей') → 'автомобиля'.
export function plural(n, one, few, many) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const ICONS = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.26-1.26a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  chevL: '<path d="M15 18l-6-6 6-6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  handshake: '<path d="M11 17l-3-3 4-4 3 3 3-3 3 3-6 6z"/><path d="M2 12l5-5 4 4"/><path d="M22 12l-5-5"/>',
  swap: '<path d="M7 4v13M4 14l3 3 3-3"/><path d="M17 20V7M14 10l3-3 3 3"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/><circle cx="17" cy="15" r="1.4"/>',
  /* Бирка (ценник) для окна «Поставить авто на продажу»: та же линейная манера, что у остальных
     иконок окна — только обводка, без заливки. Нужна, чтобы окно продажи не повторяло телефон
     из окна заказа звонка и читалось с первого взгляда. */
  tag: '<path d="M3.4 11.3V5.4a2 2 0 0 1 2-2h5.9a2 2 0 0 1 1.4.6l7.3 7.3a2 2 0 0 1 0 2.8l-5.9 5.9a2 2 0 0 1-2.8 0L4 12.7a2 2 0 0 1-.6-1.4z"/>' +
    '<circle cx="8" cy="8" r="1.5"/>',
  percent: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M19 5L5 19"/>',
  doc: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>',
  star: '<path d="M12 2l3 6.6 7 1-5 5 1.2 7L12 18.3 5.8 21.6 7 14.6 2 9.6l7-1z"/>',
  car: '<path d="M5 17h14M6.5 17a1.5 1.5 0 1 0 3 0M14.5 17a1.5 1.5 0 1 0 3 0"/><path d="M3 17v-5l2-5h14l2 5v5"/><path d="M3 12h18"/>',
  gavel: '<path d="M14 3l7 7-3 3-7-7z"/><path d="M9 8l7 7"/><path d="M3 21h9"/><path d="M4 14l6 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/>',
  filter: '<path d="M3 5h18M7 12h10M10 19h4"/>',
  // «Параметры»: три линии с бегунками — общепонятный значок настроек подбора, в той же
  // линейной манере, что и остальные иконки (только обводка, без заливки внутри 24×24).
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.1"/><circle cx="15" cy="12" r="2.1"/><circle cx="8" cy="18" r="2.1"/>',
  // «Сравнение» — весы (по просьбе заказчика, 2026-09-29): две чаши на перекладине читаются
  // как «взвесить две машины рядом». Раньше стояли две карточки-объявления. Детали разнесены
  // по краям (чаши на x=5 и x=19), чтобы при 19 px в шапке обводки не сливались в кашу.
  compare:
    '<path d="M12 3.4v16.2"/><path d="M8.4 19.6h7.2"/><path d="M4.6 7.4h14.8"/>' +
    '<path d="M5 7.4l-2.6 6.2a3 3 0 0 0 5.2 0z"/>' +
    '<path d="M19 7.4l2.6 6.2a3 3 0 0 1-5.2 0z"/>' +
    '<circle cx="12" cy="3.2" r="1.1"/>',
  mail: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M3 7l9 6 9-6"/>',
  /* Речевое облачко для окна связи с продавцом (страница автомобиля). Линейка та же, что у
     остальных иконок окна: обводка, без заливки. */
  message: '<path d="M20.4 11.2a8.2 8.2 0 0 1-8.6 8.2 9 9 0 0 1-2.5-.4l-5.2 2 1.5-4.2A8.1 8.1 0 0 1 3.8 11.2 8.1 8.1 0 0 1 11.9 3h.2a8.1 8.1 0 0 1 8.3 8.2z"/>' +
    '<path d="M8.4 9.4h7.2M8.4 13.4h4.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  /* «Скопировать ссылку» — два листа со сдвигом (а не звено цепи): читается как «копия», а не
     как «перейти по ссылке». Нужна значку на главном фото объявления (заказчик 2026-09-30). */
  copy: '<rect x="9" y="8.6" width="10.4" height="11.4" rx="2.4"/>' +
    '<path d="M5.6 15.4A2.4 2.4 0 0 1 4.6 13.5V6.4a2.4 2.4 0 0 1 2.4-2.4h6.4a2.4 2.4 0 0 1 2.2 1.4"/>',

  // ── Иконки главного меню ────────────────────────────────────────────────────────────
  // Линейные (только обводка, без заливки и фона — «прозрачные»), один язык форм и
  // одно «тело» машины на все автомобильные разделы: кузов 3.2…20.8, крыша на y=6.7,
  // колёса r=1.9 на y=17.5. Раздел читается по одной крупной детали, а не по мелкому
  // значку поверх крыши: «с пробегом» — пунктирная дорога под колёсами, «Новые» —
  // искра в свободном правом верхнем углу, «Электроавто» — молния внутри кузова,
  // «Продано» — галочка в круге там же, где искра. Детали разнесены так, чтобы
  // обводки не сливались в кашу при 28 px (рабочие иконки меню). Немашинные разделы
  // держим на одном узнаваемом предмете: ключ, раскрытый журнал, калькулятор, облачко
  // с оценкой — «журнал» специально книга, а не карточка, иначе он читается как
  // калькулятор в одном ряду.
  navUsed:
    '<path d="M3.2 17.5V13.6a2 2 0 0 1 1.4-1.9l1.2-.4 2.4-3.5A2.6 2.6 0 0 1 10.3 6.7h3.4a2.6 2.6 0 0 1 2.1 1.1l2.4 3.5 1.2.4a2 2 0 0 1 1.4 1.9v3.9Z"/>' +
    '<path d="M6 11.4h12"/>' +
    '<circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>' +
    '<path d="M4.6 21.6h14.8" stroke-dasharray="2.4 3"/>',
  navNew:
    '<path d="M3.2 17.5V13.6a2 2 0 0 1 1.4-1.9l1.2-.4 2.4-3.5A2.6 2.6 0 0 1 10.3 6.7h3.4a2.6 2.6 0 0 1 2.1 1.1l2.4 3.5 1.2.4a2 2 0 0 1 1.4 1.9v3.9Z"/>' +
    '<path d="M6 11.4h12"/>' +
    '<circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>' +
    '<path d="M18.5 2.2c.35 1.75 1.05 2.45 2.8 2.9-1.75.45-2.45 1.15-2.8 2.9-.35-1.75-1.05-2.45-2.8-2.9 1.75-.45 2.45-1.15 2.8-2.9z"/>',
  navEv:
    '<path d="M3.2 17.5V13.6a2 2 0 0 1 1.4-1.9l1.2-.4 2.4-3.5A2.6 2.6 0 0 1 10.3 6.7h3.4a2.6 2.6 0 0 1 2.1 1.1l2.4 3.5 1.2.4a2 2 0 0 1 1.4 1.9v3.9Z"/>' +
    '<circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>' +
    '<path d="M13.4 7.8 9.6 12.9h2.9l-1 3.7 3.8-5.1h-2.9z"/>',
  navService:
    '<path d="M16 2.8a5.6 5.6 0 0 0-4.9 8.3l-6.9 6.9a1.9 1.9 0 0 0 2.7 2.7l6.9-6.9A5.6 5.6 0 0 0 21.2 8.9l-3.3 3.3-2.8-2.8z"/>',
  navNews:
    '<path d="M12 6.4C10.4 5.2 8.5 4.6 6.4 4.6c-1 0-2 .1-2.9.4v12.8c.9-.3 1.9-.4 2.9-.4 2.1 0 4 .6 5.6 1.8 1.6-1.2 3.5-1.8 5.6-1.8 1 0 2 .1 2.9.4V5c-.9-.3-1.9-.4-2.9-.4-2.1 0-4 .6-5.6 1.8z"/>' +
    '<path d="M12 6.4v12.8"/>',
  navCalc:
    '<rect x="4.6" y="2.6" width="14.8" height="18.8" rx="3"/>' +
    '<rect x="7.6" y="5.8" width="8.8" height="3.6" rx="1.3"/>' +
    '<path d="M8.4 13.4h.01M12 13.4h.01M15.6 13.4h.01M8.4 17.4h.01M12 17.4h.01M15.6 17.4h.01"/>',
  navSold:
    '<path d="M3.2 17.5V13.6a2 2 0 0 1 1.4-1.9l1.2-.4 2.4-3.5A2.6 2.6 0 0 1 10.3 6.7h3.4a2.6 2.6 0 0 1 2.1 1.1l2.4 3.5 1.2.4a2 2 0 0 1 1.4 1.9v3.9Z"/>' +
    '<path d="M6 11.4h12"/>' +
    '<circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>' +
    '<circle cx="18.3" cy="5.4" r="2.9"/>' +
    '<path d="M17.1 5.4l.9.9 1.6-1.7"/>',
  navReview:
    '<path d="M20.4 11.2a8.2 8.2 0 0 1-8.6 8.2 9 9 0 0 1-2.5-.4l-5.2 2 1.5-4.2A8.1 8.1 0 0 1 3.8 11.2 8.1 8.1 0 0 1 11.9 3h.2a8.1 8.1 0 0 1 8.3 8.2z"/>' +
    '<path d="M12.2 7.4l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5z"/>',
};
export function ico(name, size = 18, cls = '') {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.car}</svg>`;
}

// Пункты меню — надписями (по просьбе заказчика, 2026-09-29): иконки вкладок убраны из
// вёрстки, остались только подписи. Поле `icon` намеренно сохраняем — это готовый набор
// значков разделов (`navUsed`, `navNew`, `navEv`, `navService`, `navNews`, `navCalc`,
// `navSold`, `navReview`); `navNews` используется иконкой «Автожурнал» в шапке (headExtras),
// а вернуть значки во вкладки — правка одной строки в navHtml().
export const NAV = [
  /* «Автомобили с пробегом» ведёт в тот же режим каталога, что и кнопка «С пробегом» в панели
     поиска (/cars-used), поэтому в панели подсвечивается «С пробегом», а не «Все авто» (просьба
     заказчика, 2026-09-29). Раздел каталога при этом один: на /cars и /cars/<марка> пункт меню
     остаётся подсвеченным — за это отвечает also. */
  { href: '/cars-used', label: 'Автомобили с пробегом', icon: 'navUsed', also: ['/cars'] },
  { href: '/cars-new', label: 'Новые', icon: 'navNew' },
  { href: '/electric', label: 'Электро', icon: 'navEv' },
  { href: '/services', label: 'Услуги', dd: true, icon: 'navService' },
  { href: '/news', label: 'Автожурнал', icon: 'navNews', extra: true },
  { href: '/kalkulyator', label: 'Кредитный калькулятор', icon: 'navCalc' },
  { href: '/cars-sold', label: 'Продано', icon: 'navSold' },
  { href: '/reviews', label: 'Отзывы', icon: 'navReview', extra: true },
];

export function logoLockup(sub = 'с пробегом', theme = 'light') {
  const file = theme === 'dark' ? 'logo-on-dark.png' : 'logo.png';
  return `<a class="logo" href="/" title="На главную страницу — Автонова с пробегом">
    <img src="/assets/logo/${file}" alt="Автонова" width="393" height="91">
    <span class="logo-sub">${esc(sub)}</span>
  </a>`;
}

// Пункт «Услуги» — раскрывающийся список: сверху ссылка на раздел, под ней перечень
// услуг из базы (передаётся в layout() как services). Список открывается по наведению,
// по фокусу с клавиатуры и по тапу на тач-устройствах (класс .open ставит site.js).
function navHtml(path, services = []) {
  const base = '/' + (path.split('/')[1] || '');
  return NAV.map((n) => {
    /* Пункт подсвечен на своей странице, на её подстраницах и на путях из also (у «Автомобилей
       с пробегом» это /cars и /cars/<марка>: раздел каталога один, а режимов выдачи четыре). */
    const mine = (h) => path === h || path.startsWith(h + '/') || base === h;
    const on = n.href === '/' ? path === '/' : (mine(n.href) || (n.also || []).some(mine));
    // Пункт меню — надпись. Значок раздела остаётся в разметке (возврат — правка одной строки),
    // но не показывается нигде: подписи видны там, где помещаются (≥1280 px), ниже меню уходит
    // в панель-бургер и там тоже только надписи (см. .nav-ico в site.css).
    const icon = ico(n.icon, 21, 'nav-ico');
    const tx = `<span class="nav-tx">${esc(n.label)}</span>`;
    if (n.dd) {
      const links = [{ href: n.href, label: 'Все услуги' }]
        .concat((services || []).map((s) => ({ href: '/services/' + s.slug, label: s.title })));
      return `<div class="nav-dd" data-nav-dd>
      <a class="nav-dd-btn${on ? ' on' : ''}" href="${n.href}" title="${esc(n.label)}" aria-haspopup="true" aria-expanded="false"><span class="nav-ico-wrap">${icon}${ico('chevron', 12, 'dd-chev')}</span>${tx}</a>
      <div class="nav-dd-menu" data-nav-dd-menu>
        ${links.map((l) => `<a href="${esc(l.href)}"${path === l.href ? ' class="on"' : ''}>${esc(l.label)}</a>`).join('')}
      </div>
    </div>`;
    }
    // «Автожурнал» и «Отзывы» (extra) ушли из текстового ряда в иконки шапки: в верхнем
    // меню их прячет CSS (.nav a.nav-extra), в мобильной панели-бургере они остаются.
    const cls = [on ? 'on' : '', n.extra ? 'nav-extra' : ''].filter(Boolean).join(' ');
    return `<a href="${n.href}"${cls ? ` class="${cls}"` : ''} title="${esc(n.label)}">${icon}${tx}</a>`;
  }).join('');
}

/* Справочник «Марка / Модель» для форм с подсказками — один код на окно «Поставить авто на
   продажу» (lib/view.mjs) и страницу «Разместить объявление» (lib/pages.mjs). Возвращает:
   • <datalist> марок и моделей — подсказки для случая, когда JS не выполнился или ещё не
     загрузился (поля остаются обычными текстовыми с системным списком);
   • JSON [data-sell-catalog="1"] — тот же справочник для initCombos в site.js: он заменяет
     системный список своим (.sel-pop), сужает модели по выбранной марке и подтягивает каталог
     av.by (public/data/avby) для марок, которых у дилера ещё нет.
   prefix — приставка к id списков: на странице /sell одновременно живут и её собственные списки,
   и списки окна, поэтому id должны различаться, иначе браузер возьмёт первый попавшийся.
   Данные кэшировать не нужно: sellCatalog() считает справочник свежим по каждому запросу
   (0,6 мс на прогретой базе), поэтому новая марка появляется в подсказках сразу после
   публикации объявления. */
export function sellCatalogMarkup(prefix = '', { generations = false } = {}) {
  const cat = sellCatalog();
  const json = JSON.stringify({ brands: cat.brands, tree: cat.tree }).replace(/</g, '\\u003c');
  const list = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
  return `${list(prefix + 'brandlist', cat.brands)}${list(prefix + 'modellist', cat.models)}`
    + (generations ? list(prefix + 'genlist', cat.generations) : '')
    + `\n    <script type="application/json" data-sell-catalog="1">${json}</script>`;
}

export function bookModalHtml() {
  return `
<div class="modal-back" data-book-modal hidden>
  <div class="modal modal-auth" role="dialog" aria-modal="true" aria-labelledby="book-h">
    <button class="modal-x" type="button" data-book-close aria-label="Закрыть">${ico('close', 18)}</button>
    <div class="modal-head">
      <span class="modal-ico">${ico('calendar', 20)}</span>
      <div>
        <h2 id="book-h" class="modal-h">Бронь автомобиля</h2>
        <p class="modal-sub" data-book-sub>Оставьте контакты — менеджер закрепит авто за вами и позвонит в течение 15 минут.</p>
      </div>
    </div>
    <form method="post" action="/lead" data-book-form>
      <input type="hidden" name="car_id" value="">
      <input type="hidden" name="kind" value="book">
      <input type="hidden" name="text" value="">
      <label class="field"><span>Имя *</span><input type="text" name="name" required autocomplete="name" placeholder="Как к вам обращаться"></label>
      <label class="field" style="margin-top:12px"><span>Телефон *</span><input type="tel" name="phone" required autocomplete="tel" placeholder="+375 __ ___ __ __"></label>
      <label class="field" style="margin-top:12px"><span>Комментарий</span><input type="text" name="comment" placeholder="Удобное время звонка, трейд-ин, вопросы"></label>
      <button class="btn btn-lg btn-block" type="submit">Забронировать</button>
      <p class="auth-alt auth-alt-line">Бронь держим 3 дня — без предоплаты.</p>
    </form>
  </div>
</div>`;
}

/* Окно быстрой заявки «Поставить авто на продажу» (заказчик, 2026-10-02: «на ее месте сделай
   кнопку - поставить авто на продажу и сделай при нажатии, чтобы открывалось окно для короткого
   заполнения информации об авто в нашем стиле»).

   Устроено ровно как окно заказа звонка (callModalHtml): те же классы .modal-back /
   .modal.modal-auth / .modal-head / .modal-x, закрытие по крестику, фону и Escape, отправка на
   /lead без перезагрузки — работает один и тот же initLeadModal в site.js, отличается только
   адрес открывающей кнопки (data-sale-open) и текст на кнопке отправки.

   Заявка «короткая»: только то, без чего нельзя оценить машину и связаться — марка с моделью,
   год, пробег, желаемая цена и телефон. Остальное (комплектация, фото, история) менеджер уточнит
   звонком; подробная форма со всеми полями осталась на странице /sell. Поля идут парами по два в
   строку (.auth-row) — окно остаётся коротким и на телефоне не превращается в простыню.

   Заказчик 02.10.2026: «В окне „Поставить авто на продажу“ убери „Заполните коротко —“ и „Нужно
   загрузить фотографии и заполнить всю карточку?“, поля „Марка *“ и „Модель *“ сделай списками
   авто/моделей, как на нашем сайте в блоке подать объявление». Поэтому подзаголовок и ссылка на
   /sell из окна убраны, а марка с моделью стали теми же связанными списками, что и на /sell
   (data-combo + подсказки из lib/car-catalog.mjs, ведёт их initCombos в site.js: выбрал марку —
   в списке моделей только её модели, а каталог av.by подгружается по ходу). Разметку подсказок
   даёт sellCatalogMarkup() — общий код для окна и страницы /sell, чтобы списки не разъехались.

   kind=sale — заявка уходит на /lead (server.mjs:341) и кладётся в таблицу leads, а собранная
   строка «Авто на продажу: …» попадает в поле text, чтобы менеджер видел машину прямо в списке
   заявок. Имя и телефон подставляются, если посетитель уже вошёл (state.user). */
export function saleModalHtml(user = null) {
  const name = user && user.name ? esc(user.name) : '';
  const phone = user && user.phone ? esc(user.phone) : '';
  return `
<div class="modal-back" data-sale-modal hidden>
  <div class="modal modal-auth sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-h">
    <button class="modal-x" type="button" data-sale-close aria-label="Закрыть">${ico('close', 18)}</button>
    <div class="modal-head">
      <span class="modal-ico">${ico('tag', 20)}</span>
      <div>
        <h2 id="sale-h" class="modal-h">Поставить авто на продажу</h2>
      </div>
    </div>
    <form method="post" action="/lead" data-sale-form>
      <input type="hidden" name="kind" value="sale">
      <input type="hidden" name="text" value="Авто на продажу с главной страницы">
      <div class="auth-row">
        <label class="field" data-combo="brand"><span>Марка *</span><input type="text" name="brand" required autocomplete="off" list="sale-brandlist" placeholder="Geely" data-combo-input data-sale-first></label>
        <label class="field" data-combo="model"><span>Модель *</span><input type="text" name="model" required autocomplete="off" list="sale-modellist" placeholder="Monjaro" data-combo-input></label>
      </div>
      <div class="auth-row">
        <label class="field"><span>Год выпуска *</span><input type="number" name="year" min="1950" max="2030" required placeholder="2022"></label>
        <label class="field"><span>Пробег, км *</span><input type="number" name="mileage" min="0" step="100" required placeholder="45 000"></label>
      </div>
      <label class="field"><span>Желаемая цена, <span class="byn">Б</span></span><input type="number" name="price" min="0" step="100" placeholder="50 000"></label>
      <div class="auth-row">
        <label class="field sale-name"><span>Имя *</span><input type="text" name="name" required autocomplete="name" value="${name}" placeholder="Как к вам обращаться"></label>
        <label class="field"><span>Телефон *</span><input type="tel" name="phone" required autocomplete="tel" value="${phone}" placeholder="+375 __ ___ __ __"></label>
      </div>
      <label class="check"><input type="checkbox" name="agree" required checked><span class="small muted">Согласен с обработкой персональных данных</span></label>
      <button class="btn btn-lg btn-block" type="submit">Отправить заявку</button>
    </form>
    ${sellCatalogMarkup('sale-')}
  </div>
</div>`;
}

/* Окно заказа звонка (заказчик, 2026-09-28: «над кнопкой разместить объявление на титульной
   странице размести кнопку заказать звонок и чтобы при нажатии открывалась окно как на кнопке
   бронь»). Вид и механика — те же, что у брони (bookModalHtml): те же классы .modal-back /
   .modal.modal-auth / .modal-head / .modal-x, закрытие по крестику, фону и Escape, отправка
   формы без перезагрузки. Отличие одно: автомобиля нет, поэтому нет и поля car_id, а заявка
   уходит на /lead с kind=call (сервер — server.mjs, у него это значение и по умолчанию).
   Разметку ставит layout() рядом с окном брони, открывает — initCallModal в site.js. */
export function callModalHtml() {
  return `
<div class="modal-back" data-call-modal hidden>
  <div class="modal modal-auth" role="dialog" aria-modal="true" aria-labelledby="call-h">
    <button class="modal-x" type="button" data-call-close aria-label="Закрыть">${ico('close', 18)}</button>
    <div class="modal-head">
      <span class="modal-ico">${ico('phone', 20)}</span>
      <div>
        <h2 id="call-h" class="modal-h">Заказать звонок</h2>
        <p class="modal-sub">Оставьте контакты — перезвоним в течение 15 минут и ответим на вопросы по автомобилю.</p>
      </div>
    </div>
    <form method="post" action="/lead" data-call-form>
      <input type="hidden" name="kind" value="call">
      <input type="hidden" name="text" value="Заказ звонка с главной страницы">
      <label class="field"><span>Имя *</span><input type="text" name="name" required autocomplete="name" placeholder="Как к вам обращаться"></label>
      <label class="field" style="margin-top:12px"><span>Телефон *</span><input type="tel" name="phone" required autocomplete="tel" placeholder="+375 __ ___ __ __"></label>
      <label class="field" style="margin-top:12px"><span>Комментарий</span><input type="text" name="comment" placeholder="Удобное время звонка, вопрос по авто"></label>
      <button class="btn btn-lg btn-block" type="submit">Жду звонка</button>
      <p class="auth-alt">Позвоним с 9:00 до 20:00 без выходных. Номер остаётся у дилера.</p>
    </form>
  </div>
</div>`;
}

/* Окно связи с продавцом на странице автомобиля (заказчик 2026-09-29: «на страницах
   автомобилей сделай так чтобы при нажатии на кнопки позвонить продавцу Отправить сообщение
   предложить цену, чтобы всплывало прозрачное окно по нашему стилю»; заказчик 2026-09-30:
   «в карточке авто — Позвонить продавцу, сделай, чтобы был только набор номера, раскрывающееся
   окно оставь только для — отправить сообщение и предложить цену, а также убери в окне —
   позвоним в течение 15 минут и подтвердим, что машина в наличии»).

   Отсюда две перемены против первой версии: звонок окна не открывает вообще (в карточке это
   обычная ссылка tel:, нажатие сразу набирает номер), а само окно осталось на две вкладки —
   «Написать» и «Своя цена». Обещания перезвона из шапки окна убраны: они относились к звонку,
   а не к сообщению и цене. Вкладки сведены к панелям, которые можно открыть, поэтому третьей
   вкладки и её формы в разметке нет.

   Это то же окно, что бронь и заказ звонка (bookModalHtml / callModalHtml): классы .modal-back /
   .modal.modal-auth / .modal-head / .modal-x, полупрозрачный фон с размытием
   (background:rgba(20,23,28,.45) + backdrop-filter:blur(7px)), закрытие по крестику, щелчку по
   фону и Escape. Отличие — вкладки (.auth-tabs / .auth-tab — тот же переключатель, что у входа
   и регистрации), поэтому «Написать» и «Предложить цену» не размножают разметку.

   Каждая вкладка — своя форма со своим car_id (скрытое поле внутри формы, а не общее на окно:
   отправляется ровно та форма, которую видно). */
export function carContactModalHtml({ carId = null, carTitle = '' } = {}) {
  const title = carTitle || 'этот автомобиль';
  const fields = (id) => `
      <input type="hidden" name="car_id" value="${carId ?? ''}">
      <input type="hidden" name="kind" value="${id}">
      <input type="hidden" name="text" value="${esc(
        id === 'message' ? 'Сообщение по объявлению: ' + title
          : 'Предложение цены: ' + title)}">
      <label class="field"><span>Имя *</span><input type="text" name="name" required autocomplete="name" placeholder="Как к вам обращаться"></label>
      <label class="field" style="margin-top:12px"><span>Телефон *</span><input type="tel" name="phone" required autocomplete="tel" placeholder="+375 __ ___ __ __"></label>`;
  const agree = `
      <button class="btn btn-lg btn-block" type="submit">`;
  return `
<div class="modal-back" data-car-contact hidden>
  <div class="modal modal-auth car-contact-modal" role="dialog" aria-modal="true" aria-labelledby="cc-h">
    <button class="modal-x" type="button" data-car-contact-close aria-label="Закрыть">${ico('close', 18)}</button>
    <div class="modal-head">
      <span class="modal-ico">${ico('message', 20)}</span>
      <div>
        <h2 id="cc-h" class="modal-h">Связаться с продавцом</h2>
        <p class="modal-sub">${esc(title)} — напишите продавцу или предложите свою цену.</p>
      </div>
    </div>
    <div class="auth-tabs car-contact-tabs" role="tablist">
      <button class="auth-tab on" type="button" role="tab" aria-selected="true" data-car-contact-tab="message">Написать</button>
      <button class="auth-tab" type="button" role="tab" aria-selected="false" data-car-contact-tab="offer">Своя цена</button>
    </div>
    <div data-car-contact-pane="message">
      <form method="post" action="/lead" data-car-contact-form="message">
        ${fields('message')}
        <label class="field" style="margin-top:12px"><span>Сообщение</span><textarea name="comment" rows="4" placeholder="Спросите о машине: состояние, комплектация, обмен, осмотр"></textarea></label>
        ${agree}Отправить сообщение</button>
        <p class="auth-alt">Ответим в рабочее время и продублируем ответ звонком.</p>
      </form>
    </div>
    <div data-car-contact-pane="offer" hidden>
      <form method="post" action="/lead" data-car-contact-form="offer">
        ${fields('offer')}
        <label class="field" style="margin-top:12px"><span>Ваша цена, <span class="byn">Б</span> *</span><input type="number" name="comment" required min="0" step="100" inputmode="numeric" placeholder="Например, 65 000"></label>
        ${agree}Предложить цену</button>
        <p class="auth-alt">Передадим предложение продавцу: если цена подойдёт, согласуем сделку.</p>
      </form>
    </div>
  </div>
</div>`;
}

export function authModalHtml(path = '/', opts = {}) {
  const tab = opts.tab === 'register' ? 'register' : 'login';
  const err = opts.error || '';
  const open = opts.open === true;
  const next = path && path.startsWith('/') ? path : '/';
  const alert = (t) => (err && t === tab ? `<div class="alert alert-err">${esc(err)}</div>` : '');
  return `
<div class="modal-back${open ? ' is-open' : ''}" data-auth-modal${open ? '' : ' hidden'}>
  <div class="modal modal-auth" role="dialog" aria-modal="true" aria-labelledby="auth-h">
    <button class="modal-x" type="button" data-auth-close aria-label="Закрыть">${ico('close', 18)}</button>
    <div class="modal-head">
      <span class="modal-ico">${ico('lock', 20)}</span>
      <div>
        <h2 id="auth-h" class="modal-h">Вход и регистрация</h2>
        <p class="modal-sub">Один аккаунт: объявления, избранное и сравнение.</p>
      </div>
    </div>
    <div class="auth-tabs" role="tablist" aria-label="Вход или регистрация">
      <button class="auth-tab${tab === 'login' ? ' on' : ''}" type="button" role="tab" data-auth-tab="login" aria-selected="${tab === 'login'}">Вход</button>
      <button class="auth-tab${tab === 'register' ? ' on' : ''}" type="button" role="tab" data-auth-tab="register" aria-selected="${tab === 'register'}">Регистрация</button>
    </div>
    <div class="auth-pane${tab === 'login' ? '' : ' hide'}" data-auth-pane="login">
      ${alert('login')}
      <form method="post" action="/login" data-auth-form="login">
        <input type="hidden" name="next" value="${esc(next)}">
        <label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="email" placeholder="you@mail.by"></label>
        <label class="field"><span>Пароль</span><input type="password" name="password" required autocomplete="current-password" placeholder="Не менее 6 символов"></label>
        <button class="btn btn-lg btn-block" type="submit">Войти</button>
      </form>
      <p class="auth-alt">Нет аккаунта? <a href="/register" data-auth-goto="register">Зарегистрироваться</a></p>
    </div>
    <div class="auth-pane${tab === 'register' ? '' : ' hide'}" data-auth-pane="register">
      ${alert('register')}
      <form method="post" action="/register" data-auth-form="register">
        <input type="hidden" name="next" value="${esc(next)}">
        <label class="field"><span>Имя *</span><input type="text" name="name" required autocomplete="name" placeholder="Как к вам обращаться"></label>
        <label class="field"><span>E-mail *</span><input type="email" name="email" required autocomplete="email" placeholder="you@mail.by"></label>
        <label class="field"><span>Пароль * — минимум 6 символов</span><input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Придумайте пароль"></label>
        <div class="auth-row">
          <label class="field"><span>Телефон</span><input type="tel" name="phone" placeholder="+375 __ ___ __ __"></label>
          <label class="field"><span>Город</span><input type="text" name="city" value="Гомель"></label>
        </div>
        <label class="check"><input type="checkbox" name="agree" required><span class="small muted">Согласен с обработкой персональных данных</span></label>
        <button class="btn btn-lg btn-block" type="submit">Создать аккаунт</button>
      </form>
      <p class="auth-alt">Уже есть аккаунт? <a href="/login" data-auth-goto="login">Войти</a></p>
    </div>
  </div>
</div>`;
}

/* ── Марки в продаже — нижняя строка шапки ────────────────────────────────
/* Тёмная полоса марок под шапкой внутренних страниц (17–18 марок с количеством).
   НЕ РЕНДЕРИТСЯ НИГДЕ с 2026-09-27: заказчик — «убери после шапки на всех страницах на сером
   фоне». Список марок вместо неё показывается светлой строкой над панелью «Поиск по параметрам»
   — на главной и на страницах «Автомобили с пробегом» / «Новые» / «Электро» (brandsTop() в
   pages.mjs). Функция оставлена: вернуть полосу — одна строка в layout().
   Прозрачные надписи «марка + количество авто»: без карточек, рамок и фона.
   Список не обрезается — что не поместилось в строку, переносится на следующую
   (сетка одинаковых колонок, поэтому марки идут ровными группами по количеству).
   Число — количество автомобилей марки в продаже; полная фраза в title.
   Плашки «Все марки 18» в строке больше нет (заказчик: «Все марки18 внизу под шапкой слева —
   убери везде»): она стояла последней на всех страницах, кроме главной, и вела в тот же /cars,
   что и любая марка. Вернуться в каталог можно логотипом и пунктом меню «Автомобили». */
export function brandStrip(brands = []) {
  // Порядок — по алфавиту, как в списке «Популярные марки» на butikavto.by и как в строке марок
  // на главной (brands() в lib/cars.mjs уже отдаёт алфавит). Раньше здесь было «сначала марки с
  // большим количеством автомобилей»: заказчик 2026-09-27 — «сделай в порядке как здесь:
  // https://butikavto.by/» (в присланном списке Alfa Romeo идёт первым, Geely с 18 авто — восьмым).
  // Тот же порядок отдан строке марок над панелью поиска (у полосы он теперь исторический).
  const list = [...(brands || [])].sort((a, b) => String(a.brand).localeCompare(String(b.brand), 'ru'));
  if (!list.length) return '';
  return `
  <nav class="brand-strip" aria-label="Марки автомобилей в продаже">
    <div class="wrap bs-grid">
      ${list.map((b) => `<a class="bs-item" href="/cars?brand=${encodeURIComponent(b.brand)}" title="${esc(b.brand)} — ${b.n} ${plural(b.n, 'автомобиль', 'автомобиля', 'автомобилей')}"><span class="bs-name">${esc(b.brand)}</span><span class="bs-cnt num">${b.n}</span></a>`).join('')}
    </div>
  </nav>`;
}

/* ── Марки внутри панели поиска (главная) ─────────────────────────────────
   Строка «Марки + марка/количество» верхней строкой карточки поиска. На главной сейчас НЕ
   используется: список марок уехал НАД панелью и стал brandLine без заголовка. Оставлено
   как готовый компонент — если заказчик захочет вернуть марки внутрь карточки поиска. */
export function brandChips(brands = [], { label = 'Марки' } = {}) {
  // Порядок тот же, что в полосе марок под шапкой и в строке марок на главной, — по алфавиту.
  const list = [...(brands || [])].sort((a, b) => String(a.brand).localeCompare(String(b.brand), 'ru'));
  if (!list.length) return '';
  return `
    <nav class="ps-brands" aria-label="Марки автомобилей в продаже">
      <span class="psb-label">${esc(label)}</span>
      <div class="psb-list">
        ${list.map((b) => `<a class="psb-item" href="/cars?brand=${encodeURIComponent(b.brand)}" title="${esc(b.brand)} — ${b.n} ${plural(b.n, 'автомобиль', 'автомобиля', 'автомобилей')}">${esc(b.brand)}<i class="num">${b.n}</i></a>`).join('')}
        <a class="psb-item psb-all" href="/cars" title="Весь каталог — ${list.length} ${plural(list.length, 'марка', 'марки', 'марок')}">Все марки<i class="num">${list.length}</i></a>
      </div>
    </nav>`;
}

export function layout({ title, description = '', body, path = '/', user = null, settings = {}, counts = {}, jsonLd = null, canonical = '', authModal = null, carContactModal = null, services = [], brands = [], afterBrands = '' }) {
  const s = settings;
  const nav = navHtml(path, services);
  // Иконка «Автожурнал» в шапке. «Отзывы» из шапки убраны совсем (просьба заказчика): остался
  // только «Автожурнал», и он всегда первый — значит всегда получает head-first, отступ от
  // кнопки локации. Иконка стоит на всех страницах, включая саму /news: раньше на своей
  // странице она пропадала («ссылка вела бы на текущую страницу»), но посетитель видит в этом
  // пропажу кнопки из шапки — при переходе по «Автожурналу» кнопка исчезала (просьба заказчика,
  // 2026-09-29).
  const headExtras = `<a class="icon-btn head-extra head-first" href="/news" title="Автожурнал" aria-label="Автожурнал">${ico('navNews', 19)}</a>`;
  // Тёмной полосы марок под шапкой (brandStrip) здесь больше нет — заказчик 2026-09-27: «убери
  // после шапки на всех страницах на сером фоне». Список марок остался светлой строкой над
  // панелью «Поиск по параметрам»: на главной и на страницах «Автомобили с пробегом» / «Новые» /
  // «Электро» (brandsTop() в pages.mjs). Параметр brands оставлен — его передают все страницы,
  // а сама функция brandStrip живёт ниже, чтобы полосу можно было вернуть одной строкой.
  const base = siteBase();
  const url = canonical || base + path;
  /* Подпись в подвале: компания из настроек идёт одной строкой («ООО «Автонова», УНП 490323534»).
     Хвост после последней запятой (обычно «УНП …») держим неразрывным: см. комментарий у .fb-copy. */
  const companyRaw = String(s.company || 'ООО «Автонова», УНП 490323534');
  const companyCut = companyRaw.lastIndexOf(',');
  const companyHead = companyCut > 0 ? companyRaw.slice(0, companyCut + 1) : companyRaw;
  const companyTail = companyCut > 0 ? companyRaw.slice(companyCut + 1).trim() : '';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/assets/logo/favicon.ico">
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(s.site_name || 'Автонова с пробегом')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(base + '/assets/logo/logo.png')}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(base + '/assets/logo/logo.png')}">
<meta name="theme-color" content="#E3000F">
  <!-- Счётчик версий CSS; 168 → 169: из карточки автомобиля убраны блок заявки на подбор машины и
       пояснение про неуказанный VIN, а колонки карточки снова идут по своему содержимому
       (align-items:start) — см. public/assets/css/site.css, «Карточка товара», и lib/pages.mjs:
       carPage. До этого 167 → 168 — раскладка статьи автожурнала на subgrid, 169 → 170 — поджаты
       поля панелей и строки «Условий покупки» в правой колонке карточки, а 170 → 171 — из карточки
       убрана последняя панель правой колонки (правки параллельной сессии, их предмет — в её записях
       STATE.md). 171 → 172 — стрелки карусели карточки и стрелки большого фото объявления сведены
       к одной кнопке (36 px, шеврон 18 px) и «чуть видны» в покое, проявляясь под курсором на фото
       (lib/pages.mjs: у галереи стоял несуществующий значок chevron-*, из-за чего у большого фото
       рисовалась машина). 172 → 173 — по уточнению заказчика «кнопки пролистывания все-таки сделай
       стрелочками, которые появляются при наведении на карточку авто» подложка у стрелок убрана:
       белый шеврон 22 px без фона, рамки и размытия, только тень; в покое стрелка едва намечена
       (.3), целиком появляется при наведении на карточку автомобиля, на большое фото и по фокусу.
       173 → 174 и 174 → 175 — шаги параллельной сессии (их предмет — в её записях STATE.md).
       175 → 176 — заказчик вернул красный цвет кнопкам героя главной («Заказать звонок / Разместить
       объявление - верни красный цвет кнопкам»): после его же просьбы о прозрачном фоне заливка
       снова --accent, буквы белые, под курсором --accent-hover.
       176 → 177 — стрелкам перелистывания фото вернули подложку, но белую и полупрозрачную
       («сделай чтобы кнопки пролистывания фотографии базового были не видны только появлялись при
       наведении мышкой на фотографии и сделай их круглыми как раньше и прозрачными. В карусели верни
       кнопки прокрутки карточек авто в бело-прозрачный фоном»): круг 36 px с заливкой
       rgba(255,255,255,.62) и тёмный шеврон 22 px вместо голой белой стрелки с тенью; у большого
       фото в покое стрелки скрыты совсем (opacity 0) и появляются при наведении на снимок.
       Формулировки здесь намеренно обтекаемые: этот комментарий уезжает в HTML каждой страницы, и
       проверки «на карточке нет такой-то строки» искали бы её в собственном комментарии. -->
<link rel="stylesheet" href="/assets/css/site.css?v=213">
<link rel="stylesheet" href="/assets/css/photo-focus.css?v=3">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body class="${path === '/' ? 'home-page' : 'inner-page'}">
<header class="header">
  <div class="wrap header-in">
    ${logoLockup('с пробегом', 'dark')}
    <nav class="nav">${nav}</nav>
    <div class="head-actions">
      <a class="icon-btn" href="tel:${esc(String(s.phone_1 || '').replace(/[^\d+]/g, ''))}" title="Позвонить: ${esc(s.phone_1 || '')}" aria-label="Позвонить: ${esc(s.phone_1 || '')}">${ico('phone', 19)}</a>
      <div class="map-picker">
        <button class="icon-btn" type="button" data-map-toggle aria-expanded="false" aria-haspopup="true" title="Как нас найти: адрес и карты" aria-label="Как нас найти">${ico('pin', 19)}</button>
        <div class="map-menu" data-map-menu hidden>
          <a href="https://yandex.by/maps/org/avtonova_s_probegom/27584324640/?ll=30.989860%2C52.442757&z=12.82" target="_blank" rel="noopener noreferrer">${ico('pin', 15)} Яндекс Карты</a>
          <a href="https://www.google.com/maps/place/%D0%90%D0%B2%D1%82%D0%BE%D0%BD%D0%BE%D0%B2%D0%B0+%D1%81+%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%B3%D0%BE%D0%BC/@52.4604997,31.0200572,17z/data=!3m1!4b1!4m6!3m5!1s0x46d469c65c8c5ebd:0xdbd358ece1fee1c3!8m2!3d52.4604997!4d31.0200572!16s%2Fg%2F11xlkl2rn7?entry=ttu&g_ep=EgoyMDI2MDkyMi4wIKXMDSoASAFQAw%3D%3D" target="_blank" rel="noopener noreferrer">${ico('pin', 15)} Google Maps</a>
        </div>
      </div>
      ${headExtras}
      <!-- Кредитный калькулятор — иконкой в шапке перед сравнением (заказчик 02.10.2026: «в мобильной
           версии добавь в шапку иконку кредитного калькулятора, размести перед иконкой сравнения»).
           Раньше калькулятор был только пунктом меню; на телефоне меню уезжает в бургер, а раздел
           нужен на виду. Значок — navCalc, тот же, что у пункта меню.
           Заказчик 02.10.2026 (вторая правка того же дня): «в десктопной версии убери значок
           калькулятора» — на широком экране раздел и так стоит подписью в ряду меню, и значок
           только дублировал пункт. Класс icon-btn-calc гасит его в @media(min-width:1280px), то
           есть ровно там, где работает ряд подписей; на телефоне (бургер, ≤1279 px) значок
           остаётся. В разметке он один и тот же — прячется только стилем. -->
      <a class="icon-btn icon-btn-calc" href="/kalkulyator" title="Кредитный калькулятор" aria-label="Кредитный калькулятор">${ico('navCalc', 19)}</a>
      <a class="icon-btn" href="/compare" title="Сравнение">${ico('compare', 19)}<span class="badge" data-count-cmp${counts.compare ? '' : ' hidden'}>${counts.compare || 0}</span></a>
      <a class="icon-btn" href="/favorites" title="Избранное">${ico('heart', 19)}<span class="badge" data-count-fav${counts.favorites ? '' : ' hidden'}>${counts.favorites || 0}</span></a>
      ${user
        ? `<a class="btn btn-ghost btn-sm head-user" href="${user.role === 'admin' ? '/admin' : '/account'}" title="${esc(user.name || 'Кабинет')} — личный кабинет">${ico('user', 16)}</a>
           <form method="post" action="/logout" style="display:inline"><button class="btn btn-ghost btn-sm head-logout" type="submit" title="Выйти из кабинета" aria-label="Выйти из кабинета">${ico('logout', 16)}</button></form>`
        : `<button class="icon-btn" type="button" data-auth-open aria-haspopup="dialog" title="Вход и регистрация">${ico('user', 19)}</button>`}
      <button class="icon-btn burger" type="button" data-burger aria-label="Меню">${ico('menu', 20)}</button>
    </div>
  </div>
  <!-- Меню на телефоне — панель, выезжающая справа (заказчик 2026-09-29: «бутерброд чтоб плавно
       выезжал с правой стороны и оставлял ещё какую-то часть слева вид страницы»). Раньше это был
       блок в потоке под шапкой, который просто раскрывался (display). Теперь это <aside> у правого
       края с position:fixed: он выезжает из-за экрана (translateX), ширину берёт min(86%,420px) —
       слева остаётся 14 % страницы, а приглушённый .scrim закрывает её и по тапу закрывает меню
       (см. .mdrawer в site.css и initChrome в site.js). Класс .hide (display:none!important)
       снимается на клик по бургеру: без него панели нет в раскладке и её сдвиг не анимируется. -->
  <div class="mnav-scrim" data-mnav-scrim hidden></div>
  <aside class="mdrawer hide" data-mobile-nav aria-label="Меню сайта">
    <div class="mdrawer-head">
      <b>Меню</b>
      <button class="mdrawer-close" type="button" data-mnav-close aria-label="Закрыть меню">${ico('close', 18)}</button>
    </div>
    <nav class="nav mdrawer-nav">${nav}</nav>
  </aside>
</header>
${afterBrands}
<main>${body}</main>
<footer class="footer"><div class="wrap footer-in">
  <div class="fgrid">
    <div>
      <div class="ftr-logo">${logoLockup('с пробегом', 'dark')}</div>
      <p class="small" style="color:rgba(255,255,255,.62);max-width:38ch">Площадка автомобилей с пробегом официального дилера «Автонова». Проверка по VIN, гарантия юридической чистоты, кредит и лизинг на месте.</p>
      ${socialRow({ phone: s.phone_1 })}
    </div>
    <div><h4>Каталог</h4><ul>
      <li><a href="/cars">Все автомобили</a></li>
      <li><a href="/cars-used">С пробегом</a></li>
      <li><a href="/cars-new">Новые</a></li>
      <li><a href="/electric">Электро</a></li>
      <li><a href="/cars-sold">Продано</a></li>
      <!-- Заказчик 2026-09-30: «В подвале, ниже - Продано, добавь - Контакты». Из подвала на
           страницу контактов перехода не было: в блоке контактов справа стоят только адрес,
           телефоны, часы и почта, а в шапке пункта «Контакты» нет вовсе. Ссылка идёт последней в
           той же колонке, сразу под «Продано», — как просил заказчик (в колонке от этого стало
           шесть строк, ровно как в «Сервисах» рядом). -->
      <li><a href="/contacts">Контакты</a></li>
    </ul></div>
    <div><h4>Сервисы</h4><ul>
      <li><a href="/services/credit">Кредит</a></li>
      <li><a href="/services/lizing">Лизинг</a></li>
      <li><a href="/services/obmen">Обмен</a></li>
      <li><a href="/services/vykup">Выкуп</a></li>
      <li><a href="/services/komissiya">Комиссия</a></li>
      <li><a href="/kalkulyator">Кредитный калькулятор</a></li>
    </ul></div>
    
      <dl class="kv">
        <div><dt>Адрес</dt><dd>${esc(s.address || '')}</dd></div>
        <div><dt>Телефоны</dt><dd><a href="tel:${esc(String(s.phone_1 || '').replace(/[^\d+]/g, ''))}">${esc(s.phone_1 || '')}</a><br><a href="tel:${esc(String(s.phone_2 || '').replace(/[^\d+]/g, ''))}">${esc(s.phone_2 || '')}</a></dd></div>
        <div><dt>Режим работы</dt><dd>${esc(s.hours || '')}</dd></div>
        <div><dt>E-mail</dt><dd><a href="mailto:${esc(s.email || '')}">${esc(s.email || '')}</a></dd></div>
      </dl>
    </div>
  </div>
  <div class="fbottom">
    <!-- УНП — одной неразрывной группой: иначе на узком экране балансировка строк рвала её пополам
         («…УНП» / «490323534. Все права защищены.»). Компания приходит из настроек одной строкой
         («ООО «Автонова», УНП 490323534»), поэтому хвост после запятой заворачиваем в .nowrap:
         строка ломается перед ним, и обе части читаются целиком. -->
    <span class="fb-copy">© ${new Date().getFullYear()} ${esc(companyHead)}${companyTail ? ` <span class="nowrap">${esc(companyTail)}</span>` : ''}. Все права защищены.</span>
    <span class="fb-note">Информация на сайте не является публичной офертой.</span>
    <!-- Снимки поколений в форме «Разместить объявление» — из свободных источников (Wikimedia
         Commons). По лицензиям CC BY / CC BY-SA автора указывать обязательно. Из подвала ссылка
         убрана по просьбе заказчика 2026-10-02 («Убери в подвале Фотографии каталога…»), страница
         атрибуции осталась и доступна с самой формы: ссылка стоит под блоком «Фотографии»
         (lib/pages.mjs, sellPage). -->
  </div>
</div></footer>
<div class="toast" data-toast><span data-toast-msg></span><a class="btn btn-sm toast-go" href="/compare">Сравнить</a></div>
${bookModalHtml()}
${callModalHtml()}
${saleModalHtml(user)}
${carContactModal || ''}
${user ? '' : authModalHtml(path, authModal || {})}
<button class="back-top" data-top type="button" aria-label="Наверх">${ico('up', 20)}</button>
<script src="/assets/js/site.js?v=45" defer></script>
</body>
</html>`;
}

/* Миниатюры фото для карточек, каруселей и списков. Заказчик 02.10.2026: «Сделай, что бы сайт
   грузился быстро и не терял качество». Качество на весь экран не меняется: страница автомобиля
   показывает исходный снимок (/uploads/...), а выдача, карусели и списки берут уменьшенную копию
   (/thumbs/....webp — ширина до 640 px, собирается скриптом _ref/make-thumbs.mjs). Вес кадра падает
   с ~173 КБ до ~40 КБ: главная перестаёт тянуть 8,8 МБ на первый экран.
   Если миниатюры ещё нет (фото загружено пользователем уже после сборки), срабатывает onerror и
   подставляется исходный снимок — битых картинок не бывает. В копии на GitHub Pages путь
   /thumbs/ переписывается на CDN там же, где и /uploads/ (см. _ref/deploy/build-pages.mjs). */
export const thumb = (src) => (typeof src === 'string' && src.startsWith('/uploads/')
  ? '/thumbs/' + src.slice('/uploads/'.length).replace(/\.[^./]+$/, '.webp')
  : src);
export function photoTag(src, alt, extra = '') {
  const t = thumb(src);
  const fallback = t === src ? '' : ` onerror="this.onerror=null;this.src='${esc(src)}'"`;
  return `<img src="${esc(t)}" alt="${esc(alt)}" loading="lazy" decoding="async"${extra}${fallback}>`;
}
export function photoImg(src, alt, cls = '') {
  if (!src) return `<div class="photo-empty"><div><b>${esc(alt)}</b><span class="small">Фотографии — по запросу</span></div></div>`;
  return photoTag(src, alt, cls ? ` class="${esc(cls)}"` : '');
}

export function carCard(c, opts = {}) {
  const photos = (c.photos || []).slice(0, 8);
  const fav = opts.favorite;
  const cmp = opts.compare;
  const badges = [];
  if (c.is_new) badges.push('<span class="tag red">Новый</span>');
  /* «проверен» в отдельной обёртке: на телефоне плашка «VIN проверен» не помещается рядом с
     «Новый» и уезжает на вторую строку поверх фото (заказчик 02.10.2026: «в мобильной версии
     карточек авто плашка „Новый, VIN проверен“ не помещается — показывай „VIN“ без слова
     „проверен“»). До 600 px слово прячет CSS (.tag-vin-word), смысл плашки остаётся — щит и VIN. */
  if (c.vin_checked) badges.push(`<span class="tag light">${ico('shield', 13)} VIN<span class="vin-word"> проверен</span></span>`);
  /* Разрыв строки плашек — невидимый (flex-basis:100%, height:0). Заказчик 02.10.2026: «выбор
     дилера на карточках авто в мобильной версии размести в одну строчку с иконкой VIN проверен
     и сделай красным». Плашка «Выбор дилера» стоит последней в разметке, поэтому на телефоне
     переносим её к «VIN» порядком flex (CSS), а этот разрыв заставляет ленту плашек переноситься
     именно перед парой «VIN + Выбор дилера»: «Новый» остаётся первой строкой, а пара — второй.
     На широком экране элемента нет, там плашки идут как раньше. */
  if (c.vin_checked && c.featured) badges.push('<i class="badge-break" aria-hidden="true"></i>');
  if (c.mileage === 0) badges.push('<span class="tag amber">Без пробега</span>');
  if (c.featured) badges.push('<span class="tag tag-dealer">Выбор дилера</span>');

  let media;
  if (photos.length > 1) {
    media = `<div class="carousel" data-carousel>
      <div class="carousel-track" data-track>${photos.map((p, i) => photoTag(p, c.brand + ' ' + c.model, i ? ' fetchpriority="low"' : '')).join('')}</div>
      <button class="carousel-btn prev" type="button" data-prev aria-label="Предыдущее фото">${ico('chevL', 22)}</button>
      <button class="carousel-btn next" type="button" data-next aria-label="Следующее фото">${ico('chevR', 22)}</button>
      <div class="carousel-dots" data-dots>${photos.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
    </div>`;
  } else {
    media = photoImg(photos[0], c.brand + ' ' + c.model);
  }

  const title = c.brand + ' ' + c.model + (c.generation ? ', ' + c.generation : '');

  /* Фото карточки — тоже ссылка на автомобиль (заказчик 2026-09-28: «сделай чтобы при нажатии на
     фото карточки авто происходил переход на страницу авто»). Поэтому на кадре лежит невидимая
     накладка .car-photo-hit: обёртка вокруг <img> сломала бы раскладку карусели (её кадры — прямые
     дети ленты) и перетаскивание снимка, а накладка ничего не двигает. «Избранное» (z-index 3) и
     кнопки карусели (4) лежат выше неё и работают как раньше; href в разметке — чтобы снимок
     открывался и с клавиатуры (накладка получает фокус), и поисковиком. */
  /* Атрибуты карточки — не только для «Избранного» и подписи, но и для клиентской сортировки
     и отбора: по ним статичная копия сайта на GitHub Pages (где серверной части нет) сама
     сортирует и фильтрует уже готовые карточки — см. _ref/deploy/build-pages.mjs и
     assets/js/demo-pages.js. Значения — ровно те поля, по которым сортирует сервер (SORTS
     в lib/cars.mjs): цена, год, пробег, дата публикации и просмотры.

     Ячейка сравнения (заказчик 02.10.2026, третий список): «кнопки сравнить размести напротив
     цены и смести к правому краю, убери фон кнопки, оставь только надпись красного цвета в цвет
     сайта и поле для галочки» — поэтому переключатель стоит в строке цены (.car-price-row) у
     правого края, а не в нижней строке .car-bar: без рамки, без заливки, подпись «Сравнить»
     красная (--accent). Внизу карточки остаётся только «Подробнее» у левого края — прежняя
     просьба «Кнопку - Подробнее, перенеси к левому краю» сохраняется. */
  return `<article class="car" data-car-id="${c.id}" data-car-title="${esc(c.brand + ' ' + c.model + ', ' + c.year)}"
    data-brand="${esc(c.brand)}" data-model="${esc(c.model)}" data-year="${Number(c.year) || 0}"
    data-price="${Number(c.price) || 0}" data-mileage="${Number(c.mileage) || 0}"
    data-added="${esc(String(c.created_at || '').slice(0, 10))}" data-views="${Number(c.views) || 0}"
    data-body="${esc(c.body || '')}" data-trans="${esc(c.transmission || '')}"
    data-fuel="${esc(c.fuel || '')}" data-drive="${esc(c.drive || '')}"
    data-volume="${Number(c.volume) || 0}">
    <div class="car-media">
      ${media}
      <a class="car-photo-hit" href="/car/${esc(c.slug)}" aria-label="${esc(title + ', ' + c.year + ' — открыть карточку автомобиля')}"></a>
      <div class="car-badges">${badges.join('')}</div>
      <button class="car-fav${fav ? ' on' : ''}" type="button" data-fav="${c.id}" aria-label="В избранное">${ico('heart', 17)}</button>
      ${c.photos && c.photos.length > 1 ? `<span class="tag" style="position:absolute;right:12px;bottom:12px">${c.photos.length} фото</span>` : ''}
    </div>
    <div class="car-body">
      <div class="spread car-head">
        <a class="car-title" href="/car/${esc(c.slug)}" title="${esc(title)}">${esc(title)}</a>
      </div>
      <div class="car-price-row">
        <div class="car-price num">${c.price_text}<small>${esc(c.engine_label)}</small></div>
        <label class="cmp-cell" title="Добавить к сравнению">
          <input type="checkbox" data-compare="${c.id}" aria-label="Добавить к сравнению"${cmp ? ' checked' : ''}><span class="cmp-text">Сравнить</span>
        </label>
      </div>
      <div class="car-params">
        <div>${esc(c.trans_label)}, ${esc(String(c.volume).replace('.', ','))} л, ${esc(c.fuel_label.toLowerCase())}, ${esc(c.body_label.toLowerCase())}</div>
        <div><i>Пробег</i>${fmt(c.mileage)} км</div>
      </div>
      <div class="car-foot">
        <div class="car-actions">
          <button class="btn btn-accent" type="button" data-car-book data-book-id="${c.id}" data-book-title="${esc(c.brand + ' ' + c.model + ', ' + c.year)}" title="Забронировать автомобиль">${ico('calendar', 16)} Бронь</button>
          <a class="btn btn-ghost" href="/services/obmen?car=${esc(c.slug)}" title="Обмен на другой автомобиль с доплатой">${ico('swap', 16)} Обмен</a>
        </div>
        <div class="car-bar">
          <a class="car-more" href="/car/${esc(c.slug)}" title="${esc(c.brand + ' ' + c.model)} — подробнее">Подробнее${ico('chevR', 15)}</a>
        </div>
      </div>
    </div>
  </article>`;
}

const opt = (map, any, cur = '') => `<option value="">${any}</option>${Object.entries(map).map(([k, v]) => `<option value="${k}"${String(cur) === String(k) ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
const yearOpts = (n, from, to, map, cur = '') => `<option value="">Любой</option>${Array.from({ length: n }, (_, i) => to - i).map((y) => {
  const off = map ? map(y) : false;
  return `<option value="${y}"${off ? ' disabled' : ''}${String(cur) === String(y) ? ' selected' : ''}>${y}</option>`;
}).join('')}`;

// Блок «Поиск по параметрам»: марка, модель, кузов, коробка, топливо, привод, год от/до,
// объём от/до, цена от/до, пробег до, ключевое слово + сброс/показ. Одна разметка на главную
// (компактная панель) и на каталог (все поля сразу): params подставляет текущие значения
// фильтра, modes — быстрые ссылки на типы выдачи, resetHref заменяет кнопку сброса ссылкой.
// head — заголовок «Поиск по параметрам» (на главной без подводки), foot — кнопки одной
// строкой внизу, more — компактный режим: главный ряд марка/модель/год/объём/цена, остальное
// за переключателем «Параметры» в шапке панели, top — готовая разметка верхней строки
// карточки (на главной — марки), count — число справа в кнопке показа, preset — ключи условий,
// заданных режимом страницы (не считаются выбором посетителя, см. ниже).
export function paramSearch({ brands = [], models = [], years = null, vols = [], prices = null, mileages = [], action = '/cars', params = {}, preset = [], submitLabel = 'Показать автомобили', resetHref = '', modes = null, head = false, foot = false, more = false, top = '', count = null, mode = 'all' } = {}) {
  const p = params || {};
  const on = (name, value) => (String(p[name] ?? '') === String(value) ? ' selected' : '');
  const v = (name) => esc(p[name] ?? '');
  const yearFrom = years ? years[0] : null;
  const yearTo = years ? years[1] : null;
  const volFrom = vols.length ? vols[0] : null;
  const volTo = vols.length ? vols[vols.length - 1] : null;
  const priceFrom = prices ? prices[0] : null;
  const priceTo = prices ? prices[1] : null;
  const mileTo = mileages.length ? mileages[mileages.length - 1] : null;
  const modelMap = {};
  for (const m of models) {
    if (!modelMap[m.brand]) modelMap[m.brand] = [];
    modelMap[m.brand].push(m.model);
  }
  const modelOpts = models.map((m) => `<option value="${esc(m.model)}" data-brand="${esc(m.brand)}"${String(p.model ?? '') === String(m.model) ? ' selected' : ''}>${esc(m.brand)} ${esc(m.model)}</option>`).join('');
  const fieldBrand = `
    <label class="ps-field"><span>Марка</span><select name="brand" data-ps-brand><option value=""${!p.brand ? ' selected' : ''}>Все марки</option>${brands.map((b) => `<option value="${esc(b.brand)}"${on('brand', b.brand)}>${esc(b.brand)}</option>`).join('')}</select></label>
    <label class="ps-field"><span>Модель</span><select name="model" data-ps-model>${modelOpts}</select></label>`;
  const fieldRange = `
    <div class="ps-field"><span>Год выпуска</span><div class="ps-range">
      <select name="year_from" aria-label="Год от">${yearOpts(yearFrom && yearTo ? yearTo - yearFrom + 1 : 0, yearFrom, yearTo, (y) => yearTo && y > yearTo, p.year_from)}</select>
      <i>—</i>
      <select name="year_to" aria-label="Год до">${yearOpts(yearFrom && yearTo ? yearTo - yearFrom + 1 : 0, yearFrom, yearTo, (y) => yearFrom && y < yearFrom, p.year_to)}</select>
    </div></div>
    <div class="ps-field"><span>Объём, л</span><div class="ps-range">
      <select name="volume_from" aria-label="Объём от"><option value="">Любой</option>${vols.map((x) => `<option value="${x}"${on('volume_from', x)}>${String(x).replace('.', ',')}</option>`).join('')}</select>
      <i>—</i>
      <select name="volume_to" aria-label="Объём до"><option value="">Любой</option>${vols.map((x) => `<option value="${x}"${on('volume_to', x)}>${String(x).replace('.', ',')}</option>`).join('')}</select>
    </div></div>`;
  const fieldTech = `
    <label class="ps-field"><span>Кузов</span><select name="body">${opt(BODY_OPTIONS, 'Любой', p.body)}</select></label>
    <label class="ps-field"><span>Коробка</span><select name="transmission">${opt(TRANS_OPTIONS, 'Любая', p.transmission)}</select></label>
    <label class="ps-field"><span>Топливо</span><select name="fuel">${opt(FUEL_OPTIONS, 'Любое', p.fuel)}</select></label>
    <label class="ps-field"><span>Привод</span><select name="drive">${opt(DRIVE_OPTIONS, 'Любой', p.drive)}</select></label>`;
  const fieldMileage = `
    <div class="ps-field"><span>Пробег до, км</span><select name="mileage_to"><option value="">Любой</option>${mileages.map((m) => `<option value="${m}"${on('mileage_to', m)}>до ${fmtNum(m)}</option>`).join('')}</select></div>`;
  const fieldPrice = `
    <div class="ps-field ps-wide"><span>Цена, <span class="byn">Б</span></span><div class="ps-range">
      <input type="number" class="num" name="price_from" min="0" step="100" value="${v('price_from')}" placeholder="от ${priceFrom ? fmtNum(priceFrom) : ''}" aria-label="Цена от">
      <i>—</i>
      <input type="number" class="num" name="price_to" min="0" step="100" value="${v('price_to')}" placeholder="до ${priceTo ? fmtNum(priceTo) : ''}" aria-label="Цена до">
    </div></div>`;
  const fieldWord = `
    <div class="ps-field"><span>Ключевое слово</span><input type="search" name="q" value="${v('q')}" placeholder="Модель, цвет, VIN"></div>`;
  const fieldTail = fieldMileage + fieldPrice + fieldWord;
  // Компактный режим (главная, more:true): на виду марка, модель, год, объём и цена — то, чем
  // реально подбирают; техника и добор (кузов, коробка, топливо, привод, пробег, слово) — за
  // переключателем «Параметры» в левом нижнем углу панели (прозрачная кнопка со значком
  // настроек, рядом с «Показать автомобили»). Прячем не <details>, а скрытым чекбоксом с
  // label: переключатель живёт в нижнем ряду формы, а скрытые
  // поля при этом остаются в форме и уходят в запрос (проверено FormData). Если фильтр уже
  // задан (пришли с каталога) — галочка стоит сразу, чтобы активное условие было на виду.
  // Цена — исключение: она в главном ряду, поэтому в EXTRA_KEYS её нет.
  // preset — ключи, которые задал сам режим страницы (на «Электро» это топливо, см. catalog()):
  // посетитель их не выбирал, поэтому из-за них «Параметры» не раскрываются — блок свернут так
  // же, как на «Все авто» и «Новых», где режим держит невидимое условие «новый автомобиль»
  // (год выпуска / пробег до 500 км / слово «новый» в описании, см. NEW_CAR_SQL).
  const EXTRA_KEYS = ['body', 'transmission', 'fuel', 'drive', 'mileage_to', 'q'];
  const presetKeys = Array.isArray(preset) ? preset : [];
  const extraUsed = EXTRA_KEYS.some((k) => p[k] && !presetKeys.includes(k));
  /* Число на кнопке пересчитывает сервер (`GET /api/cars/count`) прямо во время выбора параметров,
     поэтому пустой счётчик здесь — не отсутствие числа, а место, куда его положит скрипт
     (initParamSearch в site.js). Режим страницы («Новые», «Электро», «С пробегом») уезжает в
     data-ps-mode: у /cars-new и /electric один и тот же адрес счётчика, а условия у них разные. */
  const cnt = `<span class="btn-cnt num">${count === null || count === undefined || count === '' ? '' : fmtNum(count)}</span>`;
  const actions = `<div class="ps-actions">
      <button class="btn btn-lg" type="submit">${ico('search', 18)} ${esc(submitLabel)} ${cnt}</button>
      ${resetHref
        ? `<a class="btn btn-lg btn-ghost" href="${esc(resetHref)}">Сбросить</a>`
        : '<button class="btn btn-lg btn-ghost" type="reset" data-ps-reset>Сбросить</button>'}
    </div>`;
  return `<div class="param-card">
  ${top}
  ${more ? `<input class="ps-more-tgl" type="checkbox" id="ps-more"${extraUsed ? ' checked' : ''}>` : ''}
  ${head ? `<div class="ps-head"><div class="ps-title">Поиск по параметрам</div>${more ? '' : '<p>Подберите автомобиль по марке, кузову, году, объёму двигателя и цене — покажем только подходящие варианты.</p>'}</div>` : ''}
  ${modes && modes.length ? `<div class="ps-modes">${modes.map((m) => `<a class="ps-mode${m.on ? ' on' : ''}" href="${esc(m.href)}">${esc(m.label)}</a>`).join('')}</div>` : ''}
  <form class="param-form${more ? ' ps-compact' : ''}" method="get" action="${esc(action)}" data-param-form data-count-url="/api/cars/count" data-ps-mode="${esc(mode || 'all')}">
    <input type="hidden" name="sort" value="${v('sort')}">
    ${more ? fieldBrand + fieldRange + fieldPrice : fieldBrand + fieldTech + fieldRange}
    ${more
      ? `<div class="ps-more-body">${fieldTech}${fieldMileage}${fieldWord}</div>`
      : fieldTail}
    ${foot ? `<div class="ps-foot">${more ? `<label class="ps-more-sum" for="ps-more">${ico('sliders', 17)} Параметры</label>` : ''}${actions}</div>` : actions}
  </form>
</div>
<script type="application/json" data-ps-models="1">${JSON.stringify(modelMap).replace(/</g, '\\u003c')}</script>`;
}

// Строка марок каталога (как на butikavto.by): «Все марки» + марки с количеством.
// href(brand) строит ссылку с текущими фильтрами; пустая марка = сбросить фильтр марки.
// head:false — тот же список без строки-заголовка «Марки N» (главная: слово «Марки» убрано
// по просьбе заказчика, список марок сам себя объясняет).
// all:false — без плашки «Все марки N» (главная: заказчик попросил её убрать, «Все марки 57 —
// убери»); счётчик количества при этом стоит рядом с названием марки (см. .bl-item в site.css).
export function brandLine(brands = [], { active = '', head = true, all = true, href = (b) => (b ? '/cars?brand=' + encodeURIComponent(b) : '/cars') } = {}) {
  if (!brands.length) return '';
  const total = brands.reduce((s, b) => s + Number(b.n || 0), 0);
  const first = all ? [`<a class="bl-item bl-all${active ? '' : ' on'}" href="${esc(href(''))}">Все марки<i>${fmt(total)}</i></a>`] : [];
  const items = first
    .concat(brands.map((b) => `<a class="bl-item${String(active) === String(b.brand) ? ' on' : ''}" href="${esc(href(b.brand))}">${esc(b.brand)}<i>${fmt(b.n)}</i></a>`));
  /* Число рядов сетки марок. На широком экране ряды заданы в CSS (9×2, 6×3, 4×5), а на телефоне
     три колонки (заказчик 2026-10-02: «блок с перечнем и количеством авто, сделай в три столбца, а
     не два столбца, и размести красиво, читабельно и симметрично остальным блокам») должны
     заполняться по колонкам ровно: 18 марок → 6+6+6, а не 7+7+4, как было с жёсткими семью рядами.
     Поэтому ряды считаем от количества марок и отдаём в CSS переменной --bl-rows. */
  const rows3 = Math.ceil(items.length / 3);
  return `<div class="brand-line${head ? '' : ' bl-bare'}">
    ${head ? `<div class="bl-head"><b>Марки</b><span class="muted small">${brands.length}</span></div>` : ''}
    <div class="bl-grid" style="--bl-rows:${rows3}">${items.join('')}</div>
  </div>`;
}

// Строка брендов: «Официальный дилер» + надписи Geely / BelGee / SRM со ссылками на сайты
// брендов. Единственное место — блок .hero-dealer в герое главной (см. home() в pages.mjs): на
// широком экране это третья строка сетки, сразу под лидом (CSS .home-page .hero-dealer).
// Раньше подпись начиналась со слов «Ещё мы» — убраны по просьбе заказчика.
//
// Оформление — только текст, без рамок и фонов (просьбы заказчика: «продолжи этот блок
// прозрачными кнопками Geely, BelGee и SRM с переходом на сайты брендов, этот блок сделай по
// стилю сайта, логотипы убери», затем «Официальный дилер … смести влево, к кнопке джили, и
// сделай с прозрачным фоном, чтобы был только текст, то же самое сделай кнопкам брендов —
// Geely, BelGee и SRM, чтобы имели только буквы и они являлись ссылками»). Поэтому здесь нет
// ни эмблем (раньше в каждой ссылке лежала картинка, обрезанная окном .dealer-brand-photo),
// ни классов .btn.btn-ghost с рамкой --line-2: надписи — сама ссылка, вид даёт
// `.hero-dealer .dealer-link` (подпись слева, кегль 15 px, ховер — акцентный красный).
// Подпись «Официальный дилер» (слова «Ещё мы» убраны по просьбе заказчика: «На титульной сверху
// влева - Ещё мы официальный дилер, убери слова - Еще мы») идёт сразу после лида, прижата к левому
// краю ряда, то есть к ссылке Geely (просьба заказчика: «после “Каждый автомобиль проходит
// диагностику…” напиши: ещё мы официальный дилер Geely BelGee SRM»).
export function dealerRow(cls = '') {
  return `<div class="dealer-row${cls ? ' ' + cls : ''}"><span class="kicker"><i class="dot"></i> Официальный дилер</span>
    <div class="dealer-links" aria-label="Сайты брендов">
      <a class="dealer-link dealer-geely" href="https://geely-gomel.by/" target="_blank" rel="noopener noreferrer" aria-label="Geely — официальный сайт">Geely</a>
      <a class="dealer-link dealer-belgee" href="https://belgee-gomel.by/" target="_blank" rel="noopener noreferrer" aria-label="BelGee — официальный сайт">BelGee</a>
      <a class="dealer-link dealer-srm" href="https://autonova.by/shineray/" target="_blank" rel="noopener noreferrer" aria-label="SRM — официальный сайт">SRM</a>
    </div></div>`;
}

export function brandCards(brands = [], extra = '') {
  const list = [...brands].sort((a, b) => b.n - a.n || a.brand.localeCompare(b.brand, 'ru')).slice(0, 24);
  return `<div class="brand-grid">
    ${list.map((b) => `<a class="brand-card" href="/cars?brand=${encodeURIComponent(b.brand)}">
      <span class="bc-name">${esc(b.brand)}</span>
      <span class="bc-cnt num">${b.n} ${plural(b.n, 'автомобиль', 'автомобиля', 'автомобилей')}</span>
    </a>`).join('')}
    ${extra}
  </div>`;
}

function fmtNum(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function carCards(cars, opts = {}) {
  return cars.map((c) => carCard(c, {
    favorite: opts.favorites?.has?.(c.id),
    compare: opts.compare?.has?.(c.id),
  })).join('');
}

export function carGrid(cars, opts = {}) {
  if (!cars.length) return `<div class="empty"><h3>Ничего не найдено</h3><p>Попробуйте изменить параметры поиска или посмотрите весь каталог.</p><a class="btn" href="/cars">Весь каталог</a></div>`;
  return `<div class="cars">${carCards(cars, opts)}</div>`;
}

export function breadcrumbs(items, opts = {}) {
  /* tight — подтянутые отступы крошек: на «Разместить объявление» они вместе с остальными
     отступами страницы укладывают форму целиком в первый экран (просьба заказчика 2026-09-27). */
  return `<div class="wrap"><div class="breadcrumbs${opts.tight ? ' breadcrumbs-tight' : ''}">${items.map((it, i) => (i === items.length - 1
    ? `<span>${esc(it.label)}</span>` : `<a href="${esc(it.href)}">${esc(it.label)}</a><span>/</span>`)).join('')}</div></div>`;
}

/* Хвост каталога: кнопок страниц в разметке нет (просьба заказчика: «сделай, чтобы кнопок
   страниц не было»). Сначала на этом месте была нескончаемая лента — карточки догружались сами,
   как только коробка попадала в окно. Заказчик 2026-09-28 переиграл: «Сделай прозрачную кнопку —
   Показать ещё, и рядом приписка На странице 20 объявлений из 57 или сколько там у нас, и
   показывай 20 карточек авто» — теперь партию берут только по клику по прозрачной кнопке
   (`.btn-ghost`), а рядом видно, сколько объявлений уже на странице и сколько их всего.
   Следующую партию клиентский скрипт (`initInfinite` в site.js) запрашивает у сервера
   (`/api/cars/cards`) и дописывает в сетку `.cars`; после каждой партии подпись пересчитывается.
   Когда показано всё, кнопка и подпись уходят, остаётся строка «Показаны все N автомобилей».
   Здесь же строка «Загружаем ещё…» и кнопка повтора на случай, если запрос не прошёл, — обе
   скрыты и включаются скриптом по надобности. Без JS остаётся ссылка в `<noscript>`: она ведёт на
   ту же выдачу через `?page=` (сервер по-прежнему умеет страницы), то есть каталог работает и с
   выключенным скриптом. */
export function carsMore({ query = '', page = 1, pages = 1, total = 0, perPage = 20 } = {}) {
  const word = plural(total, 'автомобиль', 'автомобиля', 'автомобилей');
  const end = `<p class="cars-more-end" data-more-end hidden>Показаны все ${fmt(total)} ${word}</p>`;
  if (pages <= page) return `<div class="cars-more" data-more data-page="${page}" data-pages="${pages}" data-total="${total}" data-per-page="${perPage}">${end}</div>`;
  const shown = Math.min(page * perPage, total);
  const nextUrl = (query ? '?' + query + '&' : '?') + 'page=' + (page + 1);
  return `<div class="cars-more" data-more data-page="${page}" data-pages="${pages}" data-total="${total}" data-per-page="${perPage}" data-query="${esc(query)}">
    <div class="cars-more-row" data-more-row>
      <button class="btn btn-ghost" type="button" data-more-btn>Показать ещё</button>
      <p class="cars-more-count" data-more-count>На странице ${fmt(shown)} ${plural(shown, 'объявление', 'объявления', 'объявлений')} из ${fmt(total)}</p>
    </div>
    <div class="cars-more-spin" data-more-spin hidden><span class="spin"></span>Загружаем ещё…</div>
    <div class="cars-more-fail" data-more-fail hidden><button class="btn btn-ghost" type="button" data-more-retry>Повторить загрузку</button></div>
    <noscript><a class="btn btn-ghost" href="${esc(nextUrl)}">Показать ещё</a></noscript>
    ${end}
  </div>`;
}

/* Плитка-ссылка. С `photo` вместо значка рисуется снимок во всю ширину плитки — так в статье
   Автожурнала блок «Читайте также» показывает обложку каждой статьи (заказчик 2026-09-30: «На
   страницах статей справа блок — Читайте также — добавь туда соответствующие фото в статьи»).
   Без `photo` плитка остаётся прежней: значок в цветном квадрате (услуги, категории, счётчики). */
export function tile({ href, icon, title, text, count, photo, photoAlt }) {
  return `<a class="tile${photo ? ' has-photo' : ''}" href="${esc(href)}">
    ${photo
      ? photoTag(photo, photoAlt || title, ' class="tile-photo"')
      : `<div class="ico">${ico(icon, 22)}</div>`}
    <b>${esc(title)}</b><span>${esc(text || '')}</span>
    ${count !== undefined ? `<span class="cnt">${count}</span>` : ''}
  </a>`;
}

export function section(title, subtitle, inner, extra = '') {
  return `<section class="block"><div class="wrap">
    <div class="sec-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${extra}</div>
    ${inner}
  </div></section>`;
}

/* leadForm(..., offer: true) больше не используется: поле «Ваша цена» в заявке на автомобиль
   убрано совсем (заказчик 2026-09-29 — «Предложить цену» теперь открывает окно связи с продавцом
   со своей формой цены, а в заявке то же поле просто дублировало торг). С 2026-09-30 и сама заявка
   «Заявка на автомобиль» из карточки убрана целиком (заказчик: «Блок — Заявка на автомобиль в
   карточках авто, убери»), так что в карточке машины leadForm больше не вызывается — форма
   осталась на страницах услуги, кредита, контактов и подбора. Параметр оставлен, чтобы старые
   вызовы не падали. */
export function leadForm({ carId = null, kind = 'call', title = 'Оставить заявку', text = 'Перезвоним в течение 15 минут в рабочее время.' }) {
  return `<form class="lead-form" method="post" action="/lead" data-lead-form>
    <input type="hidden" name="car_id" value="${carId ?? ''}">
    <input type="hidden" name="kind" value="${esc(kind)}">
    <b>${esc(title)}</b>
    <p class="small muted" style="margin:0">${esc(text)}</p>
    <label class="field"><span>Имя</span><input type="text" name="name" required placeholder="Как к вам обращаться"></label>
    <label class="field"><span>Телефон</span><input type="tel" name="phone" required placeholder="+375 __ ___ __ __"></label>
    <label class="check"><input type="checkbox" name="agree" required checked><span class="small muted">Согласен с обработкой персональных данных</span></label>
    <button class="btn btn-block" type="submit">Отправить заявку</button>
  </form>`;
}

export const BODY_OPTIONS = BODY_LABEL;
export const FUEL_OPTIONS = FUEL_LABEL;
export const TRANS_OPTIONS = TRANS_LABEL;
export const DRIVE_OPTIONS = DRIVE_LABEL;

