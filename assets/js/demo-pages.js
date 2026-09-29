/* Демонстрационная копия сайта на GitHub Pages: серверной части здесь нет. */
(function () {
  var PAGES = ["/","/cars","/cars-used","/cars-new","/electric","/services","/news","/kalkulyator","/contacts","/cars-sold","/reviews","/car/geely-emgrand-ii-139143093","/car/audi-q5-8r-137739726","/car/geely-monjaro-2024","/car/chevrolet-cruze-j300-137864321","/car/geely-coolray-2023","/car/geely-atlas-i-138775494","/car/toyota-corolla-verso-ii-ar10-138775580","/car/geely-emgrand-ii-138818223","/car/geely-emgrand-ii-138818239","/car/peugeot-408-i-138818565","/car/geely-atlas-pro-2022","/car/nissan-qashqai-i-139060218","/car/volkswagen-golf-vi-138831474","/car/peugeot-3008-i-139059616","/car/nissan-qashqai-ii-139114115","/car/nissan-x-trail-2018","/car/renault-kaptur-i-139070415","/car/renault-duster-i-139070543","/car/geely-atlas-pro-139306287","/car/geely-emgrand-ii-139610321","/car/nissan-x-trail-iii-t32-116125129","/car/bmw-x5-2022","/car/belgee-x70-2024","/car/mercedes-benz-e-класс-w212-s212-c207-a207-128453466","/car/geely-emgrand-ii-125831745","/car/chevrolet-trax-i-129157167","/car/bmw-3-серия-e90-e91-e92-e93-128662857","/car/renault-scenic-iii-129064650","/car/ford-fusion-usa-ii-128790550","/car/ford-escape-iv-130320595","/car/audi-a5-f5-130454531","/car/geely-geometry-c-129204483","/car/peugeot-5008-i-130649179","/car/alfa-romeo-romeo-159-130426247","/car/renault-scenic-iv-130266546","/car/geely-emgrand-ii-131424217","/car/honda-jazz-ii-131177277","/car/opel-zafira-c-131068790","/car/hyundai-tucson-i-131098564","/car/hyundai-creta-i-131903010","/car/geely-atlas-i-136028422","/car/belgee-x50-132836721","/car/belgee-x50-132836706","/car/citro-n-c1-ii-134929007","/car/ford-focus-ii-136028613","/car/geely-tugella-i-138924136","/car/geely-emgrand-ii-137653807","/car/bmw-5-серия-f07-gt-136363661","/car/nissan-note-ii-e12-136866282","/car/citro-n-berlingo-ii-139181929","/car/renault-sandero-stepway-ii-139200807","/car/renault-kaptur-i-139504052","/car/geely-emgrand-ii-139488658","/car/geely-atlas-pro-139968046","/car/lada-vaz-vesta-i-139968021","/car/renault-sandero-stepway-ii-139967996","/car/geely-ex5-139858749","/news/chto-proveryaet-diler-pered-prodazhey","/news/chto-takoe-komissionnaya-prodazha","/news/elektromobil-v-belarusi","/news/kak-proverit-avto-pered-pokupkoy","/news/kak-vygodno-obmenyat-avto","/news/kredit-ili-lizing-na-avto","/news/podgotovka-avto-k-zime","/news/zalog-i-arest-chto-delat","/services/komissiya","/services/obmen","/services/vykup","/services/credit","/services/lizing","/compare","/favorites","/sell"];
  var note = null, timer = null;
  function toast(text) {
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;'
        + 'max-width:min(92vw,520px);padding:14px 18px;border-radius:12px;background:#1b1f24;color:#fff;'
        + 'font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);'
        + 'text-align:center;opacity:0;transition:opacity .2s ease';
      document.body.appendChild(note);
    }
    note.textContent = text;
    requestAnimationFrame(function () { note.style.opacity = '1'; });
    clearTimeout(timer);
    timer = setTimeout(function () { note.style.opacity = '0'; }, 5000);
  }
  function pathOf(p) { p = String(p || '').split('#')[0].split('?')[0].replace(/\/index\.html$/, '').replace(/\/+$/, ''); return p || '/'; }
  document.addEventListener('submit', function (e) {
    var f = e.target;
    /* Подбор по параметрам в каталоге считает catalog-demo.js прямо в браузере — форму не трогаем
       и пояснение не показываем (иначе вместо выдачи посетитель видел бы «работает на боевом
       сервере»). Заказчик 2026-10-02: «Нажимаю в блоке поиска авто марку, а оно не ищется». */
    if (f && f.hasAttribute && f.hasAttribute('data-param-form') && document.querySelector('.cars')) return;
    e.preventDefault();
    toast('Это демонстрационная копия сайта. Отправка форм работает на боевом сервере.');
  }, true);
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href) return;
    try {
      var url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      var rel = pathOf(url.pathname.replace(/^\/autonovaBY/, ''));
      if (PAGES.indexOf(rel) === -1) {
        e.preventDefault();
        toast('Это демонстрационная копия: раздел «' + (a.textContent || '').trim() + '» открывается на боевом сервере.');
      }
    } catch (err) { /* внешние ссылки не трогаем */ }
  }, true);
})();
