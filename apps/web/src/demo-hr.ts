// "HR application (simulation)": a stand-in for another internal system. It talks to Sentinel only
// through the public integration API (API key) and receives outcomes through the demo webhook receiver.
import './demo-hr.css';

type Field = { key: string; label: string; type: 'number' | 'string' | 'boolean' | 'date'; optional?: boolean };
type Flow = { key: string; name: string; fields: Field[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {}
  },
};
let flows: Flow[] = [];
let lastBody: string | null = null;
let online = true;

const key = () => $<HTMLInputElement>('key').value.trim();
const show = (label: string, value: unknown) => {
  const pre = $<HTMLPreElement>('exchange');
  pre.textContent = `${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n\n` + pre.textContent;
};

async function call(method: string, path: string, body?: string) {
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${key()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

function renderFields() {
  const flow = flows.find((f) => f.key === $<HTMLSelectElement>('flow').value);
  const box = $('fields');
  box.innerHTML = '';
  for (const f of flow?.fields ?? []) {
    const label = document.createElement('label');
    label.textContent = `${f.label}${f.optional ? ' (optional)' : ''} `;
    const input = document.createElement('input');
    input.dataset.key = f.key;
    input.dataset.type = f.type;
    input.type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'boolean' ? 'checkbox' : 'text';
    label.append(input);
    box.append(label);
  }
  $<HTMLInputElement>('ref').value = `HR-${Date.now().toString(36).toUpperCase()}`;
}

$('load').onclick = async () => {
  store.set('key', key());
  store.set('secret', $<HTMLInputElement>('secret').value.trim());
  const res = await call('GET', '/api/integrations/flows');
  $('connect-status').textContent = res.status === 200 ? `Connected. ${(res.json as Flow[]).length} flows available.` : `Sentinel answered ${res.status}: ${JSON.stringify(res.json)}`;
  if (res.status !== 200) return;
  flows = res.json as Flow[];
  $('flow').innerHTML = flows.map((f) => `<option value="${f.key}">${f.name.replace(/</g, '&lt;')} (${f.key})</option>`).join('');
  const trip = flows.find((f) => /trip|dinas/i.test(`${f.key} ${f.name}`));
  if (trip) $<HTMLSelectElement>('flow').value = trip.key;
  renderFields();
};
$('flow').onchange = renderFields;

async function send(body: string) {
  show('→ POST /api/integrations/requests', JSON.parse(body));
  const res = await call('POST', '/api/integrations/requests', body);
  show(`← ${res.status}`, res.json);
}

$('submit').onclick = async () => {
  const data: Record<string, unknown> = {};
  for (const input of $('fields').querySelectorAll('input')) {
    const k = input.dataset.key!;
    if (input.dataset.type === 'boolean') data[k] = input.checked;
    else if (input.value !== '') data[k] = input.dataset.type === 'number' ? Number(input.value) : input.value;
  }
  lastBody = JSON.stringify({
    flowKey: $<HTMLSelectElement>('flow').value,
    requesterEmail: $<HTMLInputElement>('email').value.trim(),
    externalRef: $<HTMLInputElement>('ref').value.trim(),
    callbackUrl: `${location.origin}/api/demo/hr/webhook`,
    data,
  });
  $<HTMLButtonElement>('resend').disabled = false;
  await send(lastBody);
};
$('resend').onclick = () => lastBody && send(lastBody);

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function verify(signature: string | null, body: string): Promise<string> {
  const secret = $<HTMLInputElement>('secret').value.trim();
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(signature ?? '');
  if (!m) return 'missing';
  if (!secret) return 'no secret entered';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${m[1]}.${body}`)));
  return mac === m[2] ? 'valid' : 'INVALID';
}

async function refresh() {
  const res = await fetch('/api/demo/hr/received');
  if (!res.ok) return;
  const { online: on, received } = (await res.json()) as { online: boolean; received: { received_at: string; event: string; signature: string; body: string }[] };
  online = on;
  $('receiver-state').textContent = on ? 'Receiver online' : 'Receiver offline (answers 503)';
  $('receiver-state').className = `pill ${on ? 'ok' : 'bad'}`;
  $('toggle').textContent = on ? 'Take receiver offline' : 'Bring receiver online';
  if (!received.length) return;
  const rows = await Promise.all(
    received.map(async (r) => {
      let body: { request?: { id?: string; externalRef?: string } } = {};
      try {
        body = JSON.parse(r.body);
      } catch {}
      const sig = await verify(r.signature, r.body);
      const cell = (t: string, cls = '') => `<td class="${cls}">${String(t ?? '').replace(/</g, '&lt;')}</td>`;
      return `<tr>${cell(new Date(r.received_at).toLocaleTimeString('en-GB'))}${cell(r.event, 'event')}${cell(body.request?.id ?? '')}${cell(body.request?.externalRef ?? '')}${cell(sig, sig === 'valid' ? 'ok' : 'bad')}</tr>`;
    }),
  );
  $('received').innerHTML = rows.join('');
}
$('toggle').onclick = async () => {
  await fetch('/api/demo/hr/receiver', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online: !online }) });
  await refresh();
};

$<HTMLInputElement>('key').value = store.get('key');
$<HTMLInputElement>('secret').value = store.get('secret');
refresh();
setInterval(refresh, 3000);
