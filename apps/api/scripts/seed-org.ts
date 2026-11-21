// Melengkapi database contoh yang dibuat sebelum master organisasi ada:
// npx tsx scripts/seed-org.ts > .seed.sql, lalu jalankan lewat wrangler d1 execute.
import { readFileSync } from 'node:fs';
import { AUTHORITY_NAME, ORG_OWNERS } from './seed';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/engine/examples/${name}.json`, import.meta.url), 'utf8'));
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const out: string[] = [];
for (const unit of read('org')) {
  out.push(
    `INSERT OR REPLACE INTO org_units (id, name, level, parent_id, head_user_id) VALUES (${q(unit.id)}, ${q(unit.name)}, ${q(unit.level)}, ${q(unit.parentId)}, ${q(unit.headUserId)});`,
  );
}
for (const u of read('directory')) {
  out.push(`UPDATE users SET unit_id = ${q(u.unitId)}, title = ${q(/\((.*)\)/.exec(u.name)?.[1])} WHERE id = ${q(u.id)};`);
}
for (const [id, name] of Object.entries(AUTHORITY_NAME)) out.push(`UPDATE authorities SET name = ${q(name)} WHERE id = ${q(id)};`);
for (const owner of ORG_OWNERS) {
  out.push(`INSERT OR IGNORE INTO org_owners (user_id, assigned_by, assigned_at) VALUES (${q(owner)}, 'u_hadi', '2026-01-01T00:00:00.000Z');`);
}
console.log(out.join('\n'));
