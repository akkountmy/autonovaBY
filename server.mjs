// «Автонова с пробегом» — сервер приложения (Node.js, без внешних зависимостей).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, all, one, run, getSetting, setSetting, DB_PATH } from './lib/db.mjs';
import { seedAll, slugify } from './lib/seed.mjs';
import { register, login, parseCookies, userByToken, destroySession, createSession, cleanupSessions, SESSION_DAYS } from './lib/auth.mjs';
import { carStats, decorate, carById, carBySlug, listCars, SORTS } from './lib/cars.mjs';
import * as P from './lib/pages.mjs';
import { siteBase } from './lib/view.mjs';
import { TRIMS, INTERIOR_COLORS, INTERIOR_MATERIALS, normalizeOptions, composeEquipment } from './lib/car-options.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');
const argPort = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : null;
const PORT = Number(process.env.PORT || argPort || 8100);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_COOKIE = 'an_session';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.avif': 'image/avif', '.heic': 'image/heic', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};

/* Фото сида приходят с av.by в AVIF, но сохраняются под именем «.jpg» (так их отдаёт CDN
   объявлений и так они лежат в data/seed-cars.json). Поэтому тип определяем по содержимому
   файла, а расширение — только запасной вариант: с неверным image/jpeg часть браузеров
   такие снимки не показывает. */
const SIGNATURES = [
  [[0xff, 0xd8], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
];
function fileType(file, fallback) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, head.length, 0);
    for (const [sig, type] of SIGNATURES) if (sig.every((b, i) => head[i] === b)) return type;
    const brand = head.subarray(4, 12).toString('latin1');
    if (brand.startsWith('ftypavi')) return 'image/avif';
    if (brand.startsWith('ftyphei') || brand.startsWith('ftypmif')) return 'image/heic';
    if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  } catch { /* файл исчез между statSync и чтением — отдадим тип по расширению */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return fallback;
}

migrate();
seedAll({});

/* ── helpers ───────────────────────────────────────────── */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function html(res, body, status = 200) {
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
}
function json(res, data, status = 200, extra = {}) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...extra });
}
function redirect(res, to, extra = {}) {
  res.writeHead(302, { Location: to, ...extra });
  res.end();
}
function parseCookies2(req) { return parseCookies(req); }
function idList(cookies, key) {
  try {
    const raw = cookies[key];
    if (!raw) return [];
    return String(raw).split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
  } catch { return []; }
}
function setCookieHeader(list) { return { 'Set-Cookie': list }; }

async function readBody(req, limit = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > limit) { req.destroy(); throw new Error('too large'); }
    chunks.push(ch);
  }
  return Buffer.concat(chunks);
}
function parseUrlEncoded(buf) {
  const o = {};
  /* Повторяющийся ключ (у формы объявления это чекбоксы «Опции» — их приходит до 87) собираем
     в массив: URLSearchParams.get вернул бы только первое значение, и выбранные опции потерялись
     бы. У обычных однозначных полей значение остаётся строкой, как раньше. */
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) o[k] = k in o ? [].concat(o[k], v) : v;
  return o;
}
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: [] };
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {}; const files = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      const body = part.subarray(sep + 4);
      const nameM = /name="([^"]*)"/i.exec(head);
      const fileM = /filename="([^"]*)"/i.exec(head);
      const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      if (nameM) {
        if (fileM && fileM[1]) files.push({ field: nameM[1], name: fileM[1], type: (typeM ? typeM[1] : '').trim(), data: body });
        else if (nameM[1] in fields) fields[nameM[1]] = [].concat(fields[nameM[1]], body.toString('utf8'));
        else fields[nameM[1]] = body.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}
