// Menjalankan PostgreSQL 16 lokal (embedded-postgres) untuk dev/test di sandbox tanpa Docker.
// Produksi tetap memakai deploy/docker-compose.dev.yml (postgres:16 resmi).
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync } from 'node:fs';

const dir = process.env.PG_DATA_DIR || '/tmp/flowcbt-pg';
const port = Number(process.env.PG_PORT || 55432);
mkdirSync(dir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF-8', '--locale=C'],
});

await pg.initialise();
await pg.start();
await pg.createDatabase('flowcbt').catch(() => {});
console.log(`PostgreSQL 16 aktif di 127.0.0.1:${port} (db: flowcbt, user: postgres/postgres)`);
console.log('DATABASE_URL=postgres://postgres:postgres@127.0.0.1:' + port + '/flowcbt?sslmode=disable');

process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
