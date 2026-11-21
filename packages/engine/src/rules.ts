import { Engine, type TopLevelCondition } from 'json-rules-engine';
import { BUILTIN_FIELDS, flattenSteps, type Condition, type Field, type FlowDefinition } from './definition';
import { EngineError, type User } from './types';

// Evaluasi kondisi dan tabel aturan diserahkan ke json-rules-engine. Modul ini
// hanya menerjemahkan definisi alur menjadi aturan engine dan menjaga dua hal:
// fakta selalu bertipe sesuai deklarasi field, dan setiap kegagalan evaluasi
// menghentikan routing (gagal-aman) alih-alih diam-diam memilih baris lain.

type FieldType = Field['type'];
type FactValue = string | number | boolean | null;

/** Fakta sebuah permintaan: nilai yang sudah dinormalkan beserta tipe tiap field. */
export interface Facts {
  values: Record<string, FactValue>;
  types: Record<string, FieldType>;
}

const OPERATOR: Record<Condition['op'], string> = {
  eq: 'equal',
  neq: 'notEqual',
  gt: 'greaterThan',
  gte: 'greaterThanInclusive',
  lt: 'lessThan',
  lte: 'lessThanInclusive',
  in: 'in',
};

/** Tanggal dibandingkan sebagai angka (milidetik UTC), bukan sebagai teks. */
function encode(raw: unknown, type: FieldType, where: string, code: 'INVALID_DATA' | 'INVALID_DEFINITION'): string | number | boolean {
  if (type === 'date') {
    const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(ms)) throw new EngineError(code, `${where} must be a valid date`);
    return ms;
  }
  if (type === 'number' ? typeof raw !== 'number' || !Number.isFinite(raw) : typeof raw !== type) {
    throw new EngineError(code, `${where} must be of type ${type}`);
  }
  return raw as string | number | boolean;
}

/**
 * Setiap field yang dideklarasikan selalu punya fakta: nilai bertipe benar, atau
 * null kalau kosong. Engine dijalankan tanpa `allowUndefinedFacts`, sehingga
 * aturan yang merujuk field di luar daftar ini gagal dengan error.
 */
export function buildFacts(fields: Field[], data: Record<string, unknown>, requester: User, about: Record<string, unknown> = {}): Facts {
  const types: Record<string, FieldType> = { ...BUILTIN_FIELDS };
  for (const f of fields) types[f.key] = f.type;
  const source: Record<string, unknown> = { ...data, ...about, 'requester.department': requester.department };
  const values: Record<string, FactValue> = {};
  for (const [key, type] of Object.entries(types)) {
    const raw = source[key];
    values[key] = raw === undefined || raw === null ? null : encode(raw, type, `Field ${key}`, 'INVALID_DATA');
  }
  return { values, types };
}

/**
 * Semua kondisi harus terpenuhi (AND). Field yang kosong tidak pernah cocok,
 * termasuk untuk operator "tidak sama dengan", jadi tiap kondisi didahului
 * pemeriksaan bahwa faktanya terisi.
 */
export function compileConditions(when: Condition[], types: Record<string, FieldType>): TopLevelCondition {
  return {
    all: when.map((c) => {
      const type = types[c.field];
      if (!type) throw new EngineError('INVALID_DEFINITION', `Condition refers to a field that does not exist: ${c.field}`);
      if ((c.op === 'in') !== Array.isArray(c.value)) {
        throw new EngineError('INVALID_DEFINITION', `Operator ${c.op} on ${c.field} has the wrong kind of value`);
      }
      const where = `Condition value for ${c.field}`;
      const value = Array.isArray(c.value)
        ? c.value.map((v) => encode(v, type, where, 'INVALID_DEFINITION'))
        : encode(c.value, type, where, 'INVALID_DEFINITION');
      return {
        all: [
          { fact: c.field, operator: 'notEqual', value: null },
          { fact: c.field, operator: OPERATOR[c.op], value },
        ],
      };
    }),
  };
}

/**
 * Kebijakan "baris pertama yang cocok": tiap kandidat menjadi satu aturan dengan
 * prioritas menurun, dan engine berhenti pada aturan pertama yang berhasil.
 * Mengembalikan indeks kandidat yang cocok, atau undefined kalau tidak ada.
 */
export async function firstMatch(candidates: { when: Condition[] }[], facts: Facts): Promise<number | undefined> {
  if (candidates.length === 0) return undefined;
  const engine = new Engine([], { allowUndefinedFacts: false, replaceFactsInEventParams: false });
  candidates.forEach((candidate, index) => {
    engine.addRule({
      name: `kandidat-${index}`,
      priority: candidates.length - index,
      conditions: compileConditions(candidate.when, facts.types),
      event: { type: 'match', params: { index } },
      onSuccess: () => {
        engine.stop();
      },
    });
  });
  let hits: number[];
  try {
    const { events } = await engine.run(facts.values);
    hits = events.map((e) => (e.params as { index: number }).index);
  } catch (e) {
    throw new EngineError('ROUTING', `Rule evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return hits.length ? Math.min(...hits) : undefined;
}

export async function matches(when: Condition[], facts: Facts): Promise<boolean> {
  return (await firstMatch([{ when }], facts)) !== undefined;
}

/**
 * Memastikan seluruh kondisi sebuah definisi bisa diterjemahkan dan dimuat engine.
 * Dipanggil sebelum aktivasi, supaya aturan yang rusak tidak pernah berlaku.
 */
export function assertCompilable(definition: FlowDefinition): void {
  const types: Record<string, FieldType> = { ...BUILTIN_FIELDS };
  for (const f of definition.fields) types[f.key] = f.type;
  const groups = [
    ...definition.tables.flatMap((t) => t.rows.map((r) => r.when)),
    ...flattenSteps(definition.steps).flatMap((s) => (s.type === 'condition' ? s.branches.map((b) => b.when) : [])),
  ];
  const engine = new Engine([], { allowUndefinedFacts: false });
  groups.forEach((when, i) => {
    try {
      engine.addRule({ name: `cek-${i}`, conditions: compileConditions(when, types), event: { type: 'match' } });
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError('INVALID_DEFINITION', `Rule could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
