/* Автонова с пробегом — страницы «Сравнение» и «Избранное» в статичной копии на GitHub Pages.
   Только для копии: на боевом сайте эти страницы собирает сервер (lib/pages.mjs) по cookie
   an_cmp / an_fav. Заказчик (02.10.2026, с телефона): «Пр нажатии на кнопку - сравнение, в шапке,
   - машины выбрал, а на странице ничего нет, тоже самое касается кнопки лайк-избраное».
   В копии сервера нет: счётчики в шапке считает site.js по cookie, а самой страницы наполнить
   нечем — поэтому здесь мы достраиваем список из data/cars.json (его пишет build-pages.mjs из
   разметки карточек каталога: id, ссылка, название, цена и характеристики).

   Подключается сборщиком копии на страницы /compare/ и /favorites/ (см. rewrite() в
   _ref/deploy/build-pages.mjs). Логика избранного и сравнения повторена намеренно: копия —
   отдельный статичный артефакт, а site.js на этих страницах уже отработал к моменту вставки. */
(function () {
  'use strict';

  /* ── адреса и cookie ────────────────────────────────────── */
  var htmlEl = document.documentElement;
  var BASE = htmlEl.getAttribute('data-site-base') || '';   /* '' на /, '../' на /compare/ */
  var CDN = htmlEl.getAttribute('data-site-cdn') || '';

  function list(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    var v = m ? decodeURIComponent(m[1]) : '';
    return v.split(',').map(function (x) { return parseInt(x, 10); })
      .filter(function (n) { return Number.isInteger(n) && n > 0; });
  }
  function save(name, ids) {
    var out = [];
    ids.forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    out = out.slice(0, 40);
    document.cookie = name + '=' + encodeURIComponent(out.join(',')) + '; Path=/; Max-Age=' + 60 * 60 * 24 * 180 + '; SameSite=Lax';
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return Number(n || 0).toLocaleString('ru-RU'); }

  var page = /\/favorites\/?$/.test(location.pathname) ? 'fav'
    : (/\/compare\/?$/.test(location.pathname) ? 'cmp' : null);
  if (!page) return;

  var empty = document.querySelector('.empty');
  if (!empty) return;                       /* страница уже наполнена сервером — не мешаем */
  var ids = list(page === 'fav' ? 'an_fav' : 'an_cmp');
  if (!ids.length) return;                  /* ничего не выбрано — пустое состояние верное */

  /* ── шапка: счётчики из cookie (site.js уже посчитал, но список мог измениться) ── */
  function counters() {
    [['an_fav', 'data-count-fav'], ['an_cmp', 'data-count-cmp']].forEach(function (p) {
      var n = list(p[0]).length;
      Array.prototype.forEach.call(document.querySelectorAll('[' + p[1] + ']'), function (el) {
        el.textContent = n; el.hidden = !n;
      });
    });
  }

  function carHref(c) { return BASE + 'car/' + c.slug + '/'; }
  /* Фото берём с CDN — из репозитория (в ветку копии снимки не кладутся). Для карточек и таблицы
     сравнения это миниатюра /thumbs/... (~50 КБ вместо ~175 КБ, см. _ref/make-thumbs.mjs); если её
     в репозитории ещё нет, onerror вернёт исходный снимок. */
  function photo(c) {
    var p = c.photo || '';
    if (/^https?:/i.test(p)) return p;
    /* Миниатюры лежат рядом с исходниками, но в формате .webp (собирает _ref/make-thumbs.mjs):
       /uploads/a/b/01.jpg → /thumbs/a/b/01.webp. Расширение меняем здесь же — как в lib/view.mjs
       (thumb), чтобы копия и живой сайт показывали один и тот же кадр. Если в data/cars.json уже
       записан адрес миниатюры, просто отдаём его с CDN. */
    if (CDN && p.indexOf('/thumbs/') === 0) return CDN + p;
    if (CDN && p.indexOf('/uploads/') === 0) return CDN + '/thumbs/' + p.slice('/uploads/'.length).replace(/\.[^.\/]+$/, '.webp');
    return BASE ? p.replace(/^\//, BASE) : p;
  }
  function photoFull(c) {
    var p = c.photo || '';
    if (/^https?:/i.test(p)) return p;
    /* Если в данных уже лежит адрес миниатюры — отдаём её же с CDN: другого адреса у копии нет. */
    if (CDN && p.indexOf('/thumbs/') === 0) return CDN + p;
    if (CDN && p.indexOf('/uploads/') === 0) return CDN + p;
    return BASE ? p.replace(/^\//, BASE) : p;
  }
  function img(c, cls) {
    return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + esc(photo(c)) + '" alt="' + esc(c.title || '') + '"'
      + ' loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(photoFull(c)) + '\'">';
  }

  /* ── карточка для «Избранного» ───────────────────────────────────────────────────────────────
     Разметка та же, что у карточек каталога (lib/view.mjs, carCard), но без карусели и без
     кабинета брони: на статичной странице эти кнопки не к чему привязать, а нерабочая кнопка
     хуже её отсутствия. Вместо них в нижней строке — «Подробнее» и «Убрать». */
  function favCard(c) {
    return '<article class="car" data-car-id="' + c.id + '">'
      + '<div class="car-media">'
      + img(c)
      + '<a class="car-photo-hit" href="' + esc(carHref(c)) + '" aria-label="' + esc(c.title + ' — открыть карточку автомобиля') + '"></a>'
      + '</div>'
      + '<div class="car-body">'
      + '<div class="spread car-head"><a class="car-title" href="' + esc(carHref(c)) + '" title="' + esc(c.title) + '">' + esc(c.title) + '</a></div>'
      + '<div class="car-price num">' + esc(c.price_text) + (c.engine ? '<small>' + esc(c.engine) + '</small>' : '') + '</div>'
      + '<div class="car-params"><div>' + esc(c.params) + '</div><div><i>Пробег</i>' + num(c.mileage) + ' км</div></div>'
      + '<div class="car-foot"><div class="car-bar">'
      + '<a class="car-more" href="' + esc(carHref(c)) + '">Подробнее<span aria-hidden="true">›</span></a>'
      + '<button class="cmp-cell cmp-cell--btn" type="button" data-unfav="' + c.id + '" title="Убрать из избранного"><span class="cmp-text">Убрать</span></button>'
      + '</div></div></div></article>';
  }

  /* ── «Сравнение» (та же разметка, что у сервера, lib/pages.mjs) ───────────────────────────
     Широкий экран — таблица .cmp-table, телефон — блок .cmp-cards: те же данные колонками-
     карточками, по две в ряд без горизонтальной прокрутки (site.css: .cmp-cards-only,
     @media(max-width:820px) переключает таблицу и карточки). Список характеристик — общий
     массив rows, из него собираются и строка таблицы, и <dl> карточки. */
  var rows = [
    ['Цена', function (c) { return c.price_text; }],
    ['Год', function (c) { return c.year; }],
    ['Пробег', function (c) { return num(c.mileage) + ' км'; }],
    ['Коробка', function (c) { return c.trans || '—'; }],
    ['Двигатель', function (c) { return String(c.volume || 0).replace('.', ',') + ' л'; }],
    ['Топливо', function (c) { return c.fuel || '—'; }],
    ['Кузов', function (c) { return c.body || '—'; }],
    ['Привод', function (c) { return c.drive || '—'; }],
    ['Мощность', function (c) { return c.power ? c.power + ' л.с.' : '—'; }],
  ];
  function specList(c) {
    return '<dl class="cmp-list">' + rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1](c)) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function cmpCards(cars) {
    return '<div class="cmp-cards-only cmp-cards">' + cars.map(function (c) {
      return '<article class="cmp-card">'
        + (c.photo ? '<img class="cmp-photo" src="' + esc(photo(c)) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(photoFull(c)) + '\'">' : '')
        + '<a class="cmp-name" href="' + esc(carHref(c)) + '">' + esc(c.brand + ' ' + c.model) + '</a>'
        + '<button class="btn btn-sm btn-ghost" type="button" data-compare-remove="' + c.id + '">Убрать</button>'
        + specList(c)
        + '<a class="btn btn-sm cmp-open" href="' + esc(carHref(c)) + '">Открыть</a></article>';
    }).join('') + '</div>';
  }

  function cmpTable(cars) {
    return cmpCards(cars)
      + '<div class="cmp-scroll"><table class="tbl cmp-table" style="min-width:' + (180 + cars.length * 220) + 'px">'
      + '<thead><tr><th></th>' + cars.map(function (c) {
        return '<th><div class="cmp-head">'
          + (c.photo ? '<img class="cmp-photo" src="' + esc(photo(c)) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(photoFull(c)) + '\'">' : '')
          + '<a class="cmp-name" href="' + esc(carHref(c)) + '">' + esc(c.brand + ' ' + c.model) + '</a>'
          + '<button class="btn btn-sm btn-ghost" type="button" data-compare-remove="' + c.id + '">Убрать</button>'
          + '</div></th>';
      }).join('') + '</tr></thead>'
      + '<tbody>' + rows.map(function (r) {
        return '<tr><td class="muted">' + esc(r[0]) + '</td>'
          + cars.map(function (c) { return '<td>' + esc(r[1](c)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>'
      + '<tfoot><tr><td></td>' + cars.map(function (c) {
        return '<td><a class="btn btn-sm" href="' + esc(carHref(c)) + '">Открыть</a></td>';
      }).join('') + '</tr></tfoot></table></div>'
      + '<p class="cmp-clear"><button class="btn btn-ghost" type="button" data-compare-clear>Очистить сравнение</button></p>';
  }

  /* ── отрисовка ──────────────────────────────────────────── */
  fetch(BASE + 'data/cars.json', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var byId = {};
      ((data && data.cars) || []).forEach(function (c) { byId[c.id] = c; });
      function picked() {
        return list(page === 'fav' ? 'an_fav' : 'an_cmp')
          .map(function (id) { return byId[id]; }).filter(Boolean);
      }
      function render() {
        var cars = picked();
        var host = document.querySelector('.demo-cars-host');
        if (!cars.length) {                       /* всё убрали — возвращаем пустое состояние */
          if (host) host.innerHTML = emptyHtml;
          counters();
          return;
        }
        var box = host || document.createElement('div');
        box.className = 'demo-cars-host';
        box.innerHTML = page === 'fav'
          ? '<div class="cars">' + cars.map(favCard).join('') + '</div>'
          : cmpTable(cars);
        if (!host) empty.parentNode.replaceChild(box, empty);
        bind(box);
        counters();
      }
      var emptyHtml = empty.innerHTML;

      function bind(box) {
        Array.prototype.forEach.call(box.querySelectorAll('[data-unfav]'), function (btn) {
          btn.addEventListener('click', function () {
            save('an_fav', list('an_fav').filter(function (x) { return x !== Number(btn.getAttribute('data-unfav')); }));
            render();
          });
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-compare-remove]'), function (btn) {
          btn.addEventListener('click', function () {
            save('an_cmp', list('an_cmp').filter(function (x) { return x !== Number(btn.getAttribute('data-compare-remove')); }));
            render();
          });
        });
        var clear = box.querySelector('[data-compare-clear]');
        if (clear) clear.addEventListener('click', function () { save('an_cmp', []); render(); });
      }

      render();
    })
    .catch(function () { /* нет data/cars.json — оставляем пустое состояние как есть */ });
})();
