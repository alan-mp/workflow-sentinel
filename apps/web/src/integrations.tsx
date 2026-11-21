import { useState, type FormEvent } from 'react';
import { api, fmtTime } from './api';
import { useLoad } from './pages';
import { Badge, Empty, ErrorNote, Loading, PageHead } from './ui';

interface Overview {
  clients: { id: string; name: string; keyPrefix: string; callbackHosts: string[]; createdAt: string; revokedAt: string | null }[];
  webhooks: { id: string; flowKey: string | null; url: string; createdAt: string }[];
}
interface Delivery {
  id: string;
  requestId: string;
  event: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
}
/** Shown once, right after creation. */
interface Secret {
  title: string;
  rows: [string, string][];
}

const DELIVERY_BADGE = { delivered: ['approved', 'Delivered'], pending: ['open', 'Retrying'], failed: ['rejected', 'Failed'] } as const;
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function Integrations() {
  const [data, reload, loadError] = useLoad<Overview>('/admin/integrations');
  const [deliveries, reloadDeliveries] = useLoad<Delivery[]>('/admin/integrations/deliveries');
  const [flows] = useLoad<{ key: string; name: string }[]>('/flows');
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [url, setUrl] = useState('');
  const [flowKey, setFlowKey] = useState('');

  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      await Promise.all([reload(), reloadDeliveries()]);
    } catch (err: any) {
      setError(err.message);
    }
  };
  const addClient = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api('POST', '/admin/integrations/clients', { name, callbackHosts: hosts.split(/[\s,]+/).filter(Boolean) });
      setSecret({ title: `API client "${res.name}" created`, rows: [['API key', res.apiKey], ['Webhook signing secret', res.signingSecret]] });
      setName('');
      setHosts('');
    });
  };
  const addWebhook = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api('POST', '/admin/integrations/webhooks', { url, flowKey: flowKey || null });
      setSecret({ title: `Webhook to ${host(res.url)} registered`, rows: [['Signing secret', res.secret]] });
      setUrl('');
      setFlowKey('');
    });
  };
  const active = data?.clients.filter((c) => !c.revokedAt) ?? [];

  return (
    <div className="page">
      <PageHead
        title="Integrations"
        sub="Other systems file requests through the API and are told the outcome by webhook. The approval rules stay here: a request filed by another system follows the same flow as one filed in this app."
      />
      <ErrorNote>{loadError || error}</ErrorNote>
      {secret ? (
        <div className="secret-box" role="status">
          <p className="secret-title">{secret.title}</p>
          <p className="field-hint">Copy these values now. They are shown once and cannot be read again.</p>
          <dl>
            {secret.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <code>{value}</code>
                  <button className="btn small" onClick={() => navigator.clipboard?.writeText(value)}>
                    Copy
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <button className="btn small" onClick={() => setSecret(null)}>
            I have saved them
          </button>
        </div>
      ) : null}
      {!data && !loadError ? <Loading /> : null}
      {data ? (
        <div className="two-col">
          <div className="stack">
            <section>
              <h2 className="section-title">API clients</h2>
              {active.length === 0 ? (
                <Empty title="No system can file requests yet">Create an API client for each system that will send requests.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table static">
                    <thead>
                      <tr>
                        <th>System</th>
                        <th>Key</th>
                        <th>Allowed callback hosts</th>
                        <th>Created</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.name}
                            <div className="cell-sub">{c.id}</div>
                          </td>
                          <td className="num">{c.keyPrefix}…</td>
                          <td>{c.callbackHosts.join(', ') || <span className="cell-sub">None</span>}</td>
                          <td className="num">{fmtTime(c.createdAt)}</td>
                          <td className="col-action">
                            <button
                              className="btn small danger"
                              onClick={() => confirm(`Revoke the key of "${c.name}"? The system will no longer be able to file requests.`) && run(() => api('DELETE', `/admin/integrations/clients/${c.id}`))}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2 className="section-title">Webhooks</h2>
              {data.webhooks.length === 0 ? (
                <Empty title="No webhooks registered">A webhook is called when a request is approved, rejected, or cancelled.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table static">
                    <thead>
                      <tr>
                        <th>URL</th>
                        <th>Flow</th>
                        <th>Created</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.webhooks.map((w) => (
                        <tr key={w.id}>
                          <td className="wrap-anywhere">{w.url}</td>
                          <td>{w.flowKey ?? 'All flows'}</td>
                          <td className="num">{fmtTime(w.createdAt)}</td>
                          <td className="col-action">
                            <button className="btn small danger" onClick={() => confirm(`Stop sending events to ${host(w.url)}?`) && run(() => api('DELETE', `/admin/integrations/webhooks/${w.id}`))}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2 className="section-title">Recent deliveries</h2>
              {deliveries?.length === 0 ? <Empty title="Nothing sent yet">Deliveries appear here when a request with a webhook or callback URL finishes.</Empty> : null}
              {deliveries?.length ? (
                <div className="table-wrap">
                  <table className="table static">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Event</th>
                        <th>To</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.map((d) => (
                        <tr key={d.id}>
                          <td className="num">
                            {d.requestId}
                            <div className="cell-sub">{fmtTime(d.createdAt)}</div>
                          </td>
                          <td>{d.event}</td>
                          <td>{host(d.url)}</td>
                          <td>
                            <Badge status={DELIVERY_BADGE[d.status][0]} label={DELIVERY_BADGE[d.status][1]} />
                            {d.status !== 'delivered' ? (
                              <div className="cell-sub">
                                {d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}
                                {d.lastError ? `, last error: ${d.lastError}` : ''}
                                {d.nextAttemptAt ? `, next try ${fmtTime(d.nextAttemptAt)}` : ''}
                              </div>
                            ) : null}
                          </td>
                          <td className="col-action">
                            {d.status !== 'delivered' ? (
                              <button className="btn small" onClick={() => run(() => api('POST', `/admin/integrations/deliveries/${d.id}/retry`))}>
                                Send now
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </div>
          <div className="stack">
            <form className="sheet" onSubmit={addClient}>
              <h2>New API client</h2>
              <label className="field">
                <span className="field-label">System name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="HR application" required />
              </label>
              <label className="field">
                <span className="field-label">Allowed callback hosts</span>
                <input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="hr.example.com" />
                <span className="field-hint">Optional. Host names this system may name as its callback URL, separated by commas.</span>
              </label>
              <div className="form-actions">
                <button className="btn primary">Create API client</button>
              </div>
            </form>
            <form className="sheet" onSubmit={addWebhook}>
              <h2>New webhook</h2>
              <label className="field">
                <span className="field-label">URL</span>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.example.com/hooks/approval" pattern="https://.*" required />
                <span className="field-hint">Must start with https://</span>
              </label>
              <label className="field">
                <span className="field-label">Flow</span>
                <select value={flowKey} onChange={(e) => setFlowKey(e.target.value)}>
                  <option value="">All flows</option>
                  {flows?.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button className="btn primary">Register webhook</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
