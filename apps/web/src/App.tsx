import { useEffect, useState, type ReactNode } from 'react';
import { Bell, FilePlus2, FileText, Inbox as InboxIcon, LogOut, Network, Plug, Search, Users, Workflow } from 'lucide-react';
import { api } from './api';
import { Editor } from './admin/Editor';
import { Flows } from './admin/Flows';
import { Integrations } from './integrations';
import { Organization } from './org';
import { Delegations, Inbox, Login, MyRequests, NewRequest, Notifications, RequestPage } from './pages';
import { Person } from './ui';

export interface Me {
  id: string;
  name: string;
  email: string;
  /** Admin sistem (IT). */
  isAdmin: boolean;
  /** Alur yang dimiliki sebagai pemilik proses. */
  ownedFlows: string[];
  /** Pemilik master organisasi: mengusulkan dan meninjau perubahan struktur. */
  ownsOrg?: boolean;
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

export interface Counts {
  inbox: number;
  unread: number;
}

type NavItem = { key: string; label: string; short: string; icon: ReactNode; count?: number };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [counts, setCounts] = useState<Counts>({ inbox: 0, unread: 0 });
  const [query, setQuery] = useState('');
  const hash = useHash();
  const load = () => api<Me>('GET', '/me').then(setMe, () => setMe(null));
  const refreshCounts = () => {
    api<any[]>('GET', '/notifications').then((n) => setCounts((c) => ({ ...c, unread: n.filter((x) => !x.read_at).length })), () => {});
    api<any[]>('GET', '/inbox').then((t) => setCounts((c) => ({ ...c, inbox: t.length })), () => {});
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (me) refreshCounts();
  }, [me, hash]);

  if (me === undefined) return null;
  if (!me) return <Login onDone={load} />;

  const [, page = 'inbox', a, b] = hash.split('/');
  const manages = me.isAdmin || me.ownedFlows.length > 0;
  const logout = async () => {
    await api('POST', '/logout');
    location.hash = '';
    setMe(null);
  };

  const work: NavItem[] = [
    { key: 'inbox', label: 'Inbox', short: 'Inbox', icon: <InboxIcon size={18} />, count: counts.inbox },
    { key: 'requests', label: 'My requests', short: 'Requests', icon: <FileText size={18} /> },
    { key: 'new', label: 'New request', short: 'New', icon: <FilePlus2 size={18} /> },
    { key: 'delegations', label: 'Delegations', short: 'Delegations', icon: <Users size={18} /> },
    { key: 'notifications', label: 'Notifications', short: 'Notifications', icon: <Bell size={18} />, count: counts.unread },
  ];
  const seesOrg = manages || Boolean(me.ownsOrg);
  const manage: NavItem[] = [
    ...(manages ? [{ key: 'admin', label: 'Approval flows', short: 'Flows', icon: <Workflow size={18} /> }] : []),
    ...(seesOrg ? [{ key: 'org', label: 'Organization', short: 'Organization', icon: <Network size={18} /> }] : []),
    ...(me.isAdmin ? [{ key: 'integrations', label: 'Integrations', short: 'Integrations', icon: <Plug size={18} /> }] : []),
  ];
  const current = page === 'r' ? 'requests' : page;

  const editing = page === 'admin' && a === 'v' && b && manages;
  let body: ReactNode;
  if (editing) body = <Editor id={b} key={b} me={me} />;
  else if (page === 'requests') body = <MyRequests selected={a} />;
  else if (page === 'new') body = <NewRequest flowKey={a} />;
  else if (page === 'r' && a) body = <RequestPage id={a} key={a} onChanged={refreshCounts} />;
  else if (page === 'delegations') body = <Delegations me={me} />;
  else if (page === 'notifications') body = <Notifications onRead={refreshCounts} />;
  else if (page === 'admin' && manages) body = <Flows me={me} />;
  else if (page === 'integrations' && me.isAdmin) body = <Integrations />;
  else if (page === 'org' && seesOrg) body = <Organization tab={a} selected={b} />;
  else body = <Inbox selected={a} query={query} setQuery={setQuery} onChanged={refreshCounts} />;

  const navLink = (item: NavItem) => (
    <a key={item.key} href={`#/${item.key}`} className={`nav-item ${current === item.key ? 'on' : ''}`} aria-current={current === item.key ? 'page' : undefined}>
      {item.icon}
      <span className="nav-label">{item.label}</span>
      {item.count ? <span className="nav-count">{item.count}</span> : null}
    </a>
  );

  return (
    <div className={`shell ${editing ? 'shell-editor' : ''}`}>
      <header className="appbar">
        <a href="#/inbox" className="brand" aria-label="Sentinel, Mitra Prodin">
          <img src="/brand/mp-logo-white-768.png" alt="Mitra Prodin" width={64} height={30} />
          <span className="brand-app">Sentinel</span>
        </a>
        <form
          className="appbar-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (/^REQ-[0-9A-F]{8}$/i.test(q)) location.hash = `#/r/${q.toUpperCase()}`;
            else location.hash = '#/inbox';
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Search by REQ number, requester, or flow" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
        </form>
        <div className="appbar-user">
          <Person name={me.name} sub={me.isAdmin ? 'System administrator' : undefined} />
          <button className="icon-btn on-blue" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {editing ? null : (
        <nav className="sidebar" aria-label="Main navigation">
          <div className="nav-group">{work.map(navLink)}</div>
          {manage.length ? (
            <div className="nav-group">
              <p className="nav-heading">Administration</p>
              {manage.map(navLink)}
            </div>
          ) : null}
        </nav>
      )}
      <main className="main">{body}</main>
      {editing ? null : (
        <nav className="tabbar" aria-label="Main navigation">
          {/* Integrations is set up at a desk; it stays out of the phone tab bar to keep the tabs readable. */}
          {[...work.filter((i) => i.key !== 'new'), ...manage.filter((i) => i.key !== 'integrations')].map((item) => (
            <a key={item.key} href={`#/${item.key}`} className={current === item.key ? 'on' : ''} aria-current={current === item.key ? 'page' : undefined}>
              <span className="tab-icon">
                {item.icon}
                {item.count ? <span className="tab-count">{item.count}</span> : null}
              </span>
              {item.short}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
