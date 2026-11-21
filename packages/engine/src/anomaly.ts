import { flattenSteps, type Condition, type FlowDefinition } from './definition';

// Deterministic checks that flag requests worth a second look. They never block or route anything;
// they only inform the approver. Thresholds come from the flow's own rules, so a flow that approves
// above 25,000,000 is checked against 25,000,000 without anyone configuring it twice.

export type AnomalyKind = 'split_below_threshold' | 'amount_outlier' | 'duplicate';

export interface Anomaly {
  kind: AnomalyKind;
  /** One plain sentence for the approver. */
  message: string;
  /** Other requests involved, by ID. */
  related: string[];
  detail: Record<string, unknown>;
}

export interface PastRequest {
  id: string;
  requesterId: string;
  data: Record<string, unknown>;
  createdAt: string;
  status: string;
}

export interface AnomalyInput {
  definition: FlowDefinition;
  current: { id: string; requesterId: string; data: Record<string, unknown>; createdAt: string };
  /** Earlier requests of the same flow. The current request may be included; it is ignored. */
  history: PastRequest[];
}

export const ANOMALY_SETTINGS = {
  splitWindowDays: 14,
  duplicateWindowDays: 7,
  outlierWindowDays: 180,
  outlierFactor: 3,
  outlierMinSamples: 5,
};

const DAY = 86_400_000;
const INACTIVE = new Set(['rejected', 'cancelled']);
const fmt = (n: number) => n.toLocaleString('en-US');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The field that holds a money amount, recognised by its key or label (amount, nominal, total, price,
 * cost, harga, biaya, Rp). Other numbers, such as days of leave, are not money and are not checked.
 */
export function amountField(def: FlowDefinition): string | undefined {
  return def.fields.find((f) => f.type === 'number' && /amount|nominal|total|price|cost|harga|biaya|\brp\b|\(rp\)/i.test(`${f.key} ${f.label}`))?.key;
}

/** The field that groups requests of the same kind, if the flow has one. */
export function categoryField(def: FlowDefinition): string | undefined {
  return def.fields.find((f) => f.type === 'string' && /categ|kategori/i.test(`${f.key} ${f.label}`))?.key;
}

/** Every numeric limit the flow's rules compare the amount against, ascending. */
export function amountThresholds(def: FlowDefinition, field: string): number[] {
  const conditions: Condition[] = [
    ...def.tables.flatMap((t) => t.rows.flatMap((r) => r.when)),
    ...flattenSteps(def.steps).flatMap((s) => (s.type === 'condition' ? s.branches.flatMap((b) => b.when) : [])),
  ];
  const values = conditions
    .filter((c) => c.field === field && ['gt', 'gte', 'lt', 'lte'].includes(c.op) && typeof c.value === 'number' && c.value > 0)
    .map((c) => c.value as number);
  return [...new Set(values)].sort((a, b) => a - b);
}

const stable = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : JSON.stringify(v);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function detectAnomalies(input: AnomalyInput, settings = ANOMALY_SETTINGS): Anomaly[] {
  const { definition: def, current } = input;
  const now = Date.parse(current.createdAt);
  const within = (r: PastRequest, days: number) => now - Date.parse(r.createdAt) <= days * DAY && Date.parse(r.createdAt) <= now;
  const history = input.history.filter((r) => r.id !== current.id);
  const out: Anomaly[] = [];

  const duplicates = history.filter(
    (r) => r.requesterId === current.requesterId && !INACTIVE.has(r.status) && within(r, settings.duplicateWindowDays) && stable(r.data) === stable(current.data),
  );
  if (duplicates.length) {
    out.push({
      kind: 'duplicate',
      message: `The same requester filed an identical request in the last ${settings.duplicateWindowDays} days (${duplicates.map((r) => r.id).join(', ')}).`,
      related: duplicates.map((r) => r.id),
      detail: { windowDays: settings.duplicateWindowDays },
    });
  }

  const aKey = amountField(def);
  const amount = aKey ? num(current.data[aKey]) : undefined;
  if (!aKey || amount === undefined) return out;
  const label = def.fields.find((f) => f.key === aKey)?.label ?? aKey;
  const cKey = categoryField(def);
  const category = cKey ? current.data[cKey] : undefined;
  const sameCategory = (r: PastRequest) => !cKey || category === undefined || r.data[cKey] === category;
  const inCategory = cKey && category !== undefined ? ` in category "${String(category)}"` : '';

  // Split purchase: each request stays under a limit, together they reach it.
  const crossed = amountThresholds(def, aKey)
    .filter((limit) => amount < limit)
    .map((limit) => {
      const peers = history.filter((r) => {
        const v = num(r.data[aKey]);
        return r.requesterId === current.requesterId && !INACTIVE.has(r.status) && within(r, settings.splitWindowDays) && sameCategory(r) && v !== undefined && v < limit;
      });
      const total = amount + peers.reduce((s, r) => s + (num(r.data[aKey]) ?? 0), 0);
      return { limit, peers, total };
    })
    .filter((x) => x.peers.length > 0 && x.total >= x.limit);
  const top = crossed[crossed.length - 1];
  if (top) {
    out.push({
      kind: 'split_below_threshold',
      message:
        `Together with ${top.peers.length} other request${top.peers.length > 1 ? 's' : ''} from the same requester${inCategory} in the last ${settings.splitWindowDays} days, ` +
        `the ${label} adds up to ${fmt(top.total)}, which reaches the ${fmt(top.limit)} limit that each request stays below.`,
      related: top.peers.map((r) => r.id),
      detail: { limit: top.limit, total: top.total, windowDays: settings.splitWindowDays },
    });
  }

  // Outlier: far above what this flow (and category) usually asks for.
  const samples = history
    .filter((r) => !INACTIVE.has(r.status) && within(r, settings.outlierWindowDays) && sameCategory(r))
    .map((r) => num(r.data[aKey]))
    .filter((v): v is number => v !== undefined);
  if (samples.length >= settings.outlierMinSamples) {
    const usual = median(samples);
    if (usual > 0 && amount > settings.outlierFactor * usual) {
      out.push({
        kind: 'amount_outlier',
        message: `The ${label} of ${fmt(amount)} is ${(amount / usual).toFixed(1)} times the usual ${fmt(usual)} for this flow${inCategory} (median of ${samples.length} requests in the last ${settings.outlierWindowDays} days).`,
        related: [],
        detail: { median: usual, samples: samples.length, factor: amount / usual },
      });
    }
  }
  return out;
}
