// Menghasilkan SQL data contoh: npx tsx scripts/seed.ts > seed.sql
import { readFileSync } from 'node:fs';
import { hashPassword } from '../src/security';

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/engine/examples/${name}.json`, import.meta.url), 'utf8'));
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export const DEMO_PASSWORD = 'demo1234';
const ADMINS = ['u_hana', 'u_dewi', 'u_irfan'];

export async function seedSql(): Promise<string> {
  const hash = await hashPassword(DEMO_PASSWORD);
  const out: string[] = [];
  for (const u of read('directory')) {
    const email = `${u.id.replace('u_', '')}@contoh.test`;
    out.push(
      `INSERT INTO users (id, email, name, department, manager_id, roles, is_admin, password_hash) VALUES (${q(u.id)}, ${q(email)}, ${q(u.name)}, ${q(u.department)}, ${q(u.managerId)}, ${q(JSON.stringify(u.roles))}, ${ADMINS.includes(u.id) ? 1 : 0}, ${q(hash)});`,
    );
  }
  const at = '2026-01-01T00:00:00.000Z';
  for (const key of ['leave', 'it_access', 'purchase']) {
    const id = `${key}-v1`;
    out.push(
      `INSERT INTO flow_versions (id, flow_key, version, status, definition, sop_url, citations, created_by, edited_by, effective_from, activated_by, activated_at, created_at) VALUES (${q(id)}, ${q(key)}, 1, 'active', ${q(JSON.stringify(read(key)))}, 'https://contoh.test/sop-${key}', '[]', 'u_hana', '["u_hana"]', ${q(at)}, 'u_dewi', ${q(at)}, ${q(at)});`,
      `INSERT INTO audit_events (at, actor_type, actor_id, action, flow_version_id, detail) VALUES (${q(at)}, 'user', 'u_dewi', 'version_activated', ${q(id)}, '{"seed":true}');`,
    );
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await seedSql());
