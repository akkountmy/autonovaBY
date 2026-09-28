// Чистка демонстрационных данных: удаляет аккаунты, созданные автопроверками и тестовыми
// регистрациями (адреса @example.com), и все сессии. Администратор сохраняется.
// Запуск: node tools/clean-demo-data.mjs
import { db, all, one, run } from '../lib/db.mjs';

const admins = all("SELECT id, email FROM users WHERE role='admin'");
if (!admins.length) {
  console.error('В базе нет администратора — чистка отменена.');
  process.exit(1);
}
const testUsers = one("SELECT count(*) c FROM users WHERE email LIKE '%@example.com' AND role <> 'admin'").c;
const sessions = one('SELECT count(*) c FROM sessions').c;
if (!testUsers && !sessions) {
  console.log('Нечего чистить: демонстрационных аккаунтов и сессий нет.');
  process.exit(0);
}
db.exec('BEGIN');
run("DELETE FROM users WHERE email LIKE '%@example.com' AND role <> 'admin'");
run('DELETE FROM sessions');
db.exec('COMMIT');
try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* файл занят другим процессом — не страшно */ }
console.log(`Удалено: пользователей ${testUsers}, сессий ${sessions}.`);
console.log('Осталось пользователей:', JSON.stringify(all('SELECT id, email, role FROM users')));