function saveUploads(files, slug) {
  const dir = path.join(PUB, 'uploads', 'user', slug);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  let i = 0;
  for (const f of files) {
    if (f.field !== 'photos' || !f.data || !f.data.length || f.data.length < 512) continue;
    const ext = (path.extname(f.name || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    const e = ok ? ext : '.jpg';
    const name = String(++i).padStart(2, '0') + e;
    fs.writeFileSync(path.join(dir, name), f.data);
    out.push('/uploads/user/' + slug + '/' + name);
    if (out.length >= 10) break;
  }
  return out;
}
function serveStatic(req, res, pathname, versioned = false) {
  const rel = pathname.replace(/^\/+/, '');
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size}-${st.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return true; }
  /* Файлы со «?v=» меняют адрес при каждой правке (см. ссылки в lib/view.mjs), поэтому их можно
     кэшировать надолго: старый адрес остаётся валидным, свежий приходит с новым «?v=».
     Без версии (загруженные в кабинет фото) держим сутки — их имена не меняются. */
  const cache = versioned ? 'public, max-age=31536000, immutable'
    : (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico', '.woff2'].includes(ext) ? 'public, max-age=86400' : 'public, max-age=300');
  res.writeHead(200, {
    'Content-Type': fileType(file, MIME[ext] || 'application/octet-stream'),
    'Content-Length': st.size,
    'Cache-Control': cache,
    ETag: etag,
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ── состояние запроса ─────────────────────────────────── */
function buildState(req, url) {
  const cookies = parseCookies2(req);
  const user = userByToken(cookies[SESSION_COOKIE]) || null;
  const favorites = idList(cookies, 'an_fav');
  const compare = idList(cookies, 'an_cmp');
  const visibleFav = favorites.filter((id) => !!carById(id));
  const visibleCmp = compare.filter((id) => !!carById(id));
  return {
    user, cookies,
    favorites: visibleFav, compare: visibleCmp,
    favoritesSet: new Set(visibleFav), compareSet: new Set(visibleCmp),
    settings: Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])),
    counts: {},
    path: url.pathname,
    query: url.search,
    url,
  };
}

/* ── маршруты ──────────────────────────────────────────── */
async function handle(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST));
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad request'); }
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '');
  const method = req.method.toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    /* /data — справочники каталога av.by для комбобоксов формы /sell
       (public/data/avby: марки, модели, поколения с фото и годами). */
    if (pathname.startsWith('/assets/') || pathname.startsWith('/uploads/') || pathname.startsWith('/data/') || pathname === '/favicon.ico' || pathname === '/robots.txt') {
      if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nSitemap: ${siteBase()}/sitemap.xml\n`, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (pathname === '/favicon.ico') { if (serveStatic(req, res, '/assets/logo/favicon.ico')) return; }
      if (serveStatic(req, res, pathname, url.searchParams.has('v'))) return;
      return notFoundRaw(res);
    }
  }

  const state = buildState(req, url);
  cleanupSessions();

  /* JSON API в стиле Bitrix (совместимость с фронтендом-клоном) */
  if (pathname === '/bxapi/v1/init') {
    return json(res, {
      status: 'ok',
      site: { name: getSetting('site_name'), url: 'http://' + (req.headers.host || HOST), currency: 'BYN' },
      user: state.user ? { id: state.user.id, name: state.user.name, email: state.user.email, role: state.user.role } : null,
      compare: state.compare, favorites: state.favorites, compareHash: state.cookies.BITRIX_SM_SLAM_COMPARE_USER_HASH || null,
      filters: { sort: Object.keys(SORTS) },
    });
  }
  if (pathname === '/bxapi/v1/cars') {
    const params = Object.fromEntries(url.searchParams);
    params.per_page = Math.min(100, Math.max(1, Number(params.per_page) || 12));
    const data = listCars(params, {});
    return json(res, {
      status: 'ok', total: data.total, page: data.page, pages: data.pages, per_page: Number(params.per_page), sort: data.sort,
      items: data.rows.map((c) => {
        const d = decorate(c);
        return {
          id: d.id, slug: d.slug, name: `${d.brand} ${d.model}`, brand: d.brand, model: d.model,
          year: d.year, mileage: d.mileage, price: d.price, price_text: d.price_text, currency: 'BYN',
          transmission: d.trans_label, fuel: d.fuel_label, body: d.body_label, drive: d.drive_label,
          volume: d.volume, power: d.power, color: d.color, city: d.city, url: '/car/' + d.slug,
          photo: d.photo || null, engine_label: d.engine_label,
        };
      }),
    });
  }
  /* Партия карточек для нескончаемой ленты каталога. Кнопок страниц в разметке больше нет:
     `carsMore` на странице — это «маячок», а следующую партию карточек клиент берёт отсюда
     (см. `initInfinite` в public/assets/js/site.js). Фильтры и режим приходят в строке запроса
     ровно те же, что у страницы, поэтому лента продолжает ту же выдачу. */
  if (pathname === '/api/cars/cards') {
    return json(res, P.carsBatch(state, Object.fromEntries(url.searchParams)));
  }
  /* Число автомобилей под выбранные в панели поиска параметры — для счётчика на кнопке
     «Показать автомобили N». Панель спрашивает его на каждое изменение поля (initParamSearch
     в public/assets/js/site.js), поэтому ответ не кэшируем: следующий набор условий должен
     считаться заново. Условия те же, что у страницы и ленты, режим приходит параметром mode. */
  if (pathname === '/api/cars/count') {
    return json(res, P.carsCount(state, Object.fromEntries(url.searchParams)), 200, { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/sitemap.xml') {
    const staticPages = ['/', '/cars', '/cars-used', '/cars-new', '/electric', '/services', '/news', '/kalkulyator', '/contacts', '/cars-sold', '/reviews'];
    const cars = all("SELECT slug FROM cars WHERE status='published'");
    const arts = all('SELECT slug FROM articles');
    const base = siteBase();
    const urls = [...staticPages, ...cars.map((c) => '/car/' + c.slug), ...arts.map((a) => '/news/' + a.slug)];
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>`, { 'Content-Type': 'application/xml; charset=utf-8' });
  }

  /* POST-обработчики */
  if (method === 'POST') {
    const ct = req.headers['content-type'] || '';
    const buf = await readBody(req);

    if (pathname === '/login') {
      const f = parseUrlEncoded(buf);
      const r = login({ email: f.email, password: f.password });
      if (r.error) return html(res, P.loginPage(state, { error: r.error, next: f.next || '/', modal: true }), 400);      return redirect(res, f.next && f.next.startsWith('/') ? f.next : '/account', setCookieHeader([
        `${SESSION_COOKIE}=${createSession(r.user.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
      ]));
    }
    if (pathname === '/register') {
      const f = parseUrlEncoded(buf);
      const r = register({ email: f.email, password: f.password, name: f.name, phone: f.phone, city: f.city });
      if (r.error) return html(res, P.registerPage(state, { error: r.error, next: f.next || '/', modal: true }), 400);
      return redirect(res, f.next && f.next.startsWith('/') ? f.next : '/account', setCookieHeader([
        `${SESSION_COOKIE}=${createSession(r.user.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
      ]));
    }
    if (pathname === '/logout') {
      destroySession(state.cookies[SESSION_COOKIE]);
      return redirect(res, '/', setCookieHeader([`${SESSION_COOKIE}=; Path=/; Max-Age=0`]));
    }
    if (pathname === '/lead') {
      const f = parseUrlEncoded(buf);
      if (!f.name || !f.phone) return redirect(res, '/contacts?err=1');
      run('INSERT INTO leads (car_id, kind, name, phone, text, created_at) VALUES (?,?,?,?,?,?)',
        f.car_id ? Number(f.car_id) : null, String(f.kind || 'call').slice(0, 40), String(f.name).slice(0, 120),
        String(f.phone).slice(0, 40), String(f.text || '').slice(0, 2000), new Date().toISOString().slice(0, 19).replace('T', ' '));
      const back = f.car_id ? '/car/' + (carById(Number(f.car_id))?.slug || '') : '/contacts';
      return redirect(res, (back || '/contacts') + (back.includes('?') ? '&' : '?') + 'sent=1');
    }
    if (pathname === '/review') {
      const f = parseUrlEncoded(buf);
      if (f.author && f.text && f.text.length >= 20) {
        run('INSERT INTO reviews (author, city, rating, text, published, created_at) VALUES (?,?,?,?,1,?)',
          String(f.author).slice(0, 80), String(f.city || 'Гомель').slice(0, 80),
          Math.min(5, Math.max(1, Number(f.rating) || 5)), String(f.text).slice(0, 4000),
          new Date().toISOString().slice(0, 19).replace('T', ' '));
      }
      return redirect(res, '/reviews?sent=1');
    }
    if (pathname === '/sell') {
      let fields = {}; let files = [];
      if (ct.includes('multipart/form-data')) { const mp = parseMultipart(buf, ct); fields = mp.fields; files = mp.files; }
      else fields = parseUrlEncoded(buf);
      if (!state.user) return redirect(res, '/login?next=/sell&m=1');
      const err = validateCar(fields);
      if (err) return html(res, P.sellPage(state, { error: err }), 400);
      const slug = uniqueSlug(slugify(`${fields.brand} ${fields.model} ${fields.year}`));
      const photos = saveUploads(files, slug);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const trim = carTrim(fields);
      const equipment = composeEquipment({
        trimName: trim.name, interiorColor: trim.interiorColor,
        interiorMaterial: trim.interiorMaterial, options: trim.options,
      });
      const r = run(`INSERT INTO cars (slug, brand, model, generation, year, mileage, price, currency, transmission, volume, fuel, body, drive, color, power, vin, description, equipment, trim, interior_color, interior_material, options, status, is_new, featured, vin_checked, city, source_url, owner_id, views, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,0,?,?)`,
        slug, String(fields.brand).slice(0, 60), String(fields.model).slice(0, 60), String(fields.generation || '').slice(0, 80),
        Number(fields.year) || 0, Number(fields.mileage) || 0, Number(fields.price) || 0, 'BYN',
        fields.transmission || 'at', Number(fields.volume) || 0, fields.fuel || 'petrol', fields.body || 'sedan',
        fields.drive || 'fwd', String(fields.color || '').slice(0, 40), Number(fields.power) || 0,
        String(fields.vin || '').slice(0, 20).toUpperCase(), String(fields.description || '').slice(0, 4000),
        // Заявка с сайта — это новое объявление: получает флаг is_new, после модерации машина встанет
        // в «Новые поступления» и получит плашку «Новый». Раньше флаг выводился из года и пробега.
        equipment, trim.name, trim.interiorColor, trim.interiorMaterial, trim.options.join(', '),
        'pending', 1,
        String(fields.city || 'Гомель').slice(0, 60), '', state.user.id, now, now);
      const carId = Number(r.lastInsertRowid);
      photos.forEach((p, i) => run('INSERT INTO car_photos (car_id, path, sort) VALUES (?,?,?)', carId, p, i));
      return redirect(res, '/account?ok=' + encodeURIComponent('Объявление отправлено на модерацию.'));
    }
    if (pathname.startsWith('/admin/')) {
      if (!state.user || state.user.role !== 'admin') return redirect(res, '/login?next=/admin&m=1');
      const f = parseUrlEncoded(buf);
      if (pathname === '/admin/car') {
        const id = Number(f.id);
        if (f.action === 'create') {
          const err = validateCar(f);
          if (err) return redirect(res, '/admin?tab=cars&error=' + encodeURIComponent(err));
          const slug = uniqueSlug(slugify(`${f.brand} ${f.model} ${f.year}`));
          const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
          const cr = run(`INSERT INTO cars (slug, brand, model, generation, year, mileage, price, discount, currency, transmission, volume, fuel, body, drive, color, power, vin, description, equipment, status, is_new, featured, vin_checked, city, source_url, owner_id, views, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?)`,
            slug, String(f.brand).slice(0, 60), String(f.model).slice(0, 60), String(f.generation || '').slice(0, 80),
            Number(f.year) || 0, Number(f.mileage) || 0, Number(f.price) || 0, Math.max(0, Number(f.discount) || 0), 'BYN',
            f.transmission || 'at', Number(f.volume) || 0, f.fuel || 'petrol', f.body || 'sedan',
            f.drive || 'fwd', String(f.color || '').slice(0, 40), Number(f.power) || 0,
            String(f.vin || '').slice(0, 20).toUpperCase(), String(f.description || '').slice(0, 4000), '',
            f.status === 'pending' ? 'pending' : 'published',
            /* Плашку «Новый» владелец ставит сам, галочкой в форме: раньше флаг выводился из года и
               пробега (2024+ и до 12 000 км) и потому не совпадал с тем, что человек считает новым
               объявлением. Автоматический расчёт остался только для объявлений с сайта (/sell). */
            f.is_new === '1' ? 1 : 0,
            f.featured === '1' ? 1 : 0, f.vin_checked === '1' ? 1 : 0,
            String(f.city || 'Гомель').slice(0, 60), '', now, now);
          return redirect(res, '/admin?tab=cars&ok=' + encodeURIComponent(`Автомобиль добавлен: /car/${slug}`) + '&new=' + Number(cr.lastInsertRowid));
        }
        if (f.action === 'delete') {
          /* Удаление карточки = продажа (заказчик 2026-09-30: «реально сделай, чтобы когда карточка
             авто исчезает с сайта, то есть авто продали и карточку удалили, этот авто появлялся в
             продажах как реальная продажа»). Поэтому перед удалением пишем запись в sold_cars —
             её показывает страница «Проданные автомобили», и та же машина попадает в группу
             «Проданные автомобили в этом месяце», потому что sold_at = сегодня.
             Фото берём у самой карточки (первое по порядку): в таблице проданных видно ту же
             машину, что стояла в каталоге, а файл при удалении не стирается и остаётся на диске.
             Продажей считаем только опубликованную карточку — удаление черновика или скрытого
             объявления продажей не является. Повтор по тому же слагу не задваиваем. */
          const car = one('SELECT id, slug, brand, model, year, price, mileage, status FROM cars WHERE id=?', id);
          let sold = false;
          if (car && car.status === 'published' && !one('SELECT id FROM sold_cars WHERE source_slug=?', car.slug)) {
            const shot = one('SELECT path FROM car_photos WHERE car_id=? ORDER BY sort LIMIT 1', id);
            run('INSERT INTO sold_cars (brand, model, year, price, mileage, sold_at, photo, source_slug) VALUES (?,?,?,?,?,?,?,?)',
              car.brand, car.model, car.year, car.price, car.mileage, nowStr(), shot ? shot.path : '', car.slug);
            sold = true;
          }
          run('DELETE FROM car_photos WHERE car_id=?', id);
          run('DELETE FROM cars WHERE id=?', id);
          if (sold) return redirect(res, '/admin?tab=cars&ok=' + encodeURIComponent(`${car.brand} ${car.model} — карточка удалена с сайта, продажа записана в «Продано».`));
        }
        else if (f.action === 'publish') run("UPDATE cars SET status='published', updated_at=? WHERE id=?", nowStr(), id);
        else if (f.action === 'pending') run("UPDATE cars SET status='pending', updated_at=? WHERE id=?", nowStr(), id);
        else if (f.action === 'feature') run("UPDATE cars SET featured=?, updated_at=? WHERE id=?", Number(f.value) ? 1 : 0, nowStr(), id);
        /* Плашки «Новый» и сумму скидки владелец правит прямо в строке таблицы: без этого обе
           пометки жили бы только в базе, а на сайте их нельзя было бы ни поставить, ни снять. */
        else if (f.action === 'flags') run("UPDATE cars SET is_new=?, discount=?, updated_at=? WHERE id=?", f.is_new === '1' ? 1 : 0, Math.max(0, Number(f.discount) || 0), nowStr(), id);
        return redirect(res, '/admin?tab=cars&ok=' + encodeURIComponent('Готово.'));
      }
      if (pathname === '/admin/review') { run('DELETE FROM reviews WHERE id=?', Number(f.id)); return redirect(res, '/admin?tab=reviews&ok=' + encodeURIComponent('Отзыв удалён.')); }
      if (pathname === '/admin/settings') {
        for (const k of ['site_name', 'phone_1', 'phone_2', 'email', 'address', 'hours', 'company']) if (f[k] !== undefined) setSetting(k, String(f[k]).slice(0, 300));
        return redirect(res, '/admin?tab=settings&ok=' + encodeURIComponent('Настройки сохранены.'));
      }
      return redirect(res, '/admin');
    }
    /* служебный эндпоинт обновления избранного/сравнения */
    if (pathname === '/api/state') {
      const f = parseUrlEncoded(buf);
      const cookies = [];
      if (f.favorites !== undefined) cookies.push(`an_fav=${encodeURIComponent(f.favorites)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax`);
      if (f.compare !== undefined) cookies.push(`an_cmp=${encodeURIComponent(f.compare)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax`);
      return json(res, { ok: true, favorites: f.favorites ?? null, compare: f.compare ?? null }, 200, cookies.length ? setCookieHeader(cookies) : {});
    }
    return notFoundRaw(res);
  }

  /* GET-страницы */
  const p1 = pathname.split('/')[1] || '';
  const p2 = pathname.split('/')[2] || '';

  try {
    if (pathname === '/') return html(res, P.home(state));
    if (pathname === '/cars') return html(res, P.catalog(state, url, 'all'));
    if (pathname === '/cars-used') return html(res, P.catalog(state, url, 'used'));
    if (pathname === '/cars-new') return html(res, P.catalog(state, url, 'new'));
    if (pathname === '/electric') return html(res, P.catalog(state, url, 'electric'));
    if (p1 === 'cars' && p2 && p2 !== 'filter') return html(res, P.brandPage(state, p2));
    if (p1 === 'cars' && p2 === 'filter') return html(res, P.catalog(state, url, 'all'));
    if (p1 === 'car' && p2) {
      const car = carBySlug(decodeURIComponent(p2));
      const canView = car && (car.status === 'published'
        || (state.user && (state.user.role === 'admin' || state.user.id === car.owner_id)));
      if (!canView) return notFoundRaw(res);
      return html(res, P.carPage(state, p2, url));
    }
    if (pathname === '/services') return html(res, P.servicesPage(state));
    if (p1 === 'services' && p2) return html(res, P.servicePage(state, p2));
    if (pathname === '/news') return html(res, P.newsPage(state));
    if (p1 === 'news' && p2) return html(res, P.articlePage(state, p2));
    if (pathname === '/kalkulyator') return html(res, P.calculatorPage(state));
    if (pathname === '/contacts') return html(res, P.contactsPage(state));
    if (pathname === '/cars-sold') return html(res, P.soldPage(state));
    if (pathname === '/reviews') return html(res, P.reviewsPage(state));
    if (pathname === '/favorites') return html(res, P.favoritesPage(state));
    if (pathname === '/compare') return html(res, P.comparePage(state));
    if (pathname === '/sell') return html(res, P.sellPage(state, { ok: url.searchParams.get('ok') || '' }));
    if (pathname === '/login') return html(res, P.loginPage(state, { next: url.searchParams.get('next') || '/' }));
    if (pathname === '/register') return html(res, P.registerPage(state, { next: url.searchParams.get('next') || '/' }));
    if (pathname === '/account') {
      if (!state.user) return redirect(res, '/login?next=/account&m=1');
      return html(res, P.accountPage(state, { ok: url.searchParams.get('ok') || '' }));
    }
    if (pathname === '/admin') {
      if (!state.user) return redirect(res, '/login?next=/admin&m=1');
      if (state.user.role !== 'admin') return html(res, P.notFound(state), 403);
      return html(res, P.adminPage(state, { tab: url.searchParams.get('tab') || 'cars', ok: url.searchParams.get('ok') || '' }));
    }
    if (pathname === '/search') return html(res, P.catalog(state, url, 'all'));
    return html(res, P.notFound(state), 404);
  } catch (e) {
    console.error('[page error]', pathname, e && e.message);
    return html(res, `<pre style="padding:24px;font:13px/1.5 monospace">Ошибка рендеринга ${escapeHtml(pathname)}\n${escapeHtml(String(e && e.stack || e))}</pre>`, 500);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function notFoundRaw(res) { send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }); }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function uniqueSlug(base) {
  let slug = base || 'car';
  let i = 2;
  while (one('SELECT id FROM cars WHERE slug=?', slug)) slug = base + '-' + i++;
  return slug;
}
function validateCar(f) {
  if (!f.brand || String(f.brand).trim().length < 2) return 'Укажите марку автомобиля.';
  if (!f.model || String(f.model).trim().length < 1) return 'Укажите модель автомобиля.';
  const y = Number(f.year);
  if (!y || y < 1950 || y > new Date().getFullYear() + 1) return 'Укажите корректный год выпуска.';
  const m = Number(f.mileage);
  if (!Number.isFinite(m) || m < 0 || m > 3000000) return 'Укажите корректный пробег.';
  if (f.vin && String(f.vin).trim() && String(f.vin).trim().length !== 17) return 'VIN должен содержать 17 символов.';
  return '';
}

/* Комплектация из формы объявления (заказчик 2026-09-27: «чтобы можно было выбирать комплектацию
   и её содержимое»). Комплектацию можно взять готовым набором из списка (lib/car-options.mjs:
   TRIMS) или написать своё название — своё поле главнее, потому что человек мог выбрать набор и
   потом поправить название руками. Значения салона и опций сверяем со справочником av.by: в форме
   им соответствуют <select> и чекбоксы, но подставленный извне POST не должен писать в базу
   произвольный текст. Собранный текст по-прежнему уходит в cars.equipment — старые карточки,
   поиск и выгрузка читают его как раньше. */
function carTrim(fields) {
  const preset = TRIMS.find((t) => t.id === fields.trim) || null;
  const own = String(fields.trim_name || '').trim().slice(0, 60);
  const pick = (list, v) => (list.includes(String(v || '')) ? String(v) : '');
  return {
    name: own || (preset && preset.id !== 'custom' ? preset.name : ''),
    interiorColor: pick(INTERIOR_COLORS, fields.interior_color),
    interiorMaterial: pick(INTERIOR_MATERIALS, fields.interior_material),
    options: normalizeOptions(fields.options),
  };
}

/* ── старт ─────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[fatal]', e);
    if (!res.headersSent) send(res, 500, 'Внутренняя ошибка сервера', { 'Content-Type': 'text/plain; charset=utf-8' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  const st = carStats();
  console.log(`Автонова с пробегом → http://${HOST}:${PORT}`);
  console.log(`БД: ${DB_PATH} · автомобилей: ${st.total} · пользователей: ${st.users}`);
});
