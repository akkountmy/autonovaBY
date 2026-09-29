/* Каталог статичной копии сайта (GitHub Pages).

   В копии нет сервера, поэтому подбор по параметрам, сортировка и «Показать ещё» работать «как на
   сайте» не могут: сервер отдаёт выдачи страницами (lib/cars.mjs, /api/cars/cards). Чтобы витрина
   не выглядела сломанной, копия собирается иначе (см. build-pages.mjs):
     • на страницу каталога кладутся сразу ВСЕ объявления этой выдачи — build-pages.mjs догружает
       остальные страницы (/api/cars/cards?page=N) и помечает их атрибутом data-extra (скрыты
       правилом .car[data-extra]{display:none} — без JS видно ровно те же 20 карточек, что и раньше);
     • у каждой карточки есть те же поля, по которым сортирует сервер: data-brand, data-model,
       data-year, data-price, data-mileage, data-added, data-views и т.д. (lib/view.mjs, carCard).
   Этот файл перебирает такие карточки в браузере: фильтрует, сортирует и показывает партиями по 20,
   обновляя те же надписи, что и сервер («Найдено N автомобилей», «На странице N объявлений из M»).
   Заказчик 2026-10-02 («Нажимаю в блоке поиска авто марку, а оно не ищется…», «Кнопка — Показать
   объявления не открывает остальные авто»): на боевом сервере это делает сервер, в копии — здесь.

   На боевом сайте файл не подключается: там всё считается на сервере. */
