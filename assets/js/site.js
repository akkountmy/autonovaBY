/* Автонова с пробегом — клиентские сценарии. Без зависимостей. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── cookies ─────────────────────────────────────────── */
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + 60 * 60 * 24 * 180 + '; SameSite=Lax';
  }
  function idList(name) {
    return getCookie(name).split(',').map(function (x) { return parseInt(x, 10); })
      .filter(function (n) { return Number.isInteger(n) && n > 0; });
  }
  function saveList(name, list) {
    var out = [];
    list.forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    setCookie(name, out.slice(0, 40).join(','));
    return out;
  }
  function toggle(name, id) {
    var list = idList(name);
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    return saveList(name, list);
  }
  function removeFrom(name, id) {
    return saveList(name, idList(name).filter(function (x) { return x !== id; }));
  }

  /* ── уведомления ─────────────────────────────────────── */
  var toastEl = null, toastTimer = null;
  function toastArm(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, ms);
  }
  function toast(msg, cmp) {
    if (!toastEl) {
      toastEl = $('[data-toast]');
      if (!toastEl) return;
      /* Пока курсор на тосте, таймер не идёт: кнопка «Сравнить» исчезала из-под руки. */
      toastEl.addEventListener('mouseenter', function () { clearTimeout(toastTimer); });
      toastEl.addEventListener('mouseleave', function () { if (toastEl.classList.contains('on')) toastArm(2600); });
      toastEl.addEventListener('focusin', function () { clearTimeout(toastTimer); });
    }
    var msgEl = toastEl.querySelector('[data-toast-msg]');
    if (msgEl) msgEl.textContent = msg; else toastEl.textContent = msg;
    toastEl.classList.toggle('toast--cmp', !!cmp);
    toastEl.classList.add('on');
    toastArm(cmp ? 6000 : 2600);
  }

  /* ── заголовочные счётчики ──────────────────────────── */
  function syncCounters() {
    $$('[data-count-fav]').forEach(function (el) { el.textContent = idList('an_fav').length; el.hidden = !idList('an_fav').length; });
    $$('[data-count-cmp]').forEach(function (el) { el.textContent = idList('an_cmp').length; el.hidden = !idList('an_cmp').length; });
  }

  /* ── карусель фотографий в карточке ─────────────────── */
  /* root — область поиска: лента каталога дописывает карточки позже и зовёт функцию ещё раз
     только для новой сетки, иначе на уже готовых карточках обработчики навесились бы дважды. */
  function initCarousels(scope) {
    $$('[data-carousel]', scope).forEach(function (root) {
      var track = $('[data-track]', root);
      if (!track) return;
      var slides = $$('[data-slide]', track);
      if (!slides.length) slides = Array.prototype.slice.call(track.children);
      var prev = $('[data-prev]', root);
      var next = $('[data-next]', root);
      var dotBox = $('[data-dots]', root);
      var dots = dotBox ? Array.prototype.slice.call(dotBox.children) : $$('[data-dot]', root);
      var i = 0, n = slides.length;
      if (n < 2) return;

      function go(k) {
        i = (k + n) % n;
        track.style.transform = 'translateX(' + (-i * 100) + '%)';
        dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
      }
      function step(e, d) { e.preventDefault(); e.stopPropagation(); go(i + d); }
      if (prev) prev.addEventListener('click', function (e) { step(e, -1); });
      if (next) next.addEventListener('click', function (e) { step(e, 1); });
      dots.forEach(function (d, j) {
        d.addEventListener('click', function (e) { step(e, j - i); });
      });
      /* Свайп слушаем на окне кадра (.car-media / .hot-media), а не на самой карусели: с 2026-09-28
         поверх кадров карточки лежит ссылка .car-photo-hit (клик по фото открывает автомобиль), и
         она — сосед карусели, а не её потомок: события пальца до карусели не доходили и свайп
         перестал листать кадры. В окне кадра лежат и карусель со стрелками, и накладка, и плашки. */
      var touchBox = null;
      try { touchBox = root.closest('.car-media, .hot-media'); } catch (e) { touchBox = null; }
      touchBox = touchBox || root;
      var sx = 0, dragging = false;
      touchBox.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; dragging = true; }, { passive: true });
      touchBox.addEventListener('touchend', function (e) {
        if (!dragging) return;
        dragging = false;
        var dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      });
      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') step(e, -1);
        if (e.key === 'ArrowRight') step(e, 1);
      });

      /* Автопрокрутка: включается атрибутом data-autoplay (карточки «Горящей продажи» в герое
         главной — заказчик просил, чтобы фотографии листались сами). В каталоге атрибута нет, там
         кадры листает покупатель. Пауза, пока курсор на карточке или внутри неё фокус, и пока
         вкладка не видна. При «уменьшить движение» в системе автопрокрутку не включаем вовсе. */
      var every = Number(root.getAttribute('data-autoplay')) || 0;
      if (every && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        var timer = 0;
        function stop() { if (timer) { clearInterval(timer); timer = 0; } }
        function play() { stop(); timer = setInterval(function () { go(i + 1); }, every); }
        root.addEventListener('mouseenter', stop);
        root.addEventListener('mouseleave', play);
        root.addEventListener('focusin', stop);
        root.addEventListener('pointerdown', stop);
        document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
        play();
      }
    });
  }

  /* ── «Горящая продажа»: лента с центральной карточкой (Centered Slider) ────── */
  /* Заказчик 2026-09-27: «блок с горящим предложением на титульный наверху сделай как Centered
     Slider». Отличие от карусели кадров выше: та листает на ширину кадра (translateX в процентах),
     а здесь активную карточку надо поставить по центру колонки — сдвиг считается в пикселях как
     «середина ленты минус середина карточки в ленте».
     Лента кольцевая: перед первой и после последней карточки JS достраивает их копии (need штук с
     каждой стороны, по числу карточек, видимых слева/справа от центральной). Благодаря копиям
     активной всегда есть чем «подпереть» центр — и первая, и последняя карточка тоже встают ровно
     в середину, без пустого места по краям и без рывка через всю ленту. Копии помечены aria-hidden
     и выведены из обхода Tab (tabindex="-1"): для скринридера и клавиатуры они дубликатов не
     создают, а ссылок на авто в разметке страницы остаётся ровно n.
     Активная карточка получает класс .on (соседние в CSS уменьшены и приглушены), на ленте
     выставляются data-ready (только с ним включаются стили соседей — при выключенном JS карточки
     не должны выглядеть «погашенными») и data-hot-index (номер активной карточки: по нему себя
     проверяют _ref/measure-hero.mjs и регрессия). */
  function initHotSliders(scope) {
    $$('[data-hot-slider]', scope).forEach(function (slider) {
      var track = $('[data-hot-track]', slider);
      if (!track) return;
      var own = $$('[data-hot-card]', track);
      if (own.length < 2) return;
      var n = own.length;
      var dotBox = $('[data-hot-dots]', slider);
      var dots = dotBox ? Array.prototype.slice.call(dotBox.children) : [];
      var prev = $('[data-hot-prev]', slider);
      var next = $('[data-hot-next]', slider);
      var i = 0;

      /* Сколько копий нужно с каждой стороны: столько карточек (с зазором) помещается между центром
         ленты и её краем. На десктопе это одна карточка, на очень широком экране — больше. */
      var first = own[0];
      var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
      var need = Math.max(1, Math.ceil(Math.max(0, (slider.clientWidth - first.offsetWidth) / 2) / (first.offsetWidth + gap)));
      function twin(card) {
        var c = card.cloneNode(true);
        c.classList.remove('on');
        c.setAttribute('aria-hidden', 'true');
        $$('a, button', c).forEach(function (el) { el.setAttribute('tabindex', '-1'); });
        return c;
      }
      /* Копии крайних карточек: слева — хвост ленты (в том же порядке), справа — начало. */
      for (var k = 0; k < need; k++) track.insertBefore(twin(own[n - need + k]), track.firstChild);
      for (var m = 0; m < need; m++) track.appendChild(twin(own[m]));
      /* Копии лежат до исходных карточек, поэтому активная i — это cards[need + i]. */
      var cards = $$('[data-hot-card]', track);

      function paint() {
        var active = cards[need + i];
        var x = Math.min(0, Math.round(slider.clientWidth / 2 - (active.offsetWidth / 2 + active.offsetLeft)));
        var shift = 'translateX(' + x + 'px)';
        if (track.style.transform !== shift) track.style.transform = shift;
        cards.forEach(function (c, j) { c.classList.toggle('on', j === need + i); });
        dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
        slider.setAttribute('data-hot-index', String(i));
      }
      function go(k) { i = ((k % n) + n) % n; paint(); }
      function step(e, d) { e.preventDefault(); e.stopPropagation(); go(i + d); }

      if (prev) prev.addEventListener('click', function (e) { step(e, -1); });
      if (next) next.addEventListener('click', function (e) { step(e, 1); });
      dots.forEach(function (d, j) { d.addEventListener('click', function (e) { step(e, j - i); }); });

      var sx = 0, dragging = false;
      slider.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; dragging = true; }, { passive: true });
      slider.addEventListener('touchend', function (e) {
        if (!dragging) return;
        dragging = false;
        var dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      });
      slider.addEventListener('keydown', function (e) {
        if (!slider.contains(document.activeElement)) return;
        if (e.key === 'ArrowLeft') step(e, -1);
        if (e.key === 'ArrowRight') step(e, 1);
      });
      /* Фокус с клавиатуры на нецентральной карточке сам подтягивает её в центр: иначе Tab уводил бы
         фокус на карточку, которой на экране не видно. Копии крайних карточек (tabindex="-1") из
         обхода выведены, но на всякий случай индекс пересчитывается в номер исходной карточки. */
      slider.addEventListener('focusin', function (e) {
        var card = e.target && e.target.closest ? e.target.closest('[data-hot-card]') : null;
        var j = card ? cards.indexOf(card) - need : -1;
        if (j >= 0 && j < n && j !== i) go(j);
      });

      /* Смена ширины (поворот телефона, раскрытие панели) пересчитывает сдвиг: пиксельная формула
         держится на ширине ленты, и без пересчёта активная карточка уехала бы с центра. */
      if (window.ResizeObserver) new ResizeObserver(function () { paint(); }).observe(slider);
      else window.addEventListener('resize', paint);

      /* Автолистание — как у карусели кадров: пауза, пока курсор или фокус внутри, и пока вкладка
         не видна; при «уменьшить движение» в системе не включается вовсе (CSS там же гасит
         transition ленты). */
      var every = Number(slider.getAttribute('data-autoplay')) || 0;
      if (every && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        var timer = 0;
        function stop() { if (timer) { clearInterval(timer); timer = 0; } }
        function play() { stop(); timer = setInterval(function () { go(i + 1); }, every); }
        slider.addEventListener('mouseenter', stop);
        slider.addEventListener('mouseleave', play);
        slider.addEventListener('focusin', stop);
        slider.addEventListener('pointerdown', stop);
        document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
        play();
      }

      slider.setAttribute('data-ready', '');
      paint();
      /* data-anim включает transition ленты только со следующего кадра: первая расстановка в центр
         должна быть мгновенной, иначе каждая загрузка страницы начиналась бы с «проезда» ленты. */
      if (window.requestAnimationFrame) requestAnimationFrame(function () { slider.setAttribute('data-anim', ''); });
      else slider.setAttribute('data-anim', '');
    });
  }

  /* ── галерея на странице автомобиля ─────────────────── */
  /* Клик по главному фото открывает полноэкранный просмотр — как на av.by, где объявление читают,
     разглядывая снимки. Стрелки, миниатюры, клавиши ←/→ и свайп листают кадры в обоих режимах.
     Оверлей собирается здесь, а не в шаблоне: разметка объявления остаётся текстовой, а сам
     просмотрщик существует только пока открыт. */
  function initGallery() {
    var main = $('[data-gallery-img]');
    if (!main) return;
    var counter = $('[data-gallery-counter]');
    var thumbs = $$('[data-thumb]');
    var srcs = thumbs.map(function (t) { return t.getAttribute('src'); });
    if (!srcs.length) srcs = [main.getAttribute('src')];
    var alt = main.getAttribute('alt') || '';
    var cur = 0, box = null, boxImg = null, boxNum = null, lastFocus = null;

    function show(i) {
      cur = ((i % srcs.length) + srcs.length) % srcs.length;
      main.setAttribute('src', srcs[cur]);
      if (counter) counter.textContent = (cur + 1) + ' / ' + srcs.length;
      thumbs.forEach(function (t, j) { t.classList.toggle('on', j === cur); });
      if (boxImg) { boxImg.setAttribute('src', srcs[cur]); boxNum.textContent = (cur + 1) + ' / ' + srcs.length; }
    }
    function build() {
      if (box) return;
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Просмотр фотографий');
      box.innerHTML = '<button class="lb-close" type="button" data-lb-close aria-label="Закрыть">×</button>' +
        '<button class="lb-nav prev" type="button" data-lb-nav="-1" aria-label="Предыдущее фото">‹</button>' +
        '<img alt="">' +
        '<button class="lb-nav next" type="button" data-lb-nav="1" aria-label="Следующее фото">›</button>' +
        '<span class="lb-num num"></span>';
      document.body.appendChild(box);
      boxImg = box.querySelector('img');
      boxImg.setAttribute('alt', alt);
      boxNum = box.querySelector('.lb-num');
      box.addEventListener('click', function (e) {
        var t = e.target;
        if (t === box || (t.closest && t.closest('[data-lb-close]'))) return close();
        var nav = t.closest && t.closest('[data-lb-nav]');
        if (nav) show(cur + Number(nav.getAttribute('data-lb-nav')));
      });
    }
    function open(i) {
      build();
      show(i);
      document.documentElement.classList.add('lb-on');
      lastFocus = document.activeElement;
      var closeBtn = box.querySelector('[data-lb-close]');
      if (closeBtn) closeBtn.focus();
    }
    function close() {
      if (!box) return;
      document.documentElement.classList.remove('lb-on');
      box.parentNode.removeChild(box);
      box = boxImg = boxNum = null;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    thumbs.forEach(function (t) {
      t.addEventListener('click', function () { show(Number(t.getAttribute('data-thumb')) || 0); });
    });
    var host = $('[data-gallery-main]');
    if (host) {
      $$('[data-gal-nav]', host).forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          show(cur + Number(btn.getAttribute('data-gal-nav')));
        });
      });
      if (srcs.length > 1) main.addEventListener('click', function () { open(cur); });
      /* Свайп: на телефоне стрелки мелкие, а листать фотографии пальцем привычно. */
      var x0 = null;
      host.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      host.addEventListener('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1));
        x0 = null;
      });
    }
    document.addEventListener('keydown', function (e) {
      if (!box) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* ── дополнения карточки автомобиля ─────────────────── */
  /* 1) «Показать все опции» — как на av.by: в комплектации видно восемь опций, остальные
        раскрываются кнопкой (класс .is-extra прячет их, пока у списка нет data-open).
     2) «Скопировать ссылку» — значок на главном фото объявления, рядом с Telegram, Viber и
        WhatsApp (заказчик 2026-09-30: «Поделиться Telegram Viber WhatsApp Скопировать ссылку, —
        сделай на фото ... значками»): navigator.clipboard на https и запасной путь
        через execCommand — сайт живёт и на http-отладке.
     3) «Отправить сообщение» и «Предложить цену» ведут к форме заявки и ставят курсор в нужное
        поле: предложенная цена уходит в leads.text той же формы. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function initCarExtras() {
    var equip = $('[data-equip]');
    var more = $('[data-equip-more]');
    if (equip && more) {
      var total = $$('.equip-opts li', equip).length;
      more.addEventListener('click', function () {
        var open = equip.toggleAttribute('data-open');
        more.textContent = open ? 'Свернуть опции' : 'Показать все опции (' + total + ')';
      });
    }
    $$('[data-copy-link]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyText(btn.getAttribute('data-copy-link') || location.href).then(
          function () { toast('Ссылка скопирована'); },
          function () { toast('Не удалось скопировать ссылку'); });
      });
    });
  }

  /* ── избранное и сравнение ──────────────────────────── */
  /* scope — область поиска (см. initCarousels): пригодится, когда карточки допишет лента. */
  function initFav(scope) {
    $$('[data-fav]', scope).forEach(function (btn) {
      var id = Number(btn.getAttribute('data-fav'));
      if (idList('an_fav').indexOf(id) !== -1) btn.classList.add('on');
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var list = toggle('an_fav', id);
        var on = list.indexOf(id) !== -1;
        btn.classList.toggle('on', on);
        syncCounters();
        toast(on ? 'Добавлено в избранное' : 'Удалено из избранного');
      });
    });
  }
  function initCompare(scope) {
    $$('[data-compare]', scope).forEach(function (el) {
      var id = Number(el.getAttribute('data-compare'));
      if (idList('an_cmp').indexOf(id) !== -1) el.checked = true;
      el.addEventListener('change', function () {
        var list = el.checked ? saveList('an_cmp', idList('an_cmp').concat([id])) : removeFrom('an_cmp', id);
        if (el.checked && list.length > 4) {
          el.checked = false;
          removeFrom('an_cmp', id);
          toast('В сравнении не более 4 автомобилей');
        } else {
          toast(el.checked ? 'Добавлено к сравнению' : 'Удалено из сравнения', el.checked);
        }
        syncCounters();
      });
    });
    $$('[data-compare-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeFrom('an_cmp', Number(btn.getAttribute('data-compare-remove')));
        location.reload();
      });
    });
    var clear = $('[data-compare-clear]');
    if (clear) clear.addEventListener('click', function () { saveList('an_cmp', []); location.reload(); });
  }

  /* ── фильтры и сортировка ───────────────────────────── */
  function initFilters() {
    /* Куда встаёт страница после перестройки списка. Заказчик 2026-10-02: «Сортировка — при
       выборе метода сортировки, при нажатии на кнопку сайт пролистывается вверх, не надо,
       должно показывать первые карточки выбранной модели авто». Переход был без якоря,
       поэтому браузер открывал страницу с самого верха (замер на 390 px: панель поиска
       занимает 801 px, шапка выдачи — на 1304 px, то есть после сортировки карточек не видно
       вовсе). Теперь сортировка добавляет #list — это шапка выдачи в каталоге («Найдено N …»
       с самой сортировкой, lib/pages.mjs), а .list-head держит scroll-margin-top под прилипшую
       шапку сайта. Селект сортировки есть только в каталоге, где #list всегда на месте. */
    $$('select[data-sort]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var u = new URL(location.href);
        u.searchParams.set('sort', sel.value);
        u.searchParams.delete('page');
        u.hash = 'list';
        location.href = u.toString();
      });
    });
  }

  /* ── калькулятор ────────────────────────────────────── */
  function initCalc() {
    var form = $('[data-calc]');
    if (!form) return;
    var monthsOut = $('[data-months]', form);
    var priceOut = $('[data-price]', form);
    var shareOut = $('[data-share]', form);
    /* Ставка считается «под капотом»: поле «Ставка, % годовых» убрано со страницы по просьбе
       заказчика («убери Ставка, % годовых … но под капотом должна считаться ставка 16 % годовых
       аннуитетом»). Меняется в lib/finance.mjs, страница отдаёт её в data-rate, здесь — только
       запасное значение, если атрибут потеряется. */
    var RATE = Number(form.dataset.rate) || 16;
    function money(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' руб.'; }
    function digits(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    /* Заливка трека до бегунка: доля в переменной --p, её читает CSS. У всех ползунков
       (стоимость, участие клиента, срок) она считается одинаково, поэтому выглядят они одинаково. */
    function paint(el) {
      if (!el) return;
      var min = Number(el.min) || 0, max = Number(el.max) || 0;
      var share = max > min ? (Number(el.value) - min) / (max - min) : 0;
      el.style.setProperty('--p', (share * 100).toFixed(2) + '%');
    }
    /* Участие клиента — проценты (заказчик 2026-09-29: «в блок кредитный калькулятор добавь
       ползунок участие клиента от 5% до 80%»). Раньше это был ползунок взноса в рублях, и его
       границу приходилось двигать вместе со стоимостью, чтобы взнос не превысил цену: теперь
       проценты от цены по определению не больше цены, поэтому подгонять границы не нужно.
       Взнос в рублях показываем рядом с процентом — так видно реальную сумму. */
    function calc() {
      var price = Number(form.price.value) || 0;
      var share = Math.min(100, Math.max(0, Number(form.share.value) || 0));
      var months = Number(form.months.value) || 12;
      var rate = RATE;
      var down = Math.round((price * share) / 100);
      var credit = Math.max(0, price - down);
      var m = rate / 100 / 12;
      var pay = m > 0 ? credit * m / (1 - Math.pow(1 + m, -months)) : credit / months;
      if (monthsOut) monthsOut.value = months;
      if (priceOut) priceOut.value = digits(price);
      if (shareOut) shareOut.value = share + ' % · ' + digits(down) + ' руб.';
      paint(form.price); paint(form.share); paint(form.months);
      var set = function (sel, txt) { var el = $(sel); if (el) el.textContent = txt; };
      set('[data-payment]', money(pay) + ' / месяц');
      set('[data-credit]', money(credit));
      set('[data-over]', money(pay * months - credit));
      set('[data-total]', money(pay * months));
    }
    form.addEventListener('input', calc);
    form.addEventListener('change', calc);
    calc();
  }

  /* ── меню и мелочи ──────────────────────────────────── */
  function initChrome() {
    var burger = $('[data-burger]');
    var nav = $('[data-mobile-nav]');
    if (burger && nav) {
      /* Меню на телефоне — выезжающая справа панель (.mdrawer в site.css). Открытое состояние
         держит класс .open (он же двигает панель через transform), а .hide на панели в закрытом
         виде нужен не для вида, а чтобы панель не участвовала в раскладке: без него её сдвиг
         translateX(100%) не анимировался бы — transition начинается только у видимого элемента.
         Закрытие: крестик в панели, тап по приглушающей подложке .mnav-scrim, Escape, переход
         по пункту меню и расширение окна шире 1279 px (от 1280 px шапка снова показывает ряд
         подписей .nav — см. @media у .mnav в site.css). */
      var scrim = $('[data-mnav-scrim]');
      var closeBtn = $('[data-mnav-close]', nav);
      var drawerOpen = false;
      var setDrawer = function (open) {
        if (open === drawerOpen) return;
        drawerOpen = open;
        nav.classList.toggle('open', open);
        nav.classList.toggle('hide', !open);
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (scrim) {
          if (open) scrim.hidden = false;
          scrim.classList.toggle('on', open);
          if (!open) setTimeout(function () { if (!drawerOpen) scrim.hidden = true; }, 300);
        }
        document.documentElement.classList.toggle('mnav-on', open);
      };
      var closeDrawer = function () { setDrawer(false); };
      setDrawer(false);
      burger.addEventListener('click', function () { setDrawer(!drawerOpen); });
      if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
      if (scrim) scrim.addEventListener('click', closeDrawer);
      nav.addEventListener('click', function (e) {
        var link = e.target.closest('a');
        if (!link) return;
        /* «Услуги» в панели — не переход, а раскрытие списка: первый тап по нему гасит переход
           и раскрывает подпункты (обработчик [data-nav-dd] ниже). Панель при этом закрывать
           нельзя — она уезжала вместе со списком, и получалось, что кнопка «Услуги» в
           бутерброде не работает (заказчик 2026-10-02). Панель закрывается на переходе по
           подпункту, по обычному пункту меню и на втором тапе по «Услуги» (когда список уже
           раскрыт — тогда это честный переход на /services). */
        var dd = link.parentNode;
        if (link.classList.contains('nav-dd-btn') && dd && !dd.classList.contains('open')
            && window.matchMedia && window.matchMedia('(hover:none)').matches) return;
        closeDrawer();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && drawerOpen) { closeDrawer(); burger.focus(); }
      });
      window.addEventListener('resize', function () { if (drawerOpen && window.innerWidth > 1279) closeDrawer(); });
    }
    var top = $('[data-top]');
    if (top) {
      var onScroll = function () { top.classList.toggle('on', window.scrollY > 600); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }
    $$('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = $(btn.getAttribute('data-toggle'));
        if (target) { target.hidden = !target.hidden; btn.classList.toggle('on', !target.hidden); }
      });
    });

    $$('[data-map-toggle]').forEach(function (btn) {
      var picker = btn.closest('.map-picker');
      var menu = picker && $('[data-map-menu]', picker);
      if (!menu) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    document.addEventListener('click', function () {
      $$('[data-map-menu]').forEach(function (menu) {
        menu.hidden = true;
        var btn = menu.parentNode && $('[data-map-toggle]', menu.parentNode);
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    });

    /* раскрывающиеся пункты меню (Услуги): по наведению открывает CSS,
       на тач-устройствах первый тап раскрывает список, второй — переходит */
    function closeNavDd() {
      $$('[data-nav-dd].open').forEach(function (dd) {
        dd.classList.remove('open');
        var b = $('.nav-dd-btn', dd);
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
    $$('[data-nav-dd]').forEach(function (dd) {
      var btn = $('.nav-dd-btn', dd);
      if (!btn) return;
      dd.addEventListener('mouseenter', function () { btn.setAttribute('aria-expanded', 'true'); });
      dd.addEventListener('mouseleave', function () {
        if (!dd.classList.contains('open')) btn.setAttribute('aria-expanded', 'false');
      });
      btn.addEventListener('click', function (e) {
        var touch = window.matchMedia && window.matchMedia('(hover:none)').matches;
        if (touch && !dd.classList.contains('open')) {
          e.preventDefault();
          closeNavDd();
          dd.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-nav-dd]')) return;
      closeNavDd();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNavDd();
    });
  }

  /* ── отправка форм заявки (без перезагрузки) ────────── */
  /* Отправка одной формы заявки на /lead. Вынесено отдельной функцией, потому что те же поля
     отправляют окна брони (initCarBook), заказа звонка (initCallModal) и связи с продавцом
     (initCarContact): у всех форма с method=post action=/lead, отличается только what делать
     после успеха. При ошибке сети форма отправляется обычным способом — заявка не теряется. */
  function sendLead(form, done) {
    var fd = new FormData(form);
    fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(fd),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
      .then(function () { done(); })
      .catch(function () { form.submit(); });
  }

  function initLeadForms() {
    $$('form.lead-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        if (!form.checkValidity()) return;
        e.preventDefault();
        sendLead(form, function () {
          form.reset();
          toast('Заявка отправлена — мы свяжемся с вами');
        });
      });
    });
  }

  function initAuthModal() {
    var back = document.querySelector('[data-auth-modal]');
    if (!back) return;
    var lastFocus = null;

    function pane(tab) {
      back.querySelectorAll('[data-auth-pane]').forEach(function (p) {
        p.classList.toggle('hide', p.getAttribute('data-auth-pane') !== tab);
      });
      back.querySelectorAll('[data-auth-tab]').forEach(function (b) {
        var on = b.getAttribute('data-auth-tab') === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var active = back.querySelector('[data-auth-pane="' + tab + '"]');
      var first = active && active.querySelector('input:not([type=hidden])');
      if (first) setTimeout(function () { first.focus(); }, 60);
    }

    function open(tab) {
      lastFocus = document.activeElement;
      back.hidden = false;
      back.classList.add('is-open');
      document.body.classList.add('modal-open');
      pane(tab || 'login');
    }

    function close() {
      back.classList.remove('is-open');
      back.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-auth-close]')) { close(); return; }
      var tab = e.target.closest('[data-auth-tab]');
      if (tab) { pane(tab.getAttribute('data-auth-tab')); return; }
      var go = e.target.closest('[data-auth-goto]');
      if (go) { e.preventDefault(); pane(go.getAttribute('data-auth-goto')); }
    });

    document.querySelectorAll('[data-auth-open]').forEach(function (btn) {
      btn.addEventListener('click', function () { open(btn.getAttribute('data-auth-open') || 'login'); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) close();
    });

    if (!back.hidden) {
      document.body.classList.add('modal-open');
      var active = back.querySelector('.auth-tab.on');
      var first = back.querySelector('[data-auth-pane]:not(.hide) .alert-err');
      if (active && !first) setTimeout(function () {
        var f = back.querySelector('[data-auth-pane]:not(.hide) input:not([type=hidden])');
        if (f) f.focus();
      }, 80);
    }
  }

  /* ── поиск по параметрам ─────────────────────────────── */
  function initParamSearch() {
    $$('[data-param-form]').forEach(function (form) {
      var brand = form.querySelector('[data-ps-brand]');
      var model = form.querySelector('[data-ps-model]');
      var dataEl = document.querySelector('[data-ps-models="1"]');
      var map = {};
      if (dataEl) { try { map = JSON.parse(dataEl.textContent) || {}; } catch (e) { map = {}; } }

      function sync(keep) {
        if (!brand || !model) return;
        var list = map[brand.value] || [];
        var current = model.value;
        model.innerHTML = '';
        var all = document.createElement('option');
        all.value = '';
        all.textContent = list.length ? 'Любая' : 'Сначала марка';
        model.appendChild(all);
        list.forEach(function (name) {
          var o = document.createElement('option');
          o.value = name;
          o.textContent = name;
          model.appendChild(o);
        });
        model.disabled = list.length === 0;
        if (keep && list.indexOf(current) !== -1) model.value = current;
      }

      if (brand && model) {
        brand.addEventListener('change', function () { sync(false); });
        sync(true);
      }
      var reset = form.querySelector('[data-ps-reset]');
      if (reset) reset.addEventListener('click', function (e) {
        e.preventDefault();
        form.reset();
        sync(false);
        later();
      });

      /* Счётчик на кнопке «Показать автомобили N» (заказчик 2026-09-27: «при изменении переменных
         в поиске сделай, чтобы в кнопке показать автомобили счётчик менялся соответствующие
         выбранным параметрам»). Число считает сервер тем же фильтром, что отдаёт страницу и ленту
         карточек, поэтому на кнопке ровно столько, сколько найдётся после отправки формы.
         Считаем не на каждое нажатие клавиши, а с небольшой задержкой, и отменяем предыдущий
         запрос: важен последний выбор. Режим страницы («Новые», «Электро») уходит отдельным
         параметром — у /cars-new и /electric один адрес счётчика. Если запрос не удался, на
         кнопке остаётся прежнее число: лучше старое, чем пустая кнопка. */
      var countUrl = form.getAttribute('data-count-url');
      var cntEl = form.querySelector('button[type="submit"] .btn-cnt');
      var timer = null, ctrl = null, shown = null;
      function num5(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
      function askCount() {
        if (!countUrl || !cntEl) return;
        var p = new URLSearchParams();
        new FormData(form).forEach(function (val, key) { if (val !== '') p.set(key, val); });
        var mode = form.getAttribute('data-ps-mode');
        if (mode && mode !== 'all') p.set('mode', mode);
        if (ctrl) ctrl.abort();
        ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        fetch(countUrl + (p.toString() ? '?' + p.toString() : ''), {
          signal: ctrl ? ctrl.signal : undefined,
          headers: { Accept: 'application/json' },
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (!d || d.total === undefined || d.total === null) return;
            var text = num5(d.total);
            if (text === shown) return;
            shown = text;
            cntEl.textContent = text;
          })
          .catch(function () { /* отменённый или упавший запрос — на кнопке прежнее число */ });
      }
      function later() {
        clearTimeout(timer);
        timer = setTimeout(askCount, 180);
      }
      if (countUrl && cntEl) {
        form.addEventListener('change', later);
        form.addEventListener('input', later);
      }
    });
  }

  /* ── раскрытие «Параметров» досматривает низ полей ─────────
     Дополнительные поля (техника, пробег, слово) появляются из-под свёрнутой панели, и на
     невысоком окне их низ уходит за нижний край: посетитель нажимает «Параметры» и не видит,
     что именно раскрылось (на 390 px скрытый блок выше экрана). После раскрытия доводим
     страницу до нижней границы раскрытых полей — она встаёт у нижнего края окна с отступом
     GAP. Прокрутка только вниз: если низ и так виден, страница не дёргается. Сворачивание
     ничего не прокручивает. При системном «уменьшить анимацию» прокрутка без плавности. */
  function initMoreToggle() {
    var GAP = 16;
    function toBottom(tgl) {
      var card = (tgl.closest && tgl.closest('.param-card')) || tgl.parentNode;
      var body = card && card.querySelector('.ps-more-body');
      if (!body) return;
      var r = body.getBoundingClientRect();
      if (!r.height) return;                       /* блок ещё скрыт — низ считать не по чему */
      var y = window.pageYOffset;
      var need = y + r.bottom - (window.innerHeight - GAP);   /* куда довести нижнюю границу */
      if (need - y < 8) return;                    /* низ уже виден — не двигаем страницу */
      var root = document.documentElement;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        /* стили сайта задают html{scroll-behavior:smooth}, а 'auto' в scrollTo означает «как в
           CSS», то есть та же плавность. На время перехода снимаем её — при системном
           «уменьшить анимацию» страница перескакивает сразу. */
        var keep = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(window.pageXOffset, need);   /* двухаргументная форма: сначала X */
        root.style.scrollBehavior = keep;
      } else {
        window.scrollTo({ top: need, left: window.pageXOffset, behavior: 'smooth' });
      }
    }
    $$('.ps-more-tgl').forEach(function (tgl) {
      tgl.addEventListener('change', function () {
        if (!tgl.checked) return;
        /* замер после пересчёта стилей: видимость .ps-more-body меняет :checked */
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { toBottom(tgl); });
        });
      });
    });
  }

  /* ── куда встаёт раскрытый список (.sel-pop) ────────────
     Общая раскладка для списков панели поиска (initSelects) и полей формы продажи (initCombos).
     Заказчик 2026-10-02 про форму «Подача объявления»: «нажимаю на марка и списки раскрываются
     вверх и большая часть марок не видно, возможно и в остальных есть такие нюансы, проверь и
     исправь». Что было не так:
       1) место считалось по window.innerHeight и с жёстким потолком 302 px, поэтому список
          показывал 9–10 строк из 166, даже когда под полем было пол-экрана свободного места;
       2) порог в 160 px (Math.max(160, …)) вынуждал открывать список вверх даже при 200 px
          свободного места внизу — а «Марка» и «Модель» стоят примерно на середине формы, так что
          вверх он и уходил;
       3) на телефоне видимую часть окна ужимает клавиатура, а направление и потолок считались
          один раз при открытии.
     Теперь: направление выбирается по тому, где места больше, потолок — 60 % видимой высоты
     (не больше 480 px и не меньше 280 px), вместо 160 px — мягкий пол 120 px, а место
     пересчитывается при изменении видимой части окна (см. watchViewport). Видимая высота
     берётся у visualViewport, когда он есть: с открытой клавиатурой это единственный верный
     ориентир. */
  function placePop(wrap, pop, anchor, cap) {
    var vv = window.visualViewport;
    var top = vv ? vv.offsetTop : 0;
    var bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    var max = cap || Math.min(480, Math.max(280, Math.round((bottom - top) * 0.6)));
    wrap.classList.remove('sel--up');
    pop.style.maxHeight = '';
    var r = anchor.getBoundingClientRect();
    var need = Math.min(pop.scrollHeight, max);
    var below = bottom - r.bottom - 8;
    var above = r.top - top - 8;
    if (below < need + 12 && above > below) {
      wrap.classList.add('sel--up');
      pop.style.maxHeight = Math.min(max, Math.max(120, above - 6)) + 'px';
      return 'up';
    }
    pop.style.maxHeight = Math.min(max, Math.max(120, below - 6)) + 'px';
    return 'down';
  }

  /* Изменение видимой части окна (клавиатура, адресная строка, поворот экрана) не закрывает
     открытый список, а переставляет его: раньше на resize и на любой прокрутке список просто
     закрывался (initSelects: resize/scroll → shutOpen; initCombos: resize → shut), и на телефоне
     он пропадал ровно в тот момент, когда браузер прокручивал поле под клавиатуру. */
  function watchViewport(place) {
    var raf = 0;
    var soon = function () {
      if (raf) return;
      var tick = function () { raf = 0; place(); };
      raf = window.requestAnimationFrame ? window.requestAnimationFrame(tick) : setTimeout(tick, 16);
    };
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, { passive: true });
    var vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', soon); vv.addEventListener('scroll', soon); }
    return soon;
  }

  /* ── выпадающие списки панели поиска и формы продажи ────
     Системный список <select> в браузере не оформляется: белый прямоугольник без скругления и
     тени, системным шрифтом, вылезает поверх шапки и обрезается по краю окна (снимок
     _ref/select-open.png). Поэтому список рисуем сами: под полем открывается белая карточка со
     скруглением, тенью и подсветкой строк, текущее значение помечено галочкой.
     Сам <select> остаётся в форме — его значение уходит на сервер, подгрузка моделей по марке и
     «Сбросить» работают как раньше, а без JS панель выглядит и работает по-старому: своя кнопка
     и список появляются только здесь, при включённом JS.
     Заказчик 2026-09-28: «сделай стили раскрытия списки как на блоке поиск авто» — теперь тот же
     список открывают и <select>-ы формы «Разместить объявление» (коробка, кузов, привод, цвет,
     комплектация, салон): в разметке это `.sell-form .field select`. */
  function initSelects() {
    var CHEV = '<svg class="sel-ar" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var CHECK = '<svg class="sel-ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    var opened = null;
    var seq = 0;

    function shutOpen() { if (opened) opened.shut(); }

    $$('.ps-field select, .sell-form .field select').forEach(function (src) {
      var field = src.closest('.ps-field') || src.closest('.field') || src.parentNode;
      var cap = field.querySelector('span');
      var name = src.getAttribute('aria-label') || (cap ? cap.textContent.trim() : '') || src.name;

      var wrap = document.createElement('div');
      wrap.className = 'sel sel--on';
      src.parentNode.insertBefore(wrap, src);
      wrap.appendChild(src);
      src.setAttribute('tabindex', '-1');
      src.setAttribute('aria-hidden', 'true');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sel-btn';
      btn.setAttribute('role', 'combobox');
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', name);
      btn.innerHTML = '<span class="sel-tx"></span>' + CHEV;

      var pop = document.createElement('div');
      pop.className = 'sel-pop';
      pop.id = 'sel-pop-' + (++seq);
      pop.setAttribute('role', 'listbox');
      pop.setAttribute('aria-label', name);
      pop.hidden = true;
      btn.setAttribute('aria-controls', pop.id);

      wrap.appendChild(btn);
      wrap.appendChild(pop);

      var tx = $('.sel-tx', btn);
      var active = -1;
      var typed = '';
      var typedAt = 0;

      function rows() { return $$('.sel-opt', pop); }
      function isOpen() { return !pop.hidden; }

      /* Список — копия <select>: строки, текущее значение, недоступные пункты. */
      function paint() {
        pop.innerHTML = '';
        var sel = src.selectedIndex;
        $$('option', src).forEach(function (o, i) {
          var row = document.createElement('div');
          row.className = 'sel-opt' + (o.disabled ? ' is-off' : '');
          row.id = pop.id + '-' + i;
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', i === sel ? 'true' : 'false');
          row.setAttribute('data-v', o.value);
          var t = document.createElement('span');
          t.className = 'sel-tx';
          t.textContent = o.textContent;
          row.appendChild(t);
          row.insertAdjacentHTML('beforeend', CHECK);
          pop.appendChild(row);
        });
        var cur = src.options[src.selectedIndex];
        tx.textContent = cur ? cur.textContent : '';
        btn.disabled = !!src.disabled;
        wrap.classList.toggle('is-disabled', !!src.disabled);
        if (isOpen()) mark(sel);
      }

      function mark(i) {
        active = i;
        rows().forEach(function (r, n) { r.classList.toggle('on', n === i); });
        if (i >= 0 && rows()[i]) btn.setAttribute('aria-activedescendant', rows()[i].id);
        else btn.removeAttribute('aria-activedescendant');
      }

      /* Куда встаёт список: общая раскладка placePop (см. выше). Потолок 302 px — как в CSS
         (.sel-pop), он же рассчитан на панель поиска, где выше списка ещё поля. */
      function place() {
        return placePop(wrap, pop, btn, 302);
      }

      function openPop() {
        if (src.disabled) return;
        if (opened && opened !== api) opened.shut();
        paint();
        pop.hidden = false;
        btn.classList.add('on');
        btn.setAttribute('aria-expanded', 'true');
        place();
        mark(src.selectedIndex);
        var cur = rows()[src.selectedIndex];
        if (cur) cur.scrollIntoView({ block: 'nearest' });
        opened = api;
      }

      function shut() {
        if (pop.hidden) return;
        pop.hidden = true;
        wrap.classList.remove('sel--up');
        btn.classList.remove('on');
        btn.setAttribute('aria-expanded', 'false');
        btn.removeAttribute('aria-activedescendant');
        active = -1;
        if (opened === api) opened = null;
      }

      function commit(i) {
        var row = rows()[i];
        if (!row || row.classList.contains('is-off')) return;
        var v = row.getAttribute('data-v');
        shut();
        if (src.value !== v) {
          src.value = v;
          // событие нужно форме: по нему подгружаются модели выбранной марки
          src.dispatchEvent(new Event('change', { bubbles: true }));
        }
        btn.focus();
      }

      function move(step) {
        var list = rows();
        if (!list.length) return;
        var i = active;
        for (var n = 0; n < list.length; n++) {
          i += step;
          if (i < 0) i = list.length - 1;
          if (i > list.length - 1) i = 0;
          if (!list[i].classList.contains('is-off')) break;
        }
        mark(i);
        list[i].scrollIntoView({ block: 'nearest' });
      }

      /* Первая строка, начинающаяся с набранных букв, — как в системном списке. */
      function seek(ch) {
        var now = Date.now();
        typed = now - typedAt > 900 ? ch : typed + ch;
        typedAt = now;
        var list = rows();
        var q = typed.toLowerCase();
        for (var n = 0; n < list.length; n++) {
          var i = (active + 1 + n) % list.length;
          if (!list[i].classList.contains('is-off') && list[i].textContent.trim().toLowerCase().indexOf(q) === 0) {
            mark(i);
            list[i].scrollIntoView({ block: 'nearest' });
            return;
          }
        }
      }

      var api = { wrap: wrap, shut: shut, place: place };

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (isOpen()) shut(); else openPop();
      });

      btn.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'Escape') { if (isOpen()) { e.preventDefault(); shut(); } return; }
        if (k === 'Tab') { shut(); return; }
        if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
          e.preventDefault();
          if (isOpen()) commit(active); else openPop();
          return;
        }
        if (k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen()) openPop(); else move(k === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (isOpen() && k === 'Home') { e.preventDefault(); mark(0); rows()[0].scrollIntoView({ block: 'nearest' }); return; }
        if (isOpen() && k === 'End') {
          e.preventDefault();
          var last = rows().length - 1;
          mark(last);
          rows()[last].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (!isOpen()) openPop();
          seek(k);
        }
      });

      pop.addEventListener('click', function (e) {
        /* То же, что и в списке подсказок выше: клик по строке не должен активировать
           <label> вокруг поля, иначе браузер дожимает клик по самому полю. */
        e.preventDefault();
        var row = e.target.closest ? e.target.closest('.sel-opt') : null;
        if (!row) return;
        commit(rows().indexOf(row));
      });

      pop.addEventListener('mousemove', function (e) {
        var row = e.target.closest ? e.target.closest('.sel-opt') : null;
        if (!row) return;
        var i = rows().indexOf(row);
        if (i !== active) mark(i);
      });

      // За системным списком следим: марка подменила модели, «Сбросить» вернул значения.
      src.addEventListener('change', paint);
      if (window.MutationObserver) {
        new MutationObserver(paint).observe(src, {
          childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'],
        });
      }
      if (src.form) src.form.addEventListener('reset', function () { setTimeout(paint, 0); });

      paint();
    });

    document.addEventListener('click', function (e) {
      if (opened && !opened.wrap.contains(e.target)) opened.shut();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shutOpen(); });
    /* Окно изменилось или страница прокрутилась — список не закрываем, а переставляем. */
    watchViewport(function () { if (opened) opened.place(); });
  }

  /* ── марка, модель и поколение формы продажи ───────────
     Заказчик 2026-09-28: «сделай стили раскрытия списки как на блоке поиск авто, а также проверь
     выбор марки авто, плохо выбирается, работает криво, не подтягивается модель и выбор
     поколения». Раньше марка была обычным input с системным <datalist> на 18 марок дилера, а
     модель и поколение — пустыми текстовыми полями: список открывался системным, значение
     подставлялось «криво», связи между полями не было вовсе.
     Теперь эти три поля открывают свой список теми же классами, что и панель поиска
     (.sel-pop/.sel-opt/.sel-ck): строки фильтруются по набранным буквам, выбранная марка сужает
     список моделей, выбранная модель — список поколений. Поле остаётся текстовым, поэтому
     значение можно и выбрать, и напечатать своё — машины, которой у дилера ещё не было.
     Данные — JSON [data-sell-catalog] из lib/car-catalog.mjs (марки каталога + 166 марок av.by,
     модели и поколения — по опубликованным объявлениям). Без JS поля работают как раньше:
     подсказки дают <datalist> той же страницы. */
  function initCombos() {
    var host = document.querySelector('[data-sell-catalog="1"]');
    if (!host) return;
    var cat = null;
    try { cat = JSON.parse(host.textContent); } catch (e) { return; }
    if (!cat || !cat.brands) return;

    var CHEV = '<svg class="sel-ar" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var CHECK = '<svg class="sel-ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    var opened = null;
    var seq = 0;
    var api = {};

    /* Ключ без регистра и диакритики: «Citroen» находит модели марки «Citroën». */
    function key(v) {
      return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().toLowerCase().replace(/\s+/g, ' ');
    }
    function val(kind) { return api[kind] ? api[kind].input.value.trim() : ''; }
    function node(brand) {
      if (!brand || !cat.tree) return null;
      if (cat.tree[brand]) return cat.tree[brand];
      var k = key(brand);
      var names = Object.keys(cat.tree);
      for (var i = 0; i < names.length; i++) if (key(names[i]) === k) return cat.tree[names[i]];
      return null;
    }
    function pick(map, name) {
      if (!map || !name) return null;
      if (map[name]) return map[name];
      var k = key(name);
      for (var n in map) if (key(n) === k) return map[n];
      return null;
    }
    /* Каталог av.by (public/data/avby): 220 марок, ~2850 моделей и ~12000 поколений с фото и
       годами выпуска. Целиком в разметку это не влезает, поэтому марки берём из index.json,
       а модели с поколениями — файлом выбранной марки (он кэшируется браузером). */
    var avby = { map: null, byBrand: {}, asked: {} };

    function sorted(list) {
      return list.sort(function (a, b) { return String(a).localeCompare(String(b), 'ru'); });
    }

    function avbyIndex() {
      if (avby.map || avby.asked.index) return;
      avby.asked.index = true;
      fetch('/data/avby/index.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var map = {};
        ((j && j.brands) || []).forEach(function (b) { map[key(b.name)] = b; });
        avby.map = map;
        if (opened) opened.rebuild();
      }).catch(function () { avby.map = {}; });
    }

    /* Модели марки из каталога av.by; null — файл марки ещё не приехал (или марки там нет). */
    function avbyModels(brand) {
      if (avby.map === null) { avbyIndex(); return null; }
      var b = avby.map[key(brand)];
      if (!b) return null;
      if (avby.byBrand[b.slug]) return avby.byBrand[b.slug];
      if (!avby.asked[b.slug]) {
        avby.asked[b.slug] = true;
        fetch('/data/avby/' + b.slug + '.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          avby.byBrand[b.slug] = (j && j.models) || {};
          if (opened) opened.rebuild();
        }).catch(function () { avby.byBrand[b.slug] = {}; });
      }
      return null;
    }

    function avbyLoading(brand) {
      if (!brand || !avby.map) return false;
      var b = avby.map[key(brand)];
      return !!(b && !avby.byBrand[b.slug]);
    }

    /* Подсказки поля: у марки — весь словарь, у модели — модели выбранной марки, у поколения —
       поколения выбранной пары. Пустой список — не ошибка: значение вводят руками.
       Элемент списка — строка (из базы дилера) или {t: название, y: годы, p: фото} (каталог av.by). */
    function items(kind) {
      if (kind === 'brand') {
        var list = (cat.brands || []).slice();
        if (avby.map) {
          var seen = {};
          list.forEach(function (n) { seen[key(n)] = 1; });
          for (var k in avby.map) if (!seen[k]) list.push(avby.map[k].name);
        }
        return sorted(list);
      }
      var tree = node(val('brand'));
      var am = avbyModels(val('brand'));
      if (kind === 'model') {
        var models = tree ? Object.keys(tree).slice() : [];
        if (am) {
          var have = {};
          models.forEach(function (n) { have[key(n)] = 1; });
          for (var m in am) if (!have[key(m)]) models.push(m);
        }
        return sorted(models);
      }
      var gens = (pick(tree, val('model')) || []).slice();
      var extra = am ? pick(am, val('model')) : null;
      if (extra) {
        var known = {};
        gens.forEach(function (g) { known[key(typeof g === 'string' ? g : g.t)] = 1; });
        extra.forEach(function (g) {
          if (!known[key(g[0])]) gens.push({ t: g[0], y: g[1] || '', p: g[2] || '' });
        });
      }
      return gens;
    }
    /* Марка сменилась — чистим только то, что перестало подходить: чужую модель и её поколение. */
    function cascade(kind) {
      function has(kind2, value) {
        return !!value && items(kind2).some(function (n) {
          return (typeof n === 'string' ? n : n.t) === value;
        });
      }
      if (kind === 'brand') {
        if (!has('model', val('model'))) {
          if (api.model) api.model.input.value = '';
          if (api.generation) api.generation.input.value = '';
        } else if (!has('generation', val('generation')) && api.generation) {
          api.generation.input.value = '';
        }
      } else if (!has('generation', val('generation')) && api.generation) {
        api.generation.input.value = '';
      }
    }

    $$('[data-combo]').forEach(function (field) {
      var kind = field.getAttribute('data-combo');
      if (kind !== 'brand' && kind !== 'model' && kind !== 'generation') return;
      var input = field.querySelector('[data-combo-input]') || field.querySelector('input');
      if (!input) return;
      /* Системные подсказки больше не нужны: список рисуем сами. */
      input.removeAttribute('list');

      var wrap = document.createElement('div');
      wrap.className = 'sel combo-sel';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      input.classList.add('sel-input');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      wrap.insertAdjacentHTML('beforeend', '<span class="combo-ar">' + CHEV + '</span>');

      var pop = document.createElement('div');
      pop.className = 'sel-pop';
      pop.id = 'combo-pop-' + (++seq);
      pop.setAttribute('role', 'listbox');
      pop.hidden = true;
      input.setAttribute('aria-controls', pop.id);
      wrap.appendChild(pop);

      var active = -1;
      /* Пока идут программные события выбора, список не раскрываем заново. */
      var quiet = false;
      var self = { wrap: wrap, input: input, shut: shut, place: place };

      function rows() { return $$('.sel-opt', pop); }

      function hint() {
        if (kind === 'brand') return 'Ничего не найдено — марку можно ввести вручную';
        if (!val('brand')) return 'Сначала выберите марку или введите свою';
        if (avbyLoading(val('brand'))) return 'Загружаю каталог av.by…';
        if (kind === 'model') return 'Моделей этой марки в каталоге нет — введите вручную';
        if (!val('model')) return 'Сначала выберите модель';
        return 'Поколений этой модели в каталоге нет — введите вручную';
      }

      /* Строки: подсказки, отфильтрованные по набранному, плюс строка-объяснение, когда их нет.
         По клику фильтра нет — открывается весь список с выделенным текущим значением, как в
         панели поиска; фильтр включается только когда в поле начали печатать. */
      function build(query) {
        pop.innerHTML = '';
        var q = String(query == null ? '' : query).trim().toLowerCase();
        var cur = input.value.trim();
        var list = items(kind);
        var shown = 0;
        for (var i = 0; i < list.length && shown < 200; i++) {
          var item = list[i];
          var obj = item && typeof item === 'object';
          var name = obj ? item.t : item;
          if (q && String(name).toLowerCase().indexOf(q) === -1) continue;
          var row = document.createElement('div');
          row.className = 'sel-opt' + (obj && item.p ? ' opt-photo' : '');
          row.id = pop.id + '-' + shown;
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', name === cur ? 'true' : 'false');
          row.setAttribute('data-v', name);
          if (obj) {
            /* Строка каталога av.by: снимок поколения, название и годы выпуска. */
            row.setAttribute('aria-label', item.y ? name + ', ' + item.y : name);
            if (item.p) {
              var im = document.createElement('img');
              im.className = 'opt-img';
              im.src = item.p;
              im.alt = '';
              im.width = 54;
              im.height = 38;
              im.loading = 'lazy';
              im.decoding = 'async';
              row.appendChild(im);
            }
            var box = document.createElement('span');
            box.className = 'opt-tx';
            var t2 = document.createElement('span');
            t2.className = 'sel-tx';
            t2.textContent = name;
            box.appendChild(t2);
            if (item.y) {
              var yrs = document.createElement('span');
              yrs.className = 'opt-years';
              /* Годы — отдельным рядом под названием, как подпись поколения на av.by. */
              yrs.textContent = item.y;
              box.appendChild(yrs);
            }
            row.appendChild(box);
          } else {
            var t = document.createElement('span');
            t.className = 'sel-tx';
            t.textContent = name;
            row.appendChild(t);
          }
          row.insertAdjacentHTML('beforeend', CHECK);
          pop.appendChild(row);
          shown++;
        }
        if (!shown) {
          var off = document.createElement('div');
          off.className = 'sel-opt is-off';
          off.setAttribute('role', 'option');
          off.setAttribute('aria-disabled', 'true');
          off.textContent = hint();
          pop.appendChild(off);
        }
        return shown;
      }

      function mark(i) {
        active = i;
        rows().forEach(function (r, n) { r.classList.toggle('on', n === i); });
        if (i >= 0 && rows()[i]) input.setAttribute('aria-activedescendant', rows()[i].id);
        else input.removeAttribute('aria-activedescendant');
      }

      function first() {
        var list = rows();
        for (var i = 0; i < list.length; i++) if (list[i].getAttribute('aria-selected') === 'true') return i;
        return list.length ? 0 : -1;
      }

      /* Списки марок, моделей и поколений длинные (марок — 166), поэтому потолок здесь не 302,
         а 60 % видимой высоты окна (placePop считает сам): на телефоне это ~480 px вместо
         прежних 302 px — видно вдвое больше марок сразу. */
      function place() {
        return placePop(wrap, pop, input);
      }

      function openPop() {
        if (opened && opened !== self) opened.shut();
        var shown = build('');
        pop.hidden = false;
        wrap.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        place();
        mark(shown ? first() : -1);
        var cur = rows()[active];
        if (cur) cur.scrollIntoView({ block: 'nearest' });
        opened = self;
      }

      function shut() {
        if (pop.hidden) return;
        pop.hidden = true;
        pop.style.maxHeight = '';
        wrap.classList.remove('sel--up', 'is-open');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
        if (opened === self) opened = null;
      }

      /* Перерисовать уже открытый список: подъехали марки, модели или поколения каталога av.by. */
      self.rebuild = function () {
        if (pop.hidden) return;
        var keep = active;
        var shown = build('');
        place();
        mark(shown ? (keep >= 0 && keep < rows().length ? keep : first()) : -1);
      };

      /* Выбор строки: значение уходит в поле, список сворачивается и больше не раскрывается
         сам — событие input ниже шлём в «тихом» режиме (заказчик 2026-09-29: «чтобы список
         при выборе значения сворачивался»). */
      function commit(i) {
        var row = rows()[i];
        if (!row || row.classList.contains('is-off')) return;
        var v = row.getAttribute('data-v');
        input.value = v;
        shut();
        quiet = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        quiet = false;
        cascade(kind);
        input.focus();
        shut();
      }

      function move(step) {
        var list = rows();
        if (!list.length) return;
        var i = active;
        for (var n = 0; n < list.length; n++) {
          i += step;
          if (i < 0) i = list.length - 1;
          if (i > list.length - 1) i = 0;
          if (!list[i].classList.contains('is-off')) break;
        }
        mark(i);
        list[i].scrollIntoView({ block: 'nearest' });
      }

      api[kind] = self;

      input.addEventListener('focus', openPop);
      input.addEventListener('click', function () { if (pop.hidden) openPop(); });
      input.addEventListener('input', function () {
        if (quiet) return;
        if (pop.hidden) openPop();
        else { var shown = build(input.value); mark(shown ? first() : -1); place(); }
      });
      /* Уход фокуса закрывает список, но клик по строке успевает её выбрать: он идёт раньше
         таймера, а выбор возвращает фокус полю. */
      input.addEventListener('blur', function () {
        setTimeout(function () { if (opened === self && document.activeElement !== input) shut(); }, 120);
      });

      input.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'Escape') { if (!pop.hidden) { e.preventDefault(); shut(); } return; }
        if (k === 'Tab') { shut(); return; }
        if (k === 'Enter') {
          /* Enter в закрытом поле не трогаем — он отправляет форму, как и раньше. */
          if (!pop.hidden && active >= 0) { e.preventDefault(); commit(active); }
          return;
        }
        if (k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          if (pop.hidden) openPop(); else move(k === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (!pop.hidden && k === 'Home') { e.preventDefault(); mark(0); return; }
        if (!pop.hidden && k === 'End') {
          e.preventDefault();
          var last = rows().length - 1;
          mark(last);
          var r = rows()[last];
          if (r) r.scrollIntoView({ block: 'nearest' });
        }
      });

      pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
      pop.addEventListener('click', function (e) {
        /* Поле живёт внутри <label>: если не отменить клик, браузер после выбора строки
           синтезирует клик по input, и список раскрывается снова (заказчик 2026-09-29). */
        e.preventDefault();
        var row = e.target.closest ? e.target.closest('.sel-opt') : null;
        if (!row) return;
        commit(rows().indexOf(row));
      });
      pop.addEventListener('mousemove', function (e) {
        var row = e.target.closest ? e.target.closest('.sel-opt') : null;
        if (!row) return;
        var i = rows().indexOf(row);
        if (i !== active) mark(i);
      });
    });

    document.addEventListener('click', function (e) {
      if (opened && !opened.wrap.contains(e.target)) opened.shut();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && opened) opened.shut(); });
    /* Окно изменилось (в том числе клавиатура на телефоне) — список не закрываем, а
       переставляем: он остаётся у поля и получает всё свободное место. */
    watchViewport(function () { if (opened) opened.place(); });

    /* Каталог av.by подтягиваем сразу: к первому клику по полю список марок уже полный. */
    avbyIndex();
  }

  /* ── бронь автомобиля ────────────────────────────────── */
  function initCarBook() {
    var back = $('[data-book-modal]');
    if (!back) return;
    var form = back.querySelector('[data-book-form]');
    var sub = back.querySelector('[data-book-sub]');
    var subDefault = sub ? sub.textContent : '';
    var lastFocus = null;

    function open(id, title) {
      lastFocus = document.activeElement;
      var ci = form.querySelector('[name=car_id]');
      var tx = form.querySelector('[name=text]');
      if (ci) ci.value = id || '';
      if (tx) tx.value = title ? 'Бронь: ' + title : '';
      if (sub) sub.textContent = title
        ? title + ' — закрепим за вами и позвоним в течение 15 минут.'
        : subDefault;
      back.hidden = false;
      back.classList.add('is-open');
      document.body.classList.add('modal-open');
      setTimeout(function () {
        var f = form.querySelector('input[name=name]');
        if (f) f.focus();
      }, 60);
    }

    function close() {
      back.classList.remove('is-open');
      back.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-car-book]');
      if (!b) return;
      e.preventDefault();
      open(b.getAttribute('data-book-id'), b.getAttribute('data-book-title') || '');
    });

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-book-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) close();
    });

    form.addEventListener('submit', function (e) {
      if (!form.checkValidity()) return;
      e.preventDefault();
      var fd = new FormData(form);
      var comment = fd.get('comment');
      if (comment) fd.set('text', (fd.get('text') || '') + (fd.get('text') ? ' · ' : '') + comment);
      fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(fd),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
        .then(function () {
          close();
          form.reset();
          toast('Заявка на бронь отправлена — менеджер позвонит');
        })
        .catch(function () { form.submit(); });
    });
  }

  /* ── заказ звонка ──────────────────────────────────────
     Заказчик, 2026-09-28: «над кнопкой разместить объявление на титульной странице размести
     кнопку заказать звонок и чтобы при нажатии открывалась окно как на кнопке бронь». Работает
     ровно как бронь (initCarBook): открытие по кнопке с data-call-open, закрытие по крестику,
     клику по фону и Escape, отправка формы на /lead без перезагрузки страницы. Разметка окна —
     lib/view.mjs: callModalHtml. */
  function initCallModal() {
    var back = $('[data-call-modal]');
    if (!back) return;
    var form = back.querySelector('[data-call-form]');
    if (!form) return;
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      back.hidden = false;
      back.classList.add('is-open');
      document.body.classList.add('modal-open');
      setTimeout(function () {
        var f = form.querySelector('input[name=name]');
        if (f) f.focus();
      }, 60);
    }

    function close() {
      back.classList.remove('is-open');
      back.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-call-open]');
      if (!b) return;
      e.preventDefault();
      open();
    });

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-call-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) close();
    });

    form.addEventListener('submit', function (e) {
      if (!form.checkValidity()) return;
      e.preventDefault();
      var fd = new FormData(form);
      var comment = fd.get('comment');
      if (comment) fd.set('text', (fd.get('text') || '') + (fd.get('text') ? ' · ' : '') + comment);
      fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(fd),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
        .then(function () {
          close();
          form.reset();
          toast('Заявка на звонок отправлена — перезвоним в течение 15 минут');
        })
        .catch(function () { form.submit(); });
    });
  }

  /* ── связь с продавцом на странице автомобиля ──────────
     Заказчик, 2026-09-29: «на страницах автомобилей сделай так чтобы при нажатии на кнопки
     позвонить продавцу Отправить сообщение предложить цену, чтобы всплывало прозрачное окно по
     нашему стилю». Заказчик, 2026-09-30: «Позвонить продавцу, сделай, чтобы был только набор
     номера, раскрывающееся окно оставь только для — отправить сообщение и предложить цену».
     Поэтому окно открывают только «Отправить сообщение» и «Предложить цену» (две вкладки), а
     «Позвонить продавцу» — обычная ссылка tel: без обработчика: JS её не перехватывает вовсе.
     Разметка окна — lib/view.mjs: carContactModalHtml, вид и механика — те же, что у брони и
     заказа звонка: .modal-back с полупрозрачным фоном и размытием, закрытие по крестику, клику
     по фону и Escape, подстановка car_id уже в разметке, отправка на /lead без перезагрузки. */
  function initCarContact() {
    var back = $('[data-car-contact]');
    if (!back) return;
    var lastFocus = null;
    var TITLES = {
      message: 'Сообщение отправлено — ответим в рабочее время',
      offer: 'Цена отправлена продавцу — свяжемся с ответом',
    };

    /* Вкладка — та же механика, что в окне входа (initAuthModal): класс .on на кнопке и
       скрытие чужой панели через hidden. Открытие сразу ставит поле с курсором на нужной
       вкладке: «Предложить цену» — поле цены, «Отправить сообщение» — имя. */
    function pane(tab) {
      var name = TITLES[tab] ? tab : 'message';
      back.querySelectorAll('[data-car-contact-pane]').forEach(function (p) {
        p.hidden = p.getAttribute('data-car-contact-pane') !== name;
      });
      back.querySelectorAll('[data-car-contact-tab]').forEach(function (b) {
        var on = b.getAttribute('data-car-contact-tab') === name;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var active = back.querySelector('[data-car-contact-pane="' + name + '"]');
      var first = active && active.querySelector('input:not([type=hidden]):not([name=phone])');
      if (first) setTimeout(function () { first.focus(); }, 60);
    }

    function open(tab) {
      lastFocus = document.activeElement;
      back.hidden = false;
      back.classList.add('is-open');
      document.body.classList.add('modal-open');
      pane(tab);
    }

    function close() {
      back.classList.remove('is-open');
      back.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-car-contact-open]');
      if (!b) return;
      /* Открывающие кнопки — только «Отправить сообщение» и «Предложить цену»; у ссылки
         «Позвонить продавцу» атрибута нет, её нажатие обрабатывает браузер (набор номера). */
      e.preventDefault();
      open(b.getAttribute('data-car-contact-open') || 'message');
    });

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-car-contact-close]')) { close(); return; }
      var t = e.target.closest('[data-car-contact-tab]');
      if (t) pane(t.getAttribute('data-car-contact-tab'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) close();
    });

    back.querySelectorAll('[data-car-contact-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        if (!form.checkValidity()) return;
        e.preventDefault();
        var what = form.getAttribute('data-car-contact-form');
        var fd = new FormData(form);
        var comment = fd.get('comment');
        /* Комментарий приписываем к теме заявки: полем text админка показывает, о чём заявка,
           а comment в базе не хранится отдельной колонкой. */
        if (comment) fd.set('text', (fd.get('text') || '') + ' · ' + comment);
        fetch(form.action, {
          method: 'POST',
          body: new URLSearchParams(fd),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
          .then(function () {
            form.reset();
            toast(TITLES[what] || TITLES.message);
            close();
          })
          .catch(function () { form.submit(); });
      });
    });
  }

  /* ── телефон: +375 стоит в поле всегда ────────────────────────────────
     Код страны — часть значения поля (уходит на сервер вместе с номером),
     стереть его нельзя, а остальные цифры раскладываются по маске
     «XX XXX XX XX» прямо при вводе и при вставке из буфера. Без JS поле
     остаётся пустым с подсказкой-маской, то есть формы работают как раньше. */
  var PHONE_CODE = '+375';
  var PHONE_CODE_LEN = PHONE_CODE.length + 1;      /* «+375 » — 5 знаков, курсор ближе не пускаем */

  function phoneGroup(d) {                          /* 291112233 → «29 111 22 33» */
    var out = d.slice(0, 2);
    if (d.length > 2) out += ' ' + d.slice(2, 5);
    if (d.length > 5) out += ' ' + d.slice(5, 7);
    if (d.length > 7) out += ' ' + d.slice(7, 9);
    return out;
  }

  /* Канонический вид «+375 XX XXX XX XX». Национальная запись (29…, 029…,
     80 29…) получает код страны; чужой код (+7 и т. п.) не трогаем — иначе
     испортим номер, который человек ввёл осознанно. */
  function phoneCanon(raw) {
    var v = String(raw == null ? '' : raw).trim();
    var d = v.replace(/\D/g, '');
    if (!d) return PHONE_CODE + ' ';
    if (d.indexOf('375') === 0) d = d.slice(3);
    else if (d.indexOf('80') === 0) d = d.slice(2);
    else if (d.charAt(0) === '0') d = d.slice(1);
    /* чужой код страны (его приносят автозаполнение или профиль) не переписываем */
    else if (v.charAt(0) === '+' || d.length > 9) return v;
    return PHONE_CODE + ' ' + phoneGroup(d.slice(0, 9));
  }

  function phoneNational(el) {                       /* цифр после кода страны; 9 = полный номер */
    var d = String(el.value || '').replace(/\D/g, '');
    if (d.indexOf('375') === 0) d = d.slice(3);
    return d.length;
  }

  /* Стирать код нельзя: за курсором в префиксе следим отдельно. */
  function phoneCaret(el, digits) {
    var v = el.value, seen = 0, i = 0;
    for (; i < v.length; i++) {
      if (v.charAt(i) >= '0' && v.charAt(i) <= '9') { seen++; if (seen === digits) { i++; break; } }
    }
    try { el.setSelectionRange(i, i); } catch (err) { /* поле без выделения — не беда */ }
  }
  function phoneDigitsBefore(el) {
    return String(el.value.slice(0, el.selectionStart)).replace(/\D/g, '').length;
  }

  function phoneSync(el, keepCaret) {
    var before = keepCaret && typeof el.selectionStart === 'number' ? phoneDigitsBefore(el) : null;
    var v = phoneCanon(el.value);
    if (v !== el.value) el.value = v;
    if (before !== null) {
      phoneCaret(el, before);
      if (el.selectionStart < PHONE_CODE_LEN) phoneCaret(el, el.value.replace(/\D/g, '').length);
    }
    phoneCheck(el);
  }

  /* Пустой или недобранный номер не пропускаем: иначе «+375 » уедет в заявку. */
  function phoneCheck(el) {
    var n = phoneNational(el);
    if (!n) el.setCustomValidity(el.required ? 'Введите номер телефона: +375 XX XXX XX XX' : '');
    else if (n < 9) el.setCustomValidity('Номер неполный — введите все 9 цифр после +375');
    else el.setCustomValidity('');
  }

  function initPhone() {
    $$('input[type=tel]').forEach(function (el) { phoneSync(el, false); });

    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el || el.type !== 'tel') return;
      if (!el.value.trim()) el.value = PHONE_CODE + ' ';
      setTimeout(function () { phoneCaret(el, 99); }, 0);   /* печатать удобнее с конца номера */
    });

    document.addEventListener('input', function (e) {
      if (e.target && e.target.type === 'tel') phoneSync(e.target, true);
    });

    document.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el || el.type !== 'tel' || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
      var start = el.selectionStart, end = el.selectionEnd;
      if (start === null || start > PHONE_CODE_LEN || end > PHONE_CODE_LEN) return;
      e.preventDefault();                            /* код страны не стирается — курсор идёт в конец */
      phoneCaret(el, el.value.replace(/\D/g, '').length);
    });

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.querySelectorAll) return;
      $$('input[type=tel]', form).forEach(function (el) {
        phoneSync(el, false);
        if (!phoneNational(el)) el.value = '';        /* один код без номера не отправляем */
      });
    }, true);

    document.addEventListener('blur', function (e) {
      if (e.target && e.target.type === 'tel') phoneCheck(e.target);
    }, true);
  }

  /* ── догрузка каталога по кнопке ─────────────────────── */
  /* Кнопок страниц на выдаче нет — есть прозрачная кнопка «Показать ещё» и подпись рядом с ней
     (`.cars-more` из lib/view.mjs). Заказчик 2026-09-28 переиграл прежнюю нескончаемую ленту:
     «Сделай прозрачную кнопку — Показать ещё, и рядом приписка На странице 20 объявлений из 57
     или сколько там у нас, и показывай 20 карточек авто». Поэтому прокрутка больше ничего не
     запрашивает: следующую партию готовых карточек забирают у сервера (`/api/cars/cards`) только
     по клику и дописывают в ту же сетку `.cars`, а подпись пересчитывается (показано = партия ×
     страница). Номер страницы в адресе не меняется. На случай медленной или упавшей сети в
     коробке есть скрытая кнопка повтора; когда карточки кончились — строка «Показаны все N
     автомобилей», а кнопка с подписью уходят. */
  function initInfinite() {
    var box = $('[data-more]');
    var grid = $('.cars');
    if (!box || !grid) return;
    var row = $('[data-more-row]', box);
    var btn = $('[data-more-btn]', box);
    var countLine = $('[data-more-count]', box);
    var end = $('[data-more-end]', box);
    var spin = $('[data-more-spin]', box);
    var fail = $('[data-more-fail]', box);
    var retry = $('[data-more-retry]', box);
    var page = Number(box.getAttribute('data-page')) || 1;
    var pages = Number(box.getAttribute('data-pages')) || 1;
    var total = Number(box.getAttribute('data-total')) || 0;
    var perPage = Number(box.getAttribute('data-per-page')) || 20;
    var query = box.getAttribute('data-query') || '';
    var busy = false;

    /* Подпись считаем той же арифметикой, что и сервер (carsMore в lib/view.mjs): показано =
       партия × номер страницы, но не больше всего. Тысячи разделяем пробелом — как fmt в
       lib/cars.mjs, иначе 1 000 объявлений выглядели бы иначе, чем в остальных счётчиках. */
    function fmtNum(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function word(n) {
      var a = Math.abs(n) % 100, b = a % 10;
      if (a > 10 && a < 20) return 'объявлений';
      if (b === 1) return 'объявление';
      if (b >= 2 && b <= 4) return 'объявления';
      return 'объявлений';
    }
    function count() {
      if (!countLine) return;
      var shown = total ? Math.min(page * perPage, total) : page * perPage;
      countLine.textContent = 'На странице ' + fmtNum(shown) + ' ' + word(shown) + ' из ' + fmtNum(total);
    }
    function finish() {
      if (row) row.hidden = true;
      if (end) end.hidden = false;
    }
    function load() {
      if (busy || page >= pages) return;
      busy = true;
      if (fail) fail.hidden = true;
      if (row) row.hidden = true;
      if (spin) spin.hidden = false;
      var next = page + 1;
      fetch('/api/cars/cards?page=' + next + (query ? '&' + query : ''))
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          if (d && d.html) grid.insertAdjacentHTML('beforeend', d.html);
          page = Number(d && d.page) || next;
          pages = Number(d && d.pages) || pages;
          total = Number(d && d.total) || total;
          box.setAttribute('data-page', page);
          /* Карточки приходят готовой разметкой — навешиваем на них то же поведение, что на
             первые: избранное, сравнение, карусель фотографий (только на новую сетку). */
          initFav(grid);
          initCompare(grid);
          initCarousels(grid);
          syncCounters();
        })
        .catch(function () { if (fail) fail.hidden = false; })
        .then(function () {
          busy = false;
          if (spin) spin.hidden = true;
          /* Партия не пришла — возвращаем кнопку, чтобы попытку можно было повторить. */
          if (page >= pages) finish();
          else if (row) row.hidden = false;
          count();
        });
    }

    if (page >= pages) { finish(); return; }
    count();
    if (btn) btn.addEventListener('click', load);
    if (retry) retry.addEventListener('click', load);
  }

  /* ── загрузка фотографий: своя кнопка и перетаскивание из папок ────── */
  /* Просьба заказчика 2026-09-27: «переработай кнопку выбрать файлы по стилю сайта, а также
     предусмотри возможность перетягивания файлов с папок компьютера». Системную кнопку
     «Выбрать файлы» заменила зона .upload-zone (public/assets/css/site.css), а сюда пришла её
     логика: перетащенные файлы складываются в настоящее поле формы (input[name=photos]) через
     DataTransfer, поэтому объявление уходит на сервер тем же POST-ом multipart/form-data.
     Брошенную папку читаем рекурсивно (webkitGetAsEntry) — тащить папку с фотографиями удобнее,
     чем десять отдельных файлов. Промах мимо зоны гасим на уровне документа: иначе браузер
     открыл бы брошенный файл вместо страницы. */
  function initUploads() {
    var MAX = 10;
    var boxes = $$('[data-upload]');
    if (!boxes.length) return;

    function fileKey(f) { return f.name + ':' + f.size + ':' + (f.lastModified || 0); }
    function isImage(f) { return /^image\//.test(f.type || ''); }
    function readable(n) {
      return n >= 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
    }
    function hasFiles(e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
    }

    /* Папка из проводника: обходим вложенные каталоги и собираем файлы. */
    function walk(entry) {
      if (entry.isFile) {
        return new Promise(function (res) { entry.file(function (f) { res([f]); }, function () { res([]); }); });
      }
      if (!entry.isDirectory) return Promise.resolve([]);
      return new Promise(function (res) {
        var reader = entry.createReader();
        var acc = [];
        (function read() {
          reader.readEntries(function (batch) {
            if (!batch.length) { res(acc); return; }
            acc = acc.concat(batch);
            read();
          }, function () { res(acc); });
        })();
      }).then(function (kids) {
        return Promise.all(kids.map(function (k) { return walk(k); })).then(function (groups) {
          return groups.reduce(function (a, b) { return a.concat(b); }, []);
        });
      });
    }

    function readDrop(dt) {
      var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
      var jobs = [];
      items.forEach(function (it) {
        if (it.kind && it.kind !== 'file') return;
        var get = it.webkitGetAsEntry || it.getAsEntry;
        var entry = null;
        if (get) { try { entry = get.call(it); } catch (err) { entry = null; } }
        if (entry) { jobs.push(walk(entry)); return; }
        var f = it.getAsFile ? it.getAsFile() : null;
        jobs.push(Promise.resolve(f ? [f] : []));
      });
      if (!jobs.length) return Promise.resolve(Array.prototype.slice.call((dt && dt.files) || []));
      return Promise.all(jobs).then(function (groups) {
        return groups.reduce(function (a, b) { return a.concat(b); }, []);
      });
    }

    boxes.forEach(function (box) {
      var zone = $('[data-upload-zone]', box);
      var input = $('[data-upload-input]', box);
      var list = $('[data-upload-list]', box);
      var count = $('[data-upload-count]', box);
      var note = $('[data-upload-err]', box);
      if (!zone || !input || !list) return;

      var picked = [];       // File[] — ровно то, что уйдёт на сервер
      var urls = [];         // превью-ссылки, чтобы не копить их при каждой перерисовке
      var depth = 0;         // счётчик dragenter/dragleave: у зоны есть дочерние элементы
      var dt = typeof DataTransfer === 'function' ? new DataTransfer() : null;

      function sync() {
        if (!dt) return;     // без DataTransfer остаётся системный выбор файлов
        dt.items.clear();
        picked.forEach(function (f) { dt.items.add(f); });
        input.files = dt.files;
      }
      function say(msg) {
        if (!note) return;
        note.textContent = msg || '';
        note.classList.toggle('hide', !msg);
      }
      function render() {
        urls.forEach(function (u) { URL.revokeObjectURL(u); });
        urls = [];
        list.innerHTML = '';
        picked.forEach(function (f, i) {
          var li = document.createElement('li');
          li.className = 'upload-item';
          var img = document.createElement('img');
          img.alt = f.name;
          if (window.URL && URL.createObjectURL && isImage(f)) {
            var u = URL.createObjectURL(f);
            urls.push(u);
            img.src = u;
          }
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'upload-del';
          del.title = 'Убрать файл';
          del.setAttribute('aria-label', 'Убрать файл ' + f.name);
          del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
          del.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            picked.splice(i, 1);
            sync(); render(); say('');
          });
          var name = document.createElement('span');
          name.className = 'upload-name';
          name.textContent = f.name;
          name.title = f.name + ' · ' + readable(f.size);
          li.appendChild(img);
          li.appendChild(del);
          li.appendChild(name);
          list.appendChild(li);
        });
        if (count) count.textContent = picked.length + ' из ' + MAX;
      }
      function add(files) {
        var incoming = Array.prototype.slice.call(files || []);
        if (!incoming.length) return;
        var bad = incoming.filter(function (f) { return !isImage(f); });
        var seen = {};
        picked.forEach(function (f) { seen[fileKey(f)] = 1; });
        var added = 0; var dup = 0;
        incoming.forEach(function (f) {
          if (!isImage(f)) return;
          if (seen[fileKey(f)]) { dup++; return; }
          if (picked.length >= MAX) return;
          seen[fileKey(f)] = 1;
          picked.push(f);
          added++;
        });
        var cut = incoming.filter(isImage).length - added - dup;
        sync(); render();
        var msgs = [];
        if (bad.length) msgs.push('Пропущено не изображений: ' + bad.length);
        if (dup) msgs.push('Повторы пропущены: ' + dup);
        if (cut > 0) msgs.push('Больше ' + MAX + ' фотографий не принять — лишние пропущены');
        say(msgs.join('. '));
      }

      /* Поле прячется за зоной, но остаётся в форме: клик по зоне открывает системный выбор,
         Enter и пробел работают с клавиатуры. */
      input.tabIndex = -1;
      zone.addEventListener('click', function () { input.click(); });
      zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', function () { add(input.files); });

      zone.addEventListener('dragenter', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth++;
        zone.classList.add('is-over');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      zone.addEventListener('dragover', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      zone.addEventListener('dragleave', function () {
        depth--;
        if (depth <= 0) { depth = 0; zone.classList.remove('is-over'); }
      });
      zone.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        zone.classList.remove('is-over');
        readDrop(e.dataTransfer).then(add);
      });
    });

    /* Файл, брошенный мимо зоны, браузер иначе открыл бы вместо страницы. */
    ['dragover', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (!hasFiles(e)) return;
        if (e.target && e.target.closest && e.target.closest('[data-upload]')) return;
        e.preventDefault();
      });
    });
  }

  /* «Комплектация» в форме объявления (заказчик 2026-09-27: «чтобы можно было выбирать
     комплектацию и её содержимое»). Комплектации и наборы опций приходят из справочника
     lib/car-options.mjs в JSON рядом с панелью ([data-sell-trims]): выбор комплектации отмечает
     входящие в неё опции, дальше список правится вручную, а строка под заголовком показывает,
     что именно входит в набор. Название комплектации подставляется в поле «Своё название» — его
     можно поправить, тогда на сервер уйдёт правка. Без JavaScript панель остаётся обычным списком
     чекбоксов: их видно и можно отметить руками. */
  function initSellTrim() {
    var host = $('[data-sell-trim]');
    if (!host) return;
    var raw = document.querySelector('[data-sell-trims]');
    var trims = [];
    try { trims = JSON.parse(raw ? raw.textContent : '[]'); } catch (e) { trims = []; }
    var sel = $('[data-trim-select]', host);
    var nameInput = $('[data-trim-name]', host);
    var grid = $('[data-options-grid]', host);
    var count = $('[data-options-count]', host);
    var sum = $('[data-options-sum]', host);
    if (!sel || !grid) return;
    var boxes = $$('input[name=options]', grid);
    var HINT = 'Выберите комплектацию — её опции отметятся сами, дальше список можно поправить.';

    function opts(n) {
      var d = n % 10, dd = n % 100;
      if (d === 1 && dd !== 11) return n + ' опция';
      if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' опции';
      return n + ' опций';
    }
    function picked() {
      return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    }
    function trim() {
      for (var i = 0; i < trims.length; i++) if (trims[i].id === sel.value) return trims[i];
      return null;
    }
    function sameAs(t) {
      var a = t.options.slice().sort().join('\u0000');
      var b = picked().sort().join('\u0000');
      return a === b;
    }
    function short(list) {
      return list.slice(0, 6).join(', ') + (list.length > 6 ? ' и ещё ' + (list.length - 6) : '');
    }
    function paint() {
      var list = picked();
      var n = list.length;
      var t = trim();
      if (count) {
        count.textContent = n ? opts(n) : 'Опции не выбраны';
        count.classList.toggle('has-sel', n > 0);
      }
      if (!sum) return;
      if (!n) sum.textContent = HINT;
      else if (t && t.id !== 'custom' && sameAs(t)) sum.textContent = 'Комплектация «' + t.name + '»: ' + short(list) + '.';
      else sum.textContent = 'Свой набор: ' + short(list) + '.';
    }
    function check(list) {
      var on = {};
      list.forEach(function (v) { on[v] = 1; });
      boxes.forEach(function (b) { b.checked = !!on[b.value]; });
    }

    sel.addEventListener('change', function () {
      var t = trim();
      if (t && t.id === 'custom') {
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      } else if (t) {
        check(t.options);
        if (nameInput) nameInput.value = t.name;
      }
      paint();
    });
    grid.addEventListener('change', paint);
    var all = $('[data-options-all]', host);
    var none = $('[data-options-none]', host);
    if (all) all.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = true; }); paint(); });
    if (none) none.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); paint(); });
    paint();
  }

  function ready() {
    initPhone();
    /* Слайдер «Горящей продажи» идёт первым: он достраивает копии крайних карточек, и карусели
       кадров внутри копий должны попасть в общий проход initCarousels ниже. */
    initHotSliders();
    initCarousels();
    initGallery();
    initCarExtras();
    initFav();
    initCompare();
    initFilters();
    initCalc();
    initChrome();
    initLeadForms();
    initAuthModal();
    initParamSearch();
    initMoreToggle();
    initSelects();
    initCombos();
    initCarBook();
    initCallModal();
    initCarContact();
    initInfinite();
    initUploads();
    initSellTrim();
    syncCounters();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
