// Menghasilkan SQL data contoh: npx tsx scripts/seed.ts > seed.sql
import { readFileSync } from 'node:fs';
import { hashPassword } from '../src/security';

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/engine/examples/${name}.json`, import.meta.url), 'utf8'));
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export const DEMO_PASSWORD = 'demo1234';
/** Admin sistem (IT). */
const ADMINS = ['u_hadi'];
/** Pemilik master organisasi: HR menyusun, direksi meninjau (atau sebaliknya). */
export const ORG_OWNERS = ['u_hana', 'u_dewi'];
export const AUTHORITY_NAME: Record<string, string> = {
  director: 'Direktur',
  finance_manager: 'Persetujuan keuangan',
  it_manager: 'Persetujuan IT',
  erp_owner: 'Pemilik sistem ERP',
  it_security: 'Keamanan IT',
  it_helpdesk: 'Helpdesk IT',
  hr: 'Persetujuan HR',
  plant_manager: 'Persetujuan teknis produksi',
  purchasing: 'Purchasing',
};
/** Pemilik proses per alur. */
const OWNERS: Record<string, string[]> = {
  leave: ['u_hana', 'u_dewi'],
  it_access: ['u_irfan', 'u_sari'],
  purchase: ['u_hana', 'u_dewi'],
};

export async function seedSql(): Promise<string> {
  const hash = await hashPassword(DEMO_PASSWORD);
  const out: string[] = [];
  for (const unit of read('org')) {
    out.push(
      `INSERT INTO org_units (id, name, level, parent_id, head_user_id) VALUES (${q(unit.id)}, ${q(unit.name)}, ${q(unit.level)}, ${q(unit.parentId)}, ${q(unit.headUserId)});`,
    );
  }
  const authorities = new Set<string>();
  for (const u of read('directory')) {
    const email = `${u.id.replace('u_', '')}@contoh.test`;
    const title = /\((.*)\)/.exec(u.name)?.[1];
    out.push(
      `INSERT INTO users (id, email, name, department, unit_id, title, is_admin, password_hash) VALUES (${q(u.id)}, ${q(email)}, ${q(u.name)}, ${q(u.department)}, ${q(u.unitId)}, ${q(title)}, ${ADMINS.includes(u.id) ? 1 : 0}, ${q(hash)});`,
    );
    for (const role of u.roles as string[]) {
      if (!authorities.has(role)) out.push(`INSERT INTO authorities (id, name) VALUES (${q(role)}, ${q(AUTHORITY_NAME[role] ?? role)});`);
      authorities.add(role);
      out.push(`INSERT INTO authority_holders (authority_id, user_id) VALUES (${q(role)}, ${q(u.id)});`);
    }
  }
  for (const owner of ORG_OWNERS) {
    out.push(`INSERT INTO org_owners (user_id, assigned_by, assigned_at) VALUES (${q(owner)}, 'u_hadi', '2026-01-01T00:00:00.000Z');`);
  }
  const at = '2026-01-01T00:00:00.000Z';
  for (const key of ['leave', 'it_access', 'purchase']) {
    const id = `${key}-v1`;
    for (const owner of OWNERS[key]!) {
      out.push(`INSERT INTO flow_owners (flow_key, user_id, assigned_by, assigned_at) VALUES (${q(key)}, ${q(owner)}, 'u_hadi', ${q(at)});`);
    }
    out.push(
      `INSERT INTO flow_versions (id, flow_key, version, status, definition, sop_url, citations, created_by, edited_by, effective_from, activated_by, activated_at, created_at) VALUES (${q(id)}, ${q(key)}, 1, 'active', ${q(JSON.stringify(read(key)))}, 'https://contoh.test/sop-${key}', '[]', 'u_hana', '["u_hana"]', ${q(at)}, 'u_dewi', ${q(at)}, ${q(at)});`,
      `INSERT INTO audit_events (at, actor_type, actor_id, action, flow_version_id, detail) VALUES (${q(at)}, 'user', 'u_dewi', 'version_activated', ${q(id)}, '{"seed":true}');`,
    );
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await seedSql());
