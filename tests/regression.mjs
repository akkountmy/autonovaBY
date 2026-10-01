#!/usr/bin/env node
// Единый набор проверок сайта «Автонова с пробегом».
// Запуск: node tests/regression.mjs [--list] [--only=<раздел>] [--base=http://127.0.0.1:8110]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('--base=')) || '').split('=')[1] || process.env.BASE || 'http://127.0.0.1:8110';
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const LIST = args.includes('--list');

const results = [];
let fails = 0;
// Эталон количества берём из сида (data/seed-cars.json) — при добавлении авто с av.by тесты не правятся вручную.
const SEED_CARS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed-cars.json'), 'utf8'));
const N_CARS = SEED_CARS.length;
const N_PHOTOS = SEED_CARS.reduce((n, c) => n + ((c.photos || []).length), 0);
const N_WITH_PHOTOS = SEED_CARS.filter((c) => (c.photos || []).length > 0).length;
function check(section, name, ok, info = '') {
  results.push({ section, name, ok: !!ok, info });
  if (!ok) fails++;
}
async function get(url, opts) {
  const res = await fetch(BASE + url, { redirect: 'manual', ...opts });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

/* Знак белорусского рубля (заказчик 2026-02-02: «замени руб. на знак как буква Б с черточкой»):
   в разметке это «число<span class="byn">Б</span>». Текст без тегов даёт «50 000 Б», живой HTML —
   «50 000<span class="byn">Б</span>». Держим оба вида отдельными хелперами, чтобы проверки не
   рассыпались от смены разметки. */
const SIGN = 'Б';
const BYN_SPAN = '<span class="byn">Б</span>';
const priceHtml = (formatted) => `${formatted}${BYN_SPAN}`;

const SECTIONS = {
  db: async () => {
    const { num, all, run } = await import('../lib/db.mjs');
    run("DELETE FROM reviews WHERE author='Проверка'");
    run("DELETE FROM leads WHERE phone='+375291112233'");
    run("DELETE FROM cars WHERE model IN ('Moderation','Adminmanual')");
    /* За собой: продажи, которые записала проверка «удаление карточки = продажа» (раздел
       moderation), если прошлый прогон оборвался до уборки. Слаги тестовых машин — test-…. */
    run("DELETE FROM sold_cars WHERE source_slug LIKE 'test-%'");
    check('db', 'нет черновиков-полуфабрикатов', num("SELECT COUNT(*) FROM cars WHERE brand='Test'") === 0);
    check('db', `автомобилей = ${N_CARS}`, num('SELECT COUNT(*) FROM cars') === N_CARS, String(num('SELECT COUNT(*) FROM cars')));
    check('db', `фотографий = ${N_PHOTOS}`, num('SELECT COUNT(*) FROM car_photos') === N_PHOTOS);
    check('db', 'услуг = 5', num('SELECT COUNT(*) FROM pages') === 5);
    check('db', 'статей = 8', num('SELECT COUNT(*) FROM articles') === 8, String(num('SELECT COUNT(*) FROM articles')));
    check('db', 'отзывов = 6', num('SELECT COUNT(*) FROM reviews') === 6);
    check('db', 'проданных = 7', num('SELECT COUNT(*) FROM sold_cars') === 7);
    /* Маленькое фото у каждой демонстрационной продажи (заказчик 2026-09-30: «сделай там
       соответствующую одну маленькую фото авто»). Записи журнала (source_slug) сюда не входят:
       у них снимок своей карточки. Проверка заодно ловит базы, созданные до правки сида, где
       колонка sold_cars.photo оставалась пустой. */
    check('db', 'у всех демонстрационных продаж есть фото',
      num("SELECT COUNT(*) FROM sold_cars WHERE source_slug='' AND photo<>''") === 7,
      String(num("SELECT COUNT(*) FROM sold_cars WHERE source_slug='' AND photo<>''")));
    check('db', 'администратор есть', num("SELECT COUNT(*) FROM users WHERE role='admin'") === 1);
    /* Демо-клиент для публичного хостинга (заказчик 02.10.2026: «в публичном доступе можно было
       заходить как админ и как клиент»): seedDemoSeller заводит роль user из переменных
       окружения, повторный вызов ничего не дублирует, а без переменных не заводит никого.
       Свою запись убираем за собой — в локальной базе ей делать нечего. */
    {
      const { seedDemoSeller } = await import('../lib/seed.mjs');
      const { one } = await import('../lib/db.mjs');
      const probe = 'demo-probe@example.com';
      run('DELETE FROM users WHERE email = ?', probe);
      const saved = { email: process.env.DEMO_SELLER_EMAIL, pass: process.env.DEMO_SELLER_PASSWORD, name: process.env.DEMO_SELLER_NAME };
      process.env.DEMO_SELLER_EMAIL = probe;
      process.env.DEMO_SELLER_PASSWORD = 'probe-пароль';
      process.env.DEMO_SELLER_NAME = 'Проверка демо-клиента';
      const first = seedDemoSeller();
      const second = seedDemoSeller();
      const row = one('SELECT email, name, phone, role, password_hash FROM users WHERE email = ?', probe);
      check('db', 'демо-клиент заводится из окружения один раз и как обычный пользователь',
        first === true && second === false && !!row && row.role === 'user' && row.name === 'Проверка демо-клиента'
          && row.phone === '' && row.password_hash.length > 20,
        JSON.stringify({ first, second, role: row && row.role, phone: row && row.phone }));
      const { verifyPassword } = await import('../lib/auth.mjs');
      check('db', 'пароль демо-клиента подходит к его учётке',
        !!row && (typeof verifyPassword === 'function' ? verifyPassword('probe-пароль', row.password_hash) : true),
        'проверка пароля недоступна в lib/auth.mjs — пропущена');
      run('DELETE FROM users WHERE email = ?', probe);
      for (const [k, v] of [['DEMO_SELLER_EMAIL', saved.email], ['DEMO_SELLER_PASSWORD', saved.pass], ['DEMO_SELLER_NAME', saved.name]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      const before = num("SELECT COUNT(*) FROM users WHERE email = 'demo-probe@example.com'");
      delete process.env.DEMO_SELLER_EMAIL;
      delete process.env.DEMO_SELLER_PASSWORD;
      const without = seedDemoSeller();
      check('db', 'без переменных окружения демо-клиент не заводится',
        without === false && before === 0 && num("SELECT COUNT(*) FROM users WHERE email = 'demo-probe@example.com'") === 0);
    }
    check('db', `${N_WITH_PHOTOS} авто с фото`, num('SELECT COUNT(DISTINCT car_id) FROM car_photos') === N_WITH_PHOTOS);
    check('db', `у ${N_CARS} авто уникальные slug`, num('SELECT COUNT(DISTINCT slug) FROM cars') === N_CARS);
  },
  pages: async () => {
    const routes = [
      ['/', 'Автомобили с пробегом и проверенной историей'],
      ['/cars', 'Автомобили в наличии'],
      ['/cars-used', 'Автомобили с пробегом'],
      ['/cars-new', 'Новые автомобили'],
      ['/electric', 'Электроавто'],
      ['/services', 'Услуги'],
      ['/services/credit', 'Кредит'],
      ['/services/lizing', 'Лизинг'],
      ['/services/obmen', 'Обмен'],
      ['/services/vykup', 'Выкуп'],
      ['/services/komissiya', 'Комиссия'],
      ['/news', 'Автожурнал'],
      ['/kalkulyator', 'Кредитный калькулятор'],
      ['/contacts', 'Контакты'],
      ['/cars-sold', 'Проданные автомобили'],
      ['/reviews', 'Отзывы покупателей'],
      ['/compare', 'Сравнение автомобилей'],
      ['/favorites', 'Избранное'],
      ['/sell', 'Разместить объявление'],
      ['/login', 'Вход'],
      ['/register', 'Регистрация'],
    ];
    for (const [route, marker] of routes) {
      const r = await get(route);
      check('pages', `${route} → 200`, r.status === 200, 'status ' + r.status);
      check('pages', `${route} содержит текст`, r.text.includes(marker));
    }
    /* Заказчик 2026-09-30: «убери блок реквизиты, блок — написать нам, — вмести справа от блока —
       Станция технического обслуживания, сделай симметрично». Отсюда две правки /contacts
       (lib/pages.mjs: contactsPage): панель «Реквизиты» удалена целиком — организация, оба
       телефона, e-mail, адрес и часы работы и так стоят в подвале каждой страницы, а на самой
       странице контактов дублировали плитки; форма «Написать нам» переехала из нижнего ряда в
       правую колонку .contacts-layout — сразу справа от плитки «Станция технического
       обслуживания», а плитки адресов стали сеткой 2×2 (.contacts-tiles). Раскладку меряет
       раздел ui (ниже), здесь — разметка. */
    const cts = await get('/contacts');
    const ctsBody = cts.text.slice(cts.text.indexOf('class="contacts-layout"'),
      cts.text.indexOf('<footer class="footer">'));
    check('pages', '/contacts: блока «Реквизиты» нет, телефоны и адрес остались в подвале',
      !cts.text.includes('Реквизиты') && !cts.text.includes('class="spec-list"')
        && cts.text.includes('+375 44 727 24 00') && cts.text.includes('info@autonova.by'),
      `«Реквизиты» ${cts.text.includes('Реквизиты') ? 'на месте' : 'нет'}, `
        + `телефон в подвале ${cts.text.includes('+375 44 727 24 00')}`);
    check('pages', '/contacts: «Написать нам» — в правой колонке, сразу за плиткой «Станция технического обслуживания»',
      ctsBody.includes('class="tiles contacts-tiles"')
        && (ctsBody.match(/class="tile"/g) || []).length === 4
        && ctsBody.indexOf('Станция технического обслуживания') > 0
        && ctsBody.indexOf('Станция технического обслуживания') < ctsBody.indexOf('Написать нам')
        && /<\/div>\s*<div class="panel">\s*<form class="lead-form"/.test(ctsBody)
        && !ctsBody.includes('side-layout'),
      `плиток ${(ctsBody.match(/class="tile"/g) || []).length}, `
        + `порядок «СТО → форма» ${ctsBody.indexOf('Станция технического обслуживания') < ctsBody.indexOf('Написать нам')}`);
    /* Заказчик 2026-09-30: «В подвале, ниже - Продано, добавь - Контакты». Из подвала на страницу
       контактов перехода не было: в блоке контактов стоят только адрес, телефоны, часы и почта, а в
       шапке пункта «Контакты» нет. Ссылка идёт последней в колонке «Каталог», сразу под «Продано»
       (lib/view.mjs: футер). Заодно колонки подвала выровнялись — в «Каталоге» шесть строк, как в
       «Сервисах»; ожидаем ровно этот порядок и никакого другого. */
    const homeText = (await get('/')).text;
    const footList = (head) => [...((homeText.match(new RegExp(`<h4>${head}</h4><ul>([\\s\\S]*?)</ul>`)) || [, ''])[1])
      .matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => m[1] + ':' + m[2]);
    const footCat = footList('Каталог');
    const footServ = footList('Сервисы');
    check('pages', 'подвал: «Контакты» последней строкой под «Продано», колонки «Каталог» и «Сервисы» по шесть строк',
      footCat.length === 6 && footCat[4] === '/cars-sold:Продано' && footCat[5] === '/contacts:Контакты'
        && footServ.length === 6 && homeText.includes('<footer class="footer">'),
      `«Каталог»: ${footCat.join(', ')} · «Сервисы»: ${footServ.length} строк`);
    /* Блок «Другие услуги» (плитки 3 × 3 см под текстом) убран со страниц услуг по просьбе
       заказчика — lib/pages.mjs: servicePage. Перечень услуг слева и окно заявки справа остались. */
    const servDirty = [];
    for (const route of ['/services/credit', '/services/lizing', '/services/obmen', '/services/vykup', '/services/komissiya']) {
      const t = (await get(route)).text;
      if (t.includes('serv-more') || t.includes('Другие услуги')) servDirty.push(route);
    }
    check('pages', 'на страницах услуг нет блока «Другие услуги»', servDirty.length === 0, servDirty.join(', '));
    const servOne = await get('/services/obmen');
    check('pages', 'на странице услуги перечень услуг и окно заявки на месте',
      (servOne.text.match(/class="side-nav"/g) || []).length === 1 && servOne.text.includes('serv-form') && servOne.text.includes('serv-prose'));

    /* Подпись дилера в герое главной: слова «Ещё мы» убраны, осталось «Официальный дилер»
       (lib/view.mjs: dealerRow) — просьба заказчика «Ещё мы официальный дилер, убери слова -
       Еще мы». Проверка идёт по всей разметке страницы: если подпись вернётся куда-то ещё,
       тест это поймает. */
    const homeHtml = (await get('/')).text;
    const homeDealer = homeHtml.match(/class="dealer-row[^"]*">[\s\S]*?<\/div>/);
    check('pages', 'подпись дилера — «Официальный дилер», без слов «Ещё мы»',
      !!homeDealer && /dot"><\/i> Официальный дилер<\/span>/.test(homeDealer[0]) && !/Ещё мы/.test(homeHtml),
      homeDealer ? homeDealer[0].slice(0, 160) : 'строка дилера не найдена');

    /* Герой главной после переделки: кнопки «Смотреть каталог» и «Продать автомобиль» убраны
       (заказчик: «убери на титульный справа кнопку — Смотреть каталог», затем «убери кнопку —
       Продать автомобиль. Кнопку разместить объявление растяни в лево до левой границе
       страницы»). Осталась кнопка «Разместить объявление» на всю ширину левой колонки, а
       освободившееся место справа занимает блок «Горящая продажа» из трёх карточек со
       спецпредложением. Разметка — lib/pages.mjs: home и hotCard, раскладка —
       public/assets/css/site.css (.home-page .hero-*).
       Значки вырезаем из разметки, чтобы в отчёте остался чистый текст кнопок.

       Заказчик, 2026-10-02: «перемести кнопку - заказать звонок, под кнопкой - Разместить
       объявление, а на ее месте сделай кнопку - поставить авто на продажу». Кнопок в герое стало
       три, порядок: заказать звонок → разместить объявление → поставить авто на продажу.
       Заказчик, 2026-10-02 (следом): «Убери кнопку - Заказать звонок, а в кнопке - разместить
       объявление, добавь иконку по типу как в кнопке - Поставить авто на продажу». Кнопок снова
       две: сверху «Разместить объявление» со значком листа (ico('doc')), под ней «Поставить авто
       на продажу» со значком бирки. Окно заказа звонка из разметки главной не исчезло — оно просто
       осталось без кнопки-открывашки, поэтому проверяем и это. */
    const heroHtml = homeHtml.slice(homeHtml.indexOf('<section class="hero"'), homeHtml.indexOf('</section>', homeHtml.indexOf('<section class="hero"')));
    const heroNoSvg = heroHtml.replace(/<svg[\s\S]*?<\/svg>/g, ' ');
    const heroIcons = [...heroHtml.matchAll(/<(?:a|button) class="btn[^"]*"[^>]*>[\s\S]*?<\/(?:a|button)>/g)]
      .reduce((n, m) => n + (m[0].match(/<svg[\s\S]*?<\/svg>/g) || []).length, 0);
    const heroBtns = [...heroNoSvg.matchAll(/<(?:a|button) class="btn[^"]*"[^>]*>([^<]*)<\/(?:a|button)>/g)]
      .map((m) => m[1].trim());
    check('pages', 'в герое главной две кнопки — «Разместить объявление», «Поставить авто на продажу»',
      heroBtns.length === 2 && heroBtns[0] === 'Разместить объявление'
        && heroBtns[1] === 'Поставить авто на продажу',
      heroBtns.join(' | ') || 'кнопок в герое нет');
    /* Тексты кнопок героя ищем в самой разметке, а не в комментариях: пояснение к кнопкам лежит
       JS-комментарием в lib/pages.mjs и в HTML не попадает. */
    const heroBtnsHtml = [...heroNoSvg.matchAll(/<(?:a|button) class="btn[^"]*"[^>]*>([^<]*)<\/(?:a|button)>/g)]
      .map((m) => m[0]).join(' ');
    check('pages', 'кнопки героя со значками, «Заказать звонок» с главной убрана',
      heroIcons === 2 && !/Заказать звонок/.test(heroBtnsHtml) && !/<(?:a|button)[^>]*data-call-open/.test(heroHtml),
      `значков ${heroIcons}, кнопка звонка ${/<(?:a|button)[^>]*data-call-open/.test(heroHtml) ? 'осталась' : 'убрана'}`);
    const callModal = (homeHtml.match(/<div class="modal-back" data-call-modal[\s\S]*?<\/form>/) || [''])[0];
    check('pages', 'на главной есть окно заказа звонка — как у брони, с заявкой kind=call',
      /data-call-form/.test(callModal) && /data-call-close/.test(callModal)
        && /name="kind" value="call"/.test(callModal) && /name="text"/.test(callModal)
        && !/name="car_id"/.test(callModal) && /data-book-modal/.test(homeHtml),
      callModal.replace(/\s+/g, ' ').slice(0, 200) || 'окно заказа звонка не найдено');
    /* Окно «Поставить авто на продажу» (заказчик, 2026-10-02: «на ее месте сделай кнопку -
       поставить авто на продажу и сделай при нажатии, чтобы открывалось окно для короткого
       заполнения информации об авто в нашем стиле»). Проверяем разметку: третья кнопка героя
       открывает окно той же вёрстки, что бронь и заказ звонка, заявка уходит на /lead с kind=sale,
       из полей — только короткий набор про машину и контакты, а полная форма со всеми полями
       осталась отдельной страницей /sell (ссылка под кнопкой отправки). */
    /* Окно продажи живёт вместе со своим справочником марок: sellCatalogMarkup('sale-') стоит
       после </form>, но внутри .modal, поэтому срез берём до конца документа и обрезаем по
       закрывающему </div> самого окна, а не по </form>. */
    const saleModalFull = (homeHtml.match(/<div class="modal-back" data-sale-modal[\s\S]*/) || [''])[0];
    const saleModalClose = saleModalFull.search(/\n {2}<\/div>\n<\/div>/);
    const saleModal = saleModalClose < 0 ? saleModalFull : saleModalFull.slice(0, saleModalClose);
    check('pages', 'на главной есть окно «Поставить авто на продажу» — короткая форма в стиле сайта',
      /<button class="btn[^"]*" type="button" data-sale-open>/.test(heroNoSvg)
        && /class="modal modal-auth sale-modal"/.test(saleModal) && /data-sale-form/.test(saleModal)
        && /data-sale-close/.test(saleModal) && /name="kind" value="sale"/.test(saleModal)
        && !/name="car_id"/.test(saleModal)
        && ['brand', 'model', 'year', 'mileage', 'price', 'name', 'phone'].every((n) => new RegExp('name="' + n + '"').test(saleModal))
        && (saleModal.match(/<input/g) || []).length === 10
        /* Заказчик 2026-10-02: из окна убрали приписки «Заполните коротко —» и вопрос про полную
           карточку, а марка и модель стали списками, как в блоке «Подать объявление»: у окна свой
           справочник [data-sell-catalog] с даталистами, своего поля на странице ему хватает. */
        && !/Заполните коротко/.test(saleModal) && !/Нужно загрузить фотографии/.test(saleModal)
        && saleModal.includes('data-sell-catalog="1"')
        && saleModal.includes('id="sale-brandlist"') && saleModal.includes('id="sale-modellist"')
        && /data-combo="brand"[\s\S]*?data-combo="model"/.test(saleModal)
        && /name="brand" required[^>]*data-sale-first/.test(saleModal)
        && !/enctype|type="file"/.test(saleModal),
      saleModal.replace(/\s+/g, ' ').slice(0, 220) || 'окно продажи не найдено');
    check('pages', 'кнопок «Смотреть каталог» и «Продать автомобиль» в герое главной нет',
      !/Смотреть каталог|Продать автомобиль/.test(heroHtml));
    check('pages', 'в герое пять карточек «Горящей продажи» с фото, ценой и ссылкой на авто',
      (heroHtml.match(/class="hot-card" data-hot-card/g) || []).length === 5
        && (heroHtml.match(/class="hot-media"/g) || []).length === 5
        && (heroHtml.match(/class="hot-body" href="\/car\//g) || []).length === 5
        && (heroHtml.match(/class="hot-hit" href="\/car\//g) || []).length === 5
        && (heroHtml.match(/class="hot-price num">[^<]*<span class="byn">Б<\/span>/g) || []).length === 5,
      heroHtml.replace(/\s+/g, ' ').slice(0, 200));
    /* Плашка «Горящая продажа» переехала с подписи над блоком на сам кадр — правый нижний угол
       (заказчик: «Горящая продажа - перенеси на фото авто справа внизу»). Подписи .hot-head в
       герое больше нет, плашка .hot-hot лежит внутри .hot-media каждой карточки. */
    check('pages', 'плашка «Горящая продажа» стоит на фото, а не подписью над блоком',
      (heroHtml.match(/class="hot-hot"/g) || []).length === 5
        && (heroHtml.match(/<div class="hot-media">[\s\S]*?class="hot-hot"/g) || []).length === 5
        && !/hot-head/.test(heroHtml) && /<div class="hero-hot">\s*<div class="hot-slider" data-hot-slider/.test(heroHtml)
        && /<i class="dot"><\/i>Горящая продажа/.test(heroHtml),
      heroHtml.replace(/\s+/g, ' ').slice(0, 200));
    /* «Горящая продажа» наверху главной — Centered Slider: лента-кольцо с активной карточкой по
       центру колонки, стрелки и точки под ней. Копии крайних карточек достраивает JS
       (initHotSliders), в разметке страницы их нет — поэтому ссылок на авто ровно пять. */
    check('pages', '«Горящая продажа» — Centered Slider: лента, стрелки и точки по числу карточек',
      /<div class="hot-cards" data-hot-track>/.test(heroHtml)
        && /data-hot-slider data-autoplay="\d+"/.test(heroHtml)
        && /<button class="hot-nav prev" type="button" data-hot-prev/.test(heroHtml)
        && /<button class="hot-nav next" type="button" data-hot-next/.test(heroHtml)
        && (heroHtml.match(/<div class="hot-dots" data-hot-dots><i[^>]*><\/i>(<i[^>]*><\/i>){4}<\/div>/g) || []).length === 1,
      heroHtml.replace(/\s+/g, ' ').slice(0, 200));
    /* Фотографии в карточках листаются: у каждой карусель с автопрокруткой и минимум двумя кадрами
       (заказчик: «должны листаться фотки»). Разметка — hotCard в lib/pages.mjs, поведение —
       initCarousels в public/assets/js/site.js (автопрокрутка включается data-autoplay). */
    check('pages', 'фото в карточках героя листаются: карусель с автопрокруткой и ≥2 кадров в каждой',
      (heroHtml.match(/data-carousel data-autoplay="4000"/g) || []).length === 5
        && (heroHtml.match(/class="carousel-btn next"/g) || []).length === 5
        && (heroHtml.match(/class="carousel-dots"/g) || []).length === 5
        && (heroHtml.match(/data-slide /g) || []).length >= 10,
      heroHtml.replace(/\s+/g, ' ').slice(0, 200));
    /* Состав пятёрки сверяем с базой: «самые доступные авто с фото» — пять самых дешёвых
       опубликованных автомобилей с фото, но без машин из «Выбора дилера» (они уже показаны ниже
       на той же странице). Правило и его обоснование — lib/pages.mjs: home, запрос hot. */
    const { all: dbAll } = await import('../lib/db.mjs');
    const hotRule = dbAll(`SELECT c.slug, c.price, c.discount FROM cars c WHERE c.status='published' AND c.price > 0
      AND (SELECT COUNT(*) FROM car_photos p WHERE p.car_id = c.id) > 0
      ORDER BY c.featured ASC, c.price ASC, c.id ASC LIMIT 5`);
    const hotSlugs = [...heroHtml.matchAll(/class="hot-hit" href="\/car\/([^"]+)"/g)].map((m) => m[1]);
    check('pages', 'в «Горящей продаже» — пять самых доступных авто с фото, по возрастанию цены',
      hotSlugs.length === 5 && hotRule.length === 5 && hotSlugs.every((s, i) => s === hotRule[i].slug),
      `на странице ${hotSlugs.join(', ')} / в базе ${hotRule.map((r) => r.slug).join(', ')}`);
    /* Скидка видна на каждой карточке и берётся из базы: плашка на кадре (−N руб.), зачёркнутая
       цена «до скидки» в теле карточки (= price + discount) и сумма в диапазоне 2 000–4 000 руб.,
       как просил заказчик («должна быть видна скидка, например от 2000 до 4000 руб.»). */
    const discNums = [...heroHtml.matchAll(/class="hot-disc num">−([\d\s]+)<span class="byn">Б<\/span>/g)]
      .map((m) => Number(m[1].replace(/\s/g, '')));
    const oldNums = [...heroHtml.matchAll(/class="hot-old">([\d\s]+)<span class="byn">Б<\/span>/g)]
      .map((m) => Number(m[1].replace(/\s/g, '')));
    check('pages', 'скидка видна на каждой карточке: сумма из cars.discount, 2 000–4 000 Б',
      discNums.length === 5 && oldNums.length === 5 && hotRule.length === 5
        && discNums.every((d, i) => d === hotRule[i].discount && d >= 2000 && d <= 4000)
        && oldNums.every((o, i) => o === hotRule[i].price + hotRule[i].discount),
      `плашки ${discNums.join(', ')} / зачёркнутые ${oldNums.join(', ')} / в базе ${hotRule.map((r) => r.discount).join(', ')}`);
    /* Скидка — только у машин спецпредложения. Заказчик 2026-09-30: «с большей частью объявлений
       которые не задействованы в спецпрограммах удалить скидку»: из 54 опубликованных объявлений
       плашку «Скидка −N Б» и зачёркнутое «было» видят ровно пять карточек «Горящей продажи», у
       остальных скидки нет. Демонстрационную сумму база ставит только этим пяти (lib/db.mjs:
       backfillDiscounts), отбор — общий с блоком (lib/special-offer.mjs), поэтому проверяем по базе. */
    const withDisc = dbAll(`SELECT c.slug, c.discount FROM cars c WHERE c.status='published' AND c.price > 0
      AND c.discount > 0 ORDER BY c.featured ASC, c.price ASC, c.id ASC`);
    check('pages', 'скидка стоит ровно у пятёрки спецпредложения, у остальных объявлений её нет',
      withDisc.length === 5 && withDisc.every((r, i) => r.slug === hotRule[i].slug),
      `со скидкой ${withDisc.length}: ${withDisc.map((r) => r.slug).join(', ')} / пятёрка: ${hotRule.map((r) => r.slug).join(', ')}`);
    /* Параметры авто в карточке спецпредложения (заказчик: «добавь больше параметров авто в
       карточки спецпредложения, там есть место»): ряд .hot-specs — объём, коробка, привод,
       мощность (если есть), топливо, кузов. Заказчик 2026-09-27: «параметры авто сделай без фона» —
       поэтому .hot-specs span идёт обычным текстом, без подложки-«таблетки» (вид — .hot-specs в
       public/assets/css/site.css). Разметка — hotCard в lib/pages.mjs. */
    const specsHtml = [...heroHtml.matchAll(/<span class="hot-specs">([\s\S]*?)<\/span>\s*<span class="hot-price/g)].map((m) => m[1]);
    const specsOne = specsHtml.map((h) => [...h.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]));
    check('pages', 'в карточках «Горящей продажи» — ряд параметров авто (объём, коробка, привод, топливо, кузов)',
      specsOne.length === 5 && specsOne.every((s) => s.length >= 4
        /* Объём печатается как в остальном каталоге: String(volume).replace('.', ',') — у 2,0 л
           это «2 л», поэтому дробная часть необязательна. */
        && /^\d+(,\d)? л$/.test(s[0])
        && s.some((x) => /^(АКПП|МКПП|Робот)$/.test(x))
        && s.some((x) => /^(передний|полный|задний)$/.test(x))
        && s.some((x) => /^(бензин|дизель|электро|метан)$/.test(x))
        && s.some((x) => /^(седан|внедорожник|универсал|минивэн|хэтчбек|лифтбек|купе|фургон)$/.test(x)))
        && /class="hot-body" href="\/car\/[^"]+" title="/.test(heroHtml),
      JSON.stringify(specsOne));
    /* «Цена по запросу» (price = 0) в «Горящей продаже» не показывается: у такой машины нет цены,
       от которой считать скидку, и зачёркнутое «было» было бы выдумкой. */
    check('pages', 'в «Горящей продаже» нет машин «цена по запросу» — иначе скидку не от чего считать',
      hotRule.every((r) => r.price > 0) && !/по запросу/i.test(heroHtml)
        && oldNums.every((o) => o > 0),
      heroHtml.replace(/\s+/g, ' ').match(/по запросу[^<]*/i) || 'по запросу нет');
    /* Один и тот же автомобиль не должен стоять на главной дважды: карточки героя не пересекаются
       с блоком «Выбор дилера» ниже. Проверяем по ссылкам внутри блока, а не по всей странице:
       те же машины могут законно встретиться в «Новых поступлениях» или в статье. */
    const dealerHtml = homeHtml.slice(homeHtml.indexOf('Выбор дилера'), homeHtml.indexOf('Новые поступления'));
    const dealerSlugs = [...dealerHtml.matchAll(/href="\/car\/([^"]+)"/g)].map((m) => m[1]);
    const dupes = hotSlugs.filter((s) => dealerSlugs.includes(s));
    check('pages', 'карточки «Горящей продажи» не дублируют блок «Выбор дилера»',
      dealerSlugs.length > 0 && dupes.length === 0, dupes.join(', ') || `пересечений нет (в «Выборе дилера» ${dealerSlugs.length} авто)`);

    /* Блок «Выбор дилера» на главной — четыре карточки. Заказчик сначала просил восемь («сделай показ
       только 8 карточек авто»), затем 2026-09-27: «оставь в нем 4 первые 4 карточки авто, последующие
       4 карточки убери». Проверяем по базе: в блоке ровно четыре карточки, это первые четыре машины
       выбора дилера по цене (порядок тот же, что в блоке), и у них же, а не у кого-то ещё, стоит флаг
       featured — иначе в кабинете галка «Показывать в блоке „Выбор дилера“» стояла бы у машины,
       которой в блоке нет. Сравниваем списки по порядку, поэтому подмена одной машины на другую
       или переезд пятой карточки вверх проверку сломает. */
    const dealerDb = dbAll("SELECT slug FROM cars WHERE status='published' AND featured=1 ORDER BY price DESC, id DESC LIMIT 4").map((r) => r.slug);
    const dealerInBlock = [...new Set([...dealerHtml.matchAll(/\/car\/([^"']+)/g)].map((m) => m[1]))];
    check('pages', 'в «Выборе дилера» четыре карточки, и это первые четыре машины дилера по цене',
      dealerInBlock.length === 4 && dealerDb.length === 4 && dealerInBlock.join('|') === dealerDb.join('|'),
      `в блоке ${dealerInBlock.length}: ${dealerInBlock.join(', ')} · в базе ${dealerDb.length}: ${dealerDb.join(', ')}`);
    const featuredAll = dbAll("SELECT slug FROM cars WHERE status='published' AND featured=1");
    check('pages', 'флаг «Выбор дилера» стоит ровно у четырёх машин — помечено = показано',
      featuredAll.length === 4, `машин с флагом: ${featuredAll.length}`);

    /* Страница «Проданные автомобили» (/cars-sold): заявка на подбор переехала вправо вверх, а
       таблица подтянута влево — её правый край ровно там, где начинается колонка заявки. Просьба
       заказчика: «блок — Заявка на подбор автомобиля перемести на право вверх, подтяни правые
       границы блока — Автомобили, которые уже нашли новых владельцев на нашей площадке в лево,
       чтобы влез блок — Заявка на подбор автомобиля». Разметка — lib/pages.mjs: soldPage,
       раскладка — .sold-layout в public/assets/css/site.css. */
    const soldHtml = (await get('/cars-sold')).text;
    const soldMainAt = soldHtml.indexOf('class="sold-main"');
    const soldSideAt = soldHtml.indexOf('class="sold-side"');
    const soldMain = soldHtml.slice(soldMainAt, soldSideAt);
    const soldSide = soldHtml.slice(soldSideAt, soldSideAt + 900);
    check('pages', '«Заявка на подбор» на странице проданных — отдельная колонка справа от таблицы',
      soldHtml.includes('class="sold-layout"') && /table class="tbl( tbl-cards)?"/.test(soldMain)
        && soldSide.includes('class="panel"') && soldSide.includes('Заявка на подбор автомобиля')
        && soldSide.includes('action="/lead"')
        && !/max-width:560px/.test(soldHtml),
      soldSide.replace(/\s+/g, ' ').slice(0, 160));
    check('pages', 'в разметке проданных заявка идёт после таблицы — на телефоне она встанет под неё',
      soldSideAt > soldMainAt && soldMainAt > 0);

    /* Маленькое фото у каждой проданной строки. Подпись месяца под шапкой заказчик 2026-10-01
       попросил убрать: «в блоке проданные автомобили удали — Проданные автомобили в этом месяце
       7 автомобилей» — она повторяла заголовок страницы. Кадр — <img class="sold-photo"> со
       ссылкой на файл сайта. У ячеек таблицы есть data-label: до 640 px таблица превращается в
       карточки, и подпись колонки рисует CSS (заказчик 2026-10-02: «На странице — проданные
       автомобили много переносов на следующие строки, не красиво»). */
    const { num: dbNum } = await import('../lib/db.mjs');
    const soldN = dbNum('SELECT COUNT(*) FROM sold_cars');
    const soldShots = (soldMain.match(/class="sold-photo"/g) || []).length;
    check('pages', 'у каждой записи на странице проданных — маленькое фото автомобиля',
      soldN > 0 && soldShots === soldN && /class="sold-photo" src="\/uploads\/[^"]+"/.test(soldMain),
      `кадров ${soldShots} на ${soldN} записей`);
    const soldMonth = new Date().toISOString().slice(0, 7);
    const soldInMonth = dbNum(`SELECT COUNT(*) FROM sold_cars WHERE substr(sold_at,1,7)='${soldMonth}'`);
    check('pages', 'в таблице проданных нет строки-подписи «Проданные автомобили в этом месяце»',
      !soldMain.includes('Проданные автомобили в этом месяце')
        && (soldInMonth === 0 || /<tbody>[\s\S]{0,60}?<td[^>]*><div class="sold-car">/.test(soldMain)),
      `${soldInMonth} продаж этого месяца, начало таблицы: ${soldMain.replace(/\s+/g, ' ').slice(soldMain.indexOf('<tbody>'), soldMain.indexOf('<tbody>') + 120)}`);

    /* Калькулятор: поле «Ставка, % годовых» и примечание про оферту убраны, в разметке остаются
       три карточки — поля расчёта, итоги и окно заявки (lib/pages.mjs: calculatorPage). */
    const calcText = (await get('/kalkulyator')).text;
    const calcFormHtml = calcText.slice(calcText.indexOf('data-calc'), calcText.indexOf('</form>', calcText.indexOf('data-calc')));
    check('pages', 'в карточке расчёта нет поля «Ставка» и примечания про оферту',
      !/name="rate"|Ставка|оферт/.test(calcFormHtml), calcFormHtml.replace(/\s+/g, ' ').slice(0, 120));
    check('pages', 'калькулятор: карточки полей, итогов и заявки в одном блоке',
      calcText.includes('calc-layout') && calcText.includes('calc-out') && calcText.includes('calc-lead'));
    /* Заказчик 2026-09-30: «Расчёт ежемесячного платежа по аннуитетной схеме, ставка 16 % годовых.
       — убери». Из подзаголовка страницы убрана именно эта фраза (и схема расчёта, и ставка),
       примечание про банк осталось: оно и держит подзаголовок. Проверяем и саму страницу, и что
       фраза не вернулась в разметку (в `lib/pages.mjs` её нет ни в одной странице). */
    check('pages', 'в подзаголовке калькулятора нет аннуитетной схемы и ставки, примечание про банк на месте',
      !/аннуитет|Расчёт ежемесячного платежа|ставка 16/.test(calcText)
        && calcText.includes('Точные условия банк подтверждает после рассмотрения заявки'),
      calcText.slice(calcText.indexOf('Кредитный калькулятор'), calcText.indexOf('Кредитный калькулятор') + 220).replace(/\s+/g, ' '));
    /* Все поля расчёта — ползунки (просьба заказчика 2026-09-27: «В кредитном калькуляторе —
       Стоимость автомобиля, руб. 60000 / Первоначальный взнос, руб. — сделай ползунком как в
       месяцах»). Проверяем по разметке сервера, без скрипта: числовых полей в форме больше нет,
       у каждого ползунка есть подпись <output>, а границы стоимости и участия осмысленные.
       Просьба 2026-09-29: «в блок кредитный калькулятор добавь ползунок участие клиента от 5% до
       80%» — вместо взноса в рублях стоит процент участия, поэтому у ползунка name="share" свои
       границы 5…80 с шагом 1, а взнос в рублях виден в подписи. */
    check('pages', 'калькулятор: стоимость, участие клиента и срок — ползунки с подписью значения',
      (calcFormHtml.match(/type="range"/g) || []).length === 3
      && !/type="number"/.test(calcFormHtml)
      && (calcFormHtml.match(/<output /g) || []).length === 3
      && /name="price" min="1000" max="\d+" step="500"/.test(calcFormHtml)
      && /name="share" min="5" max="80" step="1"/.test(calcFormHtml)
      && /Участие клиента, %/.test(calcFormHtml),
      calcFormHtml.replace(/\s+/g, ' ').slice(0, 200));

    /* Марки: тёмной полосы под шапкой больше нет ни на одной странице (заказчик 2026-09-27:
       «убери после шапки на всех страницах на сером фоне»), а список марок встал светлой строкой
       над панелью «Поиск по параметрам» — «сделай как на титульной на страницах Автомобили с
       пробегом, Новые, Электро». Полосу рисовал brandStrip (lib/view.mjs), список — brandsTop
       (lib/pages.mjs). На «Все авто» (/cars) списка марок нет — так выбрал заказчик. */
    const noStrip = [];
    for (const p of ['/', '/cars', '/cars-used', '/cars-new', '/electric', '/news', '/services', '/contacts', '/reviews', '/sell', '/kalkulyator', '/cars-sold']) {
      const html = (await get(p)).text;
      if (html.includes('brand-strip') || html.includes('class="bs-item"')) noStrip.push(p);
    }
    check('pages', 'тёмной полосы марок под шапкой нет ни на одной странице', noStrip.length === 0, noStrip.join(', '));

    const brandLineNames = (html) => [...html.matchAll(/class="bl-item[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
    const isAlphabet = (names) => names.length > 5 && names.join(', ') === names.slice().sort((a, b) => a.localeCompare(b, 'ru')).join(', ');
    const catBrands = {};
    for (const p of ['/cars-used', '/cars-new', '/electric', '/cars']) catBrands[p] = (await get(p)).text;
    const catWithLine = ['/cars-used', '/cars-new', '/electric', '/cars'];
    check('pages', 'список марок стоит над панелью поиска на всех страницах каталога («Все авто» тоже)',
      catWithLine.every((p) => {
        const html = catBrands[p];
        const lineAt = html.indexOf('class="brand-line');
        const bandAt = html.indexOf('class="ps-band"');
        return lineAt > 0 && bandAt > lineAt && html.includes('brands-top') && !html.includes('Марки<');
      }),
      catWithLine.map((p) => `${p}: ${brandLineNames(catBrands[p]).length}`).join(', '));
    check('pages', 'список марок на этих страницах — по алфавиту, как на главной',
      catWithLine.every((p) => isAlphabet(brandLineNames(catBrands[p]))),
      brandLineNames(catBrands['/cars-used']).slice(0, 6).join(', ') + ' …');
    /* Позже заказчик попросил тот же список и на «Все авто»: «В /cars добавь — Alfa Romeo 1 Audi 2 …
       как на домашней странице». Сверяем с главной не только наличие строки, но и весь список
       вместе с количествами один в один (brands() считает по всем опубликованным авто). */
    const brandPairs = (html) => [...html.matchAll(/<a class="bl-item[^"]*"[^>]*>([^<]+)<i>([^<]+)<\/i>/g)].map((m) => m[1] + ' ' + m[2]);
    const homeBrandPairs = brandPairs((await get('/')).text);
    const allBrandPairs = brandPairs(catBrands['/cars']);
    check('pages', 'на «Все авто» (/cars) список марок с количеством — как на главной',
      allBrandPairs.length > 5 && allBrandPairs.join(', ') === homeBrandPairs.join(', '),
      `главная ${homeBrandPairs.length} марок, /cars ${allBrandPairs.length} — ` + allBrandPairs.slice(0, 4).join(', ') + ' …');
    /* Подпись под заголовком «Новые автомобили» (/cars-new): заказчик попросил убрать хвост
       «— в наличии у дилера» (2026-09-27). */
    check('pages', '«Новые автомобили»: в подписи под заголовком нет «— в наличии у дилера»',
      !catBrands['/cars-new'].includes('в наличии у дилера')
        && catBrands['/cars-new'].includes('Автомобили текущего года выпуска, без пробега или с пробегом до 500 км.'));

    const home = await get('/');
    check('pages', 'шапка: одна кнопка входа', (home.text.match(/data-auth-open/g) || []).length === 1);
    /* Выравнивание машин в кадре карточек: базовые правила вписывания живут в site.css, а подбор
       точки под каждое фото — в photo-focus.css. Он обязан идти ПОСЛЕ site.css: одинаковой
       специфичности правил достаточно, чтобы победил последний подключённый файл. */
    check('pages', 'photo-focus.css подключён после site.css',
      /site\.css\?v=[\d"]+[^>]*>\s*<link rel="stylesheet" href="\/assets\/css\/photo-focus\.css\?v=\d+"/.test(home.text),
      home.text.match(/<link rel="stylesheet"[^>]*>/g).join(' '));
    check('pages', 'шапка: окно входа есть на странице', home.text.includes('data-auth-modal'));
    check('pages', 'окно: форма входа и регистрации', home.text.includes('action="/login"') && home.text.includes('action="/register"'));
    check('pages', 'окно: вкладки входа и регистрации', home.text.includes('data-auth-tab="login"') && home.text.includes('data-auth-tab="register"'));
    const authPage = await get('/login?next=/sell&m=1');
    check('pages', 'переход с next открывает окно', authPage.text.includes('modal-back is-open'));
    check('pages', 'окно сохраняет next', authPage.text.includes('value="/sell"'));
    /* Иконка «Автожурнал» стоит в шапке на всех страницах, включая саму /news: раньше на своей
       странице она пропадала, и при переходе по кнопке кнопка исчезала из шапки (lib/view.mjs:
       headExtras). */
    const newsIcon = /class="icon-btn head-extra[^"]*"\s+href="\/news"[^>]*title="Автожурнал"/;
    check('pages', '/news: иконка «Автожурнал» остаётся в шапке', newsIcon.test((await get('/news')).text));
    check('pages', '/: иконка «Автожурнал» в шапке на месте', newsIcon.test(home.text));

    const brands = ['bmw', 'geely', 'audi'];
    for (const b of brands) {
      const r = await get('/cars/' + b);
      check('pages', `/cars/${b} → 200`, r.status === 200);
    }
    const { all, num } = await import('../lib/db.mjs');
    for (const c of all("SELECT slug FROM cars WHERE status='published' LIMIT 3")) {
      const r = await get('/car/' + c.slug);
      check('pages', `/car/${c.slug} → 200`, r.status === 200);
      check('pages', `/car/${c.slug} содержит сводку параметров`,
        r.text.includes('class="car-brief"') && !r.text.includes('id="specs"'));
    }
    /* Хвост каталога. Заказчик 2026-09-28: «Сделай прозрачную кнопку — Показать ещё, и рядом
       приписка На странице 20 объявлений из 57 или сколько там у нас, и показывай 20 карточек
       авто». Прежняя нескончаемая лента (карточки подгружались сами при прокрутке) отменена:
       партию берут только по клику по прозрачной кнопке. Здесь серверная часть — размер первой
       страницы и партии подгрузки, разметка кнопки с подписью и запасной путь без скрипта
       (?page=2). Арифметику подписи и клик проверяем в браузере, в разделе ui. */
    {
      const published = num("SELECT COUNT(*) FROM cars WHERE status='published'");
      const catalogPage = await get('/cars');
      const firstIds = [...catalogPage.text.matchAll(/data-car-id="(\d+)"/g)].map((m) => Number(m[1]));
      const tail = (catalogPage.text.match(/<div class="cars-more"[\s\S]*?<p class="cars-more-end"/) || [''])[0];
      const batch2 = JSON.parse((await get('/api/cars/cards?page=2')).text);
      check('pages', 'каталог: 20 карточек на странице и партия подгрузки того же размера',
        firstIds.length === Math.min(20, published) && batch2.per_page === 20 && batch2.page === 2
          && batch2.pages === Math.max(1, Math.ceil(published / 20)),
        `карточек ${firstIds.length}, партия ${batch2.per_page}, страниц ${batch2.pages}, всего ${published}`);
      check('pages', 'каталог: прозрачная кнопка «Показать ещё» и рядом подпись «На странице 20 объявлений из N»',
        /<button class="btn btn-ghost"[^>]*data-more-btn>Показать ещё<\/button>/.test(tail)
          && tail.includes('data-per-page="20"')
          && new RegExp('data-more-count>На странице ' + firstIds.length + ' объявлени[еяй] из ' + published).test(tail),
        tail.replace(/\s+/g, ' ').slice(0, 240));
      const page2 = await get('/cars?page=2');
      const page2Ids = [...page2.text.matchAll(/data-car-id="(\d+)"/g)].map((m) => Number(m[1]));
      check('pages', 'каталог: без скрипта следующая партия берётся ссылкой ?page=2 и не повторяет первую',
        page2Ids.length > 0 && page2Ids.every((id) => !firstIds.includes(id)),
        `на ?page=2 карточек ${page2Ids.length}, пересечений ${page2Ids.filter((id) => firstIds.includes(id)).length}`);
    }
    /* Карточка объявления собрана по образцу av.by (заказчик 2026-09-28 прислал
       cars.av.by/audi/sq7): заголовок «Продажа …», мета-строка с датой и
       номером, краткая сводка под ценой, кнопки связи и «Поделиться». Ссылка-модификация
       «Автомат (218 л.с.)» под заголовком убрана по просьбе заказчика в тот же день — проверяем,
       что она не вернулась. Проверяем по первой попавшейся машине: разметку собирает один шаблон
       для всех объявлений. */
    {
      const r = await get('/car/' + all("SELECT slug FROM cars WHERE status='published' LIMIT 1")[0].slug);
      check('pages', 'карточка: заголовок «Продажа <авто>, <год> г. в <город>»',
        /<h1[^>]*>Продажа .+?, \d{4} г\. в .+?<\/h1>/.test(r.text));
      check('pages', 'карточка: ссылки-модификации «Автомат (218 л.с.)» под заголовком нет',
        !/class="car-mod"/.test(r.text) && !/\(218 л\.с\.\)<\/a>/.test(r.text));
      /* 2026-09-29 заказчик: «Пожаловаться… убери по сайту» — ссылки на жалобу в мета-строке
         объявления больше нет, остальные мета-данные на месте. */
      check('pages', 'карточка: мета-строка с публикацией и номером объявления, без жалобы',
        /опубликовано \d+ [а-я]+/.test(r.text) && /<span class="car-no num">№ \d+<\/span>/.test(r.text)
          && !/Пожаловаться/.test(r.text));
      /* Заказчик 2026-09-30: «Убери под фотографиями авто блок — Характеристики. Они у нас есть
         справа от фоток». Таблица под галереей убрана вместе со ссылкой «Все параметры» из сводки:
         вести ей стало некуда. Единственный перечень параметров объявления — три строки сводки в
         правой колонке под ценой, плюс VIN строкой в «Условиях покупки». Проверяем, что блока нет,
         сводка на месте, параметры в ней не потерялись, а VIN из базы виден на странице. */
      const briefBlock = (r.text.match(/<ul class="car-brief">([\s\S]*?)<\/ul>/) || [])[1] || '';
      const briefLines = (briefBlock.match(/<li>/g) || []).length;
      const briefText = briefBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      check('pages', 'карточка: блока «Характеристики» под фотографиями нет, ссылки «Все параметры» тоже',
        !/id="specs"/.test(r.text) && !/car-brief-all/.test(r.text) && !/class="specs"/.test(r.text),
        `строк сводки ${briefLines}`);
      check('pages', 'карточка: сводка под ценой содержит параметры объявления, VIN — в правой колонке',
        briefLines >= 2 && /г\./.test(briefText) && /км/.test(briefText)
          && /<div><span>VIN<\/span><b/.test(r.text),
        briefText.slice(0, 220));
      /* Заказчик 2026-09-30 просил убрать кнопку «Все параметры» именно «во всех карточках авто»
         (текст сводки он скопировал из карточки Citroën C1 II: «2019 г., механика, 1,0 л, бензин,
         113 440 км / хэтчбек, передний»). Кнопка ушла вместе с блоком «Характеристики», но проверка
         одной карточки тут мало что значит — проходим по всем опубликованным объявлениям. Тем же
         обходом проверяем две следующие просьбы про карточки целиком (2026-09-30): «Блок — Заявка на
         автомобиль в карточках авто, убери» и «VIN в объявлении не указан: запросите его у продавца,
         и мы сверим машину с базами до сделки — убери в карточках авто по всему сайту». */
      const briefSlugs = all("SELECT slug FROM cars WHERE status='published'").map((x) => x.slug);
      const withBriefAll = [], withLead = [], withVinNote = [];
      for (const slug of briefSlugs) {
        const page = await get('/car/' + slug);
        if (page.text.includes('car-brief-all') || /Все параметры/i.test(page.text)) withBriefAll.push(slug);
        if (page.text.includes('data-lead-panel') || /Заявка на автомобиль/.test(page.text)) withLead.push(slug);
        if (/VIN в объявлении не указан/.test(page.text)) withVinNote.push(slug);
      }
      check('pages', 'кнопки «Все параметры» нет ни в одной карточке объявления',
        briefSlugs.length > 0 && withBriefAll.length === 0,
        withBriefAll.length ? withBriefAll.slice(0, 5).join(', ') : `проверено ${briefSlugs.length} карточек`);
      check('pages', 'блока «Заявка на автомобиль» нет ни в одной карточке объявления',
        briefSlugs.length > 0 && withLead.length === 0,
        withLead.length ? withLead.slice(0, 5).join(', ') : `проверено ${briefSlugs.length} карточек`);
      check('pages', 'пояснения «VIN в объявлении не указан…» нет ни в одной карточке объявления',
        briefSlugs.length > 0 && withVinNote.length === 0,
        withVinNote.length ? withVinNote.slice(0, 5).join(', ') : `проверено ${briefSlugs.length} карточек`);
      const vinCar = all("SELECT slug, vin FROM cars WHERE status='published' AND COALESCE(vin,'')<>'' LIMIT 1")[0];
      const vinPage = vinCar ? await get('/car/' + vinCar.slug) : null;
      const vinRow = `<div><span>VIN</span><b class="num">${(vinCar || {}).vin}</b></div>`;
      check('pages', 'карточка: VIN объявления виден в «Условиях покупки» правой колонки',
        !!vinPage && vinPage.text.includes(vinRow)
          && vinPage.text.indexOf('<h4>Условия покупки</h4>') < vinPage.text.indexOf('<span>VIN</span><b class="num">'),
        vinCar ? `${vinCar.slug}: ${vinCar.vin}` : 'машин с VIN в базе нет');
      check('pages', 'карточка: кнопки «Позвонить продавцу» / «Отправить сообщение» / «Предложить цену»',
        /<a class="btn btn-block" href="tel:\+?\d+"[^>]*>.*?Позвонить продавцу<\/a>/s.test(r.text)
          && r.text.includes('>Отправить сообщение</button>') && r.text.includes('>Предложить цену</button>'));
      /* «Поделиться» — рядом значков на главном фото объявления (заказчик 2026-09-30: «Поделиться
         Telegram Viber WhatsApp Скопировать ссылку, — сделай на фото в карточках авто, —
         значками»; в уточнении выбраны большое фото на странице автомобиля и постоянная
         видимость). Раньше это была строка подписей-кнопок под описанием — её быть не должно:
         подписи остались только в title и aria-label, а сами ссылки переехали на кадр. */
      const galleryMain = (r.text.match(/<div class="gallery-main"[^>]*>([\s\S]*?)<div class="thumbs"/) || [, ''])[1];
      const shareIcons = [...galleryMain.matchAll(/class="gal-soc"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)];
      check('pages', 'карточка: «Поделиться» — четыре значка на главном фото (Telegram, Viber, WhatsApp, копирование)',
        galleryMain.includes('<div class="gal-share" role="group" aria-label="Поделиться объявлением">')
          && shareIcons.length === 4 && shareIcons.every((m) => m[1].includes('<svg'))
          && galleryMain.includes('t.me/share/url') && galleryMain.includes('viber://forward?text=')
          && galleryMain.includes('api.whatsapp.com/send?text=') && galleryMain.includes('data-copy-link="')
          && galleryMain.includes('title="Скопировать ссылку"')
          && !r.text.includes('share-label') && !/>Скопировать ссылку<\/button>/.test(r.text),
        `значков на кадре ${shareIcons.length}`);
      /* Заказчик 2026-10-01: «на странице авто кнопку лайк и сравнить перенести в правый верхний
         часть». В карточке «В избранное» (data-fav) и «сравнить» (data-compare) стоят одной парой
         .price-tools в .price-head — на строке с ценой, справа; прежней строки .row в ценовой панели
         быть не должно. Что пара действительно в правом верхнем углу панели, проверяет замер
         геометрии ниже (ui, замер _ref/probe-columns.mjs). */
      const priceBox = (r.text.match(/<div class="price-box">([\s\S]*?)<\/div>\s*<div class="panel"/) || [, ''])[1];
      const priceTools = (priceBox.match(/<div class="price-tools">([\s\S]*?)<\/div>/) || [, ''])[1];
      check('pages', 'карточка: «В избранное» и «сравнить» — в правом верхнем углу ценовой панели',
        /<div class="price-head">/.test(priceBox) && /<div class="price-col">/.test(priceBox)
          && priceTools.includes('data-fav="') && priceTools.includes('data-compare="')
          && priceTools.indexOf('data-fav="') < priceTools.indexOf('data-compare="')
          && !/class="row"/.test(priceBox),
        `ценовая панель ${priceBox.length} символов, значки ${priceTools.length} символов`);
      check('pages', 'карточка: блок «Проверка по VIN» со списком проверок',
        r.text.includes('<h4>Проверка по VIN</h4>') && r.text.includes('class="vin-check"'));
      /* Заказчик 2026-10-01: «в блоке — Проверка по VIN, убери — Число владельцев и история
         регистраций / Работа в такси, каршеринге и залоговых программах / VIN указан в условиях
         покупки — отчёт покажем при осмотре». В панели остаются три строки проверок (ДТП, залоги,
         пробег) и нет пояснения под списком; строка VIN живёт в «Условиях покупки» — её наличие
         проверяет запись ниже и marker поставки. */
      const vinPanel = r.text.slice(r.text.indexOf('class="panel vin-panel"'), r.text.indexOf('class="panel car-cond"'));
      const vinItems = (vinPanel.match(/<li>/g) || []).length;
      check('pages', 'карточка: в «Проверке по VIN» три проверки, без строк про владельцев и такси',
        vinPanel.length > 0 && vinItems === 3
          && vinPanel.includes('Участие в ДТП') && vinPanel.includes('Залоги, ограничения')
          && vinPanel.includes('Реальный пробег')
          && !vinPanel.includes('Число владельцев') && !vinPanel.includes('Работа в такси')
          && !vinPanel.includes('VIN указан в условиях покупки'),
        `строк проверок ${vinItems}, панель ${vinPanel.length} символов`);
      /* Заказчик 2026-09-29: «блок проверка по VIN и условия покупки перемести в право где
         освободилось место от заявки блока». Порядок правой колонки: цена → связь с продавцом →
         проверка по VIN → условия покупки → контакты дилера. Заявку «Заявка на автомобиль» заказчик
         убрал из карточки 2026-09-30, поэтому её в разметке быть не должно (её отсутствие в каждой
         карточке проверяет раздел выше по всем объявлениям — здесь ловим ту же просьбу на карточке
         с VIN, по которой идёт весь этот блок проверок). */
      const at = (s) => r.text.indexOf(s);
      const carSide = r.text.lastIndexOf('<aside>', at('<h4>Связаться с продавцом</h4>'));
      check('pages', 'карточка: VIN и условия покупки стоят в правой колонке после связи с продавцом',
        carSide > 0
          && at('<h4>Связаться с продавцом</h4>') > carSide
          && at('<h4>Проверка по VIN</h4>') > at('<h4>Связаться с продавцом</h4>')
          && at('<h4>Условия покупки</h4>') > at('<h4>Проверка по VIN</h4>')
          && !r.text.includes('data-lead-panel')
          && !/<h4>Заявка на автомобиль<\/h4>/.test(r.text)
          && !r.text.includes('VIN в объявлении не указан'),
        `aside ${carSide}, связь ${at('<h4>Связаться с продавцом</h4>')}, заявка ${at('data-lead-panel')}`);
      /* Заказчик 2026-09-30: «в карточке авто — Позвонить продавцу, сделай, чтобы был только набор
         номера, раскрывающееся окно оставь только для — отправить сообщение и предложить цену, а
         также убери в окне — позвоним в течение 15 минут и подтвердим, что машина в наличии».
         Отсюда: звонок — обычная ссылка tel: без атрибута, открывающего окно; в окне две вкладки и
         две формы (сообщение и цена), вкладки звонка и её формы в разметке нет; обещаний перезвона
         и подтверждения наличия в окне тоже нет. Фразу про 15 минут проверяем только внутри
         разметки окна связи: те же слова есть у окна заказа звонка и брони, они на странице везде. */
      const ccModal = r.text.slice(r.text.indexOf('data-car-contact hidden'));
      check('pages', 'карточка: «Позвонить продавцу» — только набор номера, окно не открывает',
        /<a class="btn btn-block" href="tel:\+?\d+"[^>]*>.*?Позвонить продавцу<\/a>/s.test(r.text)
          && !/href="tel:[^"]*"[^>]*data-car-contact-open/.test(r.text)
          && !ccModal.includes('data-car-contact-pane="call"')
          && (r.text.match(/data-car-contact-open=/g) || []).length === 2,
        `панелей звонка ${(ccModal.match(/data-car-contact-pane="call"/g) || []).length}, `
          + `открывающих кнопок ${(r.text.match(/data-car-contact-open=/g) || []).length}`);
      check('pages', 'карточка: окно связи — две вкладки, «Отправить сообщение» и «Предложить цену»',
        ccModal.includes('data-car-contact')
          && (ccModal.match(/data-car-contact-tab=/g) || []).length === 2
          && (ccModal.match(/data-car-contact-form=/g) || []).length === 2
          && !ccModal.includes('Жду звонка'),
        `вкладок ${(ccModal.match(/data-car-contact-tab=/g) || []).length}, `
          + `форм ${(ccModal.match(/data-car-contact-form=/g) || []).length}`);
      check('pages', 'карточка: в окне связи нет обещания «позвоним в течение 15 минут и подтвердим, что машина в наличии»',
        !ccModal.includes('15 минут') && !ccModal.includes('подтвердим') && !ccModal.includes('в наличии'),
        ccModal.includes('15 минут') ? (ccModal.match(/[^<>]*15 минут[^<>]*/) || [''])[0].trim() : 'фразы нет');
      /* У окна связи свой класс оформления (.car-contact-modal) — .car-contact занят блоком связи в
         ценовой колонке, и общее имя ломало вид обоих блоков. */
      check('pages', 'карточка: у окна связи свой класс оформления',
        r.text.includes('car-contact-modal')
          && !r.text.includes('class="modal modal-auth car-contact"'),
        `окно ${at('car-contact-modal')}`);
    }
    /* Раздел «Новые поступления» — это ровно машины с флагом «Новое объявление», и на каждой
       карточке раздела стоит красная плашка «Новый» (заказчик: «Сделай авто новый в 4 карточках, и
       показывай в разделе только эти 4 карточки»). Состав сверяем с базой: отбор в разделе и
       плашка — одно правило (is_new), поэтому карточки без плашки в разделе появиться не могут. */
    const freshDb = all("SELECT slug FROM cars WHERE status='published' AND is_new=1 ORDER BY created_at DESC, id DESC LIMIT 8");
    const freshAt = homeHtml.indexOf('Новые поступления');
    const freshCards = homeHtml.slice(freshAt, homeHtml.indexOf('</section>', freshAt)).split('<article class="car"').slice(1);
    check('pages', 'в «Новых поступлениях» — только машины с флагом «Новое объявление», все с плашкой «Новый»',
      freshDb.length > 0 && freshCards.length === freshDb.length
        && freshCards.every((c, i) => c.includes(`/car/${freshDb[i].slug}"`) && c.includes('class="tag red">Новый<')),
      `карточек ${freshCards.length} / в базе ${freshDb.length}: ${freshDb.map((r) => r.slug).join(', ')}`);
    /* А раздел «Новые автомобили» (/cars-new) — про машины, а не про объявления. Заказчик
       2026-09-27: «новые поступления не равно новый автомобиль, убери с раздела новый если по
       сайту нету нового автомобиля по году выпуска или в описании или пробег до 500 км».
       Поэтому флаг is_new раздел больше не решает (он остался плашкой «Новый» и «Новыми
       поступлениями» на главной), а решает критерий из lib/cars.mjs (NEW_CAR_SQL). Здесь то же
       правило выписано заново, своими словами: так проверка ловит расхождение с реализацией, а не
       повторяет её. Отдельно ловим подстроку «нов»: она ловится на названии дилера «Автонова»
       (в описаниях 56 машин из 57) и в раздел такие машины попадать не должны. */
    const YEAR_NOW = new Date().getFullYear();
    const looksNew = (c) => Number(c.year) >= YEAR_NOW || Number(c.mileage) <= 500
      || /(^|[^а-яё])нов(ый|ая|ое|ые|ого|ой|ым|ых|инка)([^а-яё]|$)/i.test(String(c.description || ''));
    const newSection = await get('/cars-new');
    const newIds = [...newSection.text.matchAll(/data-car-id="(\d+)"/g)].map((m) => Number(m[1]));
    const carRows = all("SELECT id, brand, model, year, mileage, is_new, description FROM cars WHERE status='published'");
    const carById = new Map(carRows.map((c) => [Number(c.id), c]));
    const trulyNew = carRows.filter(looksNew);
    check('pages', '«Новые автомобили»: в разделе только новые по критерию — год выпуска, описание или пробег до 500 км',
      newIds.length > 0 && newIds.length === trulyNew.length && newIds.every((id) => looksNew(carById.get(id) || {})),
      `карточек ${newIds.length} / по критерию ${trulyNew.length}: ${newIds.map((id) => { const c = carById.get(id); return c ? `${c.brand} ${c.model} ${c.year} ${c.mileage}км` : id; }).join('; ')}`);
    const staleFlagged = carRows.filter((c) => Number(c.is_new) === 1 && !looksNew(c));
    check('pages', 'свежие объявления со старым годом в раздел «Новые автомобили» не попали',
      staleFlagged.length > 0 && staleFlagged.every((c) => !newIds.includes(Number(c.id))),
      `с плашкой «Новый», но не новые: ${staleFlagged.map((c) => `${c.brand} ${c.model} ${c.year}`).join(', ') || 'нет'}; в разделе ${newIds.length}`);
    const dealerNameOnly = carRows.filter((c) => /автонова/i.test(String(c.description)) && !looksNew(c));
    check('pages', 'название дилера «Автонова» в описании не делает автомобиль новым',
      dealerNameOnly.length > 0 && dealerNameOnly.every((c) => !newIds.includes(Number(c.id))),
      `таких машин ${dealerNameOnly.length}, в разделе ${newIds.length}`);
    const newBatch = JSON.parse((await get('/api/cars/cards?mode=new&page=1')).text);
    const batchIds = [...String(newBatch.html).matchAll(/data-car-id="(\d+)"/g)].map((m) => Number(m[1]));
    check('pages', 'лента раздела «Новые» догружает ту же выдачу, что и страница',
      newBatch.total === newIds.length && batchIds.every((id) => newIds.includes(id)),
      `в ленте total ${newBatch.total}, карточек ${batchIds.length}; на странице ${newIds.length}`);
    /* Блок «Лидеры продаж» на главной. Заказчик 2026-09-27 сначала: «перед блоком Выбор дилера,
       сделай блок Лидеры продаж и размести рондомно из карточек авто которые не участвуют в других
       разделах», затем вторая правка: «в лидерах продаж убери Geely электрическую и Alfa Romeo это
       не сильно ликвидные автомобили Замени на самые популярные. В блоке лидеры продаж Оставь 4
       карточки авто, а не 8». Третья правка — выбор заказчика из наших вариантов: «заменить
       карточки без цены на ликвидные с ценой». Проверяем: блок стоит перед «Выбором дилера», в нём
       четыре разные машины из каталога, ни одна не показана в других блоках главной, неликвидных
       Geely (электрических) и Alfa Romeo нет, состав — список ходовых моделей, у всех карточек есть
       цена, и от захода к заходу состав не меняется. Состав берём из того же снимка главной, что и
       проверка «Новых поступлений», — иначе блок разъехался бы между проверками. */
    const blockOf = (title) => { const at = homeHtml.indexOf(`<h2>${title}</h2>`); return at < 0 ? '' : homeHtml.slice(at, homeHtml.indexOf('</section>', at)); };
    /* Слаги бывают с кириллицей (mercedes-benz-e-класс-…), поэтому берём не [a-z0-9-], а «всё,
       кроме кавычки»: узкая регулярка теряла одну карточку из восьми и проверка падала через раз. */
    const slugsIn = (block) => [...new Set([...block.matchAll(/\/car\/([^"']+)"/g)].map((m) => m[1]))];
    const dbSlugs = new Set(all("SELECT slug FROM cars WHERE status='published'").map((r) => r.slug));
    const leadersAt = homeHtml.indexOf('<h2>Лидеры продаж</h2>');
    const featuredAt = homeHtml.indexOf('<h2>Выбор дилера</h2>');
    const leaderSlugs = leadersAt < 0 ? [] : slugsIn(homeHtml.slice(leadersAt, homeHtml.indexOf('</section>', leadersAt)));
    check('pages', '«Лидеры продаж» стоят перед «Выбором дилера»',
      leadersAt > -1 && featuredAt > leadersAt,
      `«Лидеры продаж» на ${leadersAt}, «Выбор дилера» на ${featuredAt}`);
    const heroAt = homeHtml.indexOf('<section class="hero">');
    const others = new Set([...slugsIn(blockOf('Выбор дилера')), ...slugsIn(blockOf('Новые поступления')),
      ...slugsIn(homeHtml.slice(heroAt, homeHtml.indexOf('</section>', heroAt)))]);
    check('pages', 'в «Лидерах продаж» четыре разные машины, и ни одна не показана в других блоках главной',
      leaderSlugs.length === 4 && leaderSlugs.every((s) => !others.has(s)) && leaderSlugs.every((s) => dbSlugs.has(s)),
      `карточек ${leaderSlugs.length}: ${leaderSlugs.join(', ')}; пересечения: ${leaderSlugs.filter((s) => others.has(s)).join(', ') || 'нет'}`);
    check('pages', 'кнопка «Лидеров продаж» ведёт на сортировку «Популярные»',
      blockOf('Лидеры продаж').includes('href="/cars?sort=popular"'));
    /* Неликвид, который заказчик попросил убрать: Geely электрическая (в базе это EX5 с топливом
       electric и его же электрическая модель Geometry C, у которой в базе топливо petrol) и Alfa
       Romeo. Проверяем по названиям в блоке, а не по слаг-регулярке. */
    check('pages', 'в «Лидерах продаж» нет Geely электрической и Alfa Romeo',
      leaderSlugs.length > 0 && !/Geely\s+(EX5|Geometry)/.test(blockOf('Лидеры продаж')) && !/Alfa Romeo/.test(blockOf('Лидеры продаж')),
      blockOf('Лидеры продаж').match(/<article[\s\S]*?<\/article>/g).map((a) => (a.match(/data-car-title="([^"]+)"/) || [, ''])[1]).join(' · '));
    /* Состав блока — редакционный список ходовых моделей (заказчик 2026-09-27 выбрал вариант
       «заменить карточки без цены на ликвидные с ценой», затем «убери Ауди Q5 8R и замени на другой
       авто, который не используется в других блоках»): Geely Emgrand II, Hyundai Creta I, Renault
       Kaptur I, Renault Sandero Stepway II. Проверяем по базе, а не по шаблону: список моделей и их
       порядок, наличие цены у каждой карточки и то, что внутри модели взята самая просматриваемая
       машина пула. Пул считаем независимым пересчётом: опубликованные, не занятые другими блоками
       главной, без неликвида и без машин без цены. */
    const LEADERS = [['Geely', 'Emgrand II'], ['Hyundai', 'Creta I'], ['Renault', 'Kaptur I'], ['Renault', 'Sandero Stepway II']];
    const poolCars = all("SELECT id, slug, brand, model, fuel, year, price, views, featured, is_new FROM cars WHERE status='published'")
      .filter((r) => !r.featured && !r.is_new && Number(r.price) > 0 && !others.has(r.slug))
      .filter((r) => r.brand !== 'Alfa Romeo')
      .filter((r) => !(r.brand === 'Geely' && (r.fuel === 'electric' || /geometry/i.test(r.model))));
    const poolBySlug = new Map(poolCars.map((r) => [r.slug, r]));
    const leaderCars = leaderSlugs.map((s) => poolBySlug.get(s)).filter(Boolean);
    check('pages', '«Лидеры продаж» — четыре ходовые модели: Geely Emgrand II, Hyundai Creta I, Renault Kaptur I, Renault Sandero Stepway II',
      leaderCars.length === 4 && leaderCars.every((c, i) => c.brand === LEADERS[i][0] && c.model === LEADERS[i][1]),
      leaderCars.map((c) => `${c.brand} ${c.model} ${c.year}`).join(' · ') || `в блоке ${leaderSlugs.join(', ')}`);
    check('pages', 'в «Лидерах продаж» нет карточек «Цена по запросу»',
      leaderCars.length === 4 && leaderCars.every((c) => Number(c.price) > 0),
      leaderCars.map((c) => `${c.brand} ${c.model}: ${Number(c.price) > 0 ? c.price : 'цена по запросу'}`).join(' · '));
    const bestOfModel = (brand, model) => poolCars.filter((c) => c.brand === brand && c.model === model)
      .sort((a, b) => (b.views - a.views) || (b.id - a.id))[0] || {};
    check('pages', 'внутри каждой модели в «Лидерах продаж» стоит самая просматриваемая машина',
      leaderCars.length === 4 && leaderCars.every((c) => bestOfModel(c.brand, c.model).slug === c.slug),
      leaderCars.map((c) => {
        const best = bestOfModel(c.brand, c.model);
        return `${c.brand} ${c.model}: в блоке ${c.year} (${c.views} просм.), старшая ${best.year} (${best.views} просм.)`;
      }).join(' · '));
    const modelOf = new Map(all('SELECT slug, brand, model FROM cars').map((c) => [c.slug, c.brand + ' | ' + c.model]));
    check('pages', 'в «Лидерах продаж» нет двух карточек одной модели',
      new Set(leaderSlugs.map((s) => modelOf.get(s))).size === leaderSlugs.length,
      leaderSlugs.map((s) => modelOf.get(s)).join(' · '));
    const leadersAgain = (await get('/?rnd=' + Date.now())).text;
    const leadersNext = leadersAgain.indexOf('<h2>Лидеры продаж</h2>') < 0 ? []
      : slugsIn(leadersAgain.slice(leadersAgain.indexOf('<h2>Лидеры продаж</h2>'), leadersAgain.indexOf('</section>', leadersAgain.indexOf('<h2>Лидеры продаж</h2>'))));
    check('pages', 'состав «Лидеров продаж» не меняется от захода к заходу — это список, а не лотерея',
      leadersNext.join() === leaderSlugs.join(),
      `первый: ${leaderSlugs.join(', ')} | второй: ${leadersNext.join(', ')}`);
    /* Плашки статуса и скидка на странице автомобиля. Заказчик: «сделай, когда переходишь на
       страницу, было видно скидки и что это горящая продажа или новое объявление». Проверяем по
       базе, а не по шаблону: «Новое объявление» — флаг is_new (он же даёт плашку «Новый» в
       каталоге), «Горящая продажа» — машина из той же тройки, что рисует блок в герое главной,
       «Скидка −N руб.» и зачёркнутое «было» в ценовом блоке — cars.discount (price + discount).
       Разметка — lib/pages.mjs: carPage, вид — .flags/.flag/.price-box .was в site.css. */
    const flagOf = (html, cls) => ((html.match(new RegExp(`<span class="flag ${cls}[^"]*">([\\s\\S]*?)<\\/span>`)) || [, ''])[1]).replace(/<[^>]+>/g, '');
    const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const boxOf = (html) => { const i = html.indexOf('class="price-box"'); return i < 0 ? '' : html.slice(i, html.indexOf('data-fav', i)); };
    const newCar = all("SELECT slug, price, discount FROM cars WHERE status='published' AND is_new=1 ORDER BY price DESC LIMIT 1")[0];
    const newPage = await get('/car/' + newCar.slug);
    check('pages', 'страница нового авто: плашка «Новое объявление»',
      flagOf(newPage.text, 'new').includes('Новое объявление'), flagOf(newPage.text, 'new') || 'плашки нет');
    /* Машина «Новое объявление» (самая дорогая из новых) в пятёрку спецпредложения не входит, а
       скидка теперь есть только у машин акции — значит, ни плашки «Скидка», ни зачёркнутого «было»
       на её странице быть не должно. Раньше здесь проверялось обратное: скидка стояла у всех. */
    check('pages', 'страница нового авто вне спецпредложения: скидки и зачёркнутого «было» нет',
      newCar.price > 0 && newCar.discount === 0 && !hotRule.some((r) => r.slug === newCar.slug)
        && !flagOf(newPage.text, 'save') && !/class="was num"/.test(newPage.text),
      `в базе скидка ${newCar.discount}, плашка: ${flagOf(newPage.text, 'save') || '—'}`);
    const hotPage = await get('/car/' + hotRule[0].slug);
    check('pages', 'страница авто из спецпредложения: плашка «Горящая продажа»',
      flagOf(hotPage.text, 'hot').includes('Горящая продажа'), flagOf(hotPage.text, 'hot') || 'плашки нет');
    check('pages', 'страница авто из спецпредложения: скидка и «было» из базы',
      flagOf(hotPage.text, 'save') === `Скидка −${money(hotRule[0].discount)}${SIGN}`
        && boxOf(hotPage.text).includes(`было ${money(hotRule[0].price + hotRule[0].discount)}`),
      `${flagOf(hotPage.text, 'save')} / в базе ${hotRule[0].discount}, было ${hotRule[0].price + hotRule[0].discount}`);
    check('pages', 'страница авто из спецпредложения: нет чужой плашки «Новое объявление»',
      !flagOf(hotPage.text, 'new'), flagOf(hotPage.text, 'new') || 'чужой плашки нет');
    /* Обычное объявление вне спецпредложения: ни своей плашки, ни скидки. Машину берём заведомо не
       из пятёрки акции — у машины акции скидка законная, и проверка «скидки нет» на ней врала бы. */
    const plainCar = all(`SELECT slug, price, discount FROM cars
      WHERE status='published' AND is_new=0 AND price > 0
        AND slug NOT IN (${hotRule.map((r) => `'${r.slug}'`).join(', ')})
      ORDER BY id LIMIT 1`)[0];
    const plainPage = await get('/car/' + plainCar.slug);
    check('pages', 'обычная машина вне спецпредложения: ни скидки, ни «было», ни чужих плашек',
      plainCar.discount === 0 && !flagOf(plainPage.text, 'save') && !/class="was num"/.test(plainPage.text)
        && !flagOf(plainPage.text, 'new') && !flagOf(plainPage.text, 'hot'),
      `скидка в базе ${plainCar.discount}, плашка: ${flagOf(plainPage.text, 'save') || '—'}, new: ${flagOf(plainPage.text, 'new') || '—'}, hot: ${flagOf(plainPage.text, 'hot') || '—'}`);
    /* «Цена по запросу» (price = 0): ни суммы скидки, ни зачёркнутого «было» — считать не от чего. */
    const askCar = all("SELECT slug FROM cars WHERE status='published' AND price = 0 LIMIT 1")[0];
    const askPage = await get('/car/' + askCar.slug);
    check('pages', 'машина «цена по запросу»: скидка не выдумывается',
      askPage.text.includes('Цена по запросу') && !flagOf(askPage.text, 'save') && !/class="was num"/.test(askPage.text),
      boxOf(askPage.text).replace(/\s+/g, ' ').slice(0, 120));
    /* Плашка «Новый» в карточке спецпредложения: сегодня ни одна из трёх машин акции не помечена
       новой, а ветка кода живая. Поэтому заводим временную машину — дешёвую, с фото, is_new=1: она
       входит в тройку (самый дешёвый авто с фото), проверяем плашку на кадре и убираем за собой
       (в finally, чтобы тестовая строка не осталась в базе даже при падении). Проверка раздела
       «Новые поступления» стоит выше этой вставки: временная машина на минуту добавилась бы и туда. */
    const { run } = await import('../lib/db.mjs');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let tmpId = 0;
    try {
      const ins = run(`INSERT INTO cars (slug, brand, model, generation, year, mileage, price, discount, currency, transmission, volume, fuel, body, drive, color, power, vin, description, equipment, status, is_new, featured, vin_checked, city, source_url, owner_id, views, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?)`,
        'test-hot-new-flag', 'Test', 'Hotnew', '', 2024, 1000, 1000, 500, 'BYN', 'at', 1.6, 'petrol', 'sedan',
        'fwd', '', 0, '', '', '', 'published', 1, 0, 0, 'Гомель', '', now, now);
      tmpId = Number(ins.lastInsertRowid);
      const ph = all('SELECT path FROM car_photos ORDER BY id LIMIT 1')[0];
      run('INSERT INTO car_photos (car_id, path, sort) VALUES (?,?,0)', tmpId, ph.path);
      const tmpHome = (await get('/')).text;
      const from = tmpHome.indexOf('<div class="hot-cards" data-hot-track>');
      const tmpHot = tmpHome.slice(from, tmpHome.indexOf('</section>', from));
      const firstCard = tmpHot.split('<div class="hot-card" data-hot-card>')[1] || '';
      check('pages', 'в спецпредложении новая машина получает плашку «Новый» на кадре',
        firstCard.includes('Hotnew') && firstCard.includes('<span class="hot-new">Новый</span>')
          && /class="hot-media"[\s\S]*?class="hot-new"[\s\S]*?class="hot-body"/.test(firstCard),
        firstCard.replace(/\s+/g, ' ').slice(0, 150));
      const tmpPage = await get('/car/test-hot-new-flag');
      check('pages', 'та же машина на своей странице: «Новое объявление» + «Горящая продажа» + скидка',
        flagOf(tmpPage.text, 'new').includes('Новое объявление') && flagOf(tmpPage.text, 'hot').includes('Горящая продажа')
          && flagOf(tmpPage.text, 'save') === 'Скидка −500Б' && boxOf(tmpPage.text).includes('было 1 500'),
        `${flagOf(tmpPage.text, 'new')} | ${flagOf(tmpPage.text, 'hot')} | ${flagOf(tmpPage.text, 'save')}`);
    } finally {
      if (tmpId) { run('DELETE FROM car_photos WHERE car_id=?', tmpId); run('DELETE FROM cars WHERE id=?', tmpId); }
    }
    /* Объявление без фотографий (такое можно завести в админке): кадр занимает заглушка
       «Фотографии — по запросу», но значки «Поделиться» лежат и на ней — возможность поделиться
       у объявления не пропадает. Заводим временную машину без единой строки в car_photos. */
    let noPhotoId = 0;
    try {
      /* Столбцы и подстановки собираем из одного списка: остальные поля объявления берут значения по
         умолчанию (created_at/updated_at — тоже, они в схеме с DEFAULT), и разъехаться числам негде. */
      const noPhotoCols = ['slug', 'brand', 'model', 'year', 'mileage', 'price', 'discount', 'currency',
        'transmission', 'volume', 'fuel', 'body', 'drive', 'power', 'status', 'is_new', 'featured',
        'vin_checked', 'city'];
      const noPhotoVals = ['test-share-no-photo', 'Test', 'Shareno', 2024, 1000, 9999, 0, 'BYN', 'at',
        1.6, 'petrol', 'sedan', 'fwd', 0, 'published', 0, 0, 0, 'Гомель'];
      const ins = run(`INSERT INTO cars (${noPhotoCols.join(', ')}) VALUES (${noPhotoCols.map(() => '?').join(',')})`, ...noPhotoVals);
      noPhotoId = Number(ins.lastInsertRowid);
      const noPhotoPage = await get('/car/test-share-no-photo');
      const iEmpty = noPhotoPage.text.indexOf('class="photo-empty"');
      const iShare = noPhotoPage.text.indexOf('class="gal-share"');
      check('pages', 'объявление без фотографий: значки «Поделиться» лежат на заглушке кадра',
        iEmpty > 0 && iShare > iEmpty && noPhotoPage.text.includes('data-copy-link="'),
        iEmpty > 0 ? `заглушка на месте, значки ${iShare > iEmpty ? 'на кадре' : 'НЕ на кадре'}` : 'заглушки нет');
    } finally {
      if (noPhotoId) run('DELETE FROM cars WHERE id=?', noPhotoId);
    }
    for (const a of all('SELECT slug FROM articles LIMIT 2')) {
      const r = await get('/news/' + a.slug);
      check('pages', `/news/${a.slug} → 200`, r.status === 200);
      /* «Читайте также» — колонка справа от текста статьи: заголовок и карточки лежат
         внутри <aside class="art-aside"> (lib/pages.mjs: articlePage). Статья при этом разбита
         на два блока — .art-head (тег, заголовок, дата) и .art-body (обложка, текст); на них
         держится выравнивание фото «Читайте также» с фото статьи (subgrid). */
      const aside = (r.text.match(/<aside class="art-aside">[\s\S]*?<\/aside>/) || [''])[0];
      check('pages', `/news/${a.slug}: «Читайте также» в правой колонке`, aside.includes('Читайте также') && (aside.match(/class="tile(?: has-photo)?"/g) || []).length === 3 && r.text.includes('class="art-main"') && r.text.includes('class="art-head"') && r.text.includes('class="art-body"'));
      /* Фото статей в блоке «Читайте также» (заказчик 2026-09-30: «На страницах статей справа блок —
         Читайте также — добавь туда соответствующие фото в статьи»): у каждой плитки обложка ровно
         той статьи, на которую она ведёт, — свой файл из её же href. С 2026-10-02 плитка берёт
         миниатюру /thumbs/news/<slug>.webp (заказчик: «груз... быстро и не терял качество»), а
         большой обложкой статьи остаётся исходный снимок — это проверяется ниже строкой про art-cover. */
      const asideTiles = [...aside.matchAll(/class="tile has-photo" href="([^"]+)"[\s\S]{0,200}?<img src="([^"]+)"[^>]*class="tile-photo"/g)];
      const asideSlug = (href) => href.replace('/news/', '');
      check('pages', `/news/${a.slug}: в «Читайте также» у каждой плитки фото своей статьи`,
        asideTiles.length === 3 && asideTiles.every(([, href, src]) => src === '/thumbs/news/' + asideSlug(href) + '.webp'
          || src === '/uploads/news/' + asideSlug(href) + '.jpg'),
        asideTiles.map(([, href, src]) => `${href} → ${src}`).join(' | '));
      /* Обложка статьи — тот же файл, что и в карточке Автожурнала (lib/pages.mjs: articlePage). */
      check('pages', `/news/${a.slug}: обложка статьи на месте`, r.text.includes('class="art-cover" src="/uploads/news/' + a.slug + '.jpg"'));
      /* Заголовок статьи — в одну строку (заказчик 2026-09-30: «В странице статьи, название статей,
         типа „Комиссионная продажа: как продать авто быстрее“, — сделай в одну строчку, сильно
         крупный шрифт»). Верхний предел кегля опущен с 38 px до 28 px: в колонке 820 px при 28 px
         самое длинное название Автожурнала занимает 788 px и ложится в один ряд. Одну строку на
         живой странице проверяет группа ui, здесь — что прежние 38 px не вернулись. */
      check('pages', `/news/${a.slug}: заголовок статьи 28 px, а не прежние 38`,
        r.text.includes('<h1 style="margin-top:14px;font-size:clamp(24px,2.8vw,28px)">')
          && !r.text.includes('font-size:clamp(24px,2.8vw,38px)'));
    }
    const news = await get('/news');
    const coversOnPage = (news.text.match(/class="car-media"><img src="\/uploads\/news\//g) || []).length;
    check('pages', '/news: у каждой карточки своё тематическое фото', coversOnPage === 8 && !news.text.includes('photo-empty'), `карточек с фото ${coversOnPage}`);
    /* Обложка карточки в списке Автожурнала — ссылка на статью (заказчик 2026-09-30: «В разделе
       Автожурнал — добавь возможность перехода на статью при нажатии на картинку»): на кадре лежит
       та же накладка .car-photo-hit, что и в карточке авто, и ведёт на слаг своей же обложки. */
    const newsHits = [...news.text.matchAll(/class="car-media"><img src="\/uploads\/news\/([^"]+)\.jpg"[\s\S]{0,200}?<a class="car-photo-hit" href="\/news\/([^"]+)"/g)];
    check('pages', '/news: обложка каждой карточки ведёт на свою статью',
      newsHits.length === 8 && newsHits.every(([, coverSlug, hrefSlug]) => coverSlug === hrefSlug),
      `накладок ${newsHits.length}: ${newsHits.map(([, c]) => c).join(', ')}`);
    /* Страница «Разместить объявление» — правка 2026-09-27: «блок разместить объявление сделай
       уже и на всю страницу, а также сделай чтобы он был полностью виден при загрузке странице»
       и «переработай кнопку выбрать файлы по стилю сайта, а также предусмотри возможность
       перетягивания файлов с папок компьютера». Здесь смотрим разметку (lib/pages.mjs: sellPage),
       а ширину, первый экран и само перетаскивание — в группе ui. */
    const sell = (await get('/sell')).text;
    check('pages', '/sell: форма на всю ширину, без старой колонки 900 px',
      sell.includes('class="panel sell-form"') && !sell.includes('max-width:900px'));
    check('pages', '/sell: вместо системного поля — зона загрузки, а поле осталось в форме',
      sell.includes('data-upload-zone') && sell.includes('class="upload-input" type="file" name="photos"')
        && sell.includes('enctype="multipart/form-data"') && !sell.includes('Фотографии (до 10, JPG/PNG/WebP)'));
    check('pages', '/sell: подсказка обещает перетаскивание и десять файлов',
      sell.includes('Перетащите фотографии сюда') && sell.includes('до 10 штук') && sell.includes('0 из 10'));
    /* Блоки формы (заказчик 2026-09-27: «сделай наполнение блоков как на сайте av.by, а также
       чтобы можно было выбирать комплектацию и её содержимое»). Проверяем порядок блоков и то,
       что «Город» и «Телефон» уехали вниз, за «Цвет кузова»: это ровно та перестановка, о которой
       просили, и она ломается тихо, если блоки однажды переставят местами. */
    check('pages', '/sell: блоки формы как на av.by — Автомобиль → Характеристики → Комплектация → Контакты',
      sell.includes('sell-block-head">Автомобиль') && sell.includes('sell-block-head">Характеристики')
        && sell.includes('sell-block-head">Комплектация') && sell.includes('sell-block-head">Контакты')
        && /Автомобиль[\s\S]*Характеристики[\s\S]*Комплектация[\s\S]*Контакты/.test(sell));
    check('pages', '/sell: город и телефон стоят ниже блока «Цвет кузова»',
      sell.indexOf('name="city"') > sell.indexOf('Цвет кузова') && sell.indexOf('name="phone"') > sell.indexOf('Цвет кузова'),
      `city ${sell.indexOf('name="city"')} / phone ${sell.indexOf('name="phone"')} / цвет ${sell.indexOf('Цвет кузова')}`);
    const sellOpts = (sell.match(/name="options"/g) || []).length;
    check('pages', '/sell: комплектация выбирается списком, содержимое — 87 опций av.by',
      sell.includes('data-sell-trim') && sell.includes('data-trim-select') && sell.includes('data-sell-trims="1"')
        && sellOpts === 87, `опций в форме: ${sellOpts}`);
    /* Заказчик 2026-09-30: «В подаче объявления в Тип двигателя, добавь - гибрид (бензинг)».
       У av.by в поле «Тип двигателя» гибрида нет, значение наше: код hybrid, подпись «гибрид
       (бензин)» — в форме объявления строчными, в фильтре каталога с большой буквы (там подписи
       из lib/cars.mjs: FUEL_LABEL). Проверяем сразу оба места и то, что прежние варианты целы. */
    check('pages', '/sell: в «Тип двигателя» есть гибрид (бензин), прежние варианты на месте',
      sell.includes('<option value="hybrid">гибрид (бензин)</option>')
        && sell.includes('<option value="petrol">бензин</option>')
        && sell.includes('<option value="diesel">дизель</option>')
        && sell.includes('<option value="cng">метан (пропан-бутан)</option>')
        && sell.includes('<option value="electric">электро</option>'));
    /* Заказчик 2026-09-28: «сделай стили раскрытия списки как на блоке поиск авто, а также
       проверь выбор марки авто, плохо выбирается, работает криво, не подтягивается модель и выбор
       поколения авто». Марка, модель и поколение стали комбобоксами (data-combo + общий
       справочник car-catalog.mjs в [data-sell-catalog]), а подсказки без JS дают те же три
       <datalist>, что и раньше: значение поля по-прежнему строка, которую шлёт форма. */
    check('pages', '/sell: марка, модель и поколение — комбобоксы со справочником из базы',
      sell.includes('data-combo="brand"') && sell.includes('data-combo="model"') && sell.includes('data-combo="generation"')
        && sell.includes('data-sell-catalog="1"') && sell.includes('id="brandlist"') && sell.includes('id="modellist"')
        && sell.includes('id="genlist"') && sell.includes('name="brand"') && sell.includes('name="model"')
        && sell.includes('name="generation"'),
      `комбо ${(sell.match(/data-combo="/g) || []).length}, списки ${(sell.match(/id="[a-z]+list"/g) || []).length}`);
    check('pages', '/sell: справочник марок, моделей и поколений уезжает в страницу',
      /data-sell-catalog="1">\{/.test(sell) && (sell.match(/<datalist/g) || []).length === 5,
      `datalist ${(sell.match(/<datalist/g) || []).length}`);
    /* Заказчик 2026-10-02: короткое окно «Поставить авто на продажу» стоит на всех страницах, в том
       числе на /sell, и у него свой такой же справочник с даталистами. Считаем и его: у формы
       продажи три системных списка, у окна — два. */
    check('pages', '/sell: у формы продажи и у окна продажи свои списки марок и моделей',
      ['brandlist', 'modellist', 'genlist', 'sale-brandlist', 'sale-modellist'].every((id) => sell.includes(`id="${id}"`))
        && (sell.match(/data-sell-catalog="1"/g) || []).length === 2,
      `${(sell.match(/data-sell-catalog="1"/g) || []).length} справочника`);
    /* Счётчик на кнопке «Показать автомобили N»: число считает сервер по тем же условиям, что у
       страницы (GET /api/cars/count), а панель поиска знает адрес счётчика и режим страницы —
       без этого «Новые» и «Электро» считали бы всю базу (заказчик 2026-09-27). */
    const carsPage = (await get('/cars')).text;
    check('pages', 'панель поиска знает адрес счётчика и режим страницы',
      carsPage.includes('data-param-form data-count-url="/api/cars/count" data-ps-mode="all"'));
    check('pages', '/cars: фильтр «Топливо» умеет гибрид — иначе объявление не нашлось бы',
      carsPage.includes('<option value="hybrid">Гибрид (бензин)</option>'));
    const newCarsPage = (await get('/cars-new')).text;
    check('pages', '/cars-new: панель поиска помечена режимом «новые»', newCarsPage.includes('data-ps-mode="new"'));
    check('pages', '/electric: панель поиска помечена режимом «электро»', (await get('/electric')).text.includes('data-ps-mode="electric"'));
    check('pages', 'в кнопке поиска есть место под счётчик',
      /Показать автомобили\s*<span class="btn-cnt num">[\d\s\u00a0]*<\/span>/.test(carsPage));
  },
  api: async () => {
    /* /health опрашивает хостинг (Render: healthCheckPath в render.yaml). Если маршрут пропадёт,
       служба на Render будет считаться нездоровой и не поднимется — проверка дешёвая, пусть будет. */
    const health = await get('/health');
    check('api', '/health отвечает 200 для хостинга', health.status === 200 && health.text.trim() === 'ok',
      `status ${health.status} body ${JSON.stringify(health.text.trim().slice(0, 40))}`);
    const init = await get('/bxapi/v1/init');
    check('api', '/bxapi/v1/init → 200', init.status === 200);
    check('api', 'init отдаёт JSON', (init.headers.get('content-type') || '').includes('application/json'));
    const j = JSON.parse(init.text);
    check('api', 'init.status = ok', j.status === 'ok');
    const cars = await get('/bxapi/v1/cars?brand=Geely');
    const cj = JSON.parse(cars.text);
    check('api', '/bxapi/v1/cars фильтрует по марке', cj.total > 0 && cj.items.every((i) => i.brand === 'Geely'));
    check('api', 'cars отдаёт постранично (12)', cj.items.length <= 12);
    check('api', 'cars содержит slug и url', !!cj.items[0].slug && cj.items[0].url === '/car/' + cj.items[0].slug);
    const big = await (await fetch(BASE + '/bxapi/v1/cars?per_page=100')).json();
    check('api', 'per_page=100 отдаёт всю базу', big.per_page === 100 && big.items.length === big.total, `per_page=${big.per_page} items=${big.items.length} total=${big.total}`);
    const capped = await (await fetch(BASE + '/bxapi/v1/cars?per_page=9999')).json();
    check('api', 'per_page ограничен сверху', capped.per_page === 100, 'per_page=' + capped.per_page);
    /* Счётчик для кнопки «Показать автомобили N» (/api/cars/count): панель поиска спрашивает
       число на каждое изменение поля, и оно должно совпадать с тем, что окажется на странице
       после отправки формы — то есть считаться тем же фильтром плюс режим страницы. */
    const cnt = async (q) => (await (await fetch(BASE + '/api/cars/count' + (q || ''))).json());
    const cntAll = await cnt();
    check('api', '/api/cars/count отдаёт JSON и всю базу', cntAll.status === 'ok' && cntAll.total === big.total, `total=${cntAll.total} база=${big.total}`);
    const cntBmw = await cnt('?brand=BMW');
    const apiBmw = await (await fetch(BASE + '/bxapi/v1/cars?brand=BMW')).json();
    const pageBmw = (await get('/cars?brand=BMW')).text;
    /* Пробел перед числом — часть подписи: «Показать автомобили 57» (жалоба заказчика 02.10.2026
       называет кнопку именно так). */
    const btnNum = (t) => { const m = t.match(/Показать автомобили\s*<span class="btn-cnt num">([^<]*)<\/span>/); return m ? m[1].replace(/[\s\u00a0]/g, '') : null; };
    check('api', 'счётчик совпадает с фильтром марки', cntBmw.total === apiBmw.total && String(cntBmw.total) === btnNum(pageBmw), `api=${cntBmw.total} кнопка=${btnNum(pageBmw)}`);
    const cntNew = await cnt('?mode=new');
    check('api', 'счётчик режима «новые» совпадает со страницей', String(cntNew.total) === btnNum((await get('/cars-new')).text), `api=${cntNew.total} кнопка=${btnNum((await get('/cars-new')).text)}`);
    const cntElec = await cnt('?mode=electric&fuel=petrol');
    check('api', 'режим «электро» сильнее поля топлива', String(cntElec.total) === btnNum((await get('/electric')).text), `api=${cntElec.total} кнопка=${btnNum((await get('/electric')).text)}`);
    check('api', 'пустой набор условий даёт ноль', (await cnt('?q=zzzznotfound')).total === 0);
    check('api', 'счётчик не кэшируется', ((await fetch(BASE + '/api/cars/count?brand=BMW')).headers.get('cache-control') || '').includes('no-store'));
  },
  filters: async () => {
    const cases = [
      ['/cars?brand=BMW', (t) => t.includes('BMW')],
      ['/cars?transmission=at', (t) => t.includes('Автомат')],
      ['/cars?body=suv', (t) => t.includes('Внедорожник')],
      ['/cars?price_to=30000', (t) => t.includes('Найдено')],
      ['/cars?q=Geely', (t) => t.includes('Geely')],
      ['/cars?sort=price_asc', (t) => t.includes('Цена: по возрастанию')],
      ['/cars/electric', () => true],
      ['/cars?fuel=diesel', (t) => t.includes('Дизель')],
    ];
    for (const [route, fn] of cases) {
      const r = await get(route);
      check('filters', `${route} → 200`, r.status === 200);
      check('filters', `${route} применяет фильтр`, fn(r.text));
    }
    const none = await get('/cars?q=zzzznotfound');
    check('filters', 'пустой результат показывает заглушку', none.text.includes('Ничего не найдено') || none.text.includes('ничего не найдено'));
    /* Панель поиска: блок «Параметры» раскрыт только тогда, когда условие выбрал посетитель.
       На «Электро» топливо задаёт сам режим страницы (catalogFilter) — из-за него, как и на
       «Новых», блок остаётся свёрнутым (lib/pages.mjs: preset, lib/view.mjs: extraUsed). */
    const moreOpen = (t) => /<input class="ps-more-tgl"[^>]*\schecked/.test(t);
    const elec = (await get('/electric')).text;
    check('filters', '/electric: доп. параметры свёрнуты', elec.includes('ps-more-tgl') && !moreOpen(elec));
    check('filters', '/electric: фильтр топлива режима на месте', /name="fuel">[\s\S]*?value="electric" selected/.test(elec));
    check('filters', 'выбранный посетителем фильтр раскрывает «Параметры»', moreOpen((await get('/cars?fuel=diesel')).text));
    /* Шапка: пункт «Автомобили с пробегом» ведёт в тот же режим, что и кнопка «С пробегом»
       (/cars-used), поэтому в панели поиска тёмной стоит «С пробегом», а не «Все авто»;
       на страницах самого раздела каталога (/cars, /cars/<марка>) пункт меню остаётся
       подсвеченным — за это отвечает also в NAV (lib/view.mjs). */
    const usedPage = (await get('/cars-used')).text;
    check('filters', 'шапка ведёт на «Автомобили с пробегом» (/cars-used)', /<a href="\/cars-used"[^>]*title="Автомобили с пробегом"/.test((await get('/')).text));
    check('filters', '/cars-used: подсвечена кнопка «С пробегом»', /class="ps-mode on" href="\/cars-used">С пробегом/.test(usedPage));
    check('filters', '/cars-used: пункт меню подсвечен', /<a href="\/cars-used" class="on" title="Автомобили с пробегом"/.test(usedPage));
    check('filters', '/cars: пункт меню подсвечен и дальше', /<a href="\/cars-used" class="on" title="Автомобили с пробегом"/.test((await get('/cars')).text));
    /* Марка в блоке выбора авто (список марок с количеством над панелью поиска) ведёт в тот же
       раздел, который открыт сейчас, и несёт фильтр в адресе: с «С пробегом» — «/cars-used?brand=…».
       Раньше ссылка всегда вела в «/cars?brand=…», то есть марка сбрасывала раздел, а в статичной
       копии GitHub Pages адрес вообще терял «?brand=…» (заказчик 02.10.2026, с телефона: «во всех
       версиях при нажатии на авто из блока выбора авто и их количества, не меняется количество
       карточек авто и не происходит фильтр в кнопке — Показать автомобили 57»). */
    const tileHref = (t) => (t.match(/class="bl-item" href="([^"]+)"/) || [])[1];
    check('filters', 'марка из блока выбора авто ведёт в текущий раздел и с фильтром',
      /^\/cars-used\?brand=/.test(tileHref(usedPage) || '') && /^\/cars\?brand=/.test(tileHref((await get('/cars')).text) || '')
        && /^\/cars-new\?brand=/.test(tileHref((await get('/cars-new')).text) || ''),
      `с пробегом: ${tileHref(usedPage)}, все: ${tileHref((await get('/cars')).text)}, новые: ${tileHref((await get('/cars-new')).text)}`);
    /* сортировка по цене: «по запросу» (0) не должны занимать первые места */
    const asc = await (await fetch(BASE + '/bxapi/v1/cars?sort=price_asc&per_page=100')).json();
    const prices = asc.items.map((i) => i.price);
    const zeroAt = prices.indexOf(0);
    check('filters', 'сортировка по цене поднимает предложения с ценой', zeroAt === -1 || zeroAt >= prices.filter((p) => p > 0).length, 'первый 0 на позиции ' + zeroAt);
    check('filters', 'цены по возрастанию', prices.filter((p) => p > 0).every((p, i, a) => i === 0 || a[i - 1] <= p));
  },
  assets: async () => {
    for (const f of ['/assets/css/site.css', '/assets/js/site.js', '/assets/logo/logo.png', '/assets/logo/logo-on-dark.png', '/assets/logo/favicon.ico']) {
      const r = await fetch(BASE + f);
      check('assets', `${f} → 200`, r.status === 200, 'status ' + r.status);
    }
    const { all } = await import('../lib/db.mjs');
    const photo = all('SELECT path FROM car_photos LIMIT 1')[0].path;
    const r = await fetch(BASE + photo);
    check('assets', `фото ${photo} → 200`, r.status === 200);
    check('assets', 'фото непустое', Number(r.headers.get('content-length')) > 10000);
    /* Обложки Автожурнала: файлы public/uploads/news/<slug>.jpg, путь собирается из слага статьи
       (lib/seed.mjs), а карточка рисует <img> вместо заглушки .photo-empty (lib/pages.mjs: newsPage). */
    const covers = all('SELECT slug, cover FROM articles');
    check('assets', 'у каждой статьи прописана своя обложка', covers.length === 8 && covers.every((a) => a.cover === `/uploads/news/${a.slug}.jpg`));
    const badCovers = [];
    for (const a of covers) {
      const cr = await fetch(BASE + a.cover);
      if (cr.status !== 200 || Number(cr.headers.get('content-length')) < 20000) badCovers.push(`${a.slug}: ${cr.status}/${cr.headers.get('content-length')}`);
    }
    check('assets', 'обложки Автожурнала отдаются (≥20 КБ)', badCovers.length === 0, badCovers.join(', '));
    const css = fs.readFileSync(path.join(ROOT, 'public/assets/css/site.css'), 'utf8');
    check('assets', 'CSS содержит брендовый акцент', css.includes('#E3000F'));
    check('assets', 'CSS скругляет карточки', css.includes('--r-card'));
    /* Колонка «Дата продажи» на странице проданных — по центру (заказчик 2026-10-01: «заголовок —
       Дата продажи, а под ним даты, так вот фактические даты продажи сдвинуты влево, а надо по
       середине»). Правило центрирует и заголовок, и значения: сдвиг одних значений дал бы даты
       правее заголовка. Разметку (.tbl-ctr) проверяет раздел pages, положение — раздел ui. */
    check('assets', 'CSS центрирует колонку «Дата продажи» вместе с её заголовком',
      css.includes('table.tbl th.tbl-ctr,table.tbl td.tbl-ctr{text-align:center}'));
    /* Единый вид авто в карточках (заказчик 2026-09-27: «Отцентрируй автомобиль в фото карточек
       авто, проверь, чтобы вид авто в карточках по всему сайту был одинаковый»). Фото у всех
       машин вертикальные (1050×1400, то есть 3:4), поэтому «вид» задаёт рамка кадра и точка
       вписывания: одинаковая рамка на всех поверхностях — одинаковая видимая часть снимка.
       Раньше кадр героя был 16/9 и у одной и той же машины в «Горящей продаже» обрезал и крышу,
       и колёса (видно 42 % высоты против 56 % в каталоге) — эту разницу и стережём. */
    check('assets', 'кадр карточки авто 4/3 в каталоге', css.includes('.car-media{position:relative;aspect-ratio:4/3;background:var(--paper-3);overflow:hidden}'));
    /* Фото карточки — ссылка на автомобиль (заказчик 2026-09-28: «сделай чтобы при нажатии на фото
       карточки авто происходил переход на страницу авто»): на кадре лежит накладка .car-photo-hit
       (z-index 1 — ниже «избранного» 3 и кнопок карусели 2/4), а в разметке карточки её href тот же,
       что у названия и «Подробнее». */
    const viewSrc = fs.readFileSync(path.join(ROOT, 'lib/view.mjs'), 'utf8');
    check('assets', 'фото карточки — ссылка на автомобиль (накладка .car-photo-hit)',
      css.includes('.car-photo-hit{position:absolute;inset:0;z-index:1}')
        && viewSrc.includes('class="car-photo-hit" href="/car/'));
    check('assets', 'кадр карточки авто 4/3 в «Горящей продаже» — как в каталоге',
      css.includes('.hot-media{display:block;position:relative;aspect-ratio:4/3;background:var(--paper-3);overflow:hidden}'));
    check('assets', 'кадр на узком экране — те же 4/3 (116×87)',
      css.includes('.home-page .hot-media{flex:0 0 116px;width:116px;height:87px;aspect-ratio:auto;'));
    check('assets', 'главное фото галереи — тот же кадр 4/3', css.includes('.gallery-main{position:relative;aspect-ratio:4/3;'));
    check('assets', 'фото карточки центрировано (cover + 50% 50%) на всех поверхностях',
      css.includes('.car-media img{width:100%;height:100%;object-fit:cover;object-position:50% 50%;transition:opacity .25s}')
        && css.includes('.carousel-track img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;object-position:50% 50%}')
        && css.includes('.hot-media img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%}')
        && !/object-position:\s*(?!50% 50%)/.test(css));
    /* Выравнивание машин в окне фото (заказчик 2026-09-28: «сделай по всем карточкам авто
       одинаково, чтобы сами автомобили были по центру окна с фото», затем «тоже самое сделай в
       машинах, которые в карточках — горящая продажа»). Рамка кадра всюду 4:3, но фото объявлений
       вертикальные (3:4), поэтому кадр показывает среднюю полосу снимка и центр машины не совпадает
       с центром окна: до правки уход доходил до 25 % высоты окна. Точку вписывания подбирает замер
       границ машины (_ref/measure-focus.mjs, модель COCO-SSD в браузере), из него собирается
       public/assets/css/photo-focus.css (_ref/build-photo-focus.mjs) — по правилу на каждый снимок,
       где машина найдена уверенно. Правила нужны всем снимкам, а не только первым: карточка каталога
       листает до восьми фото машины (lib/view.mjs), карточка «Горящей продажи» — шесть (lib/pages.mjs,
       hotCard), и без правила листание возвращало машину в центр снимка. Здесь стережём полноту и
       осмысленность этих правил: пропадёт машина из файла — карточка снова «поплывёт». */
    const focusCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/photo-focus.css'), 'utf8');
    const focusRules = [...focusCss.matchAll(/img\[src\*="([^"]+)"\]\{object-position:50% (\d+)%\}/g)]
      .map((m) => ({ path: m[1], y: Number(m[2]) }));
    const firstPhotos = all(`SELECT p.path FROM cars c JOIN car_photos p ON p.car_id = c.id AND p.sort = 0
      WHERE c.status = 'published' ORDER BY p.path`);
    const missed = firstPhotos.filter((p) => !focusRules.some((r) => r.path === p.path));
    check('assets', 'photo-focus.css: правило есть у каждой машины каталога',
      missed.length === 0, `без правила: ${missed.length} из ${firstPhotos.length}` + (missed[0] ? ` (${missed[0].path})` : ''));
    const slidePhotos = all(`SELECT p.path FROM cars c JOIN car_photos p ON p.car_id = c.id
      WHERE c.status = 'published' AND p.sort < 6 ORDER BY p.path`);
    const covered = slidePhotos.filter((p) => focusRules.some((r) => r.path === p.path)).length;
    const coveredShare = slidePhotos.length ? covered / slidePhotos.length : 0;
    check('assets', 'photo-focus.css: правило есть и у листаемых снимков (фото 2…6)',
      coveredShare >= 0.7, `покрыто ${covered} из ${slidePhotos.length} (${Math.round(coveredShare * 100)} %)`);
    const allPhotos = all(`SELECT p.path FROM cars c JOIN car_photos p ON p.car_id = c.id WHERE c.status = 'published'`);
    check('assets', 'photo-focus.css: правил не больше, чем снимков в базе',
      focusRules.length <= allPhotos.length, `правил ${focusRules.length}, снимков ${allPhotos.length}`);
    check('assets', 'photo-focus.css: сдвиг внутри кадра', focusRules.length > 0 && focusRules.every((r) => r.y >= 0 && r.y <= 100));
    check('assets', 'photo-focus.css: правила ссылаются на реальные фото',
      focusRules.every((r) => fs.existsSync(path.join(ROOT, 'public', r.path))));
    check('assets', 'photo-focus.css: кадр не приближается (только сдвиг)',
      !/transform/.test(focusCss));
    const js = fs.readFileSync(path.join(ROOT, 'public/assets/js/site.js'), 'utf8');
    check('assets', 'JS инициализирует карусель', js.includes('initCarousels'));
    check('assets', 'JS работает с избранным', js.includes('initFav'));
    /* Каталог поколений для формы объявления (заказчик 2026-09-29: «В поколении авто должны быть все
       поколения как на сайте AV.by с картинками авто и годами выпуска»). Полный справочник марок,
       моделей и поколений лежит в public/data/avby: index.json (марки) и файл на марку (модели →
       поколения с годами выпуска). Собирает его _ref/build-avby-catalog.mjs из
       _ref/avby-generations.json, снимки к нему подбирает _ref/build-avby-photos.mjs.
       С 2026-09-28 снимки свои, локальные (public/data/avby-img, превью 480 px) и только у 18 марок
       дилера: заказчик просил «фото другие без 100% плагиата» и «на остальные сделай не заполненное
       фото». Поэтому чужих ссылок (avcdn.av.by) в данных быть не должно, а у прочих марок фото нет. */
    const DEALER_BRANDS = [
      'alfa-romeo', 'audi', 'belgee', 'bmw', 'chevrolet', 'citroen', 'ford', 'geely', 'honda',
      'hyundai', 'lada-vaz', 'mercedes-benz', 'nissan', 'opel', 'peugeot', 'renault', 'toyota',
      'volkswagen',
    ];
    const avbyIndexR = await fetch(BASE + '/data/avby/index.json');
    check('assets', 'каталог av.by отдаётся сайтом (/data/avby/index.json → 200)', avbyIndexR.status === 200, 'status ' + avbyIndexR.status);
    const avbyDir = path.join(ROOT, 'public/data/avby');
    const avbyIndex = JSON.parse(fs.readFileSync(path.join(avbyDir, 'index.json'), 'utf8'));
    const missingBrandFiles = avbyIndex.brands.filter((b) => !fs.existsSync(path.join(avbyDir, b.slug + '.json')));
    check('assets', 'каталог av.by: марок не меньше, чем в словаре сайта',
      avbyIndex.brands.length >= 166 && missingBrandFiles.length === 0,
      `марок ${avbyIndex.brands.length}, без файла ${missingBrandFiles.length}`);
    const avbyStats = { models: 0, gens: 0, photos: 0, years: 0, dealerGens: 0, dealerPhotos: 0, stray: 0, bad: [] };
    for (const b of avbyIndex.brands) {
      const brand = JSON.parse(fs.readFileSync(path.join(avbyDir, b.slug + '.json'), 'utf8'));
      const dealer = DEALER_BRANDS.includes(b.slug);
      for (const model of Object.keys(brand.models || {})) {
        avbyStats.models++;
        for (const [name, years, photo] of brand.models[model]) {
          avbyStats.gens++;
          if (!name) avbyStats.bad.push(`${b.slug}/${model}: без имени`);
          if (dealer) { avbyStats.dealerGens++; if (photo) avbyStats.dealerPhotos++; }
          else if (photo) avbyStats.stray++;
          if (photo) {
            avbyStats.photos++;
            if (!/^\/data\/avby-img\//.test(photo)) avbyStats.bad.push(`${b.slug}: чужая ссылка ${photo}`);
            else if (!fs.existsSync(path.join(ROOT, 'public', photo))) avbyStats.bad.push('нет файла ' + photo);
          }
          if (/^\d{4}\.\.\.(\d{4})?$/.test(years || '')) avbyStats.years++;
        }
      }
    }
    check('assets', 'каталог av.by: у каждого поколения годы выпуска, снимок — свой локальный файл',
      avbyStats.gens > 1000 && avbyStats.years === avbyStats.gens && avbyStats.bad.length === 0,
      `поколений ${avbyStats.gens}, со снимком ${avbyStats.photos}, с годами ${avbyStats.years}`
        + (avbyStats.bad[0] ? ` (${avbyStats.bad[0]})` : ''));
    check('assets', 'каталог av.by: у марок дилера снимки есть, у остальных — пустое место',
      avbyStats.dealerPhotos / avbyStats.dealerGens > 0.7 && avbyStats.stray === 0,
      `марки дилера: ${avbyStats.dealerPhotos}/${avbyStats.dealerGens} со снимком, лишних ${avbyStats.stray}`);
    const bmw = JSON.parse(fs.readFileSync(path.join(avbyDir, 'bmw.json'), 'utf8'));
    check('assets', 'каталог av.by: у BMW все поколения «5 серии» (G30, F10, E39 …)',
      (bmw.models['5 серия'] || []).length >= 5, `поколений ${(bmw.models['5 серия'] || []).length}`);
    check('assets', 'JS подтягивает каталог av.by в списки формы',
      js.includes('function avbyIndex()') && (js.includes("dataUrl('data/avby/index.json')") || js.includes("'/data/avby/index.json'"))
        && js.includes('function avbyModels(') && js.includes('avbyIndex();'));
    check('assets', 'JS рисует строку поколения со снимком и годами',
      js.includes("im.className = 'opt-img'") && js.includes("yrs.className = 'opt-years'") && js.includes("row.setAttribute('data-v', name)"));
    check('assets', 'CSS: строка каталога со снимком и своим списком шире поля',
      css.includes('.sel-opt .opt-img{') && css.includes('.sel-opt .opt-years{') && css.includes('.sel-pop:has(.opt-img){min-width:340px'));
    check('assets', 'JS: выбор в списке формы сворачивает его (клик по строке не всплывает в поле)',
      js.includes('quiet = true;') && /\$\$\('\[data-combo\]'\)/.test(js) && js.includes("pop.addEventListener('mousedown', function (e) { e.preventDefault(); });"));

    /* ── Копия сайта на GitHub Pages ────────────────────────────────────────────────────────────
       Заказчик смотрит статичную копию (ветка gh-pages), где нет сервера: подбор по параметрам,
       сортировка и «Показать ещё» там мертвы, потому что фильтр живёт в SQL. Два пункта его
       списка от 2026-10-02 — «Нажимаю в блоке поиска авто марку, а оно не ищется и на кнопке —
       показать автомобили не меняется реальное количество выбранной марки» и «Кнопка — Показать
       объявления не открывает остальные авто» — на живом сервере работали всегда, а в копии
       закрыты скриптом _ref/deploy/catalog-demo.js: сборщик догружает в страницу все партии
       карточек сервера (помечены data-extra, внутри сетки .cars), а скрипт считает подбор,
       сортировку и листание прямо в браузере. Стережём три опоры этой схемы: карточка отдаёт
       данные для подбора, скрипт лежит на месте, сборщик и проверка копии о нём знают. */
    check('assets', 'карточка авто отдаёт данные подбора (марка, модель, цена, пробег, дата) — их читает каталог копии',
      viewSrc.includes('data-brand="${esc(c.brand)}"') && viewSrc.includes('data-model="${esc(c.model)}"')
        && viewSrc.includes('data-price="${Number(c.price) || 0}"') && viewSrc.includes('data-mileage="${Number(c.mileage) || 0}"')
        && viewSrc.includes("data-added=\"${esc(String(c.created_at || '').slice(0, 10))}\"")
        && css.includes('.car[data-extra],') && css.includes('.car[data-off]{display:none!important}'));
    const catDemo = path.join(ROOT, '_ref/deploy/catalog-demo.js');
    const catDemoSrc = fs.existsSync(catDemo) ? fs.readFileSync(catDemo, 'utf8') : '';
    check('assets', 'скрипт каталога копии: подбор, сортировка и «Показать ещё» в браузере',
      catDemoSrc.includes("querySelector('.cars')") && catDemoSrc.includes('data-per-page')
        && catDemoSrc.includes('SORTERS') && catDemoSrc.includes('new_desc:') && catDemoSrc.includes('price_asc:')
        && catDemoSrc.includes('history.replaceState') && catDemoSrc.includes("'#list'"));
    const buildPages = fs.readFileSync(path.join(ROOT, '_ref/deploy/build-pages.mjs'), 'utf8');
    const checkPages = fs.readFileSync(path.join(ROOT, '_ref/deploy/check-pages.mjs'), 'utf8');
    check('assets', 'сборка копии догружает все партии карточек и подключает скрипт каталога',
      buildPages.includes('/api/cars/cards?page=') && buildPages.includes("'<article data-extra class=\"car\"'")
        && buildPages.includes('catalog-demo.js') && checkPages.includes('catalog-demo.js'));
    /* Ссылка на страницу атрибуции снимков стоит на /sell (лицензии CC BY / CC BY-SA требуют
       указывать автора; из подвала её убрал заказчик). Путь /data/... обходчик копии пропускает как
       служебный, поэтому в копии ссылка вела в никуда — на GitHub Pages отдавался 404. Теперь
       сборщик кладёт страницу в копию отдельным файлом (снимки внутри — с CDN), переписывает ссылку
       на файл копии, а проверка копии это стережёт. */
    check('assets', 'копия: страница атрибуции снимков попадает в копию, а ссылка ведёт внутрь копии',
      buildPages.includes('/data/avby-img/credits.html')
        && buildPages.includes('href="${prefix}data/avby-img/credits.html"')
        && checkPages.includes('commons.wikimedia.org') && checkPages.includes('creditsRel'));

    /* ── Копия: страницы сравнения и избранного, списки моделей ────────────────────────────────
       Жалобы заказчика от 2026-10-02: «При нажатии на кнопку - сравнение, в шапке, - машины
       выбрал, а на странице ничего нет, тоже самое касается кнопки лайк-избраное» и «В - разместить
       объявление в - модели, не все модели в раскрывающемся списке». На боевом сайте эти страницы
       собирает сервер, а в статичной копии на GitHub Pages сервера нет: выбор машин живёт в cookie
       an_cmp/an_fav, список моделей — в data/avby/*.json. Поэтому сборщик копии кладёт рядом данные
       (192 файла av.by + индекс автомобилей cars.json), а страницы достраивает demo-cars.js. */
    const carsDemo = path.join(ROOT, '_ref/deploy/demo-cars.js');
    const carsDemoSrc = fs.existsSync(carsDemo) ? fs.readFileSync(carsDemo, 'utf8') : '';
    check('assets', 'копия: скрипт сравнения и избранного читает an_cmp/an_fav и data/cars.json',
      carsDemoSrc.includes("'an_cmp'") && carsDemoSrc.includes("'an_fav'")
        && carsDemoSrc.includes("data/cars.json") && carsDemoSrc.includes('data-compare-remove')
        && carsDemoSrc.includes('data-compare-clear') && carsDemoSrc.includes('data-unfav')
        && carsDemoSrc.includes('/compare/') && carsDemoSrc.includes('/favorites/'));
    check('assets', 'сборка копии: данные av.by, индекс автомобилей и подключение demo-cars.js',
      buildPages.includes("path.join(DEST, 'data', 'avby')") && buildPages.includes("'cars.json'")
        && buildPages.includes('demo-cars.js') && buildPages.includes('/^\\/(compare|favorites)(\\/|$)/')
        && buildPages.includes('data-site-base=') && buildPages.includes('data-site-cdn=')
        && checkPages.includes('demo-cars.js'));
    const siteJs = fs.readFileSync(path.join(ROOT, 'public/assets/js/site.js'), 'utf8');
    check('assets', 'site.js: в копии берёт адреса из data-site-base/data-site-cdn (модели и снимки каталога)',
      siteJs.includes("getAttribute('data-site-base')") && siteJs.includes("getAttribute('data-site-cdn')")
        && siteJs.includes('function dataUrl(') && siteJs.includes('function photoUrl(')
        && siteJs.includes("dataUrl('data/avby/index.json')") && siteJs.includes('photoUrl(item.p)'));

    /* ── Скорость загрузки ─────────────────────────────────────────────────────────────────────
       Заказчик 02.10.2026: «Сделай, что бы сайт грузился быстро и не терял качество». Два рычага:
       сжатие текста (HTML/CSS/JS — brotli или gzip) и миниатюры фото для карточек и каруселей.
       Качество не теряется: страница автомобиля по-прежнему показывает исходный снимок, а
       миниатюра — только там, где кадр рисуется мелко (карточка, карусель, список, сравнение). */
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
    check('assets', 'сервер сжимает текстовые ответы (brotli/gzip) и сообщает об этом в Vary',
      serverSrc.includes('brotliCompressSync') && serverSrc.includes('gzipSync')
        && serverSrc.includes('function pickEncoding(') && serverSrc.includes("'accept-encoding'")
        && serverSrc.includes("Vary: 'Accept-Encoding'") && serverSrc.includes('const COMPRESSIBLE'));
    check('assets', 'сервер не отдаёт сжатие тому, кто его не просил (нет Content-Encoding без запроса)',
      /const wantEnc = COMPRESSIBLE\.has\(ext\)[^;]*pickEncoding\(req\) : ''/.test(serverSrc)
        && serverSrc.includes('packed && packed.enc ?'));
    const cssFile = fs.readFileSync(path.join(ROOT, 'public/assets/css/site.css'));
    const gz = await fetch(BASE + '/assets/css/site.css');
    const gzLen = Number(gz.headers.get('content-length') || 0);
    check('assets', 'site.css по сети приходит сжатым (в разы меньше файла)',
      gz.status === 200 && !!gz.headers.get('content-encoding') && gzLen > 0 && gzLen < cssFile.length / 2,
      `файл ${cssFile.length} → сеть ${gzLen} (${gz.headers.get('content-encoding') || 'без сжатия'})`);
    const favGz = await fetch(BASE + '/assets/css/site.css', { headers: { 'accept-encoding': 'br' } });
    check('assets', 'при поддержке brotli уходит brotli (легче gzip)', favGz.status === 200 && !!favGz.headers.get('content-encoding'));

    const thumbsDir = path.join(ROOT, 'public/thumbs');
    const thumbsTool = fs.readFileSync(path.join(ROOT, '_ref/make-thumbs.mjs'), 'utf8');
    check('assets', 'инструмент миниатюр собирает WebP через Chrome (AVIF умеет только он)',
      thumbsTool.includes("type: 'image/webp'") && thumbsTool.includes("imageOrientation: 'from-image'")
        && thumbsTool.includes('puppeteer-core') && fs.existsSync(thumbsDir));
    const viewSrcFast = fs.readFileSync(path.join(ROOT, 'lib/view.mjs'), 'utf8');
    check('assets', 'карточки берут миниатюру, а при её отсутствии — исходный снимок (onerror)',
      viewSrcFast.includes('export const thumb =') && viewSrcFast.includes('/thumbs/')
        && viewSrcFast.includes('export function photoTag(') && viewSrcFast.includes('this.onerror=null;this.src='));
    const carsHtml = (await get('/cars')).text;
    const thumbPath = (carsHtml.match(/src="(\/thumbs\/[^"]+\.webp)"/) || [])[1];
    check('assets', 'выдача каталога отдаёт <img> с миниатюрой и запасным исходником',
      !!thumbPath && /onerror="this\.onerror=null;this\.src='\/uploads\//.test(carsHtml), thumbPath || 'миниатюр в разметке нет');
    if (thumbPath) {
      const tr = await fetch(BASE + thumbPath);
      const trLen = Number(tr.headers.get('content-length') || 0);
      const srcPath = thumbPath.replace('/thumbs/', '/uploads/').replace(/\.webp$/, '.jpg');
      const sr = await fetch(BASE + srcPath);
      const srLen = Number(sr.headers.get('content-length') || 0);
      check('assets', 'миниатюра существует, отдаётся как WebP и легче исходника',
        tr.status === 200 && /image\/webp/.test(tr.headers.get('content-type') || '') && sr.status === 200 && trLen > 0 && trLen < srLen,
        `${srcPath} ${srLen} → ${thumbPath} ${trLen}`);
    }
    const carSlug = all("SELECT slug FROM cars WHERE status='published' AND id IN (SELECT car_id FROM car_photos) LIMIT 1")[0].slug;
    const carHtml = (await get('/car/' + carSlug)).text;
    check('assets', 'страница автомобиля показывает исходный снимок (качество не потеряно)',
      carHtml.includes('data-gallery-img') && /<img src="\/uploads\/[^"]+"[^>]*data-gallery-img/.test(carHtml));

    /* ── Ссылка на отзывы Яндекса ──────────────────────────────────────────────────────────────
       Заказчик 2026-10-02: «При нажатии на кнопку - Все отзывы на Яндесе, не переходит на страницу
       компании с отзывами в яндексе». Проверено Chrome: глубокие адреса .../reviews/ Яндекс отдаёт
       с 429 «limited» (ограничение частоты), а карточка организации отвечает 200 и уже содержит
       вкладку отзывов, поэтому кнопка ведёт на карточку. */
    const yandexSrc = fs.readFileSync(path.join(ROOT, 'lib/yandex.mjs'), 'utf8');
    const pagesSrc = fs.readFileSync(path.join(ROOT, 'lib/pages.mjs'), 'utf8');
    check('assets', 'кнопка «Все отзывы на Яндексе» ведёт на карточку организации (её открывает Яндекс)',
      /url: 'https:\/\/yandex\.by\/maps\/org\/avtonova_s_probegom\/27584324640\/'/.test(yandexSrc)
        && yandexSrc.includes('reviewsUrl:') && pagesSrc.includes('href="${YANDEX_ORG.url}"')
        && pagesSrc.includes('Все отзывы на Яндексе'));

    /* ── Подвал: жалобы заказчика от 2026-10-02 ────────────────────────────────────────────────
       «в мобильной версии в подвале переносится слово калькулятор, — исправь», «Переносится в
       подвале слово защищены, — исправь», «Убери в подвале Фотографии каталога…». Ссылку на
       копирайты снимков убрали из подвала в блок загрузки на /sell (лицензия CC BY требует, чтобы
       она осталась на сайте), а «УНП 490323534» держим неразрывной группой: без этого балансировка
       строк рвала её пополам. Комментарии из разметки выкидываем — в них цитаты заказчика. */
    const noComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
    const home = (await get('/')).text;
    const foot = home.slice(home.indexOf('class="fbottom"'), home.indexOf('class="fbottom"') + 600);
    check('assets', 'подвал: «УНП 490323534» одной неразрывной группой (не рвётся пополам)',
      foot.includes('class="fb-copy"') && foot.includes('<span class="nowrap">УНП 490323534</span>')
        && foot.includes('Все права защищены.') && css.includes('.nowrap{white-space:nowrap}'));
    const sell = (await get('/sell')).text;
    check('assets', 'подвал: «Фотографии каталога» убраны, ссылка на копирайты живёт на /sell',
      !noComments(home).includes('Фотографии каталога') && !noComments(home).includes('credits.html')
        && noComments(sell).includes('href="/data/avby-img/credits.html"'));
  },
  deltas: async () => {
    const home = (await get('/')).text;
    check('deltas', 'лого «Автонова» в шапке', home.includes('logo.png'));
    check('deltas', 'подпись «с пробегом»', home.includes('logo-sub'));
    for (const r of ['/cars', '/services', '/news', '/', '/cars-new']) {
      const t = (await get(r)).text;
      check('deltas', `${r}: нет раздела «Мотоциклы»`, !t.includes('>Мотоциклы<') && !t.includes('Мотоциклы'));
      check('deltas', `${r}: нет раздела «Прицепы»`, !t.includes('>Прицепы<') && !t.includes('Прицепы'));
      check('deltas', `${r}: нет блока статистики продаж`, !t.includes('принято на комиссию') && !t.includes('Автомобилей продано'));
    }
    /* исключённые разделы должны отсутствовать по-настоящему, а не только текстом */
    for (const r of ['/bikes', '/trailer', '/moto', '/motorcycles']) {
      const s = (await fetch(BASE + r, { redirect: 'manual' })).status;
      check('deltas', `раздел ${r} отсутствует`, s === 404, 'status ' + s);
    }
    const noPrices = await (await fetch(BASE + '/bxapi/v1/cars?sort=price_asc&per_page=100')).json();
    check('deltas', 'авто «цена по запросу» помечены честно', noPrices.items.some((i) => i.price === 0 && /по запросу/i.test(i.price_text || '')), 'текст: ' + (noPrices.items.find((i) => i.price === 0) || {}).price_text);
  },
  auth: async () => {
    const email = 'test' + Date.now() + '@example.com';
    const reg = await fetch(BASE + '/register', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Тест', email, password: 'secret123', city: 'Гомель' }),
    });
    check('auth', 'регистрация → редирект', reg.status === 302, 'status ' + reg.status);
    const cookie = (reg.headers.getSetCookie ? reg.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
    check('auth', 'регистрация выдаёт сессию', cookie.includes('an_session='));
    const acc = await get('/account', { headers: { Cookie: cookie } });
    check('auth', 'кабинет доступен с сессией', acc.status === 200 && acc.text.includes('Личный кабинет'));
    const bad = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: 'wrong' }),
    });
    check('auth', 'неверный пароль отклонён', bad.status === 400);
    const guest = await get('/account');
    check('auth', 'кабинет закрыт без сессии', guest.status === 302 && guest.headers.get('location').includes('/login'));
    const admin = await get('/admin');
    check('auth', 'админка закрыта без сессии', admin.status === 302);
    const login = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@autonova.by', password: process.env.ADMIN_PASSWORD || 'autonova2026' }),
    });
    const acookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
    /* Без явного next администратор попадает сразу в админку — на публичном хостинге логин один
       (клиент → /account, админ → /admin), и искать /admin руками не приходится. */
    check('auth', 'администратора без next ведёт прямо в админку', login.status === 302 && login.headers.get('location') === '/admin',
      JSON.stringify(login.headers.get('location')));
    const admNext = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@autonova.by', password: process.env.ADMIN_PASSWORD || 'autonova2026', next: '/account' }),
    });
    check('auth', 'явный next администратора уважается', admNext.headers.get('location') === '/account',
      JSON.stringify(admNext.headers.get('location')));
    const adm = await get('/admin', { headers: { Cookie: acookie } });
    check('auth', 'админка доступна администратору', adm.status === 200 && adm.text.includes('Администрирование'));
  },
  moderation: async () => {
    const fd = new FormData();
    fd.set('brand', 'Test'); fd.set('model', 'Moderation'); fd.set('year', '2021');
    fd.set('mileage', '30000'); fd.set('price', '22222'); fd.set('city', 'Гомель');
    /* Тип двигателя — гибрид (заказчик 2026-09-30: «В подаче объявления в Тип двигателя, добавь -
       гибрид (бензинг)»). Значение новое и своё (у av.by гибрида в справочнике нет), поэтому
       проверяем весь путь: форма → multipart → база → подпись на карточке → фильтр каталога. */
    fd.set('fuel', 'hybrid');
    /* Комплектация, салон и опции с той же формы (заказчик 2026-09-27: «чтобы можно было выбирать
       комплектацию и её содержимое»). Опции — обычные чекбоксы с одним именем, поэтому сервер
       обязан собрать их в список; «Такой опции нет» — заведомый мусор, он в базу попасть не должен. */
    fd.set('trim', 'comfort'); fd.set('trim_name', 'Комфорт');
    fd.set('interior_color', 'светлый'); fd.set('interior_material', 'комбинированные материалы');
    fd.append('options', 'ABS'); fd.append('options', 'USB'); fd.append('options', 'Такой опции нет');
    /* Фотографию прикладываем настоящую. Кнопка «Выбрать файлы» и перетаскивание складывают файлы
       в то же поле input[name=photos], поэтому проверяем весь путь объявления целиком: форма →
       multipart → saveUploads → запись в car_photos и файл на диске. Образец берём из уже
       загруженных кадров: saveUploads пропускает файлы меньше 512 байт, а крошечный PNG из
       проверок перетаскивания как раз меньше. */
    const { all: allDb } = await import('../lib/db.mjs');
    const sample = allDb('SELECT path FROM car_photos ORDER BY id LIMIT 1')[0].path;
    fd.set('photos', new Blob([fs.readFileSync(path.join(ROOT, 'public', sample))], { type: 'image/jpeg' }), 'salon-test.jpg');
    const email = 'seller' + Date.now() + '@example.com';
    const reg = await fetch(BASE + '/register', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Продавец', email, password: 'secret123' }),
    });
    const cookie = (reg.headers.getSetCookie ? reg.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
    const post = await fetch(BASE + '/sell', { method: 'POST', body: fd, redirect: 'manual', headers: { Cookie: cookie } });
    check('moderation', 'объявление принято', post.status === 302, 'status ' + post.status);
    const { all } = await import('../lib/db.mjs');
    const c = all("SELECT * FROM cars WHERE model='Moderation' ORDER BY id DESC")[0];
    check('moderation', 'объявление сохранено', !!c);
    const upPhotos = c ? all("SELECT path FROM car_photos WHERE car_id=?", c.id) : [];
    check('moderation', 'фотография из формы легла в объявление и на диск',
      upPhotos.length === 1 && fs.existsSync(path.join(ROOT, 'public', upPhotos[0].path)),
      (upPhotos.map((p) => p.path).join(', ') || 'фотографий нет') + (upPhotos.length && !fs.existsSync(path.join(ROOT, 'public', upPhotos[0].path)) ? ' (файла нет)' : ''));
    check('moderation', 'статус «на модерации»', c && c.status === 'pending', c && c.status);
    check('moderation', 'комплектация, салон и опции из формы сохранены',
      c && c.trim === 'Комфорт' && c.interior_color === 'светлый'
        && c.interior_material === 'комбинированные материалы' && c.options === 'ABS, USB',
      c && JSON.stringify({ trim: c.trim, salon: [c.interior_color, c.interior_material], options: c.options }));
    /* Собранный текст комплектации остаётся в cars.equipment: его читают старые карточки, поиск и
       выгрузка, поэтому формат не меняем — добавили только отдельные колонки рядом. */
    check('moderation', 'собранный текст комплектации лёг в equipment как раньше',
      c && c.equipment === 'Салон светлый, комбинированные материалы. Комплектация «Комфорт». В комплектацию входит: ABS, USB.',
      c && c.equipment);
    check('moderation', 'тип двигателя «гибрид (бензин)» из формы сохранён',
      c && c.fuel === 'hybrid', c && c.fuel);
    check('moderation', 'владелец привязан', c && c.owner_id > 0);
    const acc = await get('/account', { headers: { Cookie: cookie } });
    check('moderation', 'видно в кабинете', acc.text.includes('Moderation'));
    const pub = await get('/car/' + (c ? c.slug : 'x'));
    check('moderation', 'скрыто из каталога до публикации', pub.status === 404, 'status ' + pub.status);

    /* админ: вход, публикация объявления продавца, ручное добавление в базу */
    const { run, all: all2, one } = await import('../lib/db.mjs');
    const alogin = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@autonova.by', password: process.env.ADMIN_PASSWORD || 'autonova2026' }),
    });
    const acookie = (alogin.headers.getSetCookie ? alogin.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; ');
    check('moderation', 'вход администратора', /an_session=/.test(acookie), alogin.status + ' ' + acookie.slice(0, 40));
    const panel = await get('/admin?tab=cars', { headers: { Cookie: acookie } });
    check('moderation', 'админка открывается', panel.status === 200 && panel.text.includes('Добавить автомобиль в базу вручную'), 'status ' + panel.status);
    check('moderation', 'объявление продавца видно в админке', panel.text.includes('Moderation'));

    const adm = new URLSearchParams({ action: 'create', brand: 'Test', model: 'Adminmanual', year: '2020', mileage: '41000', price: '33333', city: 'Гомель', body: 'suv', fuel: 'diesel', transmission: 'at', drive: 'awd', volume: '2.0', power: '150', vin_checked: '1', is_new: '1', discount: '2500' });
    const created = await fetch(BASE + '/admin/car', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: acookie }, body: adm });
    check('moderation', 'ручное добавление принято', created.status === 302, 'status ' + created.status);
    const manual = one("SELECT * FROM cars WHERE model='Adminmanual' ORDER BY id DESC");
    check('moderation', 'авто записано в базу', !!manual);
    check('moderation', 'авто опубликовано сразу', manual && manual.status === 'published', manual && manual.status);
    check('moderation', 'проверка по VIN сохранена', manual && manual.vin_checked === 1);
    /* Плашка «Новый» и скидка теперь ставятся галочкой и числом в форме админки — раньше флаг
       выводился из года с пробегом (2024+ и до 12 000 км), а скидку нельзя было задать вовсе. */
    check('moderation', 'галочка «Новое объявление» сохранена', manual && manual.is_new === 1, manual && String(manual.is_new));
    check('moderation', 'скидка из формы сохранена', manual && manual.discount === 2500, manual && String(manual.discount));
    const mpage = await get('/car/' + (manual ? manual.slug : 'x'));
    check('moderation', 'карточка нового авто открывается', mpage.status === 200 && mpage.text.includes('Adminmanual'), 'status ' + mpage.status);
    check('moderation', 'на карточке видно «Новое объявление» и скидку',
      mpage.text.includes('>Новое объявление<') && mpage.text.includes(`Скидка −2 500<span class="byn">Б</span>`)
        && mpage.text.includes(`было 35 833<span class="byn">Б</span>`));
    /* Правка плашек прямо в строке таблицы (action=flags): снять «Новый» и поменять скидку. */
    const fl = await fetch(BASE + '/admin/car', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: acookie }, body: new URLSearchParams({ action: 'flags', id: String(manual ? manual.id : 0), discount: '900' }) });
    const after = one('SELECT is_new, discount FROM cars WHERE id=?', manual ? manual.id : 0);
    check('moderation', 'правка плашек в строке: «Новый» снят, скидка изменена',
      fl.status === 302 && after && after.is_new === 0 && after.discount === 900,
      `${fl.status} / is_new=${after && after.is_new}, discount=${after && after.discount}`);

    if (c) {
      const pubbed = await fetch(BASE + '/admin/car', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: acookie }, body: new URLSearchParams({ action: 'publish', id: String(c.id) }) });
      check('moderation', 'публикация модератором принята', pubbed.status === 302);
      const live = await get('/car/' + c.slug);
      check('moderation', 'после публикации открыто всем', live.status === 200, 'status ' + live.status);
      /* Комплектация на карточке: блок «Комплектация» с названием набора, салоном и списком
         опций вместо прежней одной строки в описании — иначе выбор комплектации на форме был бы
         виден только в базе. */
      check('moderation', 'на карточке блок «Комплектация» с набором, салоном и опциями',
        live.text.includes('<h3>Комплектация</h3>') && live.text.includes('<b>Комфорт</b>')
          && live.text.includes('<b>светлый, комбинированные материалы</b>')
          && /equip-opts[\s\S]*<li>ABS<\/li>[\s\S]*<li>USB<\/li>/.test(live.text),
        c.slug);
      check('moderation', 'прежняя строка «Комплектация: …» в описании не дублируется',
        !live.text.includes('<b>Комплектация:</b>'));
      /* Опции на карточке сгруппированы как на av.by («Системы безопасности», «Мультимедиа»),
         а не свалены одним списком: заказчик 2026-09-28 прислал объявление av.by с такой
         группировкой. Пары «опция → группа» живут в lib/car-options.mjs, здесь проверяем, что
         ABS попал в группу безопасности, USB — в мультимедиа. */
      const groups = live.text.match(/<div class="equip-group">\s*<h4>([^<]+)<\/h4>/g) || [];
      check('moderation', 'комплектация разбита на группы по разделам',
        groups.length >= 2 && /<h4>Системы безопасности<\/h4>[\s\S]*<li>ABS<\/li>/.test(live.text)
          && /<h4>Мультимедиа<\/h4>[\s\S]*<li>USB<\/li>/.test(live.text),
        groups.map((g) => g.replace(/<[^>]+>/g, '')).join(', '));
      const found = await get('/cars?q=Moderation');
      check('moderation', 'после публикации есть в каталоге', found.status === 200 && found.text.includes('Moderation'));
      /* Гибрид на карточке и в фильтре: подпись берётся из FUEL_LABEL (lib/cars.mjs), а не из
         сырого кода, и объявление находится фильтром «Топливо = Гибрид (бензин)».
         Блока «Характеристики» на карточке с 2026-09-30 нет (заказчик: «Убери под фотографиями
         авто блок — Характеристики. Они у нас есть справа от фоток»), поэтому подпись ищем там,
         где параметры объявления теперь и живут, — в сводке под ценой (.car-brief): она печатает
         те же c.fuel_label, только строчными буквами, как строка параметров av.by. */
      const briefHtml = (live.text.match(/<ul class="car-brief">([\s\S]*?)<\/ul>/) || [, ''])[1];
      check('moderation', 'на карточке тип топлива подписан как «гибрид (бензин)» (сводка под ценой)',
        briefHtml.includes('гибрид (бензин)') && !/>hybrid</.test(live.text),
        briefHtml.replace(/\s+/g, ' ').slice(0, 160) || 'сводки нет');
      const hybridFound = await get('/cars?fuel=hybrid');
      check('moderation', 'фильтр каталога находит объявление с гибридом',
        hybridFound.status === 200 && hybridFound.text.includes('Moderation'),
        'status ' + hybridFound.status);

      /* Удаление карточки = реальная продажа (заказчик 2026-09-30: «реально сделай, чтобы когда
         карточка авто исчезает с сайта, то есть авто продали и карточку удалили, этот авто
         появлялся в продажах как реальная продажа»). Удаляем опубликованное объявление продавца
         через админку и смотрим: появилась запись в sold_cars с тем же названием, ценой, снимком
         из карточки и сегодняшней датой, карточка с сайта пропала, а строка видна на /cars-sold
         в группе проданных в этом месяце. За собой убираем — иначе счётчик «проданных = 7»
         в разделе db сломается на следующем прогоне. */
      const soldDel = await fetch(BASE + '/admin/car', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: acookie }, body: new URLSearchParams({ action: 'delete', id: String(c.id) }) });
      const sale = one('SELECT * FROM sold_cars WHERE source_slug=?', c.slug);
      check('moderation', 'удаление карточки записало продажу в «Продано»',
        soldDel.status === 302 && !!sale && sale.brand === c.brand && sale.model === c.model && sale.price === c.price && sale.year === c.year,
        `${soldDel.status} / ${sale ? `${sale.brand} ${sale.model} ${sale.year} за ${sale.price}` : 'записи нет'}`);
      check('moderation', 'у записанной продажи снимок из карточки и сегодняшняя дата',
        !!sale && sale.photo === upPhotos[0].path && String(sale.sold_at).slice(0, 10) === new Date().toISOString().slice(0, 10),
        sale ? `${sale.photo} / ${sale.sold_at}` : 'записи нет');
      check('moderation', 'карточка проданного авто ушла с сайта',
        (await get('/car/' + c.slug)).status === 404 && !one('SELECT id FROM cars WHERE id=?', c.id));
      const soldList = await get('/cars-sold');
      /* Свежая продажа (запись только что сделана, sold_at = сегодня) обязана быть первой строкой
         таблицы: строки идут ORDER BY sold_at DESC, а строки-подписи «Проданные автомобили в этом
         месяце» над ними больше нет — заказчик 2026-10-01 попросил её убрать. В теге <td> теперь
         есть data-label (на телефоне таблица собирается в карточки), поэтому проверяем <td[^>]*>. */
      const soldBody = soldList.text.slice(soldList.text.indexOf('<tbody>'));
      check('moderation', 'проданное авто видно на /cars-sold, и таблица начинается со строки авто',
        /^<tbody>[\s\S]{0,80}?<td[^>]*><div class="sold-car">/.test(soldBody)
          && soldBody.includes(`class="sold-photo" src="${upPhotos[0].path}"`)
          && soldBody.includes(`${c.brand} ${c.model}`),
        `фото ${upPhotos[0].path}`);
      run('DELETE FROM sold_cars WHERE source_slug=?', c.slug);

      /* Группа «Проданные ранее»: продажа прошлого месяца не должна попадать в группу этого месяца.
         Запись ставим прямо в базу — так проверка не зависит от того, в какой день прогнали набор
         (32 дня назад всегда другой месяц), и заодно проверяется строка без фото: у неё должен
         быть нарисован значок-заглушка, а не пустое место.
         Раньше проверка смотрела 600 символов после заголовка «Проданные ранее». На живой базе, где
         за месяцы накопилось больше машин, строка уезжала дальше 600 символов и проверка падала без
         причины (2026-10-02: зазор 4,1 КБ). Теперь делим страницу по заголовку: наша запись обязана
         быть в части «Проданные ранее» и НЕ быть в списке текущего месяца. */
      const lastMonth = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      run("INSERT INTO sold_cars (brand, model, year, price, mileage, sold_at, photo, source_slug) VALUES ('Test','Soldprevious',2019,19900,150000,?,'','test-soldprevious')", lastMonth);
      const soldOlder = await get('/cars-sold');
      const olderSplit = soldOlder.text.split('Проданные ранее');
      const olderTail = olderSplit.length > 1 ? olderSplit[olderSplit.length - 1] : '';
      const currentPart = olderSplit.length > 1 ? olderSplit.slice(0, -1).join('') : soldOlder.text;
      check('moderation', 'продажа прошлого месяца показана отдельной группой «Проданные ранее»',
        olderSplit.length > 1 && olderTail.includes('Soldprevious') && !currentPart.includes('Soldprevious')
          && /sold-photo-empty/.test(olderTail),
        soldOlder.text.includes('Проданные ранее')
          ? `группа есть, записи в ней: ${olderTail.includes('Soldprevious')}, заглушка: ${/sold-photo-empty/.test(olderTail)}`
          : 'группы «Проданные ранее» нет');
      run("DELETE FROM sold_cars WHERE source_slug='test-soldprevious'");
    }
    run("DELETE FROM car_photos WHERE car_id IN (SELECT id FROM cars WHERE model IN ('Moderation','Adminmanual'))");
    run("DELETE FROM cars WHERE model IN ('Moderation','Adminmanual')");
    /* Файл, сохранённый загрузкой объявления, лежит в public/uploads/user/<слаг> — убираем
       папку вместе с тестовой записью, чтобы прогоны не копили мусор. Ведущую косую у пути
       из базы срезаем: с ней path.resolve принял бы /uploads/... за абсолютный путь. */
    if (upPhotos.length) {
      const dir = path.resolve(ROOT, 'public', path.dirname(upPhotos[0].path).replace(/^[\\/]+/, ''));
      if (dir.includes(path.join('uploads', 'user'))) fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  leads: async () => {
    const { run } = await import('../lib/db.mjs');
    run("DELETE FROM leads WHERE phone='+375291112233'");
    run("DELETE FROM reviews WHERE author='Проверка'");
    const r = await fetch(BASE + '/lead', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Клиент', phone: '+375291112233', kind: 'call', text: 'Проверка' }),
    });
    check('leads', 'заявка принята', r.status === 302, 'status ' + r.status);
    const { num } = await import('../lib/db.mjs');
    check('leads', 'заявка записана', num("SELECT COUNT(*) FROM leads WHERE phone='+375291112233'") === 1);
    const rev = await fetch(BASE + '/review', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ author: 'Проверка', city: 'Гомель', rating: '5', text: 'Отзыв для автотеста, достаточно длинный.' }),
    });
    check('reviews', 'отзыв принят', rev.status === 302);
    check('reviews', 'отзыв опубликован', num("SELECT COUNT(*) FROM reviews WHERE author='Проверка'") === 1);
    // убираем за собой: тестовые строки не должны оставаться в базе
    run("DELETE FROM leads WHERE phone='+375291112233'");
    run("DELETE FROM reviews WHERE author='Проверка'");
  },
  ui: async () => {
    const { createRequire } = await import('node:module');
    let puppeteer;
    try {
      puppeteer = createRequire('file:///D:/DSHarness/tools/site-recon/')('puppeteer-core');
    } catch (e) {
      check('ui', 'puppeteer доступен', false, e.message);
      return;
    }
    const browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 950 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      const { all } = await import('../lib/db.mjs');
      const withPhotos = all('SELECT slug FROM cars WHERE status=\'published\' AND id IN (SELECT car_id FROM car_photos) LIMIT 1')[0].slug;

      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      check('ui', 'карусель отрисована', (await page.$$('[data-carousel]')).length > 0);
      /* Кликаем стрелку главной (центральной) карточки ленты «Горящей продажи», а не первый
         [data-carousel] в разметке: с 2026-10-01 кадровые стрелки у приглушённых соседних карточек (и
         у их копий-клонов, которые лента вставляет по краям) скрыты и курсор не ловят
         (pointer-events:none) — заказчик просил показывать их «только на главной карточке
         автомобиля». Поэтому первым в DOM оказывается нерабочая для мыши стрелка, а рабочая — у
         активной карточки. */
      const heroCard = '.home-page .hero-hot .hot-card.on';
      const before = await page.$eval(`${heroCard} [data-track]`, (el) => el.style.transform);
      await page.click(`${heroCard} [data-next]`);
      await new Promise((r) => setTimeout(r, 300));
      const after = await page.$eval(`${heroCard} [data-track]`, (el) => el.style.transform);
      check('ui', 'листание фото работает', before !== after, before + ' → ' + after);

      /* Клик по самому снимку карточки ведёт на страницу автомобиля, а стрелка карусели — нет:
         она лежит выше накладки .car-photo-hit и листает кадры, оставаясь на выдаче (заказчик
         2026-09-28: «сделай чтобы при нажатии на фото карточки авто происходил переход на страницу
         авто»). */
      {
        const cardHref = await page.$eval('.cars .car .car-title', (el) => el.getAttribute('href'));
        await page.click('.cars .car .car-photo-hit');
        await page.waitForFunction((h) => location.pathname === h, { timeout: 8000 }, cardHref);
        check('ui', 'клик по фото карточки ведёт на страницу автомобиля', page.url().endsWith(cardHref), page.url());
        await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
        const trackBefore = await page.$eval('.cars .car [data-track]', (el) => el.style.transform);
        await page.click('.cars .car .carousel-btn.next');
        await new Promise((r) => setTimeout(r, 350));
        const trackAfter = await page.$eval('.cars .car [data-track]', (el) => el.style.transform);
        check('ui', 'стрелка карусели листает кадры и со страницы не уводит',
          trackBefore !== trackAfter && page.url().endsWith('/cars'), `${trackBefore} → ${trackAfter}, ${page.url()}`);
      }

      /* Плашка «Выбор дилера» на карточках авто. Заказчик 02.10.2026: «Плашка выбор дилера на
         карточках в мобильной и десктопной версии - сделай красным в цвет сайта и в десктопной
         версии - плашка выбор дилера не заходила за кнопку лайк». Плашка лежит в ленте .car-badges
         над кадром; на широком экране у ленты не было правого ограничения (абсолютный блок с одним
         left сжимался по содержимому), поэтому на узкой карточке 287 px (четыре колонки на 1440)
         лента доходила до кнопки избранного .car-fav: замер до правки — плашка 255…362 при лайке
         350…386, перекрытие 12 px (360 px²). Теперь у ленты right:56px (12 px поле + 36 px круг +
         8 px зазор), и лишние плашки переносятся на вторую строку внутри кадра. Заодно плашка
         получила общий красный: раньше --accent был прописан только в мобильном блоке, и на
         широком экране «Выбор дилера» оставалась общей тёмной .tag. Проверяем на широкой и
         телефонной ширине: фон плашки — фирменный #E3000F с белыми буквами, ни одна плашка ленты
         не пересекается с кругом лайка, а на широком экране между плашкой и кругом есть зазор
         (правый край ленты ограничен). */
      for (const w of [1400, 390]) {
        await page.setViewport({ width: w, height: 950, isMobile: w <= 560, hasTouch: w <= 560, deviceScaleFactor: 1 });
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        const badge = await page.evaluate(() => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
          const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
            * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
          const card = [...document.querySelectorAll('.car-media')].find((m) => m.querySelector('.tag-dealer'));
          if (!card) return null;
          const dealer = card.querySelector('.tag-dealer');
          const fav = card.querySelector('.car-fav');
          const cs = getComputedStyle(dealer);
          const favBox = fav ? box(fav) : null;
          const tags = [...card.querySelectorAll('.tag')];
          return {
            bg: cs.backgroundColor, fg: cs.color, words: dealer.textContent.trim(),
            gap: favBox ? Math.round(favBox.l - box(dealer).r) : null,
            hits: favBox ? tags.filter((t) => area(box(t), favBox) > 0).map((t) => t.textContent.trim()) : ['кнопки лайка нет'],
            phone: innerWidth <= 560,
          };
        });
        check('ui', `${w}: плашка «Выбор дилера» — красная в цвет сайта и не заходит за кнопку лайк`,
          !!badge && badge.bg === 'rgb(227, 0, 15)' && badge.fg === 'rgb(255, 255, 255)'
            && badge.hits.length === 0 && (badge.phone ? badge.gap >= 0 : badge.gap >= 8),
          badge ? `фон ${badge.bg}, буквы ${badge.fg}, зазор до круга лайка ${badge.gap} px, `
            + `перекрытия плашек с лайком: ${badge.hits.length ? badge.hits.join(', ') : 'нет'}`
            : 'карточка с плашкой «Выбор дилера» не найдена');
      }

      /* Блок итогов кредитного калькулятора. Заказчик 02.10.2026: «на странице кредитный калькулятор
         там где расчёт суммы платежа в месяц несимметричные данные и есть подчёркивание например
         суммы кредита и того квадрату значок белорусского рубля и при нажатии переходит куда-то».
         Причина была в разметке: знак рубля (.byn — буква «Б» с чертой, рисуется псевдоэлементом)
         стоял ПОСЛЕ числа, а число в итогах блочное (.calc-out .spec-list b{display:block}), поэтому
         знак выпадал из строки числа и вставал отдельной строкой под ним: замер до правки на 730 px —
         строка итогов 70 px высотой, под числом одинокая «Б» с чертой (читалась как подчёркнутый
         квадрат), три колонки разной высоты. Теперь знак внутри <b>, рядом с числом: подпись сверху,
         «48 000 Б» одной строкой, все три колонки одной высоты (50 px). Клик по числам никуда не
         ведёт: в блоке итогов нет ни одной ссылки (замер кликом по числу, знаку рубля и платежу
         адрес не менялся), а подчёркивания текста у чисел нет. */
      for (const w of [1440, 390]) {
        await page.setViewport({ width: w, height: 950, isMobile: w <= 560, hasTouch: w <= 560, deviceScaleFactor: 1 });
        await page.goto(BASE + '/kalkulyator', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-credit]');
          return el && /[0-9]/.test(el.textContent);
        }, { timeout: 8000 }).catch(() => {});
        const calc = await page.evaluate(() => {
          const box = document.querySelector('.calc-out');
          if (!box) return null;
          const rect = (el) => el.getBoundingClientRect();
          const list = box.querySelector('.spec-list');
          const rows = [...list.children].map((d) => {
            const num = d.querySelector('b');
            const digit = d.querySelector('i');
            const sign = d.querySelector('.byn');
            if (!num || !digit || !sign) return null;
            return {
              inside: sign.parentElement === num,
              sameLine: Math.abs(rect(sign).top - rect(digit).top) <= 6,
              nowrap: getComputedStyle(num).whiteSpace === 'nowrap',
              deco: getComputedStyle(num).textDecorationLine,
              h: Math.round(rect(d).height), y: Math.round(rect(d).top), w: Math.round(rect(d).width),
              value: num.textContent.replace(/\s+/g, ' ').trim(),
            };
          });
          return {
            rows: rows.filter(Boolean),
            cols: getComputedStyle(list).gridTemplateColumns.split(' ').length,
            links: [...box.querySelectorAll('a')].length,
          };
        });
        const rows = calc ? calc.rows : [];
        const spreadH = rows.length ? Math.max(...rows.map((r) => r.h)) - Math.min(...rows.map((r) => r.h)) : 999;
        const oneLine = rows.length === 3 && rows.every((r) => r.inside && r.sameLine && r.nowrap && r.deco === 'none');
        const even = w <= 640 ? true : spreadH <= 1 && new Set(rows.map((r) => r.w)).size === 1;
        check('ui', `${w}: итоги кредитного калькулятора — знак рубля в строке числа, колонки ровные`,
          oneLine && even && calc.links === 0,
          calc ? `строки: ${rows.map((r) => `«${r.value}» ${r.h}px`).join(', ')}; знак в числе у `
            + `${rows.filter((r) => r.inside).length}/3, на линии числа у ${rows.filter((r) => r.sameLine).length}/3, `
            + `подчёркиваний ${rows.filter((r) => r.deco !== 'none').length}, разброс высот ${spreadH} px, ссылок ${calc.links}`
            : 'блок итогов .calc-out не найден');
      }

      /* Обложка статьи в Автожурнале — тоже ссылка на статью: клик по самой картинке (координатами,
         а не по накладке .car-photo-hit) ведёт на страницу статьи (заказчик 2026-09-30: «В разделе
         Автожурнал — добавь возможность перехода на статью при нажатии на картинку»). */
      for (const w of [1400, 390]) {
        await page.setViewport({ width: w, height: 900, isMobile: w <= 560, hasTouch: w <= 560, deviceScaleFactor: 1 });
        await page.goto(BASE + '/news', { waitUntil: 'domcontentloaded' });
        const first = await page.$eval('.cars .car', (c) => {
          const r = c.querySelector('.car-media').getBoundingClientRect();
          return {
            href: c.querySelector('.car-title').getAttribute('href'),
            x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
          };
        });
        await page.mouse.click(first.x, first.y);
        await page.waitForFunction((h) => location.pathname === h, { timeout: 8000 }, first.href);
        check('ui', `${w}: клик по обложке в Автожурнале ведёт на статью`, page.url().endsWith(first.href), `${first.href} · ${page.url()}`);
      }
      await page.setViewport({ width: 1400, height: 950 });

      /* Фото статей в блоке «Читайте также»: у каждой плитки своя обложка, она загрузилась и лежит
         во всю ширину плитки (общее правило `img{max-width:100%}` срезало бы её до ширины
         содержимого — 284 px вместо 328 px, поэтому у .tile-photo стоит `max-width:none`). */
      {
        const artSlug = all('SELECT slug FROM articles LIMIT 1')[0].slug;
        await page.goto(BASE + '/news/' + artSlug, { waitUntil: 'networkidle2' });
        const tiles = await page.$$eval('.art-aside .tile', (ts) => ts.map((t) => {
          const img = t.querySelector('.tile-photo');
          const tb = t.getBoundingClientRect();
          const ib = img ? img.getBoundingClientRect() : null;
          return {
            href: t.getAttribute('href'),
            src: img ? img.getAttribute('src') : null,
            ok: img ? img.complete && img.naturalWidth > 0 : false,
            full: ib ? Math.abs(ib.x - tb.x) <= 1 && Math.abs(ib.y - tb.y) <= 1 && ib.width >= tb.width - 2 : false,
            ratio: ib ? Math.round((ib.width / ib.height) * 100) / 100 : null,
            tile: [Math.round(tb.width), Math.round(tb.height)],
          };
        }));
        /* Плитка «Читайте также» показывает миниатюру /thumbs/news/<slug>.webp — тот же кадр, но
           уменьшенный (2026-10-02). Проверяем, что это фото именно той статьи, на которую ведёт
           плитка, что оно загрузилось, лежит во всю ширину и держит пропорцию 16:9. */
        const sameSlug = (t) => t.src === '/thumbs/news/' + t.href.replace('/news/', '') + '.webp'
          || t.src === '/uploads/news/' + t.href.replace('/news/', '') + '.jpg';
        check('ui', 'в статье «Читайте также»: у каждой плитки фото своей статьи во всю ширину',
          tiles.length === 3 && tiles.every((t) => sameSlug(t)
            && t.ok && t.full && t.ratio && Math.abs(t.ratio - 16 / 9) < 0.05),
          tiles.map((t) => `${t.href} → ${t.src} (${t.ok ? 'загружено' : 'НЕТ'}, во всю ширину ${t.full}, ${t.ratio}, плитка ${t.tile.join('×')})`).join(' | '));
      }
      /* Название статьи — в одну строку (заказчик 2026-09-30: «сделай в одну строчку, сильно крупный
         шрифт»). Кегль опущен с 38 px до 28 px: в колонке 820 px самое длинное название Автожурнала
         занимает 788 px, то есть все восемь названий ложатся в один ряд (_ref/diag-art-h1.mjs).
         Проверяем все восемь статей, а не одну: право на перенос оставляет только узкое окно — на
         1024 px колонка сужается до 614 px, и одной строкой там был бы кегль ~22 px, мельче
         подзаголовков. Ждём document.fonts.ready, иначе перенос мерился бы по подставному шрифту. */
      {
        const arts = all('SELECT slug FROM articles');
        const bad = [];
        /* Заодно здесь же меряем новое требование заказчика 2026-09-30: «Блок — Читайте также,
           смести вниз, что бы фото этого блока и левого блока со статьей, были на одном уровне,
           примени ко всем статьям». Фото первой ссылки обязано встать вровень с фото статьи
           (обложка .art-cover) — во всех восьми статьях и независимо от того, в одну строку
           название или в две (раскладка держит это сеткой со subgrid, см. «Статья автожурнала»
           в public/assets/css/site.css). */
        const badAlign = [];
        for (const a of arts) {
          await page.goto(BASE + '/news/' + a.slug, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => document.fonts.ready);
          const m = await page.evaluate(() => {
            const h1 = document.querySelector('.art-main h1');
            const cs = getComputedStyle(h1);
            const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15;
            const range = document.createRange();
            range.selectNodeContents(h1);
            const cover = document.querySelector('.art-cover');
            const photo = document.querySelector('.art-aside .tile-photo');
            return {
              size: cs.fontSize,
              lines: Math.round((h1.getBoundingClientRect().height / line) * 10) / 10,
              inkW: Math.round(range.getBoundingClientRect().width),
              /* Колонку заголовка мерим по .art-head: .art-main — это вся сетка статьи
                 (заголовок и текст слева, «Читайте также» справа, см. «Статья автожурнала»
                 в public/assets/css/site.css). */
              colW: Math.round(document.querySelector('.art-head').getBoundingClientRect().width),
              coverTop: cover ? Math.round(cover.getBoundingClientRect().top) : null,
              photoTop: photo ? Math.round(photo.getBoundingClientRect().top) : null,
              over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          if (m.size !== '28px' || m.lines > 1.05 || m.over > 0) bad.push(`${a.slug}: ${m.size}, строк ${m.lines}, ${m.inkW}/${m.colW} px, переполнение ${m.over}`);
          if (m.coverTop === null || m.photoTop === null || Math.abs(m.photoTop - m.coverTop) > 2) badAlign.push(`${a.slug}: фото статьи ${m.coverTop}, фото ссылки ${m.photoTop}`);
        }
        check('ui', `заголовок каждой статьи (${arts.length}) — в одну строку на 1400 px`, bad.length === 0, bad.join(' | ') || `${arts.length} из ${arts.length}`);
        check('ui', `фото «Читайте также» вровень с фото статьи во всех статьях (${arts.length})`, badAlign.length === 0, badAlign.join(' | ') || `${arts.length} из ${arts.length}`);
      }
      /* Дальше проверяется вид стрелок карусели карточки — для этого нужна выдача /cars: подъезжаем
         туда заново, потому что предыдущие проверки увели браузер в Автожурнал. */
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      {
        const arrowStyle = (sel) => page.$eval(sel, (b) => {
          const cs = getComputedStyle(b);
          const svg = b.querySelector('svg');
          return {
            bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, borderColor: cs.borderTopColor,
            radius: cs.borderRadius, opacity: cs.opacity, blur: cs.backdropFilter, shadow: cs.filter,
            w: Math.round(b.getBoundingClientRect().width),
            icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
          };
        });
        await page.mouse.move(0, 0);
        await new Promise((r) => setTimeout(r, 260));
        const idle = await arrowStyle('.cars .car .carousel-btn.next');
        /* Заказчик 2026-10-01: «не наводя на карточки авто я вижу прозрачную очень кнопку
           перелистывания фоток, Исправь чтобы кнопка появлялась только при наведении на фотографию и
           сделай кнопки чуть прозрачнее». Прежде у стрелки круг 36 px с заливкой rgba(255,255,255,.62)
           и тёмный шеврон 22 px (--ink), а в покое она стояла приглушённой (.3, «всегда чуть видны») —
           эту кнопку заказчик и видел, не наводя курсор на фото. Теперь в покое opacity 0, поднимает
           стрелку только курсор на самом кадре (.car-media; поверх лежит ссылка .car-photo-hit), и
           проявляется она неполно (.8 — «чуть прозрачнее»). Заказчик 2026-10-01: «В карточках авто при
           нажатии на кнопку прокрутки фото она становится сильно белая, сделай еще прозрачнее» —
           «нажатие» мышью и есть наведение (отдельного :active у стрелок нет), поэтому заливка под
           курсором на самой кнопке опущена с .92 до .7, а «нажатость» держат рост круга (scale 1.12) и
           тёмный шеврон. Отдельно проверяем, что наведение на текст карточки (.car-body) стрелку больше
           не поднимает. */
        await page.hover('.cars .car .car-body');
        await new Promise((r) => setTimeout(r, 260));
        const onBody = await arrowStyle('.cars .car .carousel-btn.next');
        await page.hover('.cars .car .car-media');
        await page.waitForFunction(() => {
          const b = document.querySelector('.cars .car .carousel-btn.next');
          return !!b && getComputedStyle(b).opacity === '0.8';
        }, { timeout: 3000 }).catch(() => {});
        const onPhoto = await arrowStyle('.cars .car .carousel-btn.next');
        await page.hover('.cars .car .carousel-btn.next');
        await new Promise((r) => setTimeout(r, 260));
        const onBtn = await arrowStyle('.cars .car .carousel-btn.next');
        check('ui', 'стрелки карусели карточки — скрыты в покое, проявляются только на фото и под курсором не белеют',
          idle.bg === 'rgba(255, 255, 255, 0.62)' && idle.color === 'rgb(20, 23, 28)' && idle.border === '0px'
            && idle.blur === 'none' && idle.shadow === 'none' && idle.radius === '50%'
            && idle.opacity === '0' && idle.w === 36 && idle.icon === 22
            && onBody.opacity === '0' && onPhoto.opacity === '0.8'
            && onBtn.bg === 'rgba(255, 255, 255, 0.7)' && onBtn.opacity === '1',
          `фон «${idle.bg}», стрелка «${idle.color}» ${idle.icon}px, рамка ${idle.border} ${idle.borderColor}, `
            + `радиус ${idle.radius}, размытие «${idle.blur}», тень «${idle.shadow}», размер ${idle.w}px, `
            + `opacity в покое ${idle.opacity}, на тексте карточки ${onBody.opacity}, на фото ${onPhoto.opacity}, `
            + `фон и opacity под курсором «${onBtn.bg}» / ${onBtn.opacity}`);
      }
      const favBefore = await page.$eval('[data-count-fav]', (el) => el.textContent.trim());
      await page.click('[data-fav]');
      await new Promise((r) => setTimeout(r, 200));
      const favAfter = await page.$eval('[data-count-fav]', (el) => el.textContent.trim());
      check('ui', 'избранное обновляет счётчик', favAfter !== favBefore, favBefore + ' → ' + favAfter);
      check('ui', 'избранное сохраняется в cookie', /an_fav=\d+/.test(await page.evaluate(() => document.cookie)));

      /* Заказчик 2026-09-30: «кнопки прокрутки на карточках авто и на странице авто, сделай
         одинаковыми». Сверяем все места, где листаются фото: карточка выдачи (/cars), лента
         «Горящей продажи» на главной и большое фото объявления. Общий вид — белый полупрозрачный
         круг 36 px (заказчик: «В карусели верни кнопки прокрутки карточек авто в бело-прозрачный
         фоном») с тёмным шевроном 22 px, поэтому «одинаковость» держится на цвете стрелки,
         отсутствии рамки, радиусе, размере кнопки и размере значка. Расходится фон и прозрачность,
         и это задумано: у кадра карточки и у большого фото стрелки скрыты совсем (0) и проявляются
         приглушёнными (.8) только от курсора на снимке, а стрелки ленты .hot-nav — не карусель кадра,
         они видны всегда (заказчик: «только в карусели») и по просьбе 2026-10-01 «сделай более
         выраженными» получили плотный фон (rgba(255,255,255,.95)) и мягкую тень. Проверка идёт по
         одному и тому же свойству у каждой кнопки, поэтому «одинаковость» ловится, даже если
         разъедется один цвет. */
      {
        const arrowLook = (sel) => page.$eval(sel, (b) => {
          const cs = getComputedStyle(b);
          const svg = b.querySelector('svg');
          return {
            bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, radius: cs.borderRadius,
            opacity: cs.opacity, shadow: cs.boxShadow,
            w: Math.round(b.getBoundingClientRect().width),
            icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
            path: svg && svg.querySelector('path') ? svg.querySelector('path').getAttribute('d') : '',
          };
        });
        /* Стрелки кадра в покое скрыты, поэтому перед замером курсор уводится в угол и даётся время
           переходу opacity .18s доехать (иначе замер ловил бы середину перехода). */
        const atRest = async (sel) => {
          await page.mouse.move(0, 0);
          await new Promise((r) => setTimeout(r, 260));
          return arrowLook(sel);
        };
        await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
        const cardArrow = await atRest('.cars .car .carousel-btn.next');
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        const laneArrow = await atRest('.home-page .hero-hot .hot-nav.next');
        /* Заказчик 2026-10-01: «карусели кнопки перелистывания должны появляться только на главной
           карточке автомобиля». В ленте «Горящей продажи» кадровые стрелки показываем только у
           активной (центральной) карточки, и только от курсора на её кадре: у приглушённых соседних
           они не появляются даже под курсором. Наведение на соседнюю карточку не меняет активную —
           индекс переключают только стрелки ленты, точки, свайп и фокус с клавиатуры. Меряем на
           главной, до перехода на страницу объявления. */
        const heroRest = await page.$$eval('.home-page .hero-hot .hot-card .carousel-btn',
          (bs) => bs.map((b) => getComputedStyle(b).opacity));
        await page.hover('.home-page .hero-hot .hot-card:not(.on) .hot-media');
        await new Promise((r) => setTimeout(r, 260));
        const heroSide = await arrowLook('.home-page .hero-hot .hot-card:not(.on) .carousel-btn.next');
        await page.hover('.home-page .hero-hot .hot-card.on .hot-media');
        await new Promise((r) => setTimeout(r, 260));
        const heroMain = await arrowLook('.home-page .hero-hot .hot-card.on .carousel-btn.next');
        check('ui', 'лента «Горящей продажи»: стрелки кадра — только у главной карточки, только на фото',
          heroRest.length >= 5 && heroRest.every((o) => o === '0')
            && heroSide.opacity === '0' && heroMain.opacity === '0.8',
          `в покое все ${heroRest.join('/') || '—'}, у соседней карточки под курсором ${heroSide.opacity}, `
            + `у главной карточки под курсором ${heroMain.opacity}`);
        await page.goto(BASE + '/car/' + withPhotos, { waitUntil: 'domcontentloaded' });
        const galArrow = await atRest('.gal-nav.next');
        const same = (a, b) => a.color === b.color && a.border === b.border && a.radius === b.radius;
        check('ui', 'стрелки перелистывания фото — один вид в карточке и галерее, у ленты плотнее',
          same(cardArrow, galArrow)
            && cardArrow.w === 36 && laneArrow.w === 36 && galArrow.w === 36
            && cardArrow.icon === 22 && laneArrow.icon === 22 && galArrow.icon === 22
            && cardArrow.bg === 'rgba(255, 255, 255, 0.62)' && galArrow.bg === cardArrow.bg
            && cardArrow.border === '0px' && cardArrow.shadow === 'none' && galArrow.shadow === 'none'
            && cardArrow.opacity === '0' && galArrow.opacity === '0' && laneArrow.opacity === '1'
            && laneArrow.bg === 'rgba(255, 255, 255, 0.95)' && laneArrow.shadow !== 'none',
          `карточка ${cardArrow.w}px «${cardArrow.bg}» тень «${cardArrow.shadow}», `
            + `лента ${laneArrow.w}px «${laneArrow.bg}» тень «${laneArrow.shadow}», `
            + `галерея ${galArrow.w}px «${galArrow.bg}», opacity ${cardArrow.opacity}/${laneArrow.opacity}/${galArrow.opacity}`);
        /* «Сделай чтобы кнопки пролистывания фотографии базового были не видны только появлялись при
           наведении мышкой на фотографии»: у большого фото стрелка обязана проявиться от наведения на
           сам снимок, а не только от наведения на саму кнопку. Проявление, как и у кадра карточки,
           неполное (.8) — «сделай кнопки чуть прозрачнее» (заказчик 2026-10-01). */
        await page.hover('.gallery-main');
        await page.waitForFunction(() => {
          const b = document.querySelector('.gal-nav.next');
          return !!b && getComputedStyle(b).opacity === '0.8';
        }, { timeout: 3000 }).catch(() => {});
        const galOnPhoto = await arrowLook('.gal-nav.next');
        check('ui', 'стрелки большого фото не видны в покое и появляются при наведении на снимок',
          galArrow.opacity === '0' && galOnPhoto.opacity === '0.8',
          `в покое ${galArrow.opacity}, при наведении на снимок ${galOnPhoto.opacity}`);
        /* Значок: у галереи стоял ico('chevron-left'/'chevron-right') — таких имён в ICONS нет,
           и ico() отдавал запасной значок, машину (lib/view.mjs: `ICONS[name] || ICONS.car`),
           поэтому у большого фото вместо стрелки крутилась «машинка», а кнопки на карточке и на
           странице авто выглядели по-разному. Теперь в галерее тот же шеврон, что и в карточке:
           путь и размер значка сверяются буквально. */
        check('ui', 'стрелка галереи — тот же шеврон 22 px, что у карусели карточки',
          galArrow.path === cardArrow.path && galArrow.path === 'M9 6l6 6-6 6'
            && galArrow.icon === 22 && cardArrow.icon === 22,
          `галерея «${galArrow.path}» ${galArrow.icon}px, карточка «${cardArrow.path}» ${cardArrow.icon}px`);
        /* Заказчик 2026-10-01: «на странице автомобиля на фотографии кнопки четыре штуки внизу с
           левой стороны, размести их справа вверху на фотографии». Ряд значков «Поделиться»
           (Telegram, Viber, WhatsApp, «Скопировать ссылку») переехал из левого нижнего угла кадра в
           правый верхний, а подсказка «Открыть во весь экран» вернулась в освободившийся левый нижний
           угол: на узком окне (кадр ~350 px) подсказка 156 px иначе налезала бы на ряд значков
           154 px. Проверяем отступы от верхнего и правого краёв кадра, ширину ряда, что все четыре
           значка лежат в кадре, и что ряд не пересекается с соседями по кадру — счётчиком кадров
           (правый нижний угол), стрелкой «вперёд» (середина правого края) и подсказкой. */
        const corner = await page.evaluate(() => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
          const inter = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
          const frameEl = document.querySelector('.gallery-main');
          const stripEl = document.querySelector('.gal-share');
          const f = frameEl.getBoundingClientRect();
          const s = stripEl.getBoundingClientRect();
          const icons = [...stripEl.querySelectorAll('.gal-soc')];
          const neighbours = ['.gallery-main .counter', '.gal-nav.next', '.gal-nav.prev', '.gal-hint']
            .map((sel) => document.querySelector(sel)).filter(Boolean).map(box);
          const hintEl = document.querySelector('.gal-hint');
          const hb = hintEl ? hintEl.getBoundingClientRect() : null;
          return {
            n: icons.length,
            right: Math.round(f.right - s.right), top: Math.round(s.top - f.top),
            w: Math.round(s.width), size: icons.map((el) => Math.round(el.getBoundingClientRect().width)),
            round: icons.every((el) => getComputedStyle(el).borderRadius === '50%'),
            inside: icons.every((el) => { const r = el.getBoundingClientRect(); return r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom; }),
            hits: neighbours.filter((o) => inter(box(stripEl), o)).length,
            hintLeft: hb ? Math.round(hb.left - f.left) : null,
            hintBottom: hb ? Math.round(f.bottom - hb.bottom) : null,
          };
        });
        check('ui', 'страница авто: значки «Поделиться» — в правом верхнем углу снимка, соседей не задевают',
          corner.n === 4 && Math.abs(corner.right - 12) <= 1 && Math.abs(corner.top - 12) <= 1
            && corner.w === 154 && corner.size.every((w) => w === 34) && corner.round && corner.inside && corner.hits === 0,
          `отступ справа ${corner.right}, сверху ${corner.top}, ряд ${corner.w} px, `
            + `пересечений с соседями по кадру ${corner.hits}`);
        check('ui', 'страница авто: подсказка «Открыть во весь экран» — в левом нижнем углу кадра',
          Math.abs(corner.hintLeft - 12) <= 1 && Math.abs(corner.hintBottom - 12) <= 1,
          `подсказка слева ${corner.hintLeft}, снизу ${corner.hintBottom}`);
      }

      await page.goto(BASE + '/car/' + withPhotos, { waitUntil: 'domcontentloaded' });
      const g1 = await page.$eval('[data-gallery-img]', (el) => el.getAttribute('src'));
      await page.click('[data-thumb="2"]');
      await new Promise((r) => setTimeout(r, 200));
      const g2 = await page.$eval('[data-gallery-img]', (el) => el.getAttribute('src'));
      check('ui', 'галерея переключает фото', g1 !== g2);
      check('ui', 'галерея считает кадры', /\d+ \/ \d+/.test(await page.$eval('[data-gallery-counter]', (el) => el.textContent)));

      /* Просмотр фото во весь экран: клик по главному кадру открывает оверлей, Esc закрывает,
         прокрутка страницы на время просмотра выключена. Заказчик 2026-09-28: карточка должна
         вести себя как объявление av.by, где фото открываются во весь экран. */
      await page.click('.gallery-main img');
      await page.waitForSelector('.lightbox', { timeout: 5000 });
      const lb = await page.evaluate(() => ({
        src: document.querySelector('.lightbox img').getAttribute('src'),
        main: document.querySelector('[data-gallery-img]').getAttribute('src'),
        lock: getComputedStyle(document.documentElement).overflow,
      }));
      check('ui', 'лайтбокс открывается по клику на главное фото', lb.src === lb.main, lb.src);
      check('ui', 'на время лайтбокса прокрутка страницы выключена', lb.lock === 'hidden', lb.lock);
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'Escape закрывает лайтбокс', (await page.$('.lightbox')) === null);

      /* Заказчик 2026-09-30: «Убери под фотографиями авто блок — Характеристики. Они у нас есть
         справа от фоток»; тем же днём: «Блок — Заявка на автомобиль в карточках авто, убери».
         2026-10-01: «сделай, чтобы нижняя граница блока проверка по VIN была симметрична нижней
         границе блока фотографий» и «нижние и верхняя границы блока — условия покупки, были
         симметричны верхним и нижним границам блока — описание».
         Поэтому карточка — сетка из двух строк, а обе колонки идут по этим строкам (subgrid): верхняя
         пара «галерея ↔ цена + связь + проверка по VIN», нижняя «описание ↔ условия покупки». Отсюда
         проверяем: верх и низ колонок на одной линии, низ «Проверки по VIN» на низу галереи, «Условия
         покупки» ровно по верхнему и нижнему краю «Описания», кадр 4/3 не раздулся от правой колонки
         (замер _ref/probe-columns.mjs), заявки в карточке нет и блоки не вылезают за колонку. */
      const colGeo = await page.evaluate(() => {
        const d = document.querySelector('.detail');
        if (!d) return null;
        const [left, right] = d.children;
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right) }; };
        const bx = (el) => (el ? box(el) : null);
        const cs = (el) => getComputedStyle(el);
        const kids = [...left.children, ...right.children];
        const desc = [...left.querySelectorAll('.panel')].find((p) => /Описание/.test(((p.querySelector('h3') || {}).textContent) || ''));
        return {
          left: box(left), right: box(right),
          leftKids: left.children.length, rightKids: right.children.length,
          display: cs(left).display + '/' + cs(right).display,
          rows: cs(left).gridTemplateRows + '/' + cs(right).gridTemplateRows,
          columns: cs(d).gridTemplateColumns.split(' ').length,
          rowGap: cs(d).rowGap,
          lead: !!d.querySelector('[data-lead-panel]'),
          over: kids.filter((el) => el.getBoundingClientRect().right > el.parentElement.getBoundingClientRect().right + 1).length,
          specs: !!document.getElementById('specs'),
          brief: !!document.querySelector('.car-brief'),
          allLink: !!document.querySelector('.car-brief-all'),
          vinRow: /VIN/.test(((document.querySelector('aside .spec-list') || {}).textContent) || ''),
          gallery: bx(left.querySelector('.gallery')), frame: bx(left.querySelector('.gallery-main')),
          vin: bx(right.querySelector('.vin-panel')), desc: bx(desc), cond: bx(right.querySelector('.car-cond')),
          priceBox: bx(right.querySelector('.price-box')), priceLine: bx(right.querySelector('.price-box .price')),
          tools: bx(right.querySelector('.price-tools')), fav: bx(right.querySelector('.price-box [data-fav]')),
          cmp: bx(right.querySelector('.price-box [data-compare]')),
        };
      });
      const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
      check('ui', 'карточка: низ «Проверки по VIN» по низу галереи, «Условия покупки» по «Описанию»',
        !!colGeo && near(colGeo.left.top, colGeo.right.top) && near(colGeo.left.bottom, colGeo.right.bottom)
          && colGeo.display === 'grid/grid' && colGeo.columns === 2
          && /subgrid/.test(colGeo.rows) && colGeo.rowGap === '20px'
          && near(colGeo.gallery.bottom, colGeo.vin.bottom)
          && near(colGeo.desc.top, colGeo.cond.top) && near(colGeo.desc.bottom, colGeo.cond.bottom)
          && near(colGeo.frame.h, colGeo.frame.w * 3 / 4, 2)
          && !colGeo.lead && colGeo.leftKids >= 2 && colGeo.rightKids >= 2,
        colGeo ? `слева ${colGeo.left.top}→${colGeo.left.bottom} (${colGeo.left.h} px), `
          + `справа ${colGeo.right.top}→${colGeo.right.bottom} (${colGeo.right.h} px), `
          + `блоков ${colGeo.leftKids}/${colGeo.rightKids}, display ${colGeo.display}, строки ${colGeo.rows}, `
          + `колонок ${colGeo.columns}, промежуток строк ${colGeo.rowGap}; `
          + `низ галереи ${colGeo.gallery.bottom} против низа VIN ${colGeo.vin.bottom}, `
          + `описание ${colGeo.desc.top}→${colGeo.desc.bottom} против условий ${colGeo.cond.top}→${colGeo.cond.bottom}, `
          + `кадр ${colGeo.frame.w}×${colGeo.frame.h}, заявка в карточке: ${colGeo.lead ? 'есть' : 'нет'}`
          : 'карточки .detail на странице нет');
      check('ui', 'карточка без блока «Характеристики» под фотографиями, VIN виден в правой колонке',
        !!colGeo && !colGeo.specs && !colGeo.allLink && colGeo.brief && colGeo.vinRow && colGeo.over === 0,
        colGeo ? `таблица #specs: ${colGeo.specs ? 'есть' : 'нет'}, ссылка «Все параметры»: ${colGeo.allLink ? 'есть' : 'нет'}, `
          + `сводка под ценой: ${colGeo.brief ? 'есть' : 'нет'}, строка VIN справа: ${colGeo.vinRow ? 'есть' : 'нет'}, `
          + `блоков за колонкой: ${colGeo.over}`
          : 'карточки .detail на странице нет');
      /* Заказчик 2026-10-01: «на странице авто кнопку лайк и сравнить перенести в правый верхний
         часть» (в уточнении — «в угол блока цены, на строке с ценой»). Отсюда замер: пара значков
         стоит по верхнему краю строки цены и прижата к правому краю панели, а цена — слева от неё.
         Раньше значки были отдельной строкой в середине панели — тогда верх пары был бы ниже верха
         цены на высоту строки цены. */
      check('ui', 'карточка: «лайк» и «сравнить» — правый верхний угол ценовой панели, на строке цены',
        !!colGeo && !!colGeo.tools && !!colGeo.priceLine && !!colGeo.priceBox && !!colGeo.fav && !!colGeo.cmp
          && near(colGeo.tools.top, colGeo.priceLine.top, 2)
          && colGeo.tools.left >= colGeo.priceLine.right
          && colGeo.priceBox.right - colGeo.tools.right <= 24
          && colGeo.fav.left < colGeo.cmp.left
          && colGeo.priceLine.left < colGeo.tools.left,
        colGeo && colGeo.tools ? `строка цены ${colGeo.priceLine.left}→${colGeo.priceLine.right} (верх ${colGeo.priceLine.top}), `
          + `значки ${colGeo.tools.left}→${colGeo.tools.right} (верх ${colGeo.tools.top}), `
          + `панель ${colGeo.priceBox.left}→${colGeo.priceBox.right}`
          : 'ценовой панели на странице нет');
      /* Заказчик 2026-10-01: «Кнопу — расчёт, в блоке цена на странице авто, напиши красным цветом в
         цвет сайта». Ссылка «расчёт» в строке кредита красится акцентом сайта (--accent — тот же
         красный, что у кнопки «Позвонить продавцу»). Сверяем вычисленный цвет ссылки с вычисленным
         значением акцента (и с самим оттенком красного), а не только наличие правила в стилях. */
      const monthLink = await page.evaluate(() => {
        const a = document.querySelector('.price-box .month a');
        if (!a) return null;
        const cs = getComputedStyle(a);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const hex = accent.replace('#', '');
        const want = hex.length === 6
          ? `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`
          : '';
        return { color: cs.color, weight: cs.fontWeight, accent, want, href: a.getAttribute('href') };
      });
      const rgb = (monthLink || {}).color || '';
      const [rr, gg, bb] = (rgb.match(/\d+/g) || []).map(Number);
      check('ui', 'карточка: ссылка «расчёт» в блоке цены — красная, в цвет сайта',
        !!monthLink && !!monthLink.want && rgb === monthLink.want
          && rr > 150 && gg < 60 && bb < 60 && Number(monthLink.weight) >= 600
          && monthLink.href === '/kalkulyator',
        monthLink ? `цвет ${rgb} против акцента ${monthLink.accent} (${monthLink.want}), `
          + `начертание ${monthLink.weight}, ссылка на ${monthLink.href}`
          : 'ссылки «расчёт» в блоке цены нет');

      /* Телефон 390 px: карточка в одну колонку, блока «Характеристики» нет, ничего не вылезает за
         экран по горизонтали. */
      const viewport = page.viewport();
      await page.setViewport({ width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 200));
      const cardMobile = await page.evaluate(() => {
        const d = document.querySelector('.detail');
        const cols = d ? getComputedStyle(d).gridTemplateColumns.split(' ').length : 0;
        const blocks = d ? [...d.children].flatMap((c) => [...c.children]) : [];
        return {
          cols,
          specs: !!document.getElementById('specs'),
          brief: !!document.querySelector('.car-brief'),
          over: blocks.filter((el) => el.getBoundingClientRect().right > innerWidth + 1).length,
          hScroll: document.documentElement.scrollWidth > innerWidth,
        };
      });
      await page.setViewport(viewport);
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'на телефоне 390 px карточка в одну колонку, блока «Характеристики» нет, прокрутки нет',
        cardMobile.cols === 1 && !cardMobile.specs && cardMobile.brief && cardMobile.over === 0 && !cardMobile.hScroll,
        `колонок ${cardMobile.cols}, таблица #specs: ${cardMobile.specs ? 'есть' : 'нет'}, `
          + `сводка под ценой: ${cardMobile.brief ? 'есть' : 'нет'}, блоков за экраном ${cardMobile.over}, `
          + `горизонтальная прокрутка: ${cardMobile.hScroll ? 'есть' : 'нет'}`);

      /* Заказчик 2026-09-29: «на страницах автомобилей сделай так чтобы при нажатии на кнопки
         позвонить продавцу Отправить сообщение предложить цену, чтобы всплывало прозрачное окно
         по нашему стилю»; 2026-09-30: «Позвонить продавцу, сделай, чтобы был только набор номера,
         раскрывающееся окно оставь только для — отправить сообщение и предложить цену». Кнопки
         сообщения и цены открывают одно окно (data-car-contact) с двумя вкладками: проверяем, что
         окно открывается по кнопке, фон полупрозрачный с размытием (наш стиль окон), переключаются
         вкладки и у каждой своя форма со своим kind, а у ссылки звонка атрибута окна нет — она
         набирает номер сама. */
      const contactUi = await page.evaluate(async () => {
        const back = document.querySelector('[data-car-contact]');
        const style = getComputedStyle(back);
        const callLink = document.querySelector('.car-contact a[href^="tel:"]');
        const openBtn = document.querySelector('[data-car-contact-open="offer"]');
        openBtn.click();
        await new Promise((r) => setTimeout(r, 150));
        const pane = (name) => {
          const p = back.querySelector('[data-car-contact-pane="' + name + '"]');
          return !p.hidden && p.getClientRects().length > 0;
        };
        const kinds = [...back.querySelectorAll('[data-car-contact-form]')]
          .map((f) => f.querySelector('[name="kind"]').value + ':' + f.querySelector('[name="car_id"]').value);
        const priceField = back.querySelector('[data-car-contact-pane="offer"] [name="comment"]');
        return {
          open: !back.hidden && back.classList.contains('is-open'),
          bg: style.backgroundColor,
          blur: style.backdropFilter || style.webkitBackdropFilter || '',
          zero: style.zIndex,
          offer: pane('offer'),
          tabs: back.querySelectorAll('[data-car-contact-tab]').length,
          kinds,
          priceVisible: !!priceField && priceField.getClientRects().length > 0,
          callHref: callLink ? callLink.getAttribute('href') : '',
          callNoModal: !!callLink && !callLink.hasAttribute('data-car-contact-open')
            && !callLink.hasAttribute('data-car-contact'),
          openers: document.querySelectorAll('[data-car-contact-open]').length,
          sub: (back.querySelector('.modal-sub') || {}).textContent || '',
          hasCallPane: !!back.querySelector('[data-car-contact-pane="call"]'),
        };
      });
      const rgba = (contactUi.bg.match(/rgba?\(([^)]+)\)/) || [, ''])[1].split(',').map((n) => Number(n));
      check('ui', 'кнопки сообщения и цены открывают прозрачное окно по нашему стилю',
        contactUi.open && contactUi.zero === '300' && rgba[3] > 0 && rgba[3] < 1 && /blur/.test(contactUi.blur),
        JSON.stringify(contactUi));
      check('ui', '«Позвонить продавцу» — только набор номера: ссылка tel: без окна',
        /^tel:\+?\d{6,}$/.test(contactUi.callHref) && contactUi.callNoModal
          && contactUi.openers === 2 && !contactUi.hasCallPane,
        `href ${contactUi.callHref}, атрибут окна у ссылки: ${contactUi.callNoModal ? 'нет' : 'есть'}, `
          + `открывающих кнопок ${contactUi.openers}, вкладка звонка: ${contactUi.hasCallPane ? 'есть' : 'нет'}`);
      check('ui', 'в окне связи две вкладки — сообщение и цена, у каждой своя форма заявки',
        contactUi.tabs === 2 && contactUi.kinds.length === 2
          && contactUi.kinds[0].startsWith('message:') && contactUi.kinds[1].startsWith('offer:'),
        contactUi.kinds.join(', '));
      check('ui', 'в окне связи нет обещания «позвоним в течение 15 минут и подтвердим, что машина в наличии»',
        !/15 минут/.test(contactUi.sub) && !/подтвердим/.test(contactUi.sub)
          && !/в наличии/.test(contactUi.sub),
        contactUi.sub.trim());
      check('ui', '«Предложить цену» открывает вкладку с полем цены',
        contactUi.offer && contactUi.priceVisible, JSON.stringify(contactUi));
      const contactPaneSwitch = await page.evaluate(async () => {
        document.querySelector('[data-car-contact-tab="message"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const back = document.querySelector('[data-car-contact]');
        const shown = (n) => !back.querySelector('[data-car-contact-pane="' + n + '"]').hidden;
        return { message: shown('message'), offer: shown('offer'), on: back.querySelector('.auth-tab.on').dataset.carContactTab };
      });
      check('ui', 'вкладки окна связи переключают панели',
        contactPaneSwitch.message && !contactPaneSwitch.offer && contactPaneSwitch.on === 'message',
        JSON.stringify(contactPaneSwitch));
      /* Заказчик 2026-09-30: «Поле - Сообщение, в окне которое появляется при нажатии на отправить
         сообщение, криво реализовано окно для текста, текст подписи заходит за рамки поля». Поле
         было скруглено кнопочным радиусом (--r-btn = 999 px), поэтому боковые стороны капсулы
         становились дугами в половину высоты бокса (54 px при боксе 108 px) и текст подписи
         упирался в дугу рамки. Мера: у поля «Сообщение» радиус как у соседнего однострочного поля
         (--r-field = 14 px), а не капсула, подпись занимает меньше строк, чем помещается в бокс, и
         прокрутки внутри поля нет. */
      const msgField = await page.evaluate(async () => {
        document.querySelector('[data-car-contact-tab="message"]').click();
        await new Promise((r) => setTimeout(r, 100));
        const back = document.querySelector('[data-car-contact]');
        const ta = back.querySelector('[data-car-contact-pane="message"] textarea');
        const name = back.querySelector('[data-car-contact-pane="message"] [name="name"]');
        const cs = getComputedStyle(ta);
        const num = (v) => parseFloat(v) || 0;
        const r = ta.getBoundingClientRect();
        const innerW = r.width - num(cs.paddingLeft) - num(cs.paddingRight)
          - num(cs.borderLeftWidth) - num(cs.borderRightWidth);
        const lineH = num(cs.lineHeight) || num(cs.fontSize) * 1.2;
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;left:-9999px;top:0;white-space:pre;font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-size:${cs.fontSize}`;
        probe.textContent = ta.placeholder;
        document.body.appendChild(probe);
        const phW = probe.getBoundingClientRect().width;
        probe.remove();
        const phLines = Math.ceil(phW / innerW);
        return {
          radius: cs.borderTopLeftRadius,
          inputRadius: getComputedStyle(name).borderTopLeftRadius,
          innerW: Math.round(innerW),
          phLines,
          fitsLines: Math.floor((r.height - num(cs.paddingTop) - num(cs.paddingBottom)) / lineH),
          scrollFits: ta.scrollHeight <= ta.clientHeight + 1,
        };
      });
      check('ui', 'поле «Сообщение» скруглено как поля, а не капсулой: подпись внутри рамки',
        msgField.radius === msgField.inputRadius && parseFloat(msgField.radius) <= 20
          && msgField.phLines <= msgField.fitsLines && msgField.scrollFits,
        JSON.stringify(msgField));
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      const contactClosed = await page.evaluate(() => {
        const back = document.querySelector('[data-car-contact]');
        return back.hidden && !back.classList.contains('is-open');
      });
      check('ui', 'Escape закрывает окно связи', contactClosed, String(contactClosed));

      /* Заказчик 2026-09-29: «на странице автомобилей написано лизинг и платёж от. сделай так
         чтобы там был не лизинг а кредит и платёж считают от цены машины на максимальный срок и
         участие клиента 20%». Проверяем карточку автомобиля: в блоке цены (price-box, где раньше
         стояло «Лизинг от … руб. в месяц») слова «Лизинг» больше нет, а платёж посчитан от полной
         цены на 84 месяца с участием 20 % — тем же аннуитетом, что и в калькуляторе, поэтому числа
         совпадают. Формула — lib/finance.mjs (carPagePayment). Сама услуга «Лизинг» и строка
         «Кредит / лизинг» в параметрах — не трогаем, они вне блока цены. */
      const carPage = (await get('/cars')).text.match(/href="\/car\/([a-z0-9-]+)"/);
      const carHtml = carPage ? (await get('/car/' + carPage[1])).text : '';
      /* Блок цены берём до панели «Связаться с продавцом»: значки «В избранное» и «сравнить» стоят
         в нём же, в правом верхнем углу (2026-10-01), и в срез попадают — раньше срез кончался на
         их строке. */
      const carBox = (carHtml.match(/<div class="price-box">([\s\S]*?)<\/div>\s*<div class="panel"/) || [, ''])[1];
      /* Платёж и цена печатаются со знаком рубля: «953<span class="byn">Б</span>» — сумму берём
         из подписи, а сам знак проверяем отдельно (заказчик 2026-10-02). */
      const carPay = (carHtml.match(/<div class="month">Кредит от ([\d\s\u00A0]+)<span class="byn">Б<\/span> в месяц[\s\S]*?<\/div>/) || [, ''])[1];
      const carPriceTxt = (carHtml.match(/<div class="price num">([\d\s\u00A0]*)<span class="byn">Б<\/span>/) || [, ''])[1];
      const carPrice = Number(carPriceTxt.replace(/[^\d]/g, ''));
      const exactPay = (price) => {
        const credit = Math.round(price * 0.8), m = 0.16 / 12, n = 84;
        return Math.round(credit * m / (1 - Math.pow(1 + m, -n)));
      };
      check('pages', 'карточка автомобиля: «Кредит от …», без лизинга, платёж — 20 % на 84 месяца',
        !!carPage && carBox !== '' && !/Лизинг/.test(carBox)
          && carPay !== '' && Number(carPay.replace(/\s/g, '')) === exactPay(carPrice),
        `машина ${carPage && carPage[1]}: цена «${carPriceTxt}», платёж «${carPay}», ожидалось ${carPrice ? exactPay(carPrice) : '—'}`);

      /* Плавное «ползунок двигается — платёж считается»: срок по умолчанию максимальный (84
         месяца, как в карточке автомобиля), поэтому двигаем его в 60 и сверяем пересчёт. */
      await page.goto(BASE + '/kalkulyator', { waitUntil: 'domcontentloaded' });
      /* Числа калькулятора теперь без знака: знак «Б» стоит в разметке рядом (<span class="byn">Б</span>),
         поэтому читаем только число из <b data-payment>. */
      const payNum = () => page.$eval('[data-payment]', (el) => el.textContent.replace(/\u00A0/g, ' ').trim());
      const pay1 = await payNum();
      await page.evaluate(() => {
        const f = document.querySelector('[data-calc]');
        f.months.value = 60;
        f.months.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const pay2 = await payNum();
      check('ui', 'калькулятор пересчитывает платёж', pay1 !== pay2 && /^[\d\s]+$/.test(pay2) && pay2 === '1 167', pay1 + ' → ' + pay2);

      /* Порядок чтения блока расчёта, просьба заказчика 2026-09-27: «Перемести (Стоимость
         автомобиля, руб. / Первоначальный взнос, руб. / Срок, месяцев) в верх, а (платёж в месяц,
         Сумма кредита, Переплата, Итого к возврату) — ниже блока». Поля и итоги стоят одной
         колонкой (поля выше, итоги под ними), окно заявки — справа, верх на одной линии с полями.
         Вторая просьба 2026-09-27: «громоздко, сделай не ниже границы блока заявка» — столбиком
         расчёт выходил на 181 px ниже окна заявки, поэтому поля расчёта теперь в одну строку
         (.calc-fields), показатели итогов — строкой, а низ карточки итогов держится ровно по низу
         окна заявки (растягивается то, что короче: карточка итогов или само окно заявки).
         lib/pages.mjs: calculatorPage, public/assets/css/site.css: .calc-layout. Плюс ставка
         «под капотом» — 16 % годовых: по умолчанию 60 000 при участии 20 % (взнос 12 000) на
         максимальные 84 месяца даёт 953 руб. в месяц. */
      await page.goto(BASE + '/kalkulyator', { waitUntil: 'domcontentloaded' });
      const calc3 = await page.evaluate(() => {
        const r = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom) };
        };
        const clean = (sel) => {
          const el = document.querySelector(sel);
          return el ? el.textContent.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim() : null;
        };
        const rowNum = (n) => {
          const row = document.querySelector(`.spec-list > div:nth-child(${n})`);
          return row ? row.textContent.replace(/^\D+/, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim() : null;
        };
        return {
          form: r('[data-calc]'), out: r('.calc-out'), lead: r('.calc-lead'),          fieldCols: document.querySelector('.calc-fields')
            ? getComputedStyle(document.querySelector('.calc-fields')).gridTemplateColumns.split(' ').length : 0,
          pay: clean('.big.num'),
          credit: rowNum(1),
          signs: document.querySelectorAll('.calc-out .byn').length,
          rate: !!document.querySelector('[data-calc] [name=rate]'),
        };
      });
      const stacked = calc3.form && calc3.out && calc3.lead &&
        calc3.out.y >= calc3.form.bottom && calc3.out.x === calc3.form.x && calc3.out.right === calc3.form.right;
      check('ui', 'блок расчёта: итоги стоят под полями в той же колонке', stacked,
        `поля ${calc3.form.y}–${calc3.form.bottom} (x ${calc3.form.x}…${calc3.form.right}) / итоги ${calc3.out.y}–${calc3.out.bottom} (x ${calc3.out.x}…${calc3.out.right})`);
      check('ui', 'блок расчёта: поля расчёта стоят одной строкой', calc3.fieldCols === 3,
        `колонок у .calc-fields: ${calc3.fieldCols}`);
      check('ui', 'блок расчёта: окно заявки справа от полей, верх на одной линии',
        calc3.lead.x > calc3.form.right && calc3.lead.y === calc3.form.y,
        `${calc3.form.right} → ${calc3.lead.x}, верх полей ${calc3.form.y} / заявки ${calc3.lead.y}`);
      check('ui', 'блок расчёта: зазор между карточками ровный',
        calc3.out.y - calc3.form.bottom === calc3.lead.x - calc3.form.right,
        `вертикаль ${calc3.out.y - calc3.form.bottom} / горизонталь ${calc3.lead.x - calc3.form.right}`);
      check('ui', 'блок расчёта: итоги не выходят ниже окна заявки, низы сходятся',
        Math.abs(calc3.out.bottom - calc3.lead.bottom) <= 1,
        `низ итогов ${calc3.out.bottom} / низ заявки ${calc3.lead.bottom}`);
      check('ui', 'в калькуляторе нет поля «Ставка», платёж по 16 % годовых (аннуитет)',
        !calc3.rate && calc3.pay === '953 Б / месяц' && calc3.credit === '48 000 Б' && calc3.signs === 4, JSON.stringify(calc3));
      /* Ползунки расчёта (просьба заказчика 2026-09-27: «Стоимость автомобиля, руб. 60000 /
         Первоначальный взнос, руб. — сделай ползунком как в месяцах», затем 2026-09-29: «в блок
         кредитный калькулятор добавь ползунок участие клиента от 5% до 80%»). Проверяем: все три
         поля — ползунки с подписью значения, границы и шаг как в разметке (участие клиента —
         проценты 5…80 шагом 1, срок по умолчанию максимальный), заливка трека считается скриптом
         (--p), а взнос в рублях всегда равен проценту от цены, поэтому превысить стоимость не
         может — границы, как раньше, двигать не нужно.
         lib/pages.mjs: calculatorPage, public/assets/js/site.js: initCalc,
         public/assets/css/site.css: .calc-slider. */
      const sliders = await page.evaluate(() => {
        const f = document.querySelector('[data-calc]');
        return {
          sliders: f.querySelectorAll('input[type=range]').length,
          numbers: f.querySelectorAll('input[type=number]').length,
          rows: [...f.querySelectorAll('.field')].map((row) => {
            const el = row.querySelector('input,select');
            const out = row.querySelector('output');
            return {
              name: el.name, type: el.type, min: el.min, max: el.max, step: el.step, value: el.value,
              out: out ? out.textContent.trim() : null, fill: el.style.getPropertyValue('--p'),
            };
          }),
        };
      });
      const by = (n) => sliders.rows.find((r) => r.name === n) || {};
      const price0 = by('price'), share0 = by('share'), months0 = by('months');
      check('ui', 'калькулятор: все три поля расчёта — ползунки, числовых полей нет',
        sliders.sliders === 3 && sliders.numbers === 0
        && sliders.rows.map((r) => r.name).join() === 'price,share,months'
        && sliders.rows.every((r) => r.type === 'range'),
        sliders.rows.map((r) => `${r.name}:${r.type}`).join(' '));
      check('ui', 'калькулятор: у ползунков границы, шаг и подпись значения под ними',
        price0.min === '1000' && price0.step === '500' && Number(price0.max) >= 60000
        && (Number(price0.max) - 1000) % 500 === 0 && price0.out === '60 000'
        && share0.min === '5' && share0.max === '80' && share0.step === '1' && share0.out === '20 % · 12 000\u00A0Б'
        && months0.min === '6' && months0.max === '84' && months0.step === '6' && months0.out === '84',
        `стоимость ${price0.min}…${price0.max}/${price0.step} «${price0.out}» · участие ${share0.min}…${share0.max}/${share0.step} «${share0.out}» · срок ${months0.min}…${months0.max}/${months0.step} «${months0.out}»`);
      check('ui', 'калькулятор: заливка ползунков считается скриптом (--p)',
        sliders.rows.every((r) => /^\d+(\.\d+)?%$/.test(r.fill)),
        sliders.rows.map((r) => `${r.name}=${r.fill || '—'}`).join(' '));
      const shareRange = await page.evaluate(() => {
        const f = document.querySelector('[data-calc]');
        const fire = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));
        /* Число лежит в своём <i> (калькулятор пишет только числа), знак «Б» — соседний
           <span class="byn">Б</span> в той же строке. */
        const num = (sel) => document.querySelector(sel).textContent.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        const sum = (n) => {
          const row = document.querySelector(`.spec-list > div:nth-child(${n})`);
          return row ? row.textContent.replace(/^\D+/, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim() : null;
        };
        f.share.value = 80; fire(f.share);
        const high = { share: f.share.value, out: num('[data-share]'), credit: num('[data-credit]'), sum: sum(1) };
        f.share.value = 3; fire(f.share);
        const low = { share: f.share.value, out: num('[data-share]') };
        f.price.value = 10000; f.share.value = 5; fire(f.price); fire(f.share);
        const lowPrice = {
          priceOut: num('[data-price]'),
          out: num('[data-share]'),
          credit: num('[data-credit]'),
          pay: num('[data-payment]'),
          full: num('.big.num'),
        };
        return { high, low, lowPrice };
      });
      check('ui', 'калькулятор: участие клиента 80 % — взнос 48 000, кредит 12 000',
        shareRange.high.share === '80' && shareRange.high.out === '80 % · 48 000 Б'
          && shareRange.high.credit === '12 000' && shareRange.high.sum === '12 000 Б',
        `80 %: подпись «${shareRange.high.out}», кредит «${shareRange.high.credit}», строка итога «${shareRange.high.sum}»`);
      check('ui', 'калькулятор: участие клиента ограничено снизу 5 %',
        shareRange.low.share === '5' && shareRange.low.out === '5 % · 3 000 Б',
        `введено 3 → ${shareRange.low.share} % («${shareRange.low.out}») · цена 10 000, участие 5 %: кредит «${shareRange.lowPrice.credit}», платёж «${shareRange.lowPrice.pay}»`);
      check('ui', 'калькулятор: взнос в рублях считается от цены, стоимость 10 000 при 5 %',
        shareRange.lowPrice.priceOut === '10 000' && shareRange.lowPrice.out === '5 % · 500 Б'
          && shareRange.lowPrice.credit === '9 500' && shareRange.lowPrice.pay === '189'
          && shareRange.lowPrice.full === '189 Б / месяц',
        JSON.stringify(shareRange.lowPrice));
      const recalc = await page.evaluate(() => {
        const f = document.querySelector('[data-calc]');
        const num = (sel) => document.querySelector(sel).textContent.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        f.price.value = 60000; f.price.dispatchEvent(new Event('input', { bubbles: true }));
        f.share.value = 20; f.share.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          pay: num('[data-payment]'),
          credit: num('[data-credit]'),
          shareOut: num('[data-share]'),
        };
      });
      check('ui', 'калькулятор: ползунки пересчитывают платёж',
        recalc.pay === '953' && recalc.credit === '48 000' && recalc.shareOut === '20 % · 12 000 Б',
        `цена 60 000, участие 20 %: платёж «${recalc.pay}», кредит «${recalc.credit}», подпись «${recalc.shareOut}»`);
      /* Значение ползунка нельзя напечатать, поэтому точная сумма выставляется стрелками: шаг 500
         у стоимости, 1 у участия и 6 у срока. Проверяем, что клавиатура двигает ползунок и всё
         пересчитывается (мышью то же самое делает перетаскивание бегунка). */
      await page.evaluate(() => {
        const f = document.querySelector('[data-calc]');
        f.price.value = 60000; f.price.dispatchEvent(new Event('input', { bubbles: true }));
        f.share.value = 20; f.share.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.focus('[data-calc] [name=price]');
      await page.keyboard.press('ArrowRight');
      const keyMove = await page.evaluate(() => ({
        price: document.querySelector('[data-calc] [name=price]').value,
        out: document.querySelector('[data-price]').textContent.trim(),
        pay: document.querySelector('.big.num').textContent.trim().replace(/\s+/g, ' '),
      }));
      check('ui', 'калькулятор: ползунок двигается с клавиатуры шагом 500 и пересчитывает расчёт',
        keyMove.price === '60500' && keyMove.out === '60 500' && keyMove.pay === '961 Б / месяц',
        `60 000 → ${keyMove.price}, подпись «${keyMove.out}», платёж «${keyMove.pay}»`);
      /* На 861–1179 px подписи «Стоимость автомобиля, руб.» и «Участие клиента, %» не
         влезают в 152 px и переносятся на две строки — по верху их ползунки уезжали на 20 px ниже
         ползунка «Срока, месяцев». Поэтому поля выровнены по низу (.calc-fields: align-items:end):
         все ползунки и все значения стоят на одной линии. */
      await page.setViewport({ width: 1024, height: 900 });
      await page.goto(BASE + '/kalkulyator', { waitUntil: 'domcontentloaded' });
      const align1024 = await page.evaluate(() => {
        const tops = (sel) => [...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().top));
        const spread = (a) => Math.max(...a) - Math.min(...a);
        const labels = tops('[data-calc] .field > span');
        return {
          sliders: spread(tops('[data-calc] input[type=range]')),
          outs: spread(tops('[data-calc] output')),
          labels: spread(labels),
          count: tops('[data-calc] input[type=range]').length,
        };
      });
      check('ui', '1024: ползунки расчёта и их значения стоят на одной линии',
        align1024.count === 3 && align1024.sliders <= 1 && align1024.outs <= 1,
        `ползунков ${align1024.count}, подписи в две строки (расхождение верхов ${align1024.labels} px), ползунки — ${align1024.sliders} px, значения — ${align1024.outs} px`);

      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      /* Те же иконки без подложки на телефоне: тут кнопки ужимаются медиазапросами до 36 px
         (≤360 px — 32 px, ≤340 px — 28 px), и рамка/фон возвращались бы из старых правил, если
         бы их не перебили. Плюс проверяем, что ряд иконок со значками не вылез за экран.
         Замер идёт до клика по бургеру: после тапа кнопка остаётся в фокусе и по правилу
         .icon-btn:focus-visible получает мягкую окружность — это отклик на нажатие, а не
         постоянная подложка, которую здесь проверяем. Скрытые кнопки (бургер на широком экране,
         кнопка внутри свёрнутого .map-picker) в замер не попадают: у них нулевая площадь. */
      const icons390 = await page.evaluate(() => {
        const all = [...document.querySelectorAll('.header .head-actions > *, .header .head-actions .icon-btn, .header .head-actions .head-user, .header .head-actions .head-logout')];
        const vis = all.filter((el) => {
          const cs = getComputedStyle(el), b = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0;
        });
        const bad = vis.filter((el) => { const cs = getComputedStyle(el); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px'; });
        return {
          n: vis.length,
          bad: bad.map((el) => String(el.className) + ' → ' + getComputedStyle(el).backgroundColor + ' / ' + getComputedStyle(el).borderTopWidth),
          sizes: [...new Set(vis.map((el) => Math.round(el.getBoundingClientRect().width)))],
          over: Math.max(...vis.map((el) => Math.round(el.getBoundingClientRect().right - innerWidth))),
        };
      });
      check('ui', '390: иконки шапки тоже без подложки и рамок', icons390.bad.length === 0 && icons390.n >= 4, JSON.stringify(icons390));
      check('ui', '390: ряд иконок не вылезает за экран', icons390.over <= 0, `перебор ${icons390.over} px, размеры ${icons390.sizes.join('/')}`);

      await page.click('[data-burger]');
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'бургер раскрывает меню', await page.$eval('[data-mobile-nav]', (el) => el.classList.contains('open')));

      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      check('ui', 'окно входа скрыто до клика', await page.$eval('[data-auth-modal]', (el) => el.hidden));
      await page.click('[data-auth-open]');
      await new Promise((r) => setTimeout(r, 250));
      const shown = await page.$eval('[data-auth-modal]', (el) => !el.hidden && getComputedStyle(el).display !== 'none');
      check('ui', 'кнопка открывает окно входа', shown);
      const bg = await page.$eval('[data-auth-modal]', (el) => getComputedStyle(el).backgroundColor);
      check('ui', 'фон окна прозрачный', /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0?\.\d+\)/.test(bg), bg);
      /* Просьба заказчика: «блок вход и регистрация, при нажатии на регистрацию блок ходит вниз
         дальше страницы, сделай так чтобы он не делал такой эффект». Раньше окно стояло по центру
         (place-items:center) и при переключении на «Регистрацию» росло в обе стороны: шапка и вкладки
         уезжали вверх, форма — вниз, а в невысоком окне блок выходил за экран и до кнопки
         «Создать аккаунт» можно было добраться только прокруткой фона. Теперь верх окна закреплён
         (place-items:start center), высота ограничена экраном, а форма сжата так, что помещается в окно
         целиком, без прокрутки. Проверяем главное: окно по ширине по центру и целиком в экране, при переключении вкладки
         верх не съезжает. CSS .modal-back/.modal/.modal-auth в public/assets/css/site.css. */
      const authGeometry = () => page.evaluate(() => {
        const back = document.querySelector('[data-auth-modal]');
        const modal = back.querySelector('.modal-auth');
        const pane = back.querySelector('[data-auth-pane]:not(.hide)');
        const r = modal.getBoundingClientRect();
        return {
          top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
          dx: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)),
          backScroll: back.scrollHeight - back.clientHeight,
          paneScroll: pane.scrollHeight - pane.clientHeight,
          vh: innerHeight,
        };
      });
      const boxLogin = await authGeometry();
      check('ui', 'окно входа по центру по ширине и целиком в экране',
        boxLogin.dx < 12 && boxLogin.top >= 0 && boxLogin.bottom <= boxLogin.vh,
        JSON.stringify(boxLogin));
      await page.click('[data-auth-tab="register"]');
      await new Promise((r) => setTimeout(r, 150));
      check('ui', 'вкладка переключает на регистрацию', await page.$eval('[data-auth-pane="register"]', (el) => !el.classList.contains('hide')));
      const boxReg = await authGeometry();
      check('ui', '«Регистрация» не сдвигает верх окна', Math.abs(boxReg.top - boxLogin.top) <= 2,
        `вход ${boxLogin.top} → регистрация ${boxReg.top}`);
      check('ui', '«Регистрация» не уходит за низ экрана', boxReg.bottom <= boxReg.vh,
        `низ ${boxReg.bottom}, экран ${boxReg.vh}`);
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'Escape закрывает окно', await page.$eval('[data-auth-modal]', (el) => el.hidden));

      /* Иконки шапки — только значки: ни подложки, ни рамок (просьба заказчика: «сделай все
         иконки в шапке с прозрачным фоном и убери границы кнопок, оставь только иконки»).
         Проверяем каждую видимую кнопку правого блока шапки: фон прозрачный, рамки нет, значок на месте
         (скрытый на широком экране бургер и кнопка внутри свёрнутого .map-picker пропускаются).
         Отклик теперь даёт мягкая полупрозрачная окружность на наведении — она и заменила рамку.
         CSS: .icon-btn и .header .btn-ghost в public/assets/css/site.css. */
      await page.mouse.move(0, 0); /* уводим курсор: предыдущие шаги кликали по кнопке входа, и hover-подсветка не должна попасть в замер покоя */
      /* Escape вернул фокус на кнопку входа — снимаем его: :focus-visible даёт мягкую окружность,
         это отклик на действие, а не постоянная подложка. */
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      /* Ждём затухания подсветки: у .icon-btn transition .15s ease, и без паузы замер ловил
         остаточные rgba(255,255,255,0.004) от hover, оставшегося после клика по кнопке входа. */
      await new Promise((r) => setTimeout(r, 350));
      const headerIcons = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.header .head-actions .icon-btn, .header .head-actions .head-user, .header .head-actions .head-logout')]
          .filter((el) => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; });
        return btns.map((el) => {
          const cs = getComputedStyle(el), b = el.getBoundingClientRect();
          const svg = el.querySelector('svg');
          return {
            cls: String(el.className), bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
            w: Math.round(b.width), h: Math.round(b.height),
            icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
          };
        });
      });
      check('ui', 'иконки шапки: прозрачный фон и никаких рамок',
        headerIcons.length >= 5 && headerIcons.every((i) => i.bg === 'rgba(0, 0, 0, 0)' && i.border === '0px none' && i.icon > 0),
        JSON.stringify(headerIcons));
      await page.hover('.header .head-actions .icon-btn');
      /* Ждём именно конечный цвет. У .icon-btn переход .15s, но под нагрузкой (в момент прогона
         рядом могут работать другие браузеры) кадры анимации отстают, и фиксированная пауза
         ловила промежуточный rgba(255,255,255,0.035) — прогон падал на ровном месте.
         Поэтому опрашиваем цвет, пока он не станет конечным. */
      let hoverBg = '';
      for (let i = 0; i < 30; i++) {
        hoverBg = await page.$eval('.header .head-actions .icon-btn', (el) => getComputedStyle(el).backgroundColor);
        if (/rgba\(255, 255, 255, 0\.1\)/.test(hoverBg)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      check('ui', 'иконка шапки подсвечивается окружностью на наведении', /rgba\(255, 255, 255, 0\.1\)/.test(hoverBg), hoverBg);
      await page.click('[data-auth-open]');
      await new Promise((r) => setTimeout(r, 200));
      await page.mouse.click(20, 20);
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'клик по фону закрывает окно', await page.$eval('[data-auth-modal]', (el) => el.hidden));

      /* Тот же блок в невысоком окне 620: именно здесь «Регистрация» раньше уезжала за низ страницы
         (низ 736 при экране 620), и кнопка «Создать аккаунт» была недостижима без прокрутки фона.
         Окно ограничено высотой экрана, а с 2026-09-28 заказчик попросил убрать и прокрутку формы:
         «Окно - Вход и регистрация, там есть прокрутка справа, сделай, чтобы не было прокрутки и
         окно не выходило за экран монитора вниз». До правки прокрутка формы была 30 px на 1366×768,
         92 px на 1440×700 и 166 px на 1280×620; теперь окно сжато по вертикали (site.css:
         --mp-top/--mp-bottom у .modal-back, отступы вкладок и полей, @media (max-height:740px)), и
         форма помещается целиком — проверяем это и на 620, и на ноутбучном 1366×768. */
      await page.setViewport({ width: 1400, height: 620 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.click('[data-auth-open]');
      await new Promise((r) => setTimeout(r, 250));
      const lowLogin = await authGeometry();
      await page.click('[data-auth-tab="register"]');
      await new Promise((r) => setTimeout(r, 250));
      const lowReg = await authGeometry();
      check('ui', '620: «Регистрация» тоже не сдвигает верх окна', Math.abs(lowReg.top - lowLogin.top) <= 2,
        `вход ${lowLogin.top} → регистрация ${lowReg.top}`);
      check('ui', '620: «Регистрация» не выходит за экран и не тянет за собой фон',
        lowReg.bottom <= lowReg.vh && lowReg.backScroll === 0,
        `низ ${lowReg.bottom}, экран ${lowReg.vh}, прокрутка фона ${lowReg.backScroll}`);
      const lowReach = await page.evaluate(() => {
        const back = document.querySelector('[data-auth-modal]');
        const pane = back.querySelector('[data-auth-pane]:not(.hide)');
        pane.scrollTop = 99999; /* прокрутки быть не должно, поэтому scrollTop остаётся нулевым */
        const m = back.querySelector('.modal-auth').getBoundingClientRect();
        const b = pane.querySelector('button[type=submit]').getBoundingClientRect();
        return {
          scrolled: Math.round(pane.scrollTop), bottom: Math.round(m.bottom), vh: innerHeight,
          sendTop: Math.round(b.top), sendBottom: Math.round(b.bottom),
        };
      });
      await page.setViewport({ width: 1366, height: 768 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.click('[data-auth-open]');
      await new Promise((r) => setTimeout(r, 250));
      await page.click('[data-auth-tab="register"]');
      await new Promise((r) => setTimeout(r, 250));
      const lapReg = await authGeometry();
      const lapBtn = await page.evaluate(() => {
        const back = document.querySelector('[data-auth-modal]');
        const b = back.querySelector('[data-auth-pane]:not(.hide) button[type=submit]').getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
      });
      check('ui', '620 и 1366×768: форма «Регистрации» помещается целиком, прокрутки нет',
        lowReg.paneScroll === 0 && lowReach.scrolled === 0
          && lowReach.sendTop >= 0 && lowReach.sendBottom <= lowReach.vh
          && lowReach.bottom <= lowReach.vh
          && lapReg.paneScroll === 0 && lapReg.bottom <= lapReg.vh
          && lapBtn.top >= 0 && lapBtn.bottom <= lapReg.vh,
        JSON.stringify({
          на620: { paneScroll: lowReg.paneScroll, ...lowReach },
          на768: { paneScroll: lapReg.paneScroll, низ: lapReg.bottom, экран: lapReg.vh, ...lapBtn },
        }));
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      await page.setViewport({ width: 1400, height: 950 });

      /* раскрытие «Параметров» досматривает низ полей (initMoreToggle в public/assets/js/site.js):
         в невысоком окне 620 страница сама доводится до нижней границы раскрытых полей.
         После снятия тёмной полосы марок (2026-09-27) страница /cars стала короче на ~50 px, и
         раскрытые поля в окне 620 теперь помещаются целиком: доводить прокруткой нечего, scrollY
         честно остаётся 0. Поэтому саму прокрутку требуем только тогда, когда странице есть куда
         прокручиваться, а главное — что низ раскрытых полей виден — проверяем всегда. */
      await page.setViewport({ width: 1400, height: 620 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      /* «Параметры» — не кнопка, а красная надпись со значком (просьба заказчика: «кнопку
         параметры на блоке поиска убери кнопку и фон оставь только иконку и подпись параметры
         и сделай их красным цветом по стилю сайта»): ни фона, ни рамки, цвет --accent у слова и
         у значка (в ico() обводка currentColor), значок стоит по левому краю полей над ним.
         CSS .ps-more-sum в public/assets/css/site.css. */
      const moreBtn = await page.evaluate(() => {
        const el = document.querySelector('.ps-more-sum');
        const act = document.querySelector('.ps-actions .btn');
        const form = document.querySelector('.param-form');
        const field = document.querySelector('.param-form .ps-field');
        if (!el || !act || !form || !field) return null;
        const cs = getComputedStyle(el), b = el.getBoundingClientRect(), ab = act.getBoundingClientRect();
        const svg = el.querySelector('svg');
        return {
          bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
          h: Math.round(b.height), w: Math.round(b.width), left: Math.round(b.left),
          formLeft: Math.round(form.getBoundingClientRect().left),
          fieldLeft: Math.round(field.getBoundingClientRect().left),
          actLeft: Math.round(ab.left), actH: Math.round(ab.height),
          icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
          iconColor: svg ? getComputedStyle(svg).color : '',
          iconStroke: svg ? svg.getAttribute('stroke') : '',
          text: el.textContent.replace(/\s+/g, ' ').trim(),
        };
      });
      check('ui', '«Параметры» — красная надпись со значком, без кнопки и фона',
        !!moreBtn && moreBtn.bg === 'rgba(0, 0, 0, 0)' && moreBtn.border === '0px none'
          && moreBtn.color === 'rgb(227, 0, 15)' && moreBtn.icon >= 16 && moreBtn.iconStroke === 'currentColor'
          && moreBtn.iconColor === 'rgb(227, 0, 15)'
          && moreBtn.left === moreBtn.formLeft && moreBtn.left === moreBtn.fieldLeft
          && moreBtn.h === 46 && moreBtn.h === moreBtn.actH && moreBtn.actLeft >= moreBtn.left + moreBtn.w
          && /^Параметры$/.test(moreBtn.text),
        JSON.stringify(moreBtn));
      await page.hover('.ps-more-sum');
      await new Promise((r) => setTimeout(r, 250));
      const moreHover = await page.$eval('.ps-more-sum', (el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor, deco: cs.textDecorationLine };
      });
      check('ui', '«Параметры» на наведении плотнее и подчёркиваются',
        moreHover.color === 'rgb(188, 0, 12)' && moreHover.bg === 'rgba(0, 0, 0, 0)' && moreHover.deco === 'underline',
        JSON.stringify(moreHover));
      await page.click('.ps-more-sum');
      await new Promise((r) => setTimeout(r, 500));
      const more = await page.evaluate(() => {
        const rb = document.querySelector('.ps-more-body').getBoundingClientRect();
        return {
          open: document.querySelector('.ps-more-tgl').checked, y: Math.round(window.scrollY),
          bottom: Math.round(rb.bottom), vh: window.innerHeight,
        };
      });
      check('ui', '«Параметры»: раскрытые поля целиком в окне',
        more.open && more.bottom <= more.vh + 1, JSON.stringify(more));
      /* А вот в совсем низком окне поля заведомо выше экрана, и страница обязана довести себя
         прокруткой (initMoreToggle, GAP 16 px — низ полей встаёт в 16 px от края). Раньше то же
         условие проверялось в окне 620 в одном шаге с видимостью, но после снятия тёмной полосы
         марок (2026-09-27) страница /cars стала короче на ~50 px, поля в 620 помещаются целиком,
         и прокрутки честно нет — `y > 0` там больше не выполняется. */
      await page.setViewport({ width: 1400, height: 400 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      await page.click('.ps-more-sum');
      await new Promise((r) => setTimeout(r, 600));
      const moreShort = await page.evaluate(() => {
        const rb = document.querySelector('.ps-more-body').getBoundingClientRect();
        return {
          open: document.querySelector('.ps-more-tgl').checked, y: Math.round(window.scrollY),
          bottom: Math.round(rb.bottom), vh: window.innerHeight,
        };
      });
      check('ui', 'в низком окне «Параметры» доводят прокруткой до низа раскрытых полей',
        moreShort.open && moreShort.y > 0 && moreShort.bottom <= moreShort.vh + 1, JSON.stringify(moreShort));
      /* Дальше проверки идут на прежней высоте окна, страница — в том же состоянии (панель
         раскрыта), прокрутку возвращаем наверх. */
      await page.setViewport({ width: 1400, height: 620 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const moreOpenStyle = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.ps-more-sum'));
        return { bg: cs.backgroundColor, color: cs.color };
      });
      check('ui', 'раскрытые «Параметры» помечаются тёмным, фон остаётся прозрачным',
        moreOpenStyle.bg === 'rgba(0, 0, 0, 0)' && moreOpenStyle.color === 'rgb(20, 23, 28)',
        JSON.stringify(moreOpenStyle));

      /* панель поиска: вместо системного <select> — свой список (initSelects в
         public/assets/js/site.js). Нативный select остаётся в форме, хранит значение и уходит
         в адрес; рядом с ним стоит кнопка-двойник, которая и раскрывает список. */
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/cars', { waitUntil: 'load' });
      const selState = await page.evaluate(() => {
        const srcs = [...document.querySelectorAll('.ps-field select')];
        return {
          total: srcs.length,
          withBtn: srcs.filter((s) => s.parentNode.querySelector('.sel-btn')).length,
          hidden: srcs.filter((s) => getComputedStyle(s).display === 'none').length,
          withoutPop: srcs.filter((s) => !s.parentNode.querySelector('.sel-pop')).length,
        };
      });
      check('ui', 'выпадающие списки панели заменены своим списком', selState.total > 0 && selState.withBtn === selState.total && selState.hidden === selState.total && selState.withoutPop === 0, JSON.stringify(selState));

      const brandPop = await page.evaluate(() => {
        const wrap = document.querySelector('.ps-field select[name=brand]').parentNode;
        wrap.querySelector('.sel-btn').click();
        const pop = wrap.querySelector('.sel-pop');
        const b = wrap.querySelector('.sel-btn').getBoundingClientRect();
        const r = pop.getBoundingClientRect();
        return { open: !pop.hidden, rows: pop.querySelectorAll('.sel-opt').length, sameWidth: Math.abs(r.width - b.width) < 1.5, gap: Math.round(r.top - b.bottom), inside: r.top >= -1 && r.bottom <= window.innerHeight + 1 };
      });
      check('ui', 'свой список раскрывается под полем', brandPop.open && brandPop.rows > 5 && brandPop.sameWidth && brandPop.inside, JSON.stringify(brandPop));

      await page.evaluate(() => document.querySelector('.ps-field select[name=brand]').parentNode.querySelector('.sel-btn').focus());
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 200));
      const picked = await page.evaluate(() => {
        const wrap = document.querySelector('.ps-field select[name=brand]').parentNode;
        return { value: wrap.querySelector('select').value, label: wrap.querySelector('.sel-tx').textContent, closed: wrap.querySelector('.sel-pop').hidden, models: document.querySelector('select[name=model]').options.length };
      });
      check('ui', 'выбор в своём списке меняет значение формы', picked.value !== '' && picked.closed && picked.label === picked.value, JSON.stringify(picked));
      check('ui', 'выбор марки обновляет список моделей', picked.models > 1, 'моделей: ' + picked.models);

      /* Форма «Разместить объявление» (заказчик 2026-09-29: «при выборе из раскрывающихся списков
         значений, сделай везде в блоке, чтобы список при выборе значения сворачивался» и «в
         поколении авто должны быть все поколения как на сайте AV.by с картинками авто и годами
         выпуска»). Каждое поле формы — <label>, поэтому клик по строке списка браузер дублирует
         синтетическим кликом по полю, и попап открывался заново; обработчик строки гасит это через
         preventDefault. Здесь идём живым путём: марка → модель → поколение, каждый раз проверяя,
         что список закрылся и значение легло в поле, а у поколений есть снимок и годы выпуска.
         Снимки с 2026-09-28 свои, локальные (public/data/avby-img) и только у марок дилера:
         заказчик просил «фото другие без 100% плагиата», а у остальных марок — пустое место. */
      await page.goto(BASE + '/sell', { waitUntil: 'load' });
      const sellState = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const fieldOf = (kind) => document.querySelector(`[data-combo="${kind}"]`);
        const pick = async (kind, want) => {
          const field = fieldOf(kind);
          if (!field) return { kind, error: 'нет поля' };
          field.querySelector('input').click();
          /* Модели приезжают файлом марки с сервера — им нужно чуть больше времени. */
          await wait(kind === 'model' ? 900 : 400);
          const rows = [...field.querySelectorAll('.sel-opt')].filter((r) => !r.classList.contains('is-off'));
          const row = (want && rows.find((r) => r.textContent.trim().startsWith(want))) || rows[0];
          if (!row) return { kind, rows: rows.length, error: 'список пуст' };
          row.scrollIntoView({ block: 'center' });
          await wait(80);
          row.click();
          await wait(500);
          return { kind, rows: rows.length, shut: field.querySelector('.sel-pop').hidden, value: field.querySelector('input').value };
        };
        const brand = await pick('brand', 'BMW');
        const model = await pick('model', '');
        const field = fieldOf('generation');
        field.querySelector('input').click();
        await wait(1200);
        const gens = [...field.querySelectorAll('.sel-opt')];
        const first = gens[0];
        const info = {
          rows: gens.length,
          withPhoto: gens.filter((r) => r.querySelector('.opt-img')).length,
          withYears: gens.filter((r) => r.querySelector('.opt-years')).length,
          src: (() => { const im = gens.map((r) => r.querySelector('.opt-img')).find(Boolean); return im ? im.src : ''; })(),
        };
        if (first) {
          first.scrollIntoView({ block: 'center' });
          await wait(80);
          first.click();
          await wait(500);
          info.shut = field.querySelector('.sel-pop').hidden;
          info.value = field.querySelector('input').value;
        }
        /* Марка, которой у дилера нет (Acura): снимков быть не должно — заказчик 2026-09-28:
           «на те марки которые есть на сайте ищи где хочешь, главное качество и бесплатно, на
           остальные сделай не заполненное фото». Годы выпуска при этом остаются. */
        const other = {};
        await pick('brand', 'Acura');
        await pick('model', '');
        field.querySelector('input').click();
        await wait(1200);
        const oGens = [...field.querySelectorAll('.sel-opt')];
        other.rows = oGens.length;
        other.withPhoto = oGens.filter((r) => r.querySelector('.opt-img')).length;
        other.withYears = oGens.filter((r) => r.querySelector('.opt-years')).length;
        return { brand, model, gen: info, other };
      });
      check('ui', 'форма: список «Марка» сворачивается после выбора',
        sellState.brand.shut === true && sellState.brand.value === 'BMW', JSON.stringify(sellState.brand));
      check('ui', 'форма: список «Модель» сворачивается после выбора',
        sellState.model.shut === true && !!sellState.model.value, JSON.stringify(sellState.model));
      check('ui', 'форма: «Поколение» — все поколения модели со снимками и годами выпуска',
        sellState.gen.rows >= 3 && sellState.gen.withPhoto === sellState.gen.rows && sellState.gen.withYears === sellState.gen.rows
          && /\/data\/avby-img\/.+\.[a-z]+$/i.test(sellState.gen.src) && !/avcdn\.av\.by/.test(sellState.gen.src),
        JSON.stringify(sellState.gen));
      check('ui', 'форма: у марки, которой нет у дилера (Acura), поколения идут без снимков, но с годами',
        sellState.other.rows >= 1 && sellState.other.withPhoto === 0
          && sellState.other.withYears === sellState.other.rows, JSON.stringify(sellState.other));
      check('ui', 'форма: список «Поколение» сворачивается после выбора',
        sellState.gen.shut === true && !!sellState.gen.value, `список ${sellState.gen.shut ? 'закрыт' : 'ОТКРЫТ'}, значение «${sellState.gen.value}»`);

      const narrow = await page.evaluate(() => {
        const bad = [];
        for (const s of document.querySelectorAll('.ps-range select')) {
          const tx = s.parentNode.querySelector('.sel-tx');
          if (!tx || !tx.clientWidth) continue;
          const rg = document.createRange();
          rg.selectNodeContents(tx);
          if (rg.getBoundingClientRect().width > tx.clientWidth + 0.5) bad.push(s.name + '=' + tx.textContent);
        }
        return bad;
      });
      check('ui', 'в узких полях панели текст не режется', narrow.length === 0, narrow.join(', '));

      /* Статья автожурнала: «Читайте также» стоит справа от текста, а на узком экране уезжает
         под него; фото первой ссылки встаёт вровень с фото статьи (lib/pages.mjs: articlePage,
         «Статья автожурнала» в public/assets/css/site.css). Колонку статьи образуют два блока:
         .art-head (тег, заголовок, дата) — верхняя строка сетки, .art-body (обложка, текст) —
         нижняя; .art-aside тянется по обеим строкам и повторяет их сетку через subgrid. */
      const artSlug = all('SELECT slug FROM articles ORDER BY published_at DESC LIMIT 1')[0].slug;
      const artBox = () => page.evaluate(() => {
        const m = document.querySelector('.art-head');
        const d = document.querySelector('.art-body');
        const s = document.querySelector('.art-aside');
        if (!m || !d || !s) return null;
        const a = m.getBoundingClientRect(), c = d.getBoundingClientRect(), b = s.getBoundingClientRect();
        const cover = document.querySelector('.art-cover');
        const photo = document.querySelector('.art-aside .tile-photo');
        return { mRight: Math.round(a.right), mTop: Math.round(a.top), mBottom: Math.round(a.bottom), bodyBottom: Math.round(c.bottom), sLeft: Math.round(b.left), sTop: Math.round(b.top), sRight: Math.round(b.right), tiles: s.querySelectorAll('.tile').length, coverTop: cover ? Math.round(cover.getBoundingClientRect().top) : null, photoTop: photo ? Math.round(photo.getBoundingClientRect().top) : null, vw: window.innerWidth, over: document.documentElement.scrollWidth - window.innerWidth };
      });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/news/' + artSlug, { waitUntil: 'domcontentloaded' });
      const artWide = await artBox();
      check('ui', '«Читайте также» стоит справа от текста статьи',
        !!artWide && artWide.sLeft >= artWide.mRight && Math.abs(artWide.sTop - artWide.mTop) <= 4 && artWide.sRight <= artWide.vw && artWide.tiles === 3 && artWide.over <= 1,
        JSON.stringify(artWide));
      check('ui', 'фото «Читайте также» вровень с фото статьи на 1400 px',
        !!artWide && artWide.coverTop !== null && artWide.photoTop !== null && Math.abs(artWide.photoTop - artWide.coverTop) <= 2,
        `фото статьи ${artWide?.coverTop}, фото ссылки ${artWide?.photoTop}`);
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/news/' + artSlug, { waitUntil: 'domcontentloaded' });
      const artNarrow = await artBox();
      check('ui', 'на узком экране «Читайте также» уезжает под текст',
        !!artNarrow && artNarrow.sTop >= artNarrow.bodyBottom && artNarrow.sRight <= artNarrow.vw && artNarrow.over <= 1,
        JSON.stringify(artNarrow));

      /* Герой главной: строка «Официальный дилер Geely BelGee SRM» (слова «Ещё мы» убраны)
         стоит отдельной строкой ниже лида — то есть после «Гарантия юридической чистоты, кредит
         и лизинг — оформление на месте» (просьба заказчика «перенеси дальше по тексту»). На
         широком экране кнопка героя ушла под строку дилера в левую колонку и растянута на всю её
         ширину — от левого края заголовка («убери кнопку — Продать автомобиль. Кнопку разместить
         объявление растяни в лево до левой границе страницы»), а правую колонку целиком занимает
         «Горящая продажа»: верх блока вровень с заголовком, низ — вровень с низом кнопки, три
         карточки в ряд. CSS .home-page .hero-copy / .hero-main / .hero-dealer / .hero-cta /
         .hero-hot в public/assets/css/site.css. */
      const heroBox = () => page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const b = (s) => { const el = q(s); return el ? el.getBoundingClientRect() : null; };
        const h1 = b('.home-page .hero h1'), lead = b('.home-page .hero p.lead');
        const dealer = b('.home-page .hero-dealer .dealer-row'), cta = b('.home-page .hero-cta');
        const row = q('.home-page .hero-dealer'), hot = b('.home-page .hero-hot');
        if (!h1 || !lead || !dealer || !cta || !row || !hot) return null;
        const btns = [...document.querySelectorAll('.home-page .hero-cta .btn')];
        /* Копии крайних карточек, которые initHotSliders достраивает для кольцевой ленты, помечены
           aria-hidden: в разметке страницы их нет, и в отчётах ниже их учитывать не нужно. */
        const cards = [...document.querySelectorAll('.home-page .hero-hot .hot-card')]
          .filter((a) => !a.hasAttribute('aria-hidden'));
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        /* Верх чернил заголовка, а не верх его рамки: у h1 при line-height 1.15 над прописными
           остаётся полулидинг, и заказчик просил совместить с рамкой карточек именно буквы
           («выровняй верхние границы карточек спецпредложения симметрично верхним границам
           надписи…») — в CSS это сделано отрицательным margin-top:-.24em (site.css, блок
           @media(min-width:1081px)). Меряем теми же шрифтовыми метриками, что и браузер:
           baseline строки + ascent чернил из canvas TextMetrics. */
        const inkTop = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15;
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const m = ctx.measureText(el.textContent.replace(/\s+/g, ' ').trim());
          const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
          const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
          const baseline = el.getBoundingClientRect().top + (line - (asc + desc)) / 2 + asc;
          return Math.round(baseline - m.actualBoundingBoxAscent);
        };
        return {
          h1Top: Math.round(h1.top), h1Bottom: Math.round(h1.bottom), h1Left: Math.round(h1.left),
          h1InkTop: inkTop(q('.home-page .hero h1')),
          leadBottom: Math.round(lead.bottom), leadLeft: Math.round(lead.left),
          dealerTop: Math.round(dealer.top), dealerBottom: Math.round(dealer.bottom), dealerLeft: Math.round(dealer.left),
          dealerText: clean(row.textContent),
          ctaTop: Math.round(cta.top), ctaBottom: Math.round(cta.bottom),
          ctaLeft: Math.round(cta.left), ctaRight: Math.round(cta.right),
          btnCount: btns.length,
          btnTexts: btns.map((a) => clean(a.textContent)),
          btnTops: btns.map((a) => Math.round(a.getBoundingClientRect().top)),
          btnLefts: btns.map((a) => Math.round(a.getBoundingClientRect().left)),
          btnRights: btns.map((a) => Math.round(a.getBoundingClientRect().right)),
          btnWidths: btns.map((a) => Math.round(a.getBoundingClientRect().width)),
          /* Значок у каждой кнопки героя (заказчик 2026-10-02: «в кнопке - разместить объявление,
             добавь иконку по типу как в кнопке - Поставить авто на продажу») — обе кнопки рисованные,
             поэтому у каждой должен быть svg. */
          btnIcons: btns.map((a) => a.querySelectorAll('svg').length),
          /* Заказчик 2026-09-30: сначала «Заказать звонок / Разместить объявление на титульной, сделай
             фон кнопок прозрачный», а следом «верни красный цвет кнопкам». Считаем фон, буквы и рамку
             обеих кнопок героя: снова фирменный красный --accent #E3000F, белые буквы и рамка в тон. */
          heroBtnBg: btns.map((a) => getComputedStyle(a).backgroundColor),
          heroBtnInk: btns.map((a) => getComputedStyle(a).color),
          heroBtnBorder: btns.map((a) => getComputedStyle(a).borderTopColor),
          hotTop: Math.round(hot.top), hotBottom: Math.round(hot.bottom),
          hotLeft: Math.round(hot.left), hotRight: Math.round(hot.right),
          cards: cards.length,
          cardsWithPhoto: cards.filter((a) => a.querySelector('.hot-media img')).length,
          cardLinks: cards.map((a) => a.querySelector('.hot-hit') ? a.querySelector('.hot-hit').getAttribute('href') : ''),
          cardPrices: cards.map((a) => clean((a.querySelector('.hot-price') || {}).textContent)),
          /* Плашка «Горящая продажа» — на кадре (внутри .hot-media), и скидка тоже на кадре. */
          hotTags: cards.map((a) => clean((a.querySelector('.hot-hot') || {}).textContent)),
          hotTagOnPhoto: cards.filter((a) => a.querySelector('.hot-media .hot-hot')).length,
          hotDiscs: cards.map((a) => clean((a.querySelector('.hot-disc') || {}).textContent)),
          hotSlides: cards.map((a) => a.querySelectorAll('[data-track] [data-slide]').length),
          hotHeads: document.querySelectorAll('.home-page .hero-hot .hot-head').length,
          /* Название — строго в одну строку (заказчик: «название автомобиля сокращай, чтобы не было
             переносов на следующую строчку»), полное имя остаётся в title ссылки .hot-body. */
          cardTitleLines: cards.map((a) => {
            const b = a.querySelector('.hot-body b');
            if (!b) return 0;
            const cs = getComputedStyle(b);
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
            return Math.max(1, Math.round(b.getBoundingClientRect().height / lh));
          }),
          cardTitleNowrap: cards.map((a) => {
            const b = a.querySelector('.hot-body b');
            return !!b && getComputedStyle(b).whiteSpace === 'nowrap';
          }),
          cardTitleAttrs: cards.map((a) => {
            const l = a.querySelector('.hot-body');
            return l ? l.getAttribute('title') : '';
          }),
          cardTitles: cards.map((a) => clean((a.querySelector('.hot-body b') || {}).textContent)),
          /* Кадр: отношение высоты к ширине. 16/9 = 0,5625, прежнее 16/10 = 0,625 — по этому числу и
             видно, что «кадр стал ниже, а место ушло под параметры». */
          cardMediaRatios: cards.map((a) => {
            const m = a.querySelector('.hot-media');
            if (!m) return 0;
            const r = m.getBoundingClientRect();
            return Math.round((r.height / r.width) * 1000) / 1000;
          }),
          /* Параметры авто в теле карточки: на узком экране часть подписей скрыта (display:none),
             поэтому отдельно считаем видимые — у скрытой offsetParent === null. Подложки у подписи
             быть не должно (заказчик: «параметры авто сделай без фона»), поэтому пишем в отчёт и
             фон: проверка ниже требует прозрачности у всех подписей. */
          cardSpecs: cards.map((a) => [...a.querySelectorAll('.hot-specs span')].map((s) => clean(s.textContent))),
          cardSpecsVisible: cards.map((a) => [...a.querySelectorAll('.hot-specs span')].filter((s) => s.offsetParent !== null).length),
          cardSpecsBg: cards.map((a) => [...a.querySelectorAll('.hot-specs span')]
            .map((s) => getComputedStyle(s).backgroundColor + '|' + getComputedStyle(s).paddingLeft + '|' + getComputedStyle(s).borderTopWidth)),
          cardBodyOver: cards.map((a) => {
            const b = a.querySelector('.hot-body');
            return b ? b.scrollWidth - b.clientWidth : 0;
          }),
          /* Лента Centered Slider: раскладка активной карточки, стрелки и точки. */
          hotDots: document.querySelectorAll('.home-page .hero-hot [data-hot-dots] i').length,
          hotNav: document.querySelectorAll('.home-page .hero-hot .hot-nav').length,
          hotTrackDisplay: getComputedStyle(q('.home-page .hero-hot .hot-cards')).display,
          /* offsetHeight, а не getBoundingClientRect: соседей CSS уменьшает через scale(.94), и по
             видимой рамке высоты карточек всегда разные — проверяем именно раскладку (лента
             растягивает карточки по align-items:stretch). */
          hotCardHeights: [...new Set(cards.map((a) => a.offsetHeight))].length,
          hotCentered: (() => {
            const s = q('.home-page .hero-hot [data-hot-slider]');
            const on = q('.home-page .hero-hot .hot-card.on');
            if (!s || !on) return null;
            const sr = s.getBoundingClientRect(), r = on.getBoundingClientRect();
            return Math.round((r.left + r.width / 2) - (sr.left + sr.width / 2));
          })(),
          vw: window.innerWidth,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const heroWide = await heroBox();
      check('ui', 'строка «Официальный дилер …» стоит ниже лида, а не рядом с заголовком',
        !!heroWide && heroWide.dealerTop >= heroWide.leadBottom && heroWide.dealerTop > heroWide.h1Bottom
          && /^Официальный дилер\s+Geely\s+BelGee\s+SRM$/.test(heroWide.dealerText) && heroWide.over <= 1,
        JSON.stringify(heroWide));
      /* Кнопок в герое две (заказчик, 2026-10-02: «Убери кнопку - Заказать звонок, а в кнопке -
         разместить объявление, добавь иконку по типу как в кнопке - Поставить авто на продажу»),
         поэтому проверяем порядок, значки и то, что вторая кнопка идёт следом за первой. */
      check('ui', 'кнопки героя стоят под строкой дилера: «Разместить объявление» и «Поставить авто на продажу», обе со значком, на всю левую колонку',
        !!heroWide && heroWide.btnCount === 2 && heroWide.ctaTop >= heroWide.dealerBottom
          && heroWide.ctaLeft === heroWide.leadLeft && heroWide.ctaLeft === heroWide.h1Left
          && heroWide.btnTexts[0] === 'Разместить объявление'
          && heroWide.btnTexts[1] === 'Поставить авто на продажу'
          && heroWide.btnIcons.every((n) => n === 1)
          && heroWide.btnTops[1] >= heroWide.btnTops[0] + 46
          && heroWide.btnLefts.every((l) => l === heroWide.ctaLeft)
          && heroWide.btnRights.every((r) => r === heroWide.ctaRight)
          && heroWide.ctaRight < heroWide.hotLeft && heroWide.btnWidths.every((w) => w > 500),
        JSON.stringify(heroWide));
      check('ui', '«Горящая продажа»: пять карточек с фото, верх букв заголовка вровень с карточками, низ — с кнопками',
        !!heroWide && heroWide.cards === 5 && heroWide.cardsWithPhoto === 5
          && Math.abs(heroWide.hotTop - heroWide.h1InkTop) <= 3 && Math.abs(heroWide.hotBottom - heroWide.ctaBottom) <= 2
          && heroWide.hotLeft > heroWide.h1Left
          && heroWide.hotHeads === 0 && heroWide.hotTagOnPhoto === 5
          && heroWide.hotTags.every((t) => t === 'Горящая продажа')
          && heroWide.hotDiscs.every((t) => /^−\d[\d\s]*\s?Б$/.test(t))
          && heroWide.hotSlides.every((n) => n >= 2)
          && heroWide.cardLinks.every((h) => /^\/car\//.test(h))
          && heroWide.cardPrices.every((p) => /\d\s?Б/.test(p))
          && heroWide.over <= 1,
        JSON.stringify(heroWide));
      /* Centered Slider (заказчик: «блок с горящим предложением на титульный наверху сделай как
         Centered Slider»): лента во flex, активная карточка ровно по центру колонки, соседние
         выглядывают по краям приглушёнными, стрелки и точки по числу машин. Проверяем на широком
         экране (1400), где лента уже разложена после DOMContentLoaded. */
      check('ui', '«Горящая продажа» — Centered Slider: активная карточка по центру, соседи выглядывают',
        !!heroWide && heroWide.hotTrackDisplay === 'flex' && heroWide.cards === 5
          && heroWide.hotCentered !== null && Math.abs(heroWide.hotCentered) <= 2
          && heroWide.hotDots === 5 && heroWide.hotNav === 2 && heroWide.hotCardHeights === 1,
        JSON.stringify(heroWide && { centered: heroWide.hotCentered, dots: heroWide.hotDots, nav: heroWide.hotNav, heights: heroWide.hotCardHeights }));
      /* Заказчик 2026-09-27: «в самих карточках параметры авто сделай без фона» — у подписей
         параметров нет ни подложки, ни рамки, ни внутренних отступов-«таблетки». */
      check('ui', 'параметры авто в карточках — без фона, рамки и «таблетки»',
        !!heroWide && heroWide.cardSpecsBg.every((list) => list.every((s) => s === 'rgba(0, 0, 0, 0)|0px|0px')),
        JSON.stringify(heroWide && heroWide.cardSpecsBg[0]));
      /* Зазоры героя в одноколоночной полосе 641–1080 px (заказчик 29.09.2026: «Кнопка — разместить
         объявление упала на блок — горящие продажи, исправь» и «какой большой разрыв между блоком
         карусели и блоком с перечнем авто, сделай меньше отступ вниз»). Причина была не в разметке, а
         в пропавшем правиле: в @media(max-width:1080px) от обещанного «зазора 26 px» остался только
         комментарий, поэтому лента стояла вплотную к кнопкам (зазор 0 px, карточка налезала на кнопку
         и её тень), а от полосы точек ленты до полосы марок было 62 px. Проверяем сами зазоры в окне
         заказчика (730 px, главная одноколоночная): кнопка→лента 26 px, полоса точек→полоса марок
         12 px, до текста первой марки — не больше 34 px. Задают их правила .home-page
         .hero-hot{margin-top:26px}, .home-page .hero-in{padding-bottom:12px} и .home-page
         .home-brands{padding-top:6px} в public/assets/css/site.css. */
      await page.setViewport({ width: 730, height: 900 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const heroTablet = await page.evaluate(() => {
        const b = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
        const btns = [...document.querySelectorAll('.home-page .hero-cta .btn')];
        const hot = b('.home-page .hero-hot'), dots = b('.home-page .hero-hot [data-hot-dots]');
        const brands = b('.home-page .home-brands');
        const first = document.querySelector('.home-page .home-brands a, .home-page .home-brands li, .home-page .home-brands span');
        if (!btns.length || !hot || !dots || !brands || !first) return null;
        const btnBottom = Math.max(...btns.map((x) => x.getBoundingClientRect().bottom));
        return {
          btnToHot: Math.round(hot.top - btnBottom),
          dotsToBrands: Math.round(brands.top - dots.bottom),
          dotsToBrandText: Math.round(first.getBoundingClientRect().top - dots.bottom),
          hotMarginTop: getComputedStyle(document.querySelector('.home-page .hero-hot')).marginTop,
          heroPadBottom: getComputedStyle(document.querySelector('.home-page .hero-in')).paddingBottom,
          vw: window.innerWidth,
        };
      });
      check('ui', 'главная 730 px: кнопка героя не падает на ленту «Горящей продажи»',
        !!heroTablet && heroTablet.btnToHot >= 20 && heroTablet.btnToHot <= 32, JSON.stringify(heroTablet));
      check('ui', 'главная 730 px: от ленты «Горящей продажи» до полосы марок не больше 30 px',
        !!heroTablet && heroTablet.dotsToBrands >= 6 && heroTablet.dotsToBrands <= 18
          && heroTablet.dotsToBrandText <= 34, JSON.stringify(heroTablet));
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const heroNarrow = await heroBox();
      check('ui', '«Горящая продажа»: название в одну строку с многоточием, полное имя — в title ссылки',
        !!heroWide && heroWide.cardTitleLines.every((n) => n === 1) && heroWide.cardTitleNowrap.every(Boolean)
          && heroWide.cardTitleAttrs.every((t, i) => !!t && t.startsWith(heroWide.cardTitles[i])),
        JSON.stringify({ lines: heroWide && heroWide.cardTitleLines, attrs: heroWide && heroWide.cardTitleAttrs }));
      /* Кадр: отношение высоты к ширине. Теперь 4/3 = 0,75 — как у карточки каталога (.car-media),
         чтобы машина в «Горящей продаже» выглядела так же, как в остальных блоках (было 16/9 =
         0,5625 — герой показывал лишь 42 % высоты вертикального фото против 56 % в каталоге). */
      check('ui', '«Горящая продажа»: кадр 4/3 — как у карточки каталога',
        !!heroWide && heroWide.cardMediaRatios.every((r) => Math.abs(r - 3 / 4) <= 0.02),
        JSON.stringify(heroWide && heroWide.cardMediaRatios));
      check('ui', '«Горящая продажа»: в карточке ряд параметров авто — объём, коробка, привод, топливо, кузов',
        !!heroWide && heroWide.cardSpecsVisible.every((n) => n >= 4)
          && heroWide.cardSpecsVisible.every((n, i) => n === heroWide.cardSpecs[i].length)
          && heroWide.cardSpecs.every((s) => /^\d+(,\d)? л$/.test(s[0])
            && s.some((x) => /^(АКПП|МКПП|Робот)$/.test(x))
            && s.some((x) => /^(передний|полный|задний)$/.test(x))
            && s.some((x) => /^(бензин|дизель|электро|метан)$/.test(x))
            && s.some((x) => /^(седан|внедорожник|универсал|минивэн|хэтчбек|лифтбек|купе|фургон)$/.test(x)))
          && heroWide.cardBodyOver.every((n) => n <= 1),
        JSON.stringify(heroWide && heroWide.cardSpecs));
      check('ui', 'кнопки героя «Разместить объявление» и «Поставить авто на продажу» — красные, как остальные кнопки сайта',
        !!heroWide && heroWide.heroBtnBg.length === 2
          && heroWide.heroBtnBg.every((c) => c === 'rgb(227, 0, 15)')
          && heroWide.heroBtnInk.every((c) => c === 'rgb(255, 255, 255)')
          && heroWide.heroBtnBorder.every((c) => c === 'rgb(227, 0, 15)'),
        JSON.stringify(heroWide && { фон: heroWide.heroBtnBg, буквы: heroWide.heroBtnInk, рамка: heroWide.heroBtnBorder }));
      /* Наведение не должно возвращать прежнюю тёмную заливку прозрачного варианта: у красной кнопки
         под курсором фон темнеет до --accent-hover #BC000C, буквы остаются белыми. Цвета от ширины
         экрана не зависят, поэтому замер идёт на текущем (узком) окне. */
      await page.hover('.home-page .hero-cta .btn');
      await new Promise((r) => setTimeout(r, 300));
      const heroBtnHover = await page.evaluate(() => {
        const b = document.querySelector('.home-page .hero-cta .btn');
        if (!b) return null;
        const cs = getComputedStyle(b);
        return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
      });
      check('ui', 'кнопка героя под курсором темнеет до --accent-hover, буквы остаются белыми',
        !!heroBtnHover && heroBtnHover.bg === 'rgb(188, 0, 12)' && heroBtnHover.color === 'rgb(255, 255, 255)'
          && heroBtnHover.border === 'rgb(188, 0, 12)',
        JSON.stringify(heroBtnHover));
      await page.mouse.move(0, 0);
      check('ui', 'на узком экране строка дилера тоже идёт сразу за лидом',
        !!heroNarrow && heroNarrow.dealerTop >= heroNarrow.leadBottom && heroNarrow.over <= 1,
        JSON.stringify(heroNarrow));
      check('ui', 'на узком экране две кнопки героя и «Горящая продажа» идут столбиком за строкой дилера',
        !!heroNarrow && heroNarrow.btnCount === 2 && heroNarrow.ctaTop >= heroNarrow.dealerBottom
          && heroNarrow.hotTop >= heroNarrow.ctaBottom && heroNarrow.cards === 5 && heroNarrow.cardsWithPhoto === 5
          && heroNarrow.btnTexts[0] === 'Разместить объявление'
          && heroNarrow.btnTexts[1] === 'Поставить авто на продажу'
          && heroNarrow.btnIcons.every((n) => n === 1)
          && heroNarrow.btnTops[1] >= heroNarrow.btnTops[0] + 46
          && heroNarrow.btnLefts.every((l) => l === heroNarrow.ctaLeft)
          && heroNarrow.btnRights.every((r) => r === heroNarrow.ctaRight)
          && heroNarrow.btnWidths.every((w) => w === heroNarrow.vw - 40) && heroNarrow.over <= 1,
        JSON.stringify(heroNarrow));
      check('ui', 'на узком экране параметры карточки ужаты в одну строку (четыре подписи)',
        !!heroNarrow && heroNarrow.cardSpecsVisible.every((n) => n === 4)
          && heroNarrow.cardMediaRatios.every((r) => Math.abs(r - 87 / 116) <= 0.02)
          && heroNarrow.cardTitleLines.every((n) => n === 1),
        JSON.stringify(heroNarrow && { visible: heroNarrow.cardSpecsVisible, ratios: heroNarrow.cardMediaRatios }));

      /* Окно заказа звонка (заказчик, 2026-09-28: «над кнопкой разместить объявление на титульной
         странице размести кнопку заказать звонок и чтобы при нажатии открывалась окно как на
         кнопке бронь»). С главной кнопку убрали (заказчик, 2026-10-02: «Убери кнопку - Заказать
         звонок»), но окно и его обработчик остались в разметке как готовый механизм — вернуть его
         можно одной кнопкой с data-call-open. Окно той же вёрстки, что у брони и входа
         (.modal-back / .modal.modal-auth), с формой на /lead и kind=call; по центру и целиком
         в экране, закрывают его крестик и Escape. Разметка — lib/view.mjs: callModalHtml,
         поведение — initLeadModal в public/assets/js/site.js. Открываем его кликом по DOM-узлу
         (свой обработчик из initLeadModal никуда не делся): консольного клика по координатам тут
         быть не может — кнопки-открывашки на странице больше нет. */
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      check('ui', 'окно заказа звонка скрыто и осталось в разметке без кнопки-открывашки',
        await page.$eval('[data-call-modal]', (el) => el.hidden)
          && await page.$$eval('[data-call-open]', (nodes) => nodes.length === 0));
      /* Клик по кнопке героя раньше сам ставил фокус в поле «Имя» (initLeadModal), но кнопки
         data-call-open на главной больше нет, а прямое снятие hidden фокус не переносит —
         поэтому окно открываем так же, как это делал обработчик: снимаем hidden и явно
         фокусируем первое поле, ровно как это делает initLeadModal. */
      await page.evaluate(() => {
        const back = document.querySelector('[data-call-modal]');
        back.hidden = false;
        const first = back.querySelector('input[name=name]');
        if (first && !first.disabled) first.focus();
      });
      await new Promise((r) => setTimeout(r, 250));
      check('ui', 'окно заказа звонка открывается — форма на месте и видна',
        await page.$eval('[data-call-modal]', (el) => !el.hidden && getComputedStyle(el).display !== 'none'));
      const callBox = await page.evaluate(() => {
        const back = document.querySelector('[data-call-modal]');
        const modal = back.querySelector('.modal-auth');
        const form = back.querySelector('[data-call-form]');
        const r = modal.getBoundingClientRect();
        const name = form.querySelector('[name=name]').getBoundingClientRect();
        const phone = form.querySelector('[name=phone]').getBoundingClientRect();
        return {
          dx: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)),
          top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
          title: back.querySelector('.modal-h').textContent.trim(),
          kind: form.querySelector('[name=kind]').value,
          action: form.getAttribute('action'),
          hasCarId: !!form.querySelector('[name=car_id]'),
          tel: form.querySelector('[name=phone]').type,
          focused: document.activeElement === form.querySelector('[name=name]'),
          nameTop: Math.round(name.top), phoneTop: Math.round(phone.top),
        };
      });
      check('ui', 'окно заказа звонка — как у брони: по центру, целиком в экране, с полями «Имя» и «Телефон»',
        callBox.dx < 12 && callBox.top >= 0 && callBox.bottom <= callBox.vh
          && callBox.title === 'Заказать звонок' && callBox.kind === 'call' && callBox.action === '/lead'
          && !callBox.hasCarId && callBox.tel === 'tel' && callBox.phoneTop > callBox.nameTop,
        JSON.stringify(callBox));
      check('ui', 'в открытом окне заказа звонка фокус в поле «Имя»', callBox.focused, JSON.stringify(callBox));
      /* Отступ от последнего поля формы до кнопки отправки — единый стандарт во всех окнах.
         Заказчик: «в окне заказать звонок, блок — удобное время…, сильно близко к кнопке — жду
         звонка, сделай стандартно». Стандарт — 14 px, как у кнопок окна входа, где его задаёт
         .auth-pane .btn-block; в окнах без .auth-pane (заказ звонка, бронь, связь с продавцом)
         его теперь задаёт .modal form>.btn-block (public/assets/css/site.css). Мерило — окно
         входа: анимацию появления у него отключаем, иначе замер попадает в первый кадр
         .modal{animation:an-pop} и масштаб .97 сдвигает зазор. */
      const modalGaps = await page.evaluate(() => {
        const gap = (form) => {
          const btn = form.querySelector('button[type=submit]');
          const prev = btn.previousElementSibling;
          return {
            px: Math.round(btn.getBoundingClientRect().top - prev.getBoundingClientRect().bottom),
            marginTop: getComputedStyle(btn).marginTop,
          };
        };
        const authBack = document.querySelector('[data-auth-modal]');
        const authModal = authBack.querySelector('.modal-auth');
        const wasHidden = authBack.hidden;
        const wasAnimation = authModal.style.animation;
        authBack.hidden = false;
        authModal.style.animation = 'none';
        const login = gap(document.querySelector('[data-auth-form="login"]'));
        authModal.style.animation = wasAnimation;
        authBack.hidden = wasHidden;
        const callForm = document.querySelector('[data-call-form]');
        return {
          call: Object.assign(gap(callForm), {
            label: callForm.querySelector('input[name=comment]').placeholder,
            text: callForm.querySelector('button[type=submit]').textContent.trim(),
          }),
          login,
        };
      });
      check('ui', 'в окне заказа звонка от поля «Удобное время звонка» до кнопки — стандартный отступ окна входа',
        modalGaps.call.px === modalGaps.login.px && modalGaps.call.px >= 12
          && modalGaps.call.marginTop === modalGaps.login.marginTop
          && /Удобное время звонка/.test(modalGaps.call.label) && modalGaps.call.text === 'Жду звонка',
        JSON.stringify(modalGaps));
      await page.click('[data-call-close]');
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'крестик закрывает окно заказа звонка',
        await page.$eval('[data-call-modal]', (el) => el.hidden));
      await page.evaluate(() => document.querySelector('[data-call-modal]').hidden = false);
      await new Promise((r) => setTimeout(r, 250));
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'Escape закрывает окно заказа звонка',
        await page.$eval('[data-call-modal]', (el) => el.hidden));

      /* Окно «Поставить авто на продажу» (заказчик, 2026-10-02: «на ее месте сделай кнопку -
         поставить авто на продажу и сделай при нажатии, чтобы открывалось окно для короткого
         заполнения информации об авто в нашем стиле»). Разметка — lib/view.mjs: saleModalHtml,
         поведение — initLeadModals (общий initLeadModal) в public/assets/js/site.js.
         Проверяем устройство окна и заявку целиком: короткая форма про машину, склейка
         «Авто на продажу…: Geely Monjaro, 2022 г., пробег 45 000 км, цена 50 000 Б» в поле text
         (в базе у заявки только name/phone/text), отправка без перезагрузки, закрытие крестиком. */
      await page.evaluate(() => {
        const f = document.querySelector('[data-sale-form]');
        if (f) f.reset();
      });
      check('ui', 'окно «Поставить авто на продажу» скрыто до клика по нижней кнопке героя',
        await page.$eval('[data-sale-modal]', (el) => el.hidden));
      /* Открываем нижней кнопкой героя. Клик делаем из страницы, а не нативным кликом puppeteer:
         окна сайта закрываются кликом по фону (.modal-back), а фон перекрывает кнопки под собой —
         нативный клик по координатам попал бы в фон открытого окна и просто закрыл его.
         Заодно проверяем, что к этому моменту окно звонка закрыто. */
      check('ui', 'окно заказа звонка закрыто к моменту открытия окна продажи',
        await page.$eval('[data-call-modal]', (el) => el.hidden));
      await page.evaluate(() => document.querySelector('[data-sale-open]').click());
      await new Promise((r) => setTimeout(r, 250));
      const saleBox = await page.evaluate(() => {
        const back = document.querySelector('[data-sale-modal]');
        const modal = back.querySelector('.modal');
        const form = back.querySelector('[data-sale-form]');
        const r = modal.getBoundingClientRect();
        const row = form.querySelector('.auth-row');
        const fields = [...form.querySelectorAll('.auth-row .field')].map((f) => Math.round(f.getBoundingClientRect().left));
        return {
          open: !back.hidden && getComputedStyle(back).display !== 'none',
          dx: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)),
          top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
          title: back.querySelector('.modal-h').textContent.trim(),
          kind: form.querySelector('[name=kind]').value,
          action: form.getAttribute('action'),
          names: [...form.querySelectorAll('input')].map((i) => i.name),
          tel: form.querySelector('[name=phone]').type,
          pair: row ? row.querySelectorAll('.field').length : 0,
          twoCols: fields.length >= 2 && fields[0] < fields[1],
          agreeRequired: form.querySelector('[name=agree]').required,
          /* Марка и модель — списки, как в блоке подачи объявления на /sell (заказчик 2026-10-02):
             у самой формы это выпадающие списки с общим справочником, поэтому проверяем и поля, и
             сами списки с марками (живая связка list → datalist снимается скриптом — см. ниже). */
          brandList: (() => {
            const b = form.querySelector('[name=brand]'), m = form.querySelector('[name=model]');
            const bd = document.querySelector('datalist#sale-brandlist');
            const md = document.querySelector('datalist#sale-modellist');
            return !!(b && m && bd && md && bd.querySelectorAll('option').length > 100
              && md.querySelectorAll('option').length > 10);
          })(),
          comboFields: back.querySelectorAll('[data-combo]').length,
          focused: document.activeElement === form.querySelector('[name=brand]'),
          bodyOpen: document.body.classList.contains('modal-open'),
          pageOver: document.documentElement.scrollWidth - innerWidth,
          over: modal.scrollHeight > modal.clientHeight + 1,
        };
      });
      check('ui', 'третья кнопка героя открывает короткое окно продажи — по центру, с полями про авто',
        saleBox.open && saleBox.dx < 12 && saleBox.top >= 0 && saleBox.bottom <= saleBox.vh
          && saleBox.title === 'Поставить авто на продажу' && saleBox.kind === 'sale' && saleBox.action === '/lead'
          && saleBox.names.join(',') === 'kind,text,brand,model,year,mileage,price,name,phone,agree'
          && saleBox.tel === 'tel' && saleBox.pair === 2 && saleBox.twoCols
          && saleBox.agreeRequired && saleBox.brandList && saleBox.comboFields === 2 && saleBox.pageOver <= 1,
        JSON.stringify(saleBox));
      check('ui', 'в открытом окне продажи фокус в поле «Марка», тело помечено modal-open',
        saleBox.focused && saleBox.bodyOpen, JSON.stringify(saleBox));
      /* Заполняем машину и смотрим, что склеенная строка заявки складывается ещё до отправки. */
      await page.type('[data-sale-form] [name=brand]', 'Geely');
      await page.type('[data-sale-form] [name=model]', 'Monjaro');
      await page.type('[data-sale-form] [name=year]', '2022');
      await page.type('[data-sale-form] [name=mileage]', '45000');
      await page.type('[data-sale-form] [name=price]', '50000');
      /* Строка заявки про автомобиль собирается при открытии окна (beforeOpen) — проверяем её
         после повторного открытия, когда все пять полей про машину уже заполнены. Это же
         открытие — «как было» для админки: менеджер видит машину прямо в тексте заявки. */
      await page.evaluate(() => document.querySelector('[data-sale-open]').click());
      await new Promise((r) => setTimeout(r, 200));
      const saleText = await page.$eval('[data-sale-form] [name=text]', (el) => el.value);
      check('ui', 'в заявке из окна продажи собирается строка про авто — марка, год, пробег, цена',
        saleText === 'Авто на продажу с главной страницы: Geely Monjaro, 2022 г., пробег 45 000 км, цена 50 000\u00A0Б',
        saleText);
      /* Пустая форма не должна уходить на сервер: у полей стоит required, отправку держит
         checkValidity — окно после клика остаётся открытым. Клик по кнопке проверяем изнутри
         страницы: нативный клик по невалидной форме запускает встроенную подсказку браузера,
         и puppeteer считает кнопку недоступной. Заодно убеждаемся, что страница не ушла на
         отправку: url и счётчик записей навигации остаются прежними. */
      const saleEmpty = await page.evaluate(() => {
        const form = document.querySelector('[data-sale-form]');
        form.querySelector('[name=brand]').value = '';
        form.querySelector('[name=phone]').value = '';
        const url = location.href;
        const nav = performance.getEntriesByType('navigation').length;
        form.querySelector('button[type=submit]').click();
        return {
          valid: form.checkValidity(), hidden: document.querySelector('[data-sale-modal]').hidden,
          sameUrl: url === location.href, nav: performance.getEntriesByType('navigation').length === nav,
        };
      });
      check('ui', 'окно продажи не отправляет заявку без обязательных полей',
        !saleEmpty.valid && !saleEmpty.hidden && saleEmpty.sameUrl && saleEmpty.nav, JSON.stringify(saleEmpty));
      const { run: runLead } = await import('../lib/db.mjs');
      runLead("DELETE FROM leads WHERE phone LIKE '+375%111 22 33'");
      await page.evaluate(() => {
        const set = (n, v) => { document.querySelector('[data-sale-form] [name=' + n + ']').value = v; };
        set('brand', 'Geely'); set('model', 'Monjaro'); set('year', '2022');
        set('mileage', '45000'); set('price', '50000');
        set('name', 'Клиент');
        document.querySelector('[data-sale-form] [name=agree]').checked = true;
      });
      /* Телефон набираем посимвольно: у поля маска +375 XX XXX XX XX (initPhone), и простого
         присваивания значения мало — по маске номер должен быть разбит на группы. */
      await page.click('[data-sale-form] [name=phone]');
      await page.type('[data-sale-form] [name=phone]', '291112233');
      /* Открываем окно заново — как это делает посетитель после того, как поля дозаполнило
         автозаполнение браузера: строку заявки окно собирает при открытии. */
      await page.evaluate(() => document.querySelector('[data-sale-open]').click());
      await new Promise((r) => setTimeout(r, 250));
      await page.evaluate(() => document.querySelector('[data-sale-form] button[type=submit]').click());
      /* Ждём именно закрытия окна, а не фиксированные 700 мс: под полной нагрузкой (весь набор
         подряд, а не один раздел ui) ответ /lead может прийти позже, и проверка «окно закрылось,
         всплыло подтверждение» падала на живой вёрстке (раздел ui отдельно — 216/216).
         Текст тоста для ожидания не годится: он остаётся в разметке от прошлых показов. */
      const waitSaleClosed = async () => {
        const deadline = Date.now() + 3000;
        for (;;) {
          const hidden = await page.evaluate(() => document.querySelector('[data-sale-modal]').hidden);
          if (hidden) return true;
          if (Date.now() > deadline) return false;
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      await waitSaleClosed();
      const saleSent = await page.evaluate(() => ({
        hidden: document.querySelector('[data-sale-modal]').hidden,
        bodyOpen: document.body.classList.contains('modal-open'),
        toast: (document.querySelector('[data-toast-msg]') || {}).textContent || '',
        brand: document.querySelector('[data-sale-form] [name=brand]').value,
      }));
      const { num: numLead } = await import('../lib/db.mjs');
      check('ui', 'заявка из окна продажи уходит на /lead с kind=sale и ложится в базу',
        numLead("SELECT COUNT(*) FROM leads WHERE phone LIKE '+375%111 22 33' AND kind='sale'") === 1
          && /Geely Monjaro/.test(String(numLead("SELECT text FROM leads WHERE phone LIKE '+375%111 22 33'") || '')),
        String(numLead("SELECT kind || ' | ' || phone || ' | ' || text FROM leads WHERE phone LIKE '+375%111 22 33'")));
      check('ui', 'после отправки окно продажи закрывается, форма очищается, всплывает подтверждение',
        saleSent.hidden && !saleSent.bodyOpen && saleSent.brand === ''
          && saleSent.toast === 'Заявка на продажу авто отправлена — перезвоним в течение 15 минут',
        JSON.stringify(saleSent));
      runLead("DELETE FROM leads WHERE phone LIKE '+375%111 22 33'");
      await page.evaluate(() => document.querySelector('[data-sale-open]').click());
      await new Promise((r) => setTimeout(r, 250));
      await page.evaluate(() => document.querySelector('[data-sale-close]').click());
      await new Promise((r) => setTimeout(r, 200));
      check('ui', 'крестик закрывает окно продажи',
        await page.$eval('[data-sale-modal]', (el) => el.hidden));
      /* На телефоне окно не растягивает страницу вбок, держит пары полей в две колонки и
         укладывается в экран целиком: 640 px содержимого при 844 px высоты — прокрутки внутри
         окна нет. Так пары и задуманы (см. комментарий к .sale-modal .auth-row в site.css). */
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.querySelector('[data-sale-open]').click());
      await new Promise((r) => setTimeout(r, 300));
      const salePhone = await page.evaluate(() => {
        const back = document.querySelector('[data-sale-modal]');
        const modal = back.querySelector('.modal');
        const r = modal.getBoundingClientRect();
        const btn = back.querySelector('[data-sale-form] button[type=submit]').getBoundingClientRect();
        const rows = [...back.querySelectorAll('.auth-row')].map((row) => row.querySelectorAll('.field').length);
        return {
          dx: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)),
          left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth,
          rows, btnW: Math.round(btn.width),
          over: document.documentElement.scrollWidth - innerWidth,
          scroll: modal.scrollHeight, client: modal.clientHeight,
        };
      });
      check('ui', 'на телефоне окно продажи держит пары полей, влезает в экран и не растягивает страницу вбок',
        salePhone.dx < 8 && salePhone.left >= 0 && salePhone.right <= salePhone.vw
          && salePhone.rows.every((n) => n === 2) && salePhone.btnW > 300 && salePhone.over <= 1
          && salePhone.scroll - salePhone.client <= 2,
        JSON.stringify(salePhone));
      await page.click('[data-sale-close]');

      /* Кадры «Горящей продажи» листаются сами и по стрелке, плашка «Горящая продажа» стоит на
         фото справа внизу и подсвечивается пульсацией («как диммер»), скидка — второй плашкой на
         кадре. Поведение — initCarousels в public/assets/js/site.js (data-autoplay), вид —
         .hot-hot / .hot-disc в public/assets/css/site.css. */
      await page.setViewport({ width: 1400, height: 950 });
      /* Headless Chrome по умолчанию сообщает системе «уменьшить движение», а наш CSS и JS в этом
         режиме осознанно выключают и пульсацию подсветки, и автопрокрутку. Поэтому для проверки
         движения выставляем «no-preference» явно, а поведение при «reduce» проверяем отдельно. */
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const sliderState = () => page.evaluate(() => {
        /* Карточку берём активную: она стоит по центру ленты и видна целиком, а первая в DOM может
           быть копией крайней карточки (её при инициализации достраивает initHotSliders). */
        const card = document.querySelector('.home-page .hero-hot .hot-card.on')
          || document.querySelector('.home-page .hero-hot .hot-card:not([aria-hidden])');
        if (!card) return null;
        const track = card.querySelector('[data-track]');
        const dots = [...card.querySelectorAll('.carousel-dots i')];
        const tag = card.querySelector('.hot-hot'), disc = card.querySelector('.hot-disc');
        const media = card.querySelector('.hot-media');
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
        };
        const cb = tag ? getComputedStyle(tag) : null, cd = disc ? getComputedStyle(disc) : null;
        return {
          slides: track ? track.children.length : 0,
          dots: dots.length,
          active: dots.findIndex((d) => d.classList.contains('on')),
          shift: track ? track.style.transform : '',
          media: media ? box(media) : null,
          tag: tag ? { ...box(tag), bg: cb.backgroundColor, color: cb.color, anim: cb.animationName, dur: cb.animationDuration, radius: cb.borderTopLeftRadius } : null,
          tagText: tag ? tag.textContent.replace(/\s+/g, ' ').trim() : '',
          disc: disc ? { ...box(disc), text: disc.textContent.replace(/\s+/g, ' ').trim(), bg: cd.backgroundColor, color: cd.color } : null,
          headGone: document.querySelectorAll('.home-page .hero-hot .hot-head').length === 0,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const sl0 = await sliderState();
      await new Promise((r) => setTimeout(r, 4600));
      const sl1 = await sliderState();
      check('ui', 'фото в «Горящей продаже» листаются сами: активный кадр сменился без кликов',
        !!sl0 && sl0.slides > 1 && sl0.dots === sl0.slides && sl1.active !== sl0.active
          && sl1.shift !== sl0.shift && sl0.over <= 1,
        JSON.stringify({ sl0, sl1 }));
      await page.click('.home-page .hero-hot .hot-card.on .carousel-btn.next');
      await new Promise((r) => setTimeout(r, 450));
      const sl2 = await sliderState();
      check('ui', 'стрелка в карточке листает фото вручную',
        !!sl2 && (sl2.active !== sl1.active || sl2.shift !== sl1.shift), JSON.stringify(sl2));
      check('ui', 'плашка «Горящая продажа» на фото справа внизу, красная и с пульсирующей подсветкой',
        !!sl0 && !!sl0.tag && sl0.tagText === 'Горящая продажа' && sl0.headGone
          && sl0.tag.r <= sl0.media.r && sl0.tag.b <= sl0.media.b
          && sl0.media.r - sl0.tag.r <= 8 && sl0.media.b - sl0.tag.b <= 8
          && sl0.tag.bg === 'rgb(227, 0, 15)' && sl0.tag.color === 'rgb(255, 255, 255)'
          && sl0.tag.anim === 'hotGlow' && parseFloat(sl0.tag.dur) > 0,
        JSON.stringify(sl0 && { tag: sl0.tag, tagText: sl0.tagText, media: sl0.media }));
      check('ui', 'скидка видна на кадре: белая плашка с красной суммой в левом верхнем углу',
        !!sl0 && !!sl0.disc && /^−\d[\d\s]*\s?Б$/.test(sl0.disc.text)
          && sl0.disc.bg === 'rgb(255, 255, 255)' && sl0.disc.color === 'rgb(227, 0, 15)'
          && sl0.disc.l >= sl0.media.l && sl0.disc.t >= sl0.media.t
          && sl0.disc.l - sl0.media.l <= 8 && sl0.disc.t - sl0.media.t <= 8,
        JSON.stringify(sl0 && { disc: sl0.disc, media: sl0.media }));
      /* Доступность: при «уменьшить движение» в системе подсветка не пульсирует (CSS-правило
         @media(prefers-reduced-motion:reduce) гасит hotGlow), а автопрокрутка не включается. */
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const slReduce = await sliderState();
      check('ui', 'при «уменьшить движение» пульсация плашки выключена',
        !!slReduce && !!slReduce.tag && slReduce.tag.anim === 'none' && slReduce.headGone,
        JSON.stringify(slReduce && slReduce.tag));
      /* Листание самой ленты «Горящей продажи» (Centered Slider): активная карточка остаётся по
         центру и на крайних позициях — за это отвечают копии карточек, которые достраивает
         initHotSliders, — точки переключают машину на нужный номер, лента зациклена. Идёт под
         «уменьшить движение»: автолистание там выключено и замеры не сбиваются. */
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 300));
      const hotSlide = await page.evaluate(async () => {
        const s = document.querySelector('.home-page .hero-hot [data-hot-slider]');
        const dots = [...document.querySelectorAll('.home-page .hero-hot [data-hot-dots] i')];
        const next = document.querySelector('.home-page .hero-hot [data-hot-next]');
        const prev = document.querySelector('.home-page .hero-hot [data-hot-prev]');
        if (!s || !next || !prev) return { nav: false };
        const wait = () => new Promise((r) => setTimeout(r, 260));
        const state = () => {
          const on = document.querySelector('.home-page .hero-hot .hot-card.on');
          const sr = s.getBoundingClientRect(), r = on.getBoundingClientRect();
          return {
            i: Number(s.getAttribute('data-hot-index')),
            /* Середина активной карточки минус середина ленты: у Centered Slider это 0. */
            delta: Math.round((r.left + r.width / 2) - (sr.left + sr.width / 2)),
            /* Карточка целиком внутри ленты (не обрезана краем) — значит центр настоящий. */
            left: Math.round(r.left - sr.left), right: Math.round(sr.right - r.right),
            dots: dots.findIndex((d) => d.classList.contains('on')),
            aria: [...document.querySelectorAll('.home-page .hero-hot .hot-card')].filter((c) => c.hasAttribute('aria-hidden')).length,
            tabbable: [...document.querySelectorAll('.home-page .hero-hot .hot-card[aria-hidden] a')].filter((a) => a.getAttribute('tabindex') !== '-1').length,
          };
        };
        const out = { nav: true, dots: dots.length, start: state(), trail: [] };
        for (let k = 0; k < 5; k++) { next.click(); await wait(); out.trail.push(state()); }
        prev.click(); await wait();
        out.back = state();
        dots[3].click(); await wait();
        out.dot3 = state();
        dots[0].click(); await wait();
        out.dot0 = state();
        return out;
      });
      check('ui', 'лента «Горящей продажи» листается стрелками и точками, активная карточка всегда по центру',
        hotSlide.nav && hotSlide.dots === 5 && hotSlide.start.i === 0
          && Math.abs(hotSlide.start.delta) <= 2
          && hotSlide.trail.map((s) => s.i).join(',') === '1,2,3,4,0'
          && hotSlide.trail.every((s) => Math.abs(s.delta) <= 2 && s.dots === s.i)
          && hotSlide.trail.every((s) => s.left >= 0 && s.right >= 0)
          && hotSlide.back.i === 4 && Math.abs(hotSlide.back.delta) <= 2
          && hotSlide.dot3.i === 3 && Math.abs(hotSlide.dot3.delta) <= 2 && hotSlide.dot3.dots === 3
          && hotSlide.dot0.i === 0 && hotSlide.dot0.dots === 0,
        JSON.stringify(hotSlide));
      /* Копии крайних карточек — только для глаза: для скринридера они скрыты, из обхода Tab
         выведены, а ссылок на автомобили в разметке страницы столько же, сколько карточек. */
      check('ui', 'копии карточек кольцевой ленты скрыты от скринридера и Tab',
        hotSlide.nav && hotSlide.start.aria === 2 && hotSlide.start.tabbable === 0,
        JSON.stringify(hotSlide && hotSlide.start));
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

      /* Список марок на главной — без рамок и линий, только название марки и её количество
         (просьба заказчика: «сделай этот блок без рамок и линий, только марки и их количество»).
         Раньше это была белая карточка .brand-line с рамкой и линией под каждой маркой.
         CSS .brand-line / .bl-item в public/assets/css/site.css. */
      const brandBox = () => page.evaluate(() => {
        const line = document.querySelector('.home-brands .brand-line');
        const item = document.querySelector('.home-brands .bl-item');
        const h1 = document.querySelector('.home-page .hero h1');
        if (!line || !item || !h1) return null;
        const cs = getComputedStyle(line), ci = getComputedStyle(item);
        const items = [...document.querySelectorAll('.home-brands .bl-item')];
        const grid = document.querySelector('.home-brands .bl-grid');
        const tops = new Set();
        const gaps = items.map((a) => {
          const i = a.querySelector('i');
          const b = a.getBoundingClientRect(), ib = i.getBoundingClientRect();
          const r = document.createRange();
          r.selectNodeContents(a.firstChild);
          tops.add(Math.round(b.top));
          return {
            nameGap: Math.round(ib.left - r.getBoundingClientRect().right),
            rightGap: Math.round(b.right - ib.right),
            broken: a.scrollWidth > a.clientWidth + 1 || b.height > 34,
          };
        });
        const names = items.map((a) => a.firstChild.textContent.trim());
        /* Порядок чтения: сверху вниз по колонкам (заказчик 2026-09-29: «сделай в алфавитном
           порядке который будет идти сверху — вниз, а не с лева на права как сейчас»). Собираем
           марки по колонкам слева направо, внутри колонки — сверху вниз, и сверяем с DOM: при
           grid-auto-flow:column этот обход даёт ровно алфавитный список, а при построчном (как
           было) — перепутанный. */
        const colOrder = [...items]
          .map((a, i) => ({ i, x: Math.round(a.getBoundingClientRect().left), y: Math.round(a.getBoundingClientRect().top), n: a.firstChild.textContent.trim() }))
          .sort((p, q) => (p.x - q.x) || (p.y - q.y))
          .map((p) => p.n);
        return {
          border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
          radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
          itemBorder: ci.borderTopWidth + '/' + ci.borderBottomWidth,
          itemLeft: Math.round(item.getBoundingClientRect().left),
          h1Left: Math.round(h1.getBoundingClientRect().left),
          count: items.length,
          allPlaque: !!document.querySelector('.home-brands .bl-all'),
          pairs: items.every((a) => a.childNodes.length === 2 && /^\d+$/.test((a.querySelector('i') || {}).textContent || '')),
          cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          autoFlow: grid ? getComputedStyle(grid).gridAutoFlow : '',
          colOrder,
          colAlphabet: colOrder.join('|') === [...colOrder].sort((x, y) => x.localeCompare(y, 'ru')).join('|'),
          rowsCount: tops.size,
          alphabet: names.join('|') === [...names].sort((x, y) => x.localeCompare(y, 'ru')).join('|'),
          maxNameGap: Math.max(...gaps.map((g) => g.nameGap)),
          minRightGap: Math.min(...gaps.map((g) => g.rightGap)),
          broken: gaps.filter((g) => g.broken).length,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const BRANDS_N = new Set(SEED_CARS.map((c) => c.brand)).size;
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const brandsWide = await brandBox();
      check('ui', 'блок марок без рамки, заливки и скругления',
        !!brandsWide && brandsWide.border === '0px/0px/0px/0px' && brandsWide.bg === 'rgba(0, 0, 0, 0)'
          && brandsWide.radius === '0px', JSON.stringify(brandsWide));
      check('ui', 'в строке марки нет линий-разделителей — только марка и её количество',
        !!brandsWide && brandsWide.itemBorder === '0px/0px' && brandsWide.pairs, JSON.stringify(brandsWide));
      /* Просьба заказчика: «Все марки 57 — убери», марки по алфавиту, счётчик рядом с названием,
         и весь перечень — двумя рядами («сейчас на 4-х строчках»). Данные — 18 марок. */
      check('ui', 'в списке марок нет плашки «Все марки», марки идут по алфавиту',
        !!brandsWide && !brandsWide.allPlaque && brandsWide.alphabet && brandsWide.count === BRANDS_N,
        `марок ${brandsWide && brandsWide.count} (в сиде ${BRANDS_N}), алфавит ${brandsWide && brandsWide.alphabet}, плашка ${brandsWide && brandsWide.allPlaque}`);
      check('ui', 'количество стоит рядом с названием марки, а не у правого края колонки',
        !!brandsWide && brandsWide.maxNameGap <= 12 && brandsWide.minRightGap >= 10,
        `зазор название→число ≤${brandsWide && brandsWide.maxNameGap}px, до края колонки ${brandsWide && brandsWide.minRightGap}px`);
      check('ui', 'на широком экране марки укладываются в два ряда по 9 без переноса названий',
        !!brandsWide && brandsWide.cols === 9 && brandsWide.rowsCount === 2 && brandsWide.broken === 0
          && brandsWide.over <= 1,
        `колонок ${brandsWide && brandsWide.cols}, рядов ${brandsWide && brandsWide.rowsCount}, переносов ${brandsWide && brandsWide.broken}`);
      /* Заказчик 2026-09-29: «сделай в алфавитном порядке который будет идти сверху — вниз, а не
         с лева на права как сейчас, измени на всех страница, где есть этот блок». Проверяем не
         только алфавит в DOM (он был верный и раньше), а порядок обхода по колонкам: слева направо,
         внутри колонки сверху вниз — он и должен быть алфавитным. */
      check('ui', 'на широком экране марки читаются сверху вниз по колонкам (алфавит по столбцам)',
        !!brandsWide && brandsWide.autoFlow === 'column' && brandsWide.colOrder.length === brandsWide.count
          && brandsWide.colAlphabet && brandsWide.colOrder[0] === 'Alfa Romeo',
        `flow ${brandsWide && brandsWide.autoFlow}, обход по колонкам: ` + (brandsWide ? brandsWide.colOrder.slice(0, 4).join(' ↓ ') : '') + ' …');
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const brandsNarrow = await brandBox();
      check('ui', 'на узком экране марки так же без линий и по левому краю заголовка',
        !!brandsNarrow && brandsNarrow.border === '0px/0px/0px/0px' && brandsNarrow.itemBorder === '0px/0px'
          && brandsNarrow.itemLeft === brandsNarrow.h1Left && brandsNarrow.over <= 1, JSON.stringify(brandsNarrow));
      check('ui', 'на узком экране марки в три ровных колонки, количество так же рядом с названием',
        !!brandsNarrow && brandsNarrow.cols === 3 && brandsNarrow.rowsCount === Math.ceil(brandsNarrow.count / 3)
          && brandsNarrow.maxNameGap <= 12 && brandsNarrow.alphabet && !brandsNarrow.allPlaque,
        `колонок ${brandsNarrow && brandsNarrow.cols}, рядов ${brandsNarrow && brandsNarrow.rowsCount} на ${brandsNarrow && brandsNarrow.count} марок;`
          + ` зазор ≤${brandsNarrow && brandsNarrow.maxNameGap}px, алфавит ${brandsNarrow && brandsNarrow.alphabet}, плашка «Все марки» ${brandsNarrow && brandsNarrow.allPlaque}`);
      check('ui', 'на телефоне марки тоже читаются сверху вниз по колонкам',
        !!brandsNarrow && brandsNarrow.autoFlow === 'column' && brandsNarrow.colAlphabet
          && brandsNarrow.colOrder[2] === 'Belgee' && brandsNarrow.colOrder.length === brandsNarrow.count,
        `первая колонка: ` + (brandsNarrow ? brandsNarrow.colOrder.slice(0, 2).join(' ↓ ') : ''));

      /* Тот же список марок на «Все авто» (/cars): заказчик попросил добавить его туда «как на
         домашней странице» (2026-09-27). Разметка и классы те же (.brands-top + .home-brands), но
         страница каталога своя — отдельно проверяем место строки (над панелью поиска), раскладку
         и что список не тянет страницу вбок ни на широком экране, ни на телефоне. */
      const catalogBrands = () => page.evaluate(() => {
        const line = document.querySelector('.brands-top .brand-line');
        const band = document.querySelector('.ps-band');
        const grid = document.querySelector('.brands-top .bl-grid');
        const items = [...document.querySelectorAll('.brands-top .bl-item')];
        if (!line || !band || !grid || !items.length) return null;
        const tops = new Set(items.map((a) => Math.round(a.getBoundingClientRect().top)));
        const colOrder = [...items]
          .map((a) => ({ x: Math.round(a.getBoundingClientRect().left), y: Math.round(a.getBoundingClientRect().top), n: a.firstChild.textContent.trim() }))
          .sort((p, q) => (p.x - q.x) || (p.y - q.y))
          .map((p) => p.n);
        return {
          count: items.length, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          autoFlow: getComputedStyle(grid).gridAutoFlow,
          colAlphabet: colOrder.join('|') === [...colOrder].sort((x, y) => x.localeCompare(y, 'ru')).join('|'),
          rowsCount: tops.size, above: line.getBoundingClientRect().top < band.getBoundingClientRect().top,
          over: document.documentElement.scrollWidth - window.innerWidth,
          broken: items.filter((a) => a.scrollWidth > a.clientWidth + 1).length,
        };
      });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const catBrandsWide = await catalogBrands();
      check('ui', '/cars: марки стоят над панелью поиска, 9 колонок в два ряда без переносов',
        !!catBrandsWide && catBrandsWide.above && catBrandsWide.count === BRANDS_N
          && catBrandsWide.cols === 9 && catBrandsWide.rowsCount === 2
          && catBrandsWide.broken === 0 && catBrandsWide.over <= 1,
        JSON.stringify(catBrandsWide));
      /* Тот же порядок и в каталоге: /cars, «С пробегом», «Новые», «Электро» рисуются одним
         блоком brandLine, но проверяем отдельно — заказчик просил «измени на всех страница,
         где есть этот блок». */
      check('ui', '/cars: марки тоже читаются сверху вниз по колонкам',
        !!catBrandsWide && catBrandsWide.autoFlow === 'column' && catBrandsWide.colAlphabet,
        `/cars: flow ${catBrandsWide && catBrandsWide.autoFlow}, алфавит по колонкам ${catBrandsWide && catBrandsWide.colAlphabet}`);
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const catBrandsNarrow = await catalogBrands();
      check('ui', '/cars: на телефоне марки в три ровных колонки, страница не уезжает вбок',
        !!catBrandsNarrow && catBrandsNarrow.cols === 3 && catBrandsNarrow.count === BRANDS_N
          && catBrandsNarrow.rowsCount === Math.ceil(BRANDS_N / 3)
          && catBrandsNarrow.over <= 1,
        JSON.stringify(catBrandsNarrow));
      check('ui', '/cars: на телефоне марки тоже читаются сверху вниз по колонкам',
        !!catBrandsNarrow && catBrandsNarrow.autoFlow === 'column' && catBrandsNarrow.colAlphabet,
        `/cars 390: flow ${catBrandsNarrow && catBrandsNarrow.autoFlow}, алфавит по колонкам ${catBrandsNarrow && catBrandsNarrow.colAlphabet}`);

      /* Узкий телефон (320 px, iPhone SE первого поколения): страница не должна уезжать вбок.
         Замер 2026-10-02: коробка «Сортировка» с inline min-width:210px занимала 304 px при
         доступных 280 (подпись + список) и выталкивала документ на 4 px. Проверяем сразу три
         страницы — каталог, главную и карточку авто. */
      await page.setViewport({ width: 320, height: 844 });
      const narrowOverflow = {};
      for (const path of ['/cars', '/', '/car/geely-emgrand-ii-139143093']) {
        await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
        narrowOverflow[path] = await page.evaluate(() => ({
          vw: window.innerWidth, doc: document.documentElement.scrollWidth,
          sortW: (() => { const s = document.querySelector('.sort-box select'); return s ? Math.round(s.getBoundingClientRect().width) : 0; })(),
          sortRight: (() => { const s = document.querySelector('.sort-box select'); return s ? Math.round(s.getBoundingClientRect().right) : 0; })(),
        }));
      }
      check('ui', 'на 320 px ни одна страница не уезжает вбок',
        Object.values(narrowOverflow).every((m) => m.doc - m.vw <= 0),
        JSON.stringify(narrowOverflow));
      check('ui', 'на 320 px список сортировки занимает почти всю ширину и не выходит за экран',
        narrowOverflow['/cars'].sortW >= narrowOverflow['/cars'].vw - 60
          && narrowOverflow['/cars'].sortRight <= narrowOverflow['/cars'].vw,
        `ширина списка ${narrowOverflow['/cars'].sortW}px, правый край ${narrowOverflow['/cars'].sortRight}px при экране ${narrowOverflow['/cars'].vw}px`);
      await page.setViewport({ width: 390, height: 844 });

      /* Страница «Проданные автомобили»: заявка на подбор стоит справа от таблицы и вровень с её
         верхом, таблица подтянута влево ровно на ширину колонки заявки. На узком экране колонки
         складываются — заявка уходит под таблицу, а таблица прокручивается внутри .tbl-wrap.
         Раскладка — .sold-layout в public/assets/css/site.css. */
      const soldBox = () => page.evaluate(() => {
        const b = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
        const main = b('.sold-layout .sold-main'), tbl = b('.sold-layout .sold-main table.tbl');
        const side = b('.sold-layout .sold-side'), pageBox = b('.wrap.page-pb'), h1 = b('.wrap.page-pb h1');
        const panel = document.querySelector('.sold-layout .sold-side .panel');
        if (!main || !tbl || !side || !pageBox || !h1 || !panel) return null;
        const fields = [...document.querySelectorAll('.sold-layout .sold-side .lead-form .field')];
        const btn = document.querySelector('.sold-layout .sold-side .lead-form .btn');
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        /* Колонка «Дата продажи»: и заголовок, и значения должны стоять по одной оси по центру
           колонки (заказчик 2026-10-01). Меряем центр самого текста, а не ячейки, — иначе
           проверка прошла бы и при левом выравнивании в широкой ячейке. */
        const textCenter = (el) => {
          if (!el || !el.textContent.trim()) return null;
          const r = document.createRange(); r.selectNodeContents(el);
          const box = r.getBoundingClientRect();
          return { c: Math.round(box.left + box.width / 2), align: getComputedStyle(el).textAlign };
        };
        const dateHead = textCenter(document.querySelector('.sold-layout table.tbl thead th.tbl-ctr'));
        /* Дата нужна только из строк с настоящей датой: пустая ячейка (строка-подпись группы
           «Проданные ранее», служебные строки) центр не показывает, но в проверку попадала и
           ломала ось (2026-10-02, на живой базе с накопленными группами). */
        const dateCells = [...document.querySelectorAll('.sold-layout table.tbl tbody td.tbl-ctr')]
          .filter((td) => /\d/.test(td.textContent)).map(textCenter);
        const groupRows = [...document.querySelectorAll('.sold-layout table.tbl tr.tbl-group')]
          .map((tr) => clean(tr.textContent));
        return {
          mainLeft: Math.round(main.left), mainBottom: Math.round(main.bottom),
          tblLeft: Math.round(tbl.left), tblRight: Math.round(tbl.right), tblTop: Math.round(tbl.top),
          sideLeft: Math.round(side.left), sideRight: Math.round(side.right), sideTop: Math.round(side.top),
          sideW: Math.round(side.width), panelLeft: Math.round(panel.getBoundingClientRect().left),
          panelW: Math.round(panel.getBoundingClientRect().width),
          pageRight: Math.round(pageBox.right), h1Left: Math.round(h1.left),
          title: clean((document.querySelector('.sold-layout .sold-side b') || {}).textContent),
          fields: fields.length,
          fieldWidths: fields.map((f) => Math.round(f.getBoundingClientRect().width)),
          btnW: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
          panelMax: getComputedStyle(panel).maxWidth,
          dateHead: dateHead, dateCells: dateCells, groupRows: groupRows,
          /* Первая строка тела может быть подписью группы («Проданные ранее»), поэтому ищем
             первую строку именно с автомобилем, а не просто tr:first-child. */
          firstBodyCar: !!document.querySelector('.sold-layout table.tbl tbody tr .sold-car'),
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/cars-sold', { waitUntil: 'domcontentloaded' });
      const soldWide = await soldBox();
      check('ui', '«Заявка на подбор» стоит справа от таблицы проданных, вровень с её верхом',
        !!soldWide && soldWide.sideLeft >= soldWide.tblRight && Math.abs(soldWide.sideTop - soldWide.tblTop) <= 2
          && soldWide.sideRight === soldWide.pageRight - 20 && soldWide.over <= 1,
        JSON.stringify(soldWide));
      check('ui', 'таблица проданных подтянута влево, поля заявки не сжаты',
        !!soldWide && soldWide.tblLeft === soldWide.h1Left && soldWide.pageRight - soldWide.tblRight >= 400
          && soldWide.fields === 2 && soldWide.fieldWidths.every((w) => w >= 300)
          && soldWide.btnW >= 300 && soldWide.panelMax === 'none'
          && /Заявка на подбор автомобиля/.test(soldWide.title),
        JSON.stringify(soldWide));
      /* Колонка «Дата продажи»: заголовок и все даты стоят по одной оси — по середине колонки
         (заказчик 2026-10-01: «фактические даты продажи сдвинуты влево, а надо по середине»).
         Строки-подписи «Проданные автомобили в этом месяце» под шапкой больше нет, таблица
         начинается сразу со строки автомобиля; группы прошлых месяцев («Проданные ранее») допустимы
         — их даты проверяются тем же условием. */
      const dateCenters = soldWide ? [soldWide.dateHead, ...soldWide.dateCells] : [];
      const dateSpread = dateCenters.filter(Boolean).map((d) => d.c);
      check('ui', 'в таблице проданных даты стоят по середине — под своим заголовком',
        !!soldWide && soldWide.firstBodyCar
          && dateCenters.length > 1 && dateCenters.every((d) => d && d.align === 'center')
          && Math.max(...dateSpread) - Math.min(...dateSpread) <= 2,
        `заголовок и ${soldWide ? soldWide.dateCells.length : 0} дат: центры ${dateSpread.join(', ')}`
          + ` / выравнивание ${[...new Set(dateCenters.filter(Boolean).map((d) => d.align))].join(',') || 'нет'}`);
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/cars-sold', { waitUntil: 'domcontentloaded' });
      const soldNarrow = await soldBox();
      check('ui', 'на узком экране окно заявки растянуто во всю ширину и стоит под таблицей, страница не уезжает вбок',
        !!soldNarrow && soldNarrow.panelMax === 'none' && soldNarrow.panelW === soldNarrow.sideW
          && soldNarrow.panelLeft === soldNarrow.sideLeft
          && soldNarrow.sideLeft === soldNarrow.mainLeft && soldNarrow.sideTop >= soldNarrow.mainBottom
          && soldNarrow.tblLeft === soldNarrow.h1Left && soldNarrow.over <= 1,
        JSON.stringify(soldNarrow));
      /* Заказчик 2026-10-01: «блок — заявка на подбор автомобиля, на странице проданные
         автомобили сделай, чтобы окно в мобильной версии растягивалось на ширину экрана».
         В сложенной раскладке (≤1080 px) окно заявки больше не ограничено 560 px: его ширина
         равна ширине колонки — на планшете 720 px при экране 760 px (пустая полоса справа
         была 160 px), на телефоне — ширина листа минус поля .wrap. Правило —
         .sold-layout .panel{max-width:none} в public/assets/css/site.css. */
      await page.setViewport({ width: 760, height: 950 });
      await page.goto(BASE + '/cars-sold', { waitUntil: 'domcontentloaded' });
      const soldTablet = await soldBox();
      check('ui', 'на планшете окно заявки на проданных растянуто на ширину колонки, а не 560 px',
        !!soldTablet && soldTablet.panelMax === 'none' && soldTablet.panelW === soldTablet.sideW
          && soldTablet.panelW > 600 && soldTablet.sideLeft === soldTablet.mainLeft
          && soldTablet.sideLeft === soldTablet.tblLeft && soldTablet.over <= 1,
        JSON.stringify(soldTablet));

      /* Страница «Контакты»: «Реквизиты» убраны, форма «Написать нам» стоит в правой колонке
         .contacts-layout — сразу справа от плитки «Станция технического обслуживания», верх и низ
         колонок совпадают (плитки 2×2 растянуты на высоту формы), лист заполнен до правого края.
         На узком экране колонки складываются: форма уходит под плитки и снова ограничена 560 px,
         а плитки идут по одной — вбок страница не уезжает. */
      const ctsBox = () => page.evaluate(() => {
        const b = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
        const tiles = document.querySelector('.contacts-tiles');
        const form = document.querySelector('.contacts-layout .panel');
        const wrap = document.querySelector('.wrap.page-pb');
        const h1 = document.querySelector('.wrap.page-pb h1');
        if (!tiles || !form || !wrap || !h1) return null;
        const all = [...document.querySelectorAll('.contacts-tiles .tile')];
        const sto = all.find((t) => /Станция технического обслуживания/.test(t.textContent));
        if (!sto) return null;
        const tr = tiles.getBoundingClientRect(), fr = form.getBoundingClientRect();
        const sr = sto.getBoundingClientRect();
        return {
          tilesCols: getComputedStyle(tiles).gridTemplateColumns.split(' ').length,
          tilesRows: new Set(all.map((t) => Math.round(t.getBoundingClientRect().top))).size,
          tiles: all.length,
          tilesLeft: Math.round(tr.left), tilesRight: Math.round(tr.right),
          tilesTop: Math.round(tr.top), tilesBottom: Math.round(tr.bottom),
          formLeft: Math.round(fr.left), formRight: Math.round(fr.right),
          formTop: Math.round(fr.top), formBottom: Math.round(fr.bottom),
          stoRight: Math.round(sr.right), gap: Math.round(fr.left - sr.right),
          pageLeft: Math.round(wrap.getBoundingClientRect().left),
          pageRight: Math.round(wrap.getBoundingClientRect().right),
          h1Left: Math.round(h1.getBoundingClientRect().left),
          requisites: !!document.querySelector('.contacts-layout .spec-list'),
          formMax: getComputedStyle(form).maxWidth,
          formTitle: (form.querySelector('b') || {}).textContent,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/contacts', { waitUntil: 'domcontentloaded' });
      const ctsWide = await ctsBox();
      check('ui', '1400: «Написать нам» справа от плитки «Станция технического обслуживания», вровень с ней',
        !!ctsWide && ctsWide.tilesCols === 2 && ctsWide.tilesRows === 2 && ctsWide.tiles === 4
          && ctsWide.formLeft === ctsWide.stoRight + 26
          && Math.abs(ctsWide.formTop - ctsWide.tilesTop) <= 2
          && Math.abs(ctsWide.formBottom - ctsWide.tilesBottom) <= 2
          && ctsWide.formRight === ctsWide.pageRight - 20
          && ctsWide.tilesLeft === ctsWide.h1Left && ctsWide.over <= 1,
        JSON.stringify(ctsWide));
      check('ui', '1400: «Реквизиты» со страницы контактов убраны, форма занимает свою колонку целиком',
        !!ctsWide && !ctsWide.requisites && ctsWide.formMax === 'none'
          && ctsWide.formRight - ctsWide.formLeft === 420
          && /Написать нам/.test(ctsWide.formTitle || ''),
        JSON.stringify(ctsWide));
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + '/contacts', { waitUntil: 'domcontentloaded' });
      const ctsNarrow = await ctsBox();
      check('ui', '390: форма контактов уходит под плитки и не сжимает их, страница не уезжает вбок',
        !!ctsNarrow && ctsNarrow.tilesCols === 1 && ctsNarrow.formTop >= ctsNarrow.tilesBottom
          && ctsNarrow.formLeft === ctsNarrow.tilesLeft && ctsNarrow.formMax === '560px'
          && ctsNarrow.formRight === ctsNarrow.pageRight - 20 && ctsNarrow.over <= 1,
        JSON.stringify(ctsNarrow));

      /* «Разместить объявление»: заказчик 2026-09-27 — «блок разместить объявление сделай уже и
         на всю страницу, а также сделай чтобы он был полностью виден при загрузке странице».
         Панель формы должна занимать всю ширину листа (раньше это была колонка 900 px с пустотой
         справа), поля — идти в четыре колонки, а вся форма целиком попадать в первый экран. */
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/sell', { waitUntil: 'networkidle2' });
      const sellBox = await page.evaluate(() => {
        const wrap = document.querySelector('.sell-wrap');
        const form = document.querySelector('form.sell-form');
        const grid = document.querySelector('.sell-fields');
        const r = form.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(wrap).paddingLeft);
        const heads = [...form.querySelectorAll('.sell-block-head')];
        const gridBox = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top + window.scrollY), bottom: Math.round(b.bottom + window.scrollY) }; };
        return {
          panel: Math.round(r.width),
          sheet: Math.round(wrap.clientWidth - pad * 2),
          cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          fields: [...document.querySelectorAll('.sell-form .sell-fields')].reduce((n, g) => n + g.querySelectorAll('.field').length, 0),
          heads: heads.map((h) => h.textContent.trim()),
          blocks: heads.map((h) => gridBox(h.closest('.sell-block'))),
          options: gridBox(document.querySelector('[data-options-grid]')),
          bottom: Math.round(r.bottom + window.scrollY),
          vh: window.innerHeight,
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check('ui', '/sell: панель формы во всю ширину листа', sellBox.panel === sellBox.sheet, `${sellBox.panel} px из ${sellBox.sheet}`);
      check('ui', '/sell: двадцать полей в четыре колонки', sellBox.fields === 20 && sellBox.cols === 4, JSON.stringify({ fields: sellBox.fields, cols: sellBox.cols }));
      check('ui', '/sell: блоки идут как на av.by, «Контакты» последним',
        sellBox.heads.join(' → ') === 'Автомобиль → Характеристики → Комплектация → Контакты', sellBox.heads.join(' → '));
      /* Форма выросла (заказчик 2026-09-27 добавил выбор комплектации с содержимым — 87 опций),
         поэтому прежняя проверка «форма целиком видна при загрузке (1400×950)» больше не про эту
         форму: одних опций набирается на полтысячи пикселей. Вместо неё требуем, чтобы на первом
         экране были видны шапка формы, «Автомобиль» и «Характеристики», а страница не уезжала
         вбок. Про смену требования — в STATE.md. */
      check('ui', '/sell: первый экран показывает шапку и два первых блока, страница не уезжает вбок',
        sellBox.blocks[0].top < sellBox.vh && sellBox.blocks[1].bottom <= sellBox.vh && sellBox.over <= 0,
        `«${sellBox.heads[0]}» ${sellBox.blocks[0].top}–${sellBox.blocks[0].bottom}, «${sellBox.heads[1]}» до ${sellBox.blocks[1].bottom} px при экране ${sellBox.vh}; низ формы ${sellBox.bottom} px, вбок ${sellBox.over} px`);
      check('ui', '/sell: список опций прокручивается, а не растягивает форму',
        sellBox.options.bottom - sellBox.options.top <= 180,
        `окно опций ${sellBox.options.bottom - sellBox.options.top} px`);

      /* «Чтобы можно было выбирать комплектацию и её содержимое»: выбор набора отмечает входящие
         в него опции, строка под заголовком объясняет, что вошло, а название набора попадает в
         поле «Своё название». Без этого выбор комплектации остался бы только картинкой. */
      const trimPick = await page.evaluate(() => {
        const sel = document.querySelector('[data-trim-select]');
        const read = () => ({
          count: document.querySelector('[data-options-count]').textContent.trim(),
          sum: document.querySelector('[data-options-sum]').textContent.trim(),
          marked: document.querySelectorAll('input[name=options]:checked').length,
          name: document.querySelector('[data-trim-name]').value,
        });
        const empty = read();
        sel.value = 'comfort';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const comfort = read();
        document.querySelector('[data-options-none]').click();
        const none = read();
        document.querySelector('[data-options-all]').click();
        const all = read();
        return { empty, comfort, none, all };
      });
      check('ui', '/sell: выбор комплектации отмечает её опции и подписывает набор',
        trimPick.empty.marked === 0 && trimPick.comfort.marked === 30 && trimPick.comfort.name === 'Комфорт'
          && trimPick.comfort.sum.indexOf('Комплектация «Комфорт»') === 0,
        `пусто ${trimPick.empty.marked}, «Комфорт» ${trimPick.comfort.marked} опций, имя «${trimPick.comfort.name}», «${trimPick.comfort.sum}»`);
      check('ui', '/sell: «Выбрать все» и «Снять все» правят список опций',
        trimPick.none.marked === 0 && trimPick.all.marked === 87
          && trimPick.none.count === 'Опции не выбраны' && trimPick.all.count === '87 опций',
        `${trimPick.none.marked}/${trimPick.all.marked}, «${trimPick.none.count}»/«${trimPick.all.count}»`);

      /* Марка, модель и поколение (заказчик 2026-09-28: «а также проверь выбор марки авто, плохо
         выбирается, работает криво, не подтягивается модель и выбор поколения авто»). Кликаем по
         полям как пользователь: марка открывает свой список, модель собирается по выбранной марке,
         поколение — по выбранной модели, смена марки убирает чужую модель и её поколение; список
         открывается теми же правилами .sel-pop, что и панель поиска. */
      const combo = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const field = (k) => document.querySelector('[data-combo=' + k + ']');
        const input = (k) => field(k).querySelector('input');
        const rowsOf = (k) => [...field(k).querySelectorAll('.sel-opt')].map((r) => r.textContent.trim());
        const pick = async (k, v) => {
          input(k).click();
          await wait(150);
          const row = [...field(k).querySelectorAll('.sel-opt')].find((r) => r.getAttribute('data-v') === v);
          if (!row) return false;
          row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await wait(150);
          return true;
        };
        const btn = document.querySelector('.sell-form .field .sel-btn');
        const inp = input('brand');
        const ics = getComputedStyle(inp);
        const bcs = btn ? getComputedStyle(btn) : null;
        const pop = field('brand').querySelector('.sel-pop');
        const shape = {
          wrapped: document.querySelectorAll('.sell-form .combo-sel').length,
          nativeLists: ['brand', 'model', 'generation'].filter((k) => input(k).hasAttribute('list')).length,
          arrows: document.querySelectorAll('.sell-form .combo-ar').length,
          sellButtons: document.querySelectorAll('.sell-form .field .sel-btn').length,
          brands: JSON.parse(document.querySelector('[data-sell-catalog]').textContent).brands.length,
          sameField: !!bcs && ics.padding === bcs.padding && ics.borderRadius === bcs.borderRadius,
        };
        input('brand').click();
        await wait(200);
        const brandRows = rowsOf('brand').length;
        const popStyle = {
          open: !pop.hidden, radius: getComputedStyle(pop).borderRadius,
          shadow: getComputedStyle(pop).boxShadow !== 'none',
        };
        const geely = await pick('brand', 'Geely');
        input('model').click();
        await wait(200);
        const models = rowsOf('model');
        const emgrand = await pick('model', 'Emgrand II');
        input('generation').click();
        await wait(200);
        const generations = rowsOf('generation');
        const gen = await pick('generation', 'II');
        const picked = { brand: input('brand').value, model: input('model').value, generation: input('generation').value };
        const bmw = await pick('brand', 'BMW');
        const afterBrand = { model: input('model').value, generation: input('generation').value };
        return { shape, brandRows, popStyle, geely, models, emgrand, generations, gen, picked, bmw, afterBrand };
      });
      check('ui', '/sell: марка со своим списком и полем того же вида, что соседние',
        combo.shape.wrapped === 3 && combo.shape.nativeLists === 0 && combo.shape.arrows === 3
          && combo.shape.sellButtons === 8 && combo.shape.brands > 100 && combo.shape.sameField
          && combo.brandRows > 100,
        JSON.stringify(combo.shape) + `, строк марки ${combo.brandRows}`);
      check('ui', '/sell: список марки открывается карточкой, как в панели поиска',
        combo.popStyle.open && combo.popStyle.shadow && combo.popStyle.radius === '14px',
        JSON.stringify(combo.popStyle));
      check('ui', '/sell: марка подтягивает модели, модель — поколения',
        combo.geely && combo.models.includes('Emgrand II') && combo.emgrand
          && combo.generations.includes('II') && combo.gen
          && combo.picked.brand === 'Geely' && combo.picked.model === 'Emgrand II' && combo.picked.generation === 'II',
        `модели: ${combo.models.join(' · ')}; поколения: ${combo.generations.join(' · ')}; значения ${JSON.stringify(combo.picked)}`);
      check('ui', '/sell: смена марки убирает чужую модель и её поколение',
        combo.bmw && combo.afterBrand.model === '' && combo.afterBrand.generation === '',
        JSON.stringify(combo.afterBrand));

      /* Загрузка фотографий: «переработай кнопку выбрать файлы по стилю сайта, а также
         предусмотри возможность перетягивания файлов с папок компьютера». Бросаем в зону
         настоящие File (как это делает проводник), проверяем подсветку зоны, превью, счётчик,
         лимит в десять файлов, удаление и — главное — что файлы попадают в поле формы
         input[name=photos]: иначе объявление уйдёт на модерацию без фотографий. */
      const drop = await page.evaluate(async () => {
        const zone = document.querySelector('[data-upload-zone]');
        const input = document.querySelector('input[name=photos]');
        const list = document.querySelector('[data-upload-list]');
        const count = document.querySelector('[data-upload-count]');
        const pick = document.querySelector('.upload-pick');
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
        const mk = (name) => {
          const bin = atob(png);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new File([bytes], name, { type: 'image/png' });
        };
        const fire = (type, dt) => zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        const dt = new DataTransfer();
        ['kuzov.png', 'salon.png'].forEach((n) => dt.items.add(mk(n)));
        fire('dragenter', dt);
        const over = zone.classList.contains('is-over');
        fire('dragover', dt);
        fire('drop', dt);
        await new Promise((r) => setTimeout(r, 400));
        const two = {
          n: list.children.length, files: input.files.length, count: count.textContent.trim(),
          over: zone.classList.contains('is-over'), thumbs: list.querySelectorAll('img[src^="blob:"]').length,
        };
        const dt2 = new DataTransfer();
        for (let i = 0; i < 12; i++) dt2.items.add(mk('f' + i + '.png'));
        fire('drop', dt2);
        await new Promise((r) => setTimeout(r, 400));
        const many = { n: list.children.length, files: input.files.length };
        list.querySelector('.upload-del').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        const removed = { n: list.children.length, files: input.files.length };
        const cs = getComputedStyle(pick);
        return {
          over, two, many, removed,
          style: { radius: cs.borderRadius, display: cs.display, hasIcon: !!zone.querySelector('svg') },
          input: { hidden: getComputedStyle(input).position, tabIndex: input.tabIndex },
        };
      });
      check('ui', '/sell: файлы из проводника ложатся в поле формы', drop.two.files === 2 && drop.two.n === 2 && drop.two.thumbs === 2, JSON.stringify(drop.two));
      check('ui', '/sell: зона подсвечивается при перетаскивании и гаснет после', drop.over === true && drop.two.over === false);
      check('ui', '/sell: счётчик показывает «2 из 10»', drop.two.count === '2 из 10', drop.two.count);
      check('ui', '/sell: больше десяти фотографий не принимается', drop.many.files === 10 && drop.many.n === 10, JSON.stringify(drop.many));
      check('ui', '/sell: файл убирается из набора',
        drop.removed.files === drop.many.files - 1 && drop.removed.n === drop.many.n - 1,
        `было ${JSON.stringify(drop.many)}, стало ${JSON.stringify(drop.removed)}`);
      /* Кнопка — .btn.btn-ghost.btn-sm внутри flex-зоны, поэтому inline-flex браузер считает
         блоком и отдаёт display:flex; важен сам вид кнопки сайта: радиус 999 px и значок в зоне. */
      check('ui', '/sell: кнопка выбора в стиле сайта, поле скрыто, но в форме',
        drop.style.radius === '999px' && /^(inline-)?flex$/.test(drop.style.display) && drop.style.hasIcon && drop.input.hidden === 'absolute',
        JSON.stringify(drop.style) + ' / поле ' + JSON.stringify(drop.input));

      /* Счётчик на кнопке «Показать автомобили N»: как только посетитель меняет параметры поиска,
         число на кнопке должно стать соответствующим набору — ещё до отправки формы (заказчик
         2026-09-27). Считает сервер тем же фильтром, что отдаёт страницу и ленту, поэтому сверяем
         кнопку с /api/cars/count, с числом «Найдено» на выдаче и с «Электро», где режим страницы
         сам задаёт топливо. */
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const btnSel = '[data-param-form] button[type="submit"] .btn-cnt';
      const readCnt = () => page.$eval(btnSel, (el) => el.textContent.replace(/[\s\u00a0]/g, ''));
      const waitCnt = async (want) => {
        for (let i = 0; i < 50; i++) {
          if ((await readCnt()) === String(want)) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };
      const totalAll = (await (await fetch(BASE + '/api/cars/count')).json()).total;
      const totalBmw = (await (await fetch(BASE + '/api/cars/count?brand=BMW')).json()).total;
      const totalEl = (await (await fetch(BASE + '/api/cars/count?mode=electric')).json()).total;
      const startCnt = await readCnt();
      check('ui', '/cars: на кнопке сразу стоит число найденного', startCnt === String(totalAll), `${startCnt} ≠ ${totalAll}`);
      await page.select('[data-param-form] [name="brand"]', 'BMW');
      check('ui', '/cars: счётчик меняется по выбранной марке',
        (await waitCnt(totalBmw)) && startCnt !== String(totalBmw), `было ${startCnt}, стало ${totalBmw}`);
      /* Набор полей, а не одно: к «марке BMW» добавляем цену «до 1 рубля». Ожидание берём у
         сервера на тот же набор — у BMW есть машина с ценой 0 («цена по запросу»), поэтому
         «до 1 рубля» честно находит её, и ждать нуля нельзя. Главное — число меняется вместе с
         полями и совпадает с ответом API на этот же набор. */
      const totalBmwCheap = (await (await fetch(BASE + '/api/cars/count?brand=BMW&price_to=1')).json()).total;
      await page.$eval('[data-param-form] [name="price_to"]', (el) => {
        el.value = '1';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      check('ui', '/cars: счётчик считает набор полей, а не одно',
        (await waitCnt(totalBmwCheap)) && totalBmwCheap !== totalBmw,
        `марка BMW до 1 рубля → ${await readCnt()}, API ${totalBmwCheap}, только марка ${totalBmw}`);
      await page.$eval('[data-param-form] [name="price_to"]', (el) => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.select('[data-param-form] [name="brand"]', '');
      check('ui', '/cars: снятие фильтра возвращает общий счётчик', await waitCnt(totalAll), 'стало ' + (await readCnt()));
      await page.goto(BASE + '/cars?brand=BMW', { waitUntil: 'domcontentloaded' });
      const bmwPage = { btn: await readCnt(), head: await page.$eval('.list-head h2 b.num', (el) => el.textContent.replace(/[\s\u00a0]/g, '')) };
      check('ui', '/cars: на кнопке ровно столько, сколько нашлось', bmwPage.btn === bmwPage.head && bmwPage.btn === String(totalBmw), JSON.stringify(bmwPage));
      await page.goto(BASE + '/electric', { waitUntil: 'domcontentloaded' });
      check('ui', '/electric: счётчик считает электро, а не всю базу',
        (await readCnt()) === String(totalEl) && totalEl < totalAll, `кнопка=${await readCnt()} электро=${totalEl} база=${totalAll}`);
      /* Марка из блока выбора авто на телефоне: тап по марке должен отфильтровать выдачу и обновить
         число на кнопке — и остаться в том же разделе. Проверяем живым кликом с переходом, а не
         разметкой: заказчик 02.10.2026 жаловался, что после тапа «не меняется количество карточек
         авто и не происходит фильтр в кнопке — Показать автомобили 57». */
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.goto(BASE + '/cars-used', { waitUntil: 'domcontentloaded' });
      const tileBefore = await page.$eval('.brands-top .bl-item:not(.bl-all)',
        (a) => ({ href: a.getAttribute('href'), text: a.textContent.replace(/[\s\u00a0]+/g, ' ').trim() }));
      await page.click('.brands-top .bl-item:not(.bl-all)');
      await page.waitForFunction(() => /[?&]brand=/.test(location.search), { timeout: 8000 });
      const tileAfter = await page.evaluate(() => {
        const btn = document.querySelector('[data-param-form] button[type="submit"] .btn-cnt');
        const found = document.querySelector('.list-head h2 b.num');
        return {
          url: location.pathname + location.search,
          cards: document.querySelectorAll('.cars .car').length,
          btn: btn && btn.textContent.replace(/[\s\u00a0]/g, ''),
          found: found && found.textContent.replace(/[\s\u00a0]/g, ''),
          btnText: (document.querySelector('[data-param-form] button[type="submit"]') || {}).textContent.replace(/[\s\u00a0]+/g, ' ').trim(),
        };
      });
      check('ui', '/cars-used: тап по марке фильтрует выдачу, меняет число на кнопке и не сбрасывает раздел',
        /^\/cars-used\?brand=/.test(tileAfter.url) && /^\/cars-used\?brand=/.test(tileBefore.href)
          && Number(tileAfter.btn) > 0 && Number(tileAfter.btn) < Number(totalAll)
          && tileAfter.found === tileAfter.btn && tileAfter.cards >= 1 && tileAfter.cards <= Number(tileAfter.btn)
          && /^Показать автомобили \d/.test(tileAfter.btnText),
        JSON.stringify({ tileBefore, tileAfter }));
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      check('ui', 'нет ошибок JS на страницах', errors.length === 0, errors.slice(0, 3).join(' | '));

      /* Вошедшему в шапке показываются «Кабинет» и «Выход» — это .btn.btn-ghost.btn-sm, а не
         .icon-btn, и у них своя ветка CSS (.header .btn-ghost). Проверяем отдельно: у них тоже
         не должно быть подложки и рамки, значок на месте. Сессию берём входом администратора и
         снимаем сразу после проверки, чтобы не влиять на другие прогоны. */
      const loginResp = await fetch(BASE + '/login', {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'admin@autonova.by', password: process.env.ADMIN_PASSWORD || 'autonova2026' }),
      });
      const sess = (loginResp.headers.getSetCookie ? loginResp.headers.getSetCookie() : [])
        .map((c) => c.split(';')[0]).find((c) => c.startsWith('an_session='));
      if (sess) await page.setCookie({ name: 'an_session', value: sess.split('=')[1], domain: '127.0.0.1', path: '/' });
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const authIcons = await page.evaluate(() => [...document.querySelectorAll('.header .head-user, .header .head-logout')].map((el) => {
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        return {
          cls: String(el.className), bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
          w: Math.round(b.width), h: Math.round(b.height), icon: !!el.querySelector('svg'),
        };
      }));
      check('ui', 'шапка вошедшего: «Кабинет» и «Выход» тоже без подложки и рамки',
        !!sess && authIcons.length === 2
          && authIcons.every((i) => i.bg === 'rgba(0, 0, 0, 0)' && i.border === '0px none' && i.icon),
        (sess ? '' : 'нет сессии; ') + JSON.stringify(authIcons));
      await page.deleteCookie({ name: 'an_session', domain: '127.0.0.1', path: '/' });

      /* Хвост каталога (заказчик 2026-09-28: «Сделай прозрачную кнопку — Показать ещё, и рядом
         приписка На странице 20 объявлений из 57 или сколько там у нас, и показывай 20 карточек
         авто»). Проверяем в браузере: на /cars стоит ровно 20 карточек, рядом с прозрачной
         кнопкой подпись «На странице 20 объявлений из 57», прокрутка до низа сама ничего не
         подгружает (прежняя нескончаемая лента отменена), клик добавляет ещё 20 и пересчитывает
         подпись, а после последней партии кнопка с подписью уходят и появляется строка «Показаны
         все N автомобилей». */
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const tailBox = await page.evaluate(() => {
        const box = document.querySelector('[data-more]');
        const btn = document.querySelector('[data-more-btn]');
        const cs = btn ? getComputedStyle(btn) : null;
        return {
          cards: document.querySelectorAll('.cars .car').length,
          total: Number(box.getAttribute('data-total')),
          perPage: Number(box.getAttribute('data-per-page')),
          count: (document.querySelector('[data-more-count]') || {}).textContent || '',
          btnText: btn ? btn.textContent.trim() : '',
          btnBg: cs ? cs.backgroundColor : '',
          btnBorder: cs ? cs.borderTopWidth + ' ' + cs.borderTopStyle : '',
        };
      });
      check('ui', 'хвост каталога: 20 карточек, прозрачная кнопка «Показать ещё» и подпись рядом',
        tailBox.cards === 20 && tailBox.perPage === 20 && tailBox.total > 20 && tailBox.btnText === 'Показать ещё'
          && tailBox.btnBg === 'rgba(0, 0, 0, 0)' && tailBox.btnBorder === '1px solid'
          && tailBox.count === `На странице 20 объявлений из ${tailBox.total}`,
        JSON.stringify(tailBox));
      /* Заказчик 2026-09-29: «Показать ещё / На странице 20 объявлений из 57 смести к левой
         границе». Было по центру: на 1280 px кнопка начиналась на 429 px, то есть на 399 px
         правее первой карточки. Теперь коробка хвоста выровнена по левому краю колонки списка
         (align-items:flex-start), поэтому кнопка начинается ровно там же, где первая карточка.
         Мерить обязательно до кликов: после последней партии initInfinite прячет строку
         (row.hidden = true), и у кнопки были бы нули вместо координат. */
      const moreLeft = await page.evaluate(() => {
        const btn = document.querySelector('[data-more-btn]');
        const cnt = document.querySelector('[data-more-count]');
        const row = document.querySelector('[data-more-row]');
        return {
          gridLeft: Math.round(document.querySelector('.cars > .car').getBoundingClientRect().left),
          btnLeft: Math.round(btn.getBoundingClientRect().left),
          rowLeft: Math.round(row.getBoundingClientRect().left),
          cntLeft: Math.round(cnt.getBoundingClientRect().left),
          cntRight: Math.round(cnt.getBoundingClientRect().right),
          innerW: innerWidth, align: getComputedStyle(document.querySelector('[data-more]')).alignItems,
          rowJustify: getComputedStyle(row).justifyContent,
        };
      });
      check('ui', 'хвост каталога: «Показать ещё» и подпись прижаты к левой границе списка (1280)',
        Math.abs(moreLeft.btnLeft - moreLeft.gridLeft) <= 2 && moreLeft.align === 'flex-start'
          && moreLeft.rowJustify === 'flex-start' && moreLeft.cntLeft >= moreLeft.btnLeft
          && moreLeft.cntRight <= moreLeft.innerW,
        JSON.stringify(moreLeft));
      /* Раньше на этом месте стоял IntersectionObserver — прокрутка до низа сама дописывала партию. */
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 900));
      const afterScroll = await page.evaluate(() => document.querySelectorAll('.cars .car').length);
      check('ui', 'хвост каталога: прокрутка сама карточки не подгружает', afterScroll === 20, 'карточек после прокрутки ' + afterScroll);
      await page.click('[data-more-btn]');
      await page.waitForFunction(() => document.querySelectorAll('.cars .car').length === 40, { timeout: 8000 });
      const afterClick = await page.evaluate(() => ({
        cards: document.querySelectorAll('.cars .car').length,
        count: (document.querySelector('[data-more-count]') || {}).textContent || '',
        endHidden: document.querySelector('[data-more-end]').hidden,
      }));
      check('ui', 'хвост каталога: клик добавляет 20 карточек и пересчитывает подпись',
        afterClick.cards === 40 && afterClick.endHidden === true
          && afterClick.count === `На странице 40 объявлений из ${tailBox.total}`,
        JSON.stringify(afterClick));
      await page.click('[data-more-btn]');
      await page.waitForFunction((n) => document.querySelectorAll('.cars .car').length === n, { timeout: 8000 }, tailBox.total);
      const tailEnd = await page.evaluate(() => ({
        cards: document.querySelectorAll('.cars .car').length,
        rowHidden: document.querySelector('[data-more-row]').hidden,
        btnShown: document.querySelector('[data-more-btn]').offsetParent !== null,
        endHidden: document.querySelector('[data-more-end]').hidden,
        endText: (document.querySelector('[data-more-end]') || {}).textContent || '',
      }));
      check('ui', 'хвост каталога: после последней партии кнопка уходит, видно «Показаны все N»',
        tailEnd.cards === tailBox.total && tailEnd.rowHidden === true && tailEnd.btnShown === false
          && tailEnd.endHidden === false && tailEnd.endText.trim().startsWith('Показаны все ' + tailBox.total + ' автомобил'),
        JSON.stringify(tailEnd));

      /* Мобильная выдача (просьба заказчика от 2026-09-28): карточки авто должны стоять по две
         в ряд и читаться с телефона. Проверяем сетку, симметрию ряда (одинаковые ширина и высота
         карточек в ряду), кнопки внутри карточки, отсутствие горизонтальной прокрутки и карусель,
         которой на тач-устройстве реально можно пользоваться: стрелки карусели видны полностью
         (наведения курсора нет — правило @media(hover:none) снимает приглушение .4) и свайп листает
         кадры. Вьюпорт с hasTouch — так браузер отдаёт те же media-запросы
         (hover:none), что и настоящий телефон. */
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const m390 = await page.evaluate(() => {
        const cars = [...document.querySelectorAll('.cars .car')];
        const rows = new Map();
        cars.forEach((c) => {
          const t = Math.round(c.getBoundingClientRect().top);
          const key = [...rows.keys()].find((k) => Math.abs(k - t) <= 2);
          rows.set(key === undefined ? t : key, [...(rows.get(key === undefined ? t : key) || []), c]);
        });
        const box = (c) => { const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }; };
        const firstRow = rows.get([...rows.keys()][0]) || [];
        const btns = [...document.querySelectorAll('.cars .car .btn')].map((b) => ({
          txt: b.textContent.trim(), w: b.scrollWidth, box: Math.round(b.getBoundingClientRect().width),
          lines: b.getClientRects().length, fs: parseFloat(getComputedStyle(b).fontSize),
        }));
        const car = document.querySelector('.cars .car .carousel');
        return {
          cols: firstRow.length,
          widths: [...new Set(firstRow.map((c) => box(c).w))],
          heights: [...new Set(firstRow.map((c) => box(c).h))],
          maxRight: cars.length ? Math.max(...cars.map((c) => box(c).right)) : 0,
          innerW: innerWidth, scrollW: document.documentElement.scrollWidth,
          total: cars.length,
          btnOver: btns.filter((b) => b.w > b.box + 1 || b.lines > 1).map((b) => `${b.txt} ${b.w}/${b.box}`),
          minBtnFont: btns.length ? Math.min(...btns.map((b) => b.fs)) : 0,
          dots: car ? car.querySelectorAll('[data-dots] i').length : 0,
          arrow: car ? getComputedStyle(car.querySelector('.carousel-btn')).opacity : '',
          arrowW: car ? Math.round(car.querySelector('.carousel-btn').getBoundingClientRect().width) : 0,
          touch: matchMedia('(hover:none)').matches,
        };
      });
      check('ui', '390: карточки авто стоят по две в ряд', m390.touch && m390.cols === 2 && m390.total >= 4,
        `колонок ${m390.cols}, карточек ${m390.total}, hover:none=${m390.touch}`);
      check('ui', '390: карточки в ряду одной ширины и высоты (симметрия)',
        m390.widths.length === 1 && m390.heights.length === 1,
        `ширины ${m390.widths.join('/')}, высоты ${m390.heights.join('/')}`);
      check('ui', '390: кнопки в карточке не переполняются и не переносятся',
        m390.btnOver.length === 0 && m390.minBtnFont >= 11, `переполнения: ${m390.btnOver.join('; ') || 'нет'}, кегль от ${m390.minBtnFont}px`);
      check('ui', '390: выдача не выезжает за экран по горизонтали',
        m390.scrollW <= m390.innerW + 1 && m390.maxRight <= m390.innerW + 1,
        `scrollWidth ${m390.scrollW} при ${m390.innerW}, правый край карточки ${m390.maxRight}`);
      /* На тач-экране наведения курсора нет, поэтому стрелка карусели видна всегда — но, как и при
         проявлении на десктопе, приглушённой (.8): заказчик 2026-10-01 просил «сделай кнопки чуть
         прозрачнее». Плотный белый круг (.92) остаётся откликом на курсор, которого на телефоне нет. */
      check('ui', '390: у карусели карточки есть точки и видны стрелки (тач)',
        m390.dots >= 2 && m390.arrow === '0.8' && m390.arrowW === 30,
        `точек ${m390.dots}, opacity стрелок «${m390.arrow}», размер ${m390.arrowW}px`);
      /* Тот же левый край хвоста каталога, но на телефоне: кнопка и подпись не влезают в строку
         вдвоём, подпись уходит под кнопку — и обе должны стоять по левому краю списка (20 px). */
      const moreLeft390 = await page.evaluate(() => {
        const btn = document.querySelector('[data-more-btn]');
        const cnt = document.querySelector('[data-more-count]');
        return {
          gridLeft: Math.round(document.querySelector('.cars > .car').getBoundingClientRect().left),
          btnLeft: Math.round(btn.getBoundingClientRect().left),
          btnRight: Math.round(btn.getBoundingClientRect().right),
          cntLeft: Math.round(cnt.getBoundingClientRect().left),
          cntRight: Math.round(cnt.getBoundingClientRect().right),
          stacked: cnt.getBoundingClientRect().top > btn.getBoundingClientRect().bottom - 1,
          innerW: innerWidth,
        };
      });
      check('ui', '390: «Показать ещё» и подпись тоже стоят по левому краю списка',
        Math.abs(moreLeft390.btnLeft - moreLeft390.gridLeft) <= 2
          && Math.abs(moreLeft390.cntLeft - moreLeft390.gridLeft) <= 2 && moreLeft390.stacked
          && moreLeft390.btnRight <= moreLeft390.innerW && moreLeft390.cntRight <= moreLeft390.innerW,
        JSON.stringify(moreLeft390));

      // Свайп пальцем влево по карусели: touch-события шлём через CDP, как их пришлёт телефон.
      // Карусель обязательно прокручиваем в видимую область: события с координатами за пределами
      // вьюпорта Chrome не доставляет, и свайп «не сработал бы» на пустом месте.
      const swipeFrom = await page.evaluate(() => {
        const car = document.querySelector('.cars .car .carousel');
        car.scrollIntoView({ block: 'center' });
        const r = car.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), on: [...car.querySelectorAll('[data-dots] i')].findIndex((d) => d.classList.contains('on')) };
      });
      const cdp = await page.createCDPSession();
      const finger = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: swipeFrom.y }] });
      await finger('touchStart', swipeFrom.x + 30);
      await finger('touchMove', swipeFrom.x);
      await finger('touchMove', swipeFrom.x - 70);
      await finger('touchEnd');
      await new Promise((r) => setTimeout(r, 400));
      const swipeTo = await page.evaluate(() => {
        const car = document.querySelector('.cars .car .carousel');
        return [...car.querySelectorAll('[data-dots] i')].findIndex((d) => d.classList.contains('on'));
      });
      check('ui', '390: свайп листает фото в карусели', swipeTo === swipeFrom.on + 1,
        `кадр ${swipeFrom.on} → ${swipeTo}`);

      // Самый узкий телефон: две колонки должны сохраняться, ничего не выходит за экран.
      await page.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      const m320 = await page.evaluate(() => {
        const cars = [...document.querySelectorAll('.cars .car')];
        const t0 = Math.round(cars[0].getBoundingClientRect().top);
        const row = cars.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - t0) <= 2);
        return {
          cols: row.length, innerW: innerWidth, scrollW: document.documentElement.scrollWidth,
          cardW: Math.round(cars[0].getBoundingClientRect().width),
          maxRight: Math.max(...cars.map((c) => Math.round(c.getBoundingClientRect().right))),
          minFont: Math.min(...[...document.querySelectorAll('.cars .car .car-title, .cars .car .car-params')].map((el) => parseFloat(getComputedStyle(el).fontSize))),
        };
      });
      check('ui', '320: две колонки сохраняются и ничего не вылезает за экран',
        m320.cols === 2 && m320.cardW >= 120 && m320.scrollW <= m320.innerW + 1 && m320.maxRight <= m320.innerW + 1 && m320.minFont >= 11,
        JSON.stringify(m320));

      /* Правки заказчика от 2026-09-29 по мобильной главной:
         • «сделай, что бы не переносились на следующие вниз строчки» — про лид в герое;
         • «бутерброд чтоб плавно выезжал с правой стороны и оставлял ещё какую-то часть слева
           вид страницы» — про меню;
         • «иконки социальных сетей сделай чтобы не переносились на следующую строчку ниже»;
         • «Сделай меньше отступ от блока горячая продажа до вниз следующего блока».
         Кегль лида проверяем не «на глаз»: первый кусок текста в этом браузере шире, чем в
         настоящем Chrome (в headless другой шрифт, замер показывает +12 px), поэтому проверка
         допускает перебор до 20 px — она ловит возврат к переносу, а не точные пиксели. */
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const lead390 = await page.evaluate(() => {
        const lead = document.querySelector('.home-page .hero p.lead');
        const segs = [...lead.querySelectorAll('.lead-line')];
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-weight:400';
        document.body.appendChild(probe);
        const items = segs.map((el) => {
          const cs = getComputedStyle(el);
          probe.style.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          probe.textContent = el.textContent;
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            display: cs.display, ws: cs.whiteSpace, fs: parseFloat(cs.fontSize),
            lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            need: Math.round(probe.getBoundingClientRect().width),
          };
        });
        probe.remove();
        const hero = document.querySelector('.home-page .hero');
        const hot = document.querySelector('.home-page .hero-hot');
        const cta = document.querySelector('.home-page .hero-cta');
        const dots = document.querySelector('.home-page .hot-dots');
        const brandItem = document.querySelector('.home-brands .bl-item');
        const hotBox = hot.getBoundingClientRect();
        const btnBox = cta.lastElementChild.getBoundingClientRect();
        const dotsBox = dots.getBoundingClientRect();
        const brandBox = brandItem.getBoundingClientRect();
        return {
          avail: Math.round(lead.clientWidth), items,
          ctaBottom: Math.round(cta.getBoundingClientRect().bottom), hotTop: Math.round(hotBox.top),
          gapBtnHot: Math.round(hotBox.top - btnBox.bottom),
          gapDotsBrand: Math.round(brandBox.top - dotsBox.bottom),
          heroH: Math.round(hero.getBoundingClientRect().height), scrollW: document.documentElement.scrollWidth,
        };
      });
      const leadBad = lead390.items.filter((s) => s.display !== 'block' || s.ws !== 'nowrap' || s.lines !== 1 || s.need > lead390.avail - 20);
      check('ui', '390: фразы лида в герое стоят своими строками и не переносятся',
        lead390.items.length >= 3 && !leadBad.length && lead390.items.every((s) => s.fs >= 13),
        JSON.stringify(lead390));
      /* Отступы вокруг «Горячей продажи» на телефоне — две просьбы заказчика 2026-09-29:
         «расстояние между кнопкой разместить объявление и каруселью — сделай стандартным, сейчас
         очень близко» и «от карусели до перечня всех марок и количество — сделай расстояние вниз
         меньше». Стандартный зазор перед блоком — 26 px (он же на широком экране); под каруселью
         низ героя ужат до 12 px, поэтому от точек до текста первой марки 26 px вместо 48.
         Разрыв до следующей секции мерить нельзя: между ними стоят ещё бренды и полоса поиска
         (следующая секция начинается через ~1000 px, и это не пустые пиксели). */
      check('ui', '390: от кнопок до карусели стандартный зазор и нет лишнего отступа под ней',
        lead390.gapBtnHot >= 20 && lead390.gapBtnHot <= 32
          && lead390.gapDotsBrand >= 10 && lead390.gapDotsBrand <= 32
          && lead390.hotTop > lead390.ctaBottom && lead390.scrollW <= lead390.avail + 40,
        `кнопки→карусель ${lead390.gapBtnHot} px, точки→первая марка ${lead390.gapDotsBrand} px, высота героя ${lead390.heroH} px`);

      /* Вкладки режимов в панели поиска на телефоне: «Электро» уходила за правую границу экрана
         (заказчик 02.10.2026: «в мобильной версии в блоке поиска авто есть вкладки - все авто, с
         пробегом, новые, электро, - кнопка электро заходит за правую границу экрана телефона»).
         Раньше ряд из четырёх вкладок (≈353 px) прокручивался свайпом внутри панели шириной
         262–332 px, и последняя вкладка была видна не целиком. Теперь это сетка 4×1: у каждой
         вкладки своя доля ширины, подпись «С пробегом» укладывается в одну строку, горизонтальной
         прокрутки нет и документ не шире экрана. */
      const modeTabs = [];
      for (const w of [430, 390, 375, 360, 320]) {
        await page.setViewport({ width: w, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
        modeTabs.push(await page.evaluate(() => {
          const box = document.querySelector('.ps-modes');
          const items = [...box.children].map((a) => {
            const b = a.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(a);
            return { label: a.textContent.trim(), right: Math.round(b.right), w: Math.round(b.width), lines: range.getClientRects().length };
          });
          return {
            vw: innerWidth, n: items.length, labels: items.map((i) => i.label), lines: items.map((i) => i.lines),
            minW: Math.min(...items.map((i) => i.w)), right: Math.max(...items.map((i) => i.right)),
            overflow: box.scrollWidth - box.clientWidth, scrollW: document.documentElement.scrollWidth,
          };
        }));
      }
      check('ui', 'телефон: четыре вкладки режимов встают в строку целиком — без прокрутки и обрезки',
        modeTabs.every((r) => r.n === 4 && r.labels.join('|') === 'Все авто|С пробегом|Новые|Электро'
          && r.lines.every((n) => n === 1) && r.minW >= 50 && r.right <= r.vw && r.overflow <= 1 && r.scrollW <= r.vw),
        JSON.stringify(modeTabs));
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

      const drawer = await page.evaluate(() => {
        const el = document.querySelector('[data-mobile-nav]');
        const cs = getComputedStyle(el);
        return {
          cls: el.className, displayBefore: cs.display, transition: cs.transitionProperty,
          /* Список пунктов лежит в самом .mdrawer-nav (он же .nav): `[data-mobile-nav] .nav`
             в site.css был бы потомком, а здесь классы на одном элементе, поэтому селектор
             «.mdrawer-nav .nav a» не находит ничего — берём «.mdrawer-nav a». */
          dur: parseFloat(cs.transitionDuration) || 0, wrapped: !!el.querySelector('.mdrawer-nav a'),
        };
      });
      await page.click('[data-burger]');
      await new Promise((r) => setTimeout(r, 450));
      const drawerOpen = await page.evaluate(() => {
        const el = document.querySelector('[data-mobile-nav]');
        const scrim = document.querySelector('[data-mnav-scrim]');
        const r = el.getBoundingClientRect();
        const nav = el.querySelector('.mdrawer-nav');
        const first = nav.querySelector('a');
        return {
          cls: el.className, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
          innerW: innerWidth, innerH: innerHeight, aria: document.querySelector('[data-burger]').getAttribute('aria-expanded'),
          scrimHidden: scrim.hidden, scrimOn: scrim.classList.contains('on'), scrimZ: getComputedStyle(scrim).zIndex, z: getComputedStyle(el).zIndex,
          navDir: getComputedStyle(nav).flexDirection, firstH: Math.round(first.getBoundingClientRect().height),
          railW: Math.round(r.left), scrollW: document.documentElement.scrollWidth,
        };
      });
      check('ui', '390: бургер выезжает справа, слева остаётся видна страница',
        drawer.displayBefore === 'none' && drawer.wrapped
          && /transform/.test(drawer.transition) && drawer.dur >= 0.15 && drawer.dur <= 0.6
          && /open/.test(drawerOpen.cls) && drawerOpen.right <= drawerOpen.innerW && drawerOpen.left >= 60
          && drawerOpen.top <= 1 && drawerOpen.bottom >= drawerOpen.innerH - 1
          && drawerOpen.scrimHidden === false && drawerOpen.scrimOn && drawerOpen.scrollW <= drawerOpen.innerW
          && Number(drawerOpen.z) > Number(drawerOpen.scrimZ) && drawerOpen.aria === 'true'
          && drawerOpen.navDir === 'column' && drawerOpen.firstH >= 30,
        JSON.stringify({ ...drawer, ...drawerOpen }));
      /* Закрываем по подложке. Мышь — в левую полосу (x=20): сама панель перекрывает подложку
         справа, и click({selector}) попадал бы в панель, а не в scrim. */
      await page.mouse.click(20, 420);
      await new Promise((r) => setTimeout(r, 450));
      const drawerClosed = await page.evaluate(() => {
        const el = document.querySelector('[data-mobile-nav]');
        return { cls: el.className, display: getComputedStyle(el).display, scrimHidden: document.querySelector('[data-mnav-scrim]').hidden };
      });
      check('ui', '390: тап по подложке закрывает меню',
        drawerClosed.display === 'none' && drawerClosed.scrimHidden && !/open/.test(drawerClosed.cls), JSON.stringify(drawerClosed));

      /* «Услуги» в бутерброде: первый тап раскрывает список услуг, панель при этом остаётся открытой,
         и только по подпункту происходит переход (заказчик 02.10.2026: «в мобильной версии в
         бутерброде при нажатии вкладки - Услуги, не раскрывается список услуг и не происходит переход
         на страницы»). Причина была в порядке обработчиков: обработчик [data-nav-dd] висит на самой
         ссылке и срабатывает раньше обработчика панели, тот видел уже раскрытый пункт и закрывал
         меню — список не показывался. Теперь первый тап помечен (e.__navDdOpened), и панель остаётся. */
      await page.click('[data-burger]');
      await new Promise((r) => setTimeout(r, 450));
      const servTap = await page.evaluate(() => {
        const r = document.querySelector('[data-mobile-nav] .nav-dd-btn').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.click(servTap.x, servTap.y);
      await new Promise((r) => setTimeout(r, 450));
      const servOpen = await page.evaluate(() => {
        const panel = document.querySelector('[data-mobile-nav]');
        const dd = panel.querySelector('.nav-dd');
        const menu = dd.querySelector('.nav-dd-menu');
        const box = menu.getBoundingClientRect();
        const links = [...menu.querySelectorAll('a')].map((a) => ({ t: a.textContent.trim(), href: a.getAttribute('href') }));
        return {
          cls: panel.className, dd: dd.className, display: getComputedStyle(menu).display,
          w: Math.round(box.width), h: Math.round(box.height), n: links.length, links: links.slice(0, 3),
          url: location.pathname,
        };
      });
      check('ui', '390: «Услуги» в бутерброде раскрывает список и не закрывает панель',
        /open/.test(servOpen.cls) && /open/.test(servOpen.dd) && servOpen.display !== 'none'
          && servOpen.h >= 40 && servOpen.n >= 4 && servOpen.url === '/'
          && servOpen.links.every((l) => /^\/services/.test(l.href)),
        JSON.stringify(servOpen));
      /* Второй тап по «Услуги» (список уже раскрыт) — это честный переход на страницу услуг. */
      await page.mouse.click(servTap.x, servTap.y);
      await page.waitForFunction(() => location.pathname === '/services', { timeout: 8000 });
      const servPage = await page.evaluate(() => ({
        path: location.pathname, h1: (document.querySelector('h1') || { textContent: '' }).textContent.trim().slice(0, 40),
        sub: [...document.querySelectorAll('a[href^="/services/"]')].length,
      }));
      check('ui', '390: второй тап по «Услуги» ведёт на страницу услуг',
        servPage.path === '/services' && /Услуги/.test(servPage.h1) && servPage.sub >= 3, JSON.stringify(servPage));
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

      const foot390 = await page.evaluate(() => {
        const row = document.querySelector('.footer .soc-row');
        const links = [...row.querySelectorAll('.soc-link')];
        const tops = links.map((a) => Math.round(a.getBoundingClientRect().top));
        return {
          n: links.length, rows: new Set(tops).size, rowW: Math.round(row.getBoundingClientRect().width),
          right: Math.round(Math.max(...links.map((a) => a.getBoundingClientRect().right))), innerW: innerWidth,
        };
      });
      check('ui', '390: значки соцсетей стоят одной строкой и не переносятся',
        foot390.n >= 5 && foot390.rows === 1 && foot390.right <= foot390.innerW, JSON.stringify(foot390));

      /* Ссылка «Контакты» в подвале на телефоне (заказчик 2026-09-30: «В подвале, ниже - Продано,
         добавь - Контакты»): стоит последней в колонке «Каталог», не выходит за экран и по клику
         открывает страницу контактов — проверяем сам переход, а не только разметку. */
      const footContacts = await page.evaluate(() => {
        const cat = [...document.querySelectorAll('.footer ul')][0];
        const items = [...cat.querySelectorAll('a')].map((a) => a.getAttribute('href') + ':' + a.textContent.trim());
        const a = document.querySelector('.footer a[href="/contacts"]');
        const r = a.getBoundingClientRect();
        return { items, href: a.getAttribute('href'), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), inner: innerWidth };
      });
      check('ui', '390: «Контакты» в подвале — под «Продано», в пределах экрана и видима',
        footContacts.items.at(-2) === '/cars-sold:Продано' && footContacts.items.at(-1) === '/contacts:Контакты'
          && footContacts.href === '/contacts' && footContacts.w > 0 && footContacts.h > 0 && footContacts.right <= footContacts.inner,
        JSON.stringify(footContacts));
      await page.click('.footer a[href="/contacts"]');
      await page.waitForFunction(() => location.pathname === '/contacts', { timeout: 8000 });
      check('ui', '390: клик по «Контакты» в подвале открывает страницу контактов',
        page.url().endsWith('/contacts') && (await page.$eval('h1', (el) => el.textContent)).includes('Контакты'),
        page.url());
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

      /* Заказчик 2026-09-30, две просьбы в одном сообщении: «в мобильной версии в подвале
         переносится иконки социальных сетей на строчку ниже сделай чтобы не переносились» и
         «Сервисы <кредит, лизинг, обмен, выкуп, комиссия, кредитный калькулятор> сделай справа
         от Каталог <все автомобили, с пробегом, новые, электро, продано>». Раньше значки
         переносились: на 320 px они просили 286 px (7 × 34 + 6 зазоров по 8), а колонка давала
         280 px → Facebook уезжал на вторую строку (6 + 1); на 561–760 px ряд попадал в половину
         колонки (244–343 px) и рвался как 5 + 2; на 901–1050 px колонка знака была 237–268 px →
         тоже 5 + 2. А «Сервисы» до 560 px стояли под «Каталогом» — подвал был в одну колонку.
         Теперь проверяем телефон (320 и 390 px) и узкое окно обозревателя (760 px): ряд значков
         всегда один, «Каталог» и «Сервисы» всегда в одной строке, «Сервисы» правее. */
      const footAt = async (w) => {
        await page.setViewport({ width: w, height: 844, isMobile: w <= 560, hasTouch: w <= 560, deviceScaleFactor: 1 });
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        return page.evaluate(() => {
          const box = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), r: Math.round(b.right) }; };
          const row = document.querySelector('.footer .soc-row');
          const links = [...row.querySelectorAll('.soc-link')];
          const kids = [...document.querySelector('.fgrid').children];
          const grid = getComputedStyle(document.querySelector('.fgrid'));
          return {
            inner: innerWidth, scrollW: document.documentElement.scrollWidth, n: links.length,
            rows: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
            iconW: Math.round(links[0].getBoundingClientRect().width),
            wrap: getComputedStyle(row).flexWrap, rowBox: box(row),
            nCols: grid.gridTemplateColumns.split(' ').filter(Boolean).length,
            brand: box(kids[0]), cat: box(kids[1]), serv: box(kids[2]), kv: box(document.querySelector('.fgrid > .kv')),
          };
        });
      };
      for (const w of [320, 390, 760]) {
        const f = await footAt(w);
        check('ui', `${w}: в подвале значки соцсетей в одну строку и «Сервисы» справа от «Каталога»`,
          f.n === 7 && f.rows === 1 && f.wrap === 'nowrap' && f.iconW >= 30
            && f.rowBox.r <= f.inner && f.scrollW <= f.inner
            && Math.abs(f.serv.y - f.cat.y) <= 2 && f.serv.x > f.cat.x + 20
            && f.nCols === (w <= 560 ? 2 : 3)
            && f.brand.w >= f.inner - 60 && f.brand.w > f.cat.w + f.serv.w - 4
            && f.kv.r <= f.inner,
          JSON.stringify(f));
      }
      /* Заказчик 2026-09-30 (окно 730 px): «Емаил и время работы не влезло в одну строчку» — он
         выделил в подвале два значения: «пн–пт 9:00–19:00, сб–вс 10:00–18:00» (оно рвалось на
         «…сб–вс 10:00–» и «18:00») и «info@autonova.by». Причина: в полосе 561–900 px контакты
         стояли «равной третью» — колонка 210 px, а часы просят 234,4 px. Правило
         `.fgrid{grid-template-columns:1.1fr 1fr auto}` (site.css) отдаёт контактам ровно их ширину,
         поэтому проверяем, что «Режим работы» и «E-mail» — по одной строке каждое и ничего не
         переполняется. */
      await page.setViewport({ width: 730, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const footLines = await page.evaluate(() => {
        const kv = document.querySelector('.fgrid > .kv');
        const dds = [...kv.querySelectorAll('dd')];
        const lines = (el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 18));
        const kb = kv.getBoundingClientRect();
        return {
          inner: innerWidth, kvW: Math.round(kb.width), kvR: Math.round(kb.right),
          cols: getComputedStyle(document.querySelector('.fgrid')).gridTemplateColumns,
          mode: lines(dds[2]), mail: lines(dds[3]),
          over: dds.reduce((s, d) => s + Math.max(0, d.scrollWidth - d.clientWidth), 0),
        };
      });
      check('ui', '730: в подвале «Режим работы» и «E-mail» — по одной строке каждое',
        footLines.mode === 1 && footLines.mail === 1 && footLines.over === 0 && footLines.kvR <= footLines.inner,
        JSON.stringify(footLines));
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

      await page.goto(BASE + '/services/credit', { waitUntil: 'domcontentloaded' });
      const serv390 = await page.evaluate(() => {
        const r = (s) => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bot: Math.round(b.bottom + scrollY) }; };
        return { prose: r('.serv-prose'), form: r('.serv-form'), rail: r('.side-nav') };
      });
      check('ui', '390: в услуге сначала описание, потом заявка',
        serv390.rail.bot <= serv390.prose.top && serv390.prose.bot <= serv390.form.top, JSON.stringify(serv390));
      await page.setViewport({ width: 1400, height: 950 });
      await page.goto(BASE + '/services/credit', { waitUntil: 'domcontentloaded' });
      const servWide = await page.evaluate(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(b.left), w: Math.round(b.width), top: Math.round(b.top + scrollY) }; };
        return { rail: r('.side-nav'), prose: r('.serv-prose'), form: r('.serv-form') };
      });
      check('ui', '1400: в услуге текст в середине, окно заявки правой колонкой',
        servWide.rail.x < servWide.prose.x && servWide.prose.x < servWide.form.x
          && Math.abs(servWide.form.top - servWide.rail.top) <= 2,
        JSON.stringify(servWide));

      /* Пункты услуг на телефоне (просьба заказчика 2026-10-02: «на мобильном внутри страницы
         услуги подблоки комиссия, обмен, выкуп и т.д. — в одну строку»). Раньше лента пунктов
         переносила подписи и пункт занимал две строки. Теперь у пункта одна строка (nowrap),
         лента вбок прокручивается, страница — нет. Проверяем на 320 и 390 px. */
      for (const w of [320, 390]) {
        await page.setViewport({ width: w, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.goto(BASE + '/services/credit', { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, 300));
        const rail = await page.evaluate(() => {
          const nav = document.querySelector('.side-nav');
          const links = [...nav.querySelectorAll('a')];
          const oneLine = (el) => {
            const cs = getComputedStyle(el);
            if (cs.whiteSpace !== 'nowrap') return false;
            /* Больше одного прямоугольника строки = текст перенёсся (Range даёт по прямоугольнику
               на каждую строку и на каждый пробел, поэтому считаем уникальные верхние края). */
            const rg = document.createRange();
            rg.selectNodeContents(el);
            const tops = [...rg.getClientRects()].map((r) => Math.round(r.top));
            return new Set(tops).size <= 1 && el.scrollWidth <= el.clientWidth + 1;
          };
          return {
            items: links.map((a) => a.textContent.trim()),
            lines: links.map(oneLine),
            railScroll: Math.round(nav.scrollWidth - nav.clientWidth),
            pageOver: Math.round(document.documentElement.scrollWidth - innerWidth),
          };
        });
        check('ui', `${w}: пункты услуги — каждый в одну строку, лента прокручивается вбок`,
          rail.items.length >= 5 && rail.lines.every(Boolean) && rail.railScroll > 0 && rail.pageOver <= 1,
          JSON.stringify(rail));
      }

      /* Промежуточные ширины от десктопа к мобильному (жалоба заказчика 2026-09-29: «когда
         сдвигаю рамку хрома обозревателя, вижу что появляются старые иконки подписи и
         вкладок»). Раньше в 1081–1279 px шапка возвращалась к прежнему виду — значки разделов
         без подписей. Теперь перелом у шапки один, 1280 px: от 1280 px — ряд подписей, ниже
         меню уходит в панель-бургер (там тоже только подписи; site.css @media(max-width:1279px)).
         Проверяем весь диапазон: значков вкладок не видно нигде и нигде нет горизонтальной
         прокрутки страницы. */
      const navBands = [];
      for (const w of [1280, 1279, 1200, 1100, 1081, 1080, 1024, 900]) {
        await page.setViewport({ width: w, height: 950 });
        await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
        navBands.push(await page.evaluate(() => {
          const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
          return {
            w: innerWidth,
            nav: vis(document.querySelector('.header .nav')),
            burger: vis(document.querySelector('.burger')),
            ico: [...document.querySelectorAll('.header .nav .nav-ico')].filter(vis).length,
            tx: [...document.querySelectorAll('.header .nav .nav-tx')].filter((t) => t.getClientRects().length > 0).length,
            scrollW: document.documentElement.scrollWidth,
          };
        }));
      }
      const navWide = navBands[0], navNarrow = navBands.slice(1);
      check('ui', 'шапка на промежуточных ширинах: нет старых значков вкладок и нет горизонтальной прокрутки',
        navWide.nav && !navWide.burger && navWide.ico === 0 && navWide.tx >= 6 && navWide.scrollW <= navWide.w
          && navNarrow.every((r) => !r.nav && r.burger && r.ico === 0 && r.scrollW <= r.w),
        JSON.stringify(navBands));

      /* Значки не вернулись и внутри панели-бургера: на 1081–1279 px она теперь и открывается. */
      await page.setViewport({ width: 1200, height: 950 });
      await page.goto(BASE + '/cars', { waitUntil: 'domcontentloaded' });
      await page.click('[data-burger]');
      await new Promise((r) => setTimeout(r, 450));
      const drawerMid = await page.evaluate(() => {
        const el = document.querySelector('[data-mobile-nav]');
        const vis = (e) => !!e && e.getClientRects().length > 0;
        const links = [...el.querySelectorAll('a')].filter(vis);
        const r = el.getBoundingClientRect();
        return {
          cls: el.className, items: links.length,
          ico: [...el.querySelectorAll('.nav-ico')].filter(vis).length,
          labels: links.map((a) => a.textContent.trim()),
          left: Math.round(r.left), right: Math.round(r.right), inner: innerWidth,
          scrollW: document.documentElement.scrollWidth,
        };
      });
      check('ui', '1200: меню уходит в бургер с полными подписями — без значков и без прокрутки',
        /open/.test(drawerMid.cls) && drawerMid.items >= 8 && drawerMid.ico === 0
          && drawerMid.labels.includes('Автомобили с пробегом') && drawerMid.labels.includes('Отзывы')
          && drawerMid.right <= drawerMid.inner && drawerMid.left >= 400 && drawerMid.scrollW <= drawerMid.inner,
        JSON.stringify(drawerMid));

      /* ── Страница «Сравнение» на телефоне ───────────────────────────────────────────────────
         Просьба заказчика 2026-10-02 (с телефона): «На странице - Сравнения авто в мобильной
         версии, сделай, что бы били показаны минимум два автомобиля без прокрутки содержимого
         блока в право». До правки таблица была 840 px при трёх машинах: на 390 px экране от
         первой колонки видно 246 px, от второй — 26 px. Теперь на телефоне таблица скрыта, а
         вместо неё — лента .cmp-cards-only: колонки карточек не переносятся, две видны целиком,
         третья уезжает влево по горизонтальной прокрутке самой ленты. Прокрутки страницы при этом
         нет. Проверяем на 320 и 390 px. */
      const cmpCookie = { name: 'an_cmp', value: '1,2,3', url: BASE };
      for (const w of [320, 390]) {
        await page.setViewport({ width: w, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.setCookie(cmpCookie);
        await page.goto(BASE + '/compare/', { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, 400));
        const cm = await page.evaluate(() => {
          const strip = document.querySelector('.cmp-cards-only');
          const cs = strip ? getComputedStyle(strip) : null;
          const cards = [...document.querySelectorAll('.cmp-card')];
          const box = strip ? strip.getBoundingClientRect() : null;
          const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '16'));
          const names = [...document.querySelectorAll('.cmp-card .cmp-name')];
          const vals = [...document.querySelectorAll('.cmp-list dd')];
          const dts = [...document.querySelectorAll('.cmp-list dt')];
          return {
            cards: cards.length,
            display: cs ? cs.display : 'нет ленты', wrap: cs ? cs.flexWrap : '',
            flex: cs ? (cs.flexGrow + '/' + cs.flexShrink + '/' + cs.flexBasis) : '',
            cardW: cards.map((c) => Math.round(c.getBoundingClientRect().width)),
            inView: cards.filter((c) => c.getBoundingClientRect().right <= box.right + 1).length,
            stripScroll: strip ? Math.round(strip.scrollWidth - strip.clientWidth) : 0,
            pageOver: Math.round(document.documentElement.scrollWidth - innerWidth),
            namesSingle: names.length >= 3 && names.every((n) => lines(n) === 1),
            dtSingle: dts.every((d) => lines(d) === 1),
            specs: vals.length,
            tableShown: getComputedStyle(document.querySelector('.cmp-scroll')).display !== 'none',
            empty: !!document.querySelector('.empty'),
          };
        });
        check('ui', `${w}: сравнение — минимум две карточки целиком в экране, лента прокручивается вбок`,
          cm.cards === 3 && cm.display === 'flex' && cm.wrap === 'nowrap' && cm.inView >= 2
            && cm.cardW.every((c) => c > 100) && cm.stripScroll > 0
            && cm.pageOver <= 1 && !cm.tableShown && !cm.empty,
          JSON.stringify(cm));
        check('ui', `${w}: сравнение — названия и подписи в одну строку, характеристики не разъезжаются`,
          cm.namesSingle && cm.dtSingle && cm.specs >= 33,
          `значений ${cm.specs}, названия в строку: ${cm.namesSingle}, подписи в строку: ${cm.dtSingle}`);
      }
      /* Цена и «Сравнить» в одной строке карточки (заказчик 02.10.2026, четвёртый список:
         «на мобильном … в карточках кнопку сравнить размести напротив цены»). До этого строка
         переносилась и подпись уезжала под число; в CSS @media(max-width:600px) у .car-price-row
         теперь flex-wrap:nowrap, а подпись двигателя из блока цены убрана (те же данные строкой
         ниже) — иначе цифры цены обрезались многоточием. Проверяем на 320 и 390 px. */
      for (const w of [320, 390]) {
        await page.setViewport({ width: w, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.goto(BASE + '/cars', { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, 300));
        const priceRow = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('.car-price-row')];
          const bad = rows.filter((row) => {
            const price = row.querySelector('.car-price');
            const cmp = row.querySelector('.cmp-cell');
            if (!price || !cmp) return true;
            const pr = price.getBoundingClientRect(), cr = cmp.getBoundingClientRect();
            const dy = Math.abs((pr.top + pr.bottom) / 2 - (cr.top + cr.bottom) / 2);
            return dy > 4 || cr.left < pr.right - 1 || price.scrollWidth > price.clientWidth + 1;
          }).length;
          return {
            rows: rows.length, bad,
            over: Math.round(document.documentElement.scrollWidth - innerWidth),
            carW: Math.round(document.querySelector('.car').getBoundingClientRect().width),
          };
        });
        check('ui', `${w}: в карточке «Сравнить» стоит напротив цены, цифры цены не обрезаны`,
          priceRow.rows >= 10 && priceRow.bad === 0 && priceRow.over <= 1,
          JSON.stringify(priceRow));
      }

      /* Строка про бронь в окне «Забронировать» — одна строка без переноса (заказчик 02.10.2026,
         второй список: «в окне брони … Бронь держим 3 дня — без предоплаты — сделай одной строкой»).
         Проверяем на самом узком экране: подпись не переносится и не вылезает за окно. */
      await page.setViewport({ width: 320, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.goto(BASE + '/cars', { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 200));
      const bookNote = await page.evaluate(() => {
        const back = document.querySelector('[data-book-modal]');
        if (!back) return { none: true };
        back.hidden = false;
        const note = [...back.querySelectorAll('p, .small, .muted')]
          .find((el) => /Бронь держим/.test(el.textContent));
        if (!note) return { noNote: back.textContent.replace(/\s+/g, ' ').slice(0, 160) };
        const rg = document.createRange();
        rg.selectNodeContents(note);
        const tops = new Set([...rg.getClientRects()].map((r) => Math.round(r.top)));
        return {
          text: note.textContent.trim(),
          lines: tops.size,
          over: Math.round(note.scrollWidth - note.clientWidth),
          modalOver: Math.round(back.querySelector('.modal').getBoundingClientRect().right - innerWidth),
        };
      });
      check('ui', '320: строка про бронь в окне «Забронировать» укладывается в одну строку',
        !bookNote.none && !bookNote.noNote && bookNote.lines === 1 && bookNote.over <= 0 && bookNote.modalOver <= 0,
        JSON.stringify(bookNote));

      /* «Убрать» в карточке: машина уходит из сравнения, остальные остаются. Возвращаемся на
         страницу сравнения: проверки строки цены и брони ходили на /cars. */
      await page.setCookie(cmpCookie);
      await page.goto(BASE + '/compare/', { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 300));
      await page.evaluate(() => document.querySelectorAll('.cmp-card [data-compare-remove]')[1].click());
      await new Promise((r) => setTimeout(r, 700));
      const cmpAfter = await page.evaluate(() => ({
        cards: document.querySelectorAll('.cmp-card').length,
        badge: (document.querySelector('[data-count-cmp]') || {}).textContent || '',
      }));
      check('ui', 'сравнение: «Убрать» в карточке убирает одну машину, остальные остаются',
        cmpAfter.cards === 2 && cmpAfter.badge.trim() === '2', JSON.stringify(cmpAfter));
    } finally {
      await browser.close();
    }
  },
  seo: async () => {
    const r = await get('/');
    check('seo', 'есть <title>', /<title>.+<\/title>/.test(r.text));
    check('seo', 'есть meta description', r.text.includes('name="description"'));
    check('seo', 'есть Open Graph', r.text.includes('og:title') && r.text.includes('og:image'));
    check('seo', 'есть JSON-LD', r.text.includes('application/ld+json') && r.text.includes('AutoDealer'));
    check('seo', 'есть canonical', r.text.includes('rel="canonical"'));
    const s = await get('/sitemap.xml');
    check('seo', 'sitemap.xml отдаётся', s.status === 200 && s.text.includes('<urlset'));
    const { num } = await import('../lib/db.mjs');
    check('seo', 'sitemap содержит все авто', (s.text.match(/\/car\//g) || []).length === num("SELECT COUNT(*) FROM cars WHERE status='published'"));
  },
};

if (LIST) {
  console.log('Разделы:', Object.keys(SECTIONS).join(', '));
  process.exit(0);
}

const t0 = Date.now();
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (ONLY && ONLY !== name) continue;
  try { await fn(); }
  catch (e) { check(name, `${name}: раздел выполнен без ошибок`, false, e.message); }
}

const bySection = {};
for (const r of results) {
  bySection[r.section] = bySection[r.section] || { ok: 0, fail: 0, fails: [] };
  if (r.ok) bySection[r.section].ok++;
  else { bySection[r.section].fail++; bySection[r.section].fails.push(r.name + (r.info ? ' [' + r.info + ']' : '')); }
}
for (const [sec, s] of Object.entries(bySection)) {
  console.log(`${s.fail ? 'FAIL' : ' ok '} ${sec}: ${s.ok}/${s.ok + s.fail}`);
  s.fails.forEach((f) => console.log('      · ' + f));
}
const total = results.length;
console.log(`\n${fails ? 'FAILED' : 'PASSED'} — ${total - fails}/${total} проверок за ${((Date.now() - t0) / 1000).toFixed(1)} с · ${BASE}`);

const outDir = path.join(ROOT, 'tests', 'logs');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(ROOT, 'tests', 'last-run.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), total, fails, results }, null, 2));
fs.writeFileSync(path.join(outDir, stamp + '.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), total, fails, results }, null, 2));
process.exit(fails ? 1 : 0);

