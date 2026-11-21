// Pakai: npm run simulate -- <alur> <id pemohon> '<data JSON>'
import { readFileSync } from 'node:fs';
import { InMemoryDirectory, simulate, validateDefinition, type User } from '../src/index';

const [flow, requesterId, json] = process.argv.slice(2);
if (!flow || !requesterId || !json) {
  console.error(`Pakai: npm run simulate -- <leave|it_access|purchase> <id pemohon> '<data JSON>'`);
  process.exit(1);
}
const read = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const users: User[] = read('directory');
const result = validateDefinition(read(flow));
for (const i of result.issues) console.log(`[${i.level}] ${i.message}`);
if (!result.definition) process.exit(1);

const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
const steps = await simulate(result.definition, { requesterId, data: JSON.parse(json) }, new InMemoryDirectory({ users, units: read('org') }));
console.log(`${result.definition.name} - pemohon: ${name(requesterId)}`);
steps.forEach((s, i) => {
  const who = s.error ? `GAGAL: ${s.error}` : s.skipped ? '(dilewati)' : s.userIds.map(name).join(' atau ');
  const notes = [
    s.type === 'notify' ? 'notifikasi' : '',
    s.parallelIn ? `paralel: ${s.parallelIn}` : '',
    s.tableRow ? `tabel ${s.tableRow.tableId}, baris ${s.tableRow.rowId}` : '',
    s.reroutedToManager ? 'dialihkan ke atasan karena pemohon adalah approver' : '',
  ].filter(Boolean);
  console.log(`${i + 1}. ${s.name}: ${who}${notes.length ? `  [${notes.join('; ')}]` : ''}`);
});