(function () {
  'use strict';

  var grid = document.querySelector('.cars');
  var more = document.querySelector('[data-more]');
  /* Форма подбора есть не на каждой странице с сеткой (например, на странице марки её нет) —
     тогда просто показываем/прячем партии и сортируем. */
  var form = document.querySelector('[data-param-form]');
  if (!grid) return;                             // не страница каталога — молча выходим
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.car'));
  if (!cards.length) return;

  var head = document.getElementById('list');
  var sortSel = document.querySelector('select[data-sort]');
  var titleEl = head ? head.querySelector('h2') : null;
  var cntEl = form ? form.querySelector('button[type="submit"] .btn-cnt') : null;
  var moreRow = document.querySelector('[data-more-row]');
  var moreBtn = document.querySelector('[data-more-btn]');
  var moreCnt = document.querySelector('[data-more-count]');
  var moreEnd = document.querySelector('[data-more-end]');
  var total = cards.length;
  /* Партия — столько карточек, сколько сервер отдаёт за раз (data-per-page), иначе первая
     отрисованная партия (столько карточек пришло без data-extra). */
  var perPage = Number(more && more.getAttribute('data-per-page')) || 0;
  if (!perPage) {
    perPage = cards.filter(function (c) { return !c.hasAttribute('data-extra'); }).length || 20;
  }
  var shown = perPage;

  var plural = function (n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  var num5 = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  var attrNum = function (c, name) { var v = Number(c.getAttribute(name)); return isFinite(v) ? v : 0; };
  var val = function (name) {
    var el = form && form.elements ? form.elements[name] : null;
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  };
  var numVal = function (name) { var n = parseFloat(val(name)); return isFinite(n) ? n : 0; };

  /* ── отбор: те же условия, что сервер применяет к выдаче ───────────────────────────────────── */
  function fits(c) {
    var v;
    v = val('brand'); if (v && c.getAttribute('data-brand') !== v) return false;
    v = val('model'); if (v && c.getAttribute('data-model') !== v) return false;
    v = val('body'); if (v && c.getAttribute('data-body') !== v) return false;
    v = val('transmission'); if (v && c.getAttribute('data-trans') !== v) return false;
    v = val('fuel'); if (v && c.getAttribute('data-fuel') !== v) return false;
    v = val('drive'); if (v && c.getAttribute('data-drive') !== v) return false;
    if (numVal('year_from') && attrNum(c, 'data-year') < numVal('year_from')) return false;
    if (numVal('year_to') && attrNum(c, 'data-year') > numVal('year_to')) return false;
    if (val('volume_from') && attrNum(c, 'data-volume') < numVal('volume_from')) return false;
    if (val('volume_to') && attrNum(c, 'data-volume') > numVal('volume_to')) return false;
    if (numVal('mileage_to') && attrNum(c, 'data-mileage') > numVal('mileage_to')) return false;
    if (numVal('price_from') && attrNum(c, 'data-price') < numVal('price_from')) return false;
    if (numVal('price_to') && attrNum(c, 'data-price') > numVal('price_to')) return false;
    var q = val('q').toLowerCase();
    if (q && c.textContent.toLowerCase().indexOf(q) === -1) return false;
    return true;
  }

  /* ── сортировка: ключи ровно те же, что в select (SORTS в lib/cars.mjs) ────────────────────── */
  var byNum = function (name, dir) {
    return function (a, b) { return (attrNum(a, name) - attrNum(b, name)) * dir; };
  };
  /* «Цена по запросу» (price = 0) у сервера всегда в конце — и при возрастании, и при убывании. */
  var byPrice = function (dir) {
    return function (a, b) {
      var x = attrNum(a, 'data-price'), y = attrNum(b, 'data-price');
      if ((x > 0) !== (y > 0)) return x > 0 ? -1 : 1;
      return (x - y) * dir;
    };
  };
  var byAdded = function (a, b) {
    var x = a.getAttribute('data-added') || '', y = b.getAttribute('data-added') || '';
    if (x === y) return attrNum(b, 'data-car-id') - attrNum(a, 'data-car-id');
    return x < y ? 1 : -1;
  };
  var SORTERS = {
    new_desc: byAdded,
    price_asc: byPrice(1),
    price_desc: byPrice(-1),
    year_desc: byNum('data-year', -1),
    mileage_asc: byNum('data-mileage', 1),
    popular: byNum('data-views', -1),
  };

  /* ── вывод: порядок карточек, партия, надписи ──────────────────────────────────────────────── */
  function render() {
    var list = cards.filter(fits);
    list.sort(SORTERS[(sortSel && sortSel.value) || 'new_desc'] || byAdded);
    var frag = document.createDocumentFragment();
    var i;
    for (i = 0; i < list.length; i++) frag.appendChild(list[i]);
    for (i = 0; i < cards.length; i++) if (list.indexOf(cards[i]) === -1) frag.appendChild(cards[i]);
    for (i = 0; i < list.length; i++) {
      if (i >= shown) list[i].setAttribute('data-extra', '');
      else list[i].removeAttribute('data-extra');
      list[i].removeAttribute('data-off');
    }
    for (i = 0; i < cards.length; i++) {
      if (list.indexOf(cards[i]) === -1) cards[i].setAttribute('data-off', '');
    }
    grid.appendChild(frag);                      // перестановка одним движением, без мигания

    if (titleEl) {
      var b = titleEl.querySelector('b.num');
      if (b) b.textContent = num5(list.length);
      var tail = titleEl.lastChild;
      if (tail && tail.nodeType === 3) {
        tail.nodeValue = ' ' + plural(list.length, 'автомобиль', 'автомобиля', 'автомобилей');
      }
    }
    if (cntEl) cntEl.textContent = num5(list.length);
    if (moreRow && moreCnt) {
      var onPage = Math.min(shown, list.length);
      moreCnt.textContent = 'На странице ' + num5(onPage) + ' ' +
        plural(onPage, 'объявление', 'объявления', 'объявлений') + ' из ' + num5(list.length);
      if (onPage >= list.length) {
        moreRow.hidden = true;
        if (moreEnd) { moreEnd.hidden = false; moreEnd.textContent = 'Показаны все ' + num5(list.length) + ' ' + plural(list.length, 'автомобиль', 'автомобиля', 'автомобилей'); }
      } else {
        moreRow.hidden = false;
        if (moreEnd) moreEnd.hidden = true;
      }
    }
  }

  function apply(doScroll) {
    shown = perPage;
    render();
    /* Адрес держим честным: параметры выдачи видны в строке браузера, ссылку можно скопировать.
       history, а не location: страница статичная и перезагружать её незачем. */
    try {
      var qs = '';
      if (form) {
        var p = new URLSearchParams();
        new FormData(form).forEach(function (v, k) { if (v !== '') p.set(k, v); });
        /* Сортировка живёт вне формы (селект в шапке выдачи) — в адрес добавляем её отдельно, как
           это делает серверная страница, и только если она не совпадает с сортировкой по умолчанию. */
        if (sortSel && sortSel.value && sortSel.value !== (sortSel.options[0] || {}).value) p.set('sort', sortSel.value);
        qs = p.toString();
      }
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + '#list');
    } catch (e) { /* старый браузер — просто не меняем адрес */ }
    if (doScroll && head) head.scrollIntoView({ block: 'start' });
  }

  /* ── события: перехватываем то, что на боевом сайте делает сервер ──────────────────────────── */
  /* Сортировка: site.js уводит на новый адрес (там сортирует сервер). В копии сортируем на месте —
     иначе страница перезагружалась бы в начало списка (жалоба заказчика: «при нажатии на кнопку
     сайт пролистывается вверх»). Перехват в фазе перехвата: обработчик site.js до элемента не
     доходит. */
  if (sortSel) {
    document.addEventListener('change', function (e) {
      if (e.target !== sortSel) return;
      e.stopPropagation();
      apply(true);
    }, true);
  }

  /* Отправка формы поиска: серверу её отдать некому — считаем сами и остаёмся на месте. */
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      apply(true);
    }, true);
    form.addEventListener('change', function () { apply(false); });
    form.addEventListener('input', function () { apply(false); });
    form.addEventListener('reset', function () { setTimeout(function () { apply(false); }, 0); });
  }

  /* «Показать ещё»: site.js запрашивает /api/cars/cards (в копии его нет) — показываем следующую
     партию из тех карточек, что уже лежат в странице. */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-more-btn]') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    shown += perPage;
    render();
  }, true);

  /* Параметры из адреса (переход по ссылке «?brand=…» или обновление страницы) — переносим в форму,
     чтобы выдача совпала с адресом. */
  try {
    var params = new URLSearchParams(location.search);
    if (form) {
      params.forEach(function (v, k) {
        var el = form.elements[k];
        if (!el) return;
        if (el.type === 'checkbox' || el.type === 'radio') return;
        el.value = v;
      });
    }
    if (params.get('sort') && sortSel) sortSel.value = params.get('sort');
  } catch (e2) { /* без адреса — просто показываем всё по порядку сервера */ }

  render();
})();
