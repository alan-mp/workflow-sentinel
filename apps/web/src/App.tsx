import { useEffect, useState } from 'react';
import { api } from './api';
import { Editor } from './admin/Editor';
import { Flows } from './admin/Flows';
import { Delegations, Inbox, Login, MyRequests, NewRequest, Notifications, RequestDetail } from './pages';

export interface Me {
  id: string;
  name: string;
  email: string;
  /** Admin sistem (IT). */
  isAdmin: boolean;
  /** Alur yang dimiliki sebagai pemilik proses. */
  ownedFlows: string[];
}

const useHash = () => {
  const [hash, setHash] = useState(location.hash.slice(1) || '/inbox');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/inbox');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [unread, setUnread] = useState(0);
  const hash = useHash();
  const load = () => api<Me>('GET', '/me').then(setMe, () => setMe(null));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (me) api<any[]>('GET', '/notifications').then((n) => setUnread(n.filter((x) => !x.read_at).length), () => {});
  }, [me, hash]);

  if (me === undefined) return null;
  if (!me) return <Login onDone={load} />;

  const [, page, a, b] = hash.split('/');
  const manages = me.isAdmin || me.ownedFlows.length > 0;
  const tabs = [
    ['inbox', 'Kotak masuk'],
    ['requests', 'Permintaan'],
    ['delegations', 'Delegasi'],
    ['notifications', `Notifikasi${unread ? ` (${unread})` : ''}`],
    ...(manages ? [['admin', 'Alur']] : []),
  ] as const;
  const logout = async () => {
    await api('POST', '/logout');
    location.hash = '';
    setMe(null);
  };

  let body;
  if (page === 'requests') body = <MyRequests />;
  else if (page === 'new' && a) body = <NewRequest flowKey={a} />;
  else if (page === 'r' && a) body = <RequestDetail id={a} key={a} />;
  else if (page === 'delegations') body = <Delegations me={me} />;
  else if (page === 'notifications') body = <Notifications />;
  else if (page === 'admin' && a === 'v' && b && manages) return <Editor id={b} key={b} me={me} />;
  else if (page === 'admin' && manages) body = <Flows me={me} />;
  else body = <Inbox />;

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Sentinel</strong>
        <span className="muted grow">{me.name}</span>
        <button className="link" onClick={logout}>
          Keluar
        </button>
      </header>
      <main className="content">{body}</main>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <a key={key} href={`#/${key}`} className={page === key || (!page && key === 'inbox') ? 'on' : ''}>
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
