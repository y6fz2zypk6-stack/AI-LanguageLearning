import { useCallback, useEffect } from 'react';
import type { AppConfig, Settings } from '@shared/types';
import { api, setUnauthorizedHandler } from './api';
import { ConfirmHost, Toasts, TopBar } from './components';
import ChatPage from './pages/ChatPage';
import LoginPage from './pages/LoginPage';
import MistakesPage from './pages/MistakesPage';
import PartnerEditPage from './pages/PartnerEditPage';
import PartnersPage from './pages/PartnersPage';
import SettingsPage from './pages/SettingsPage';
import { match, usePath } from './router';
import { setState, useStore } from './store';

function Routes() {
  const path = usePath();
  if (path === '/' || path === '') return <PartnersPage />;
  if (path === '/partners/new') return <PartnerEditPage key="new" />;
  if (path === '/mistakes') return <MistakesPage />;
  if (path === '/settings') return <SettingsPage />;
  let m = match('/partners/:id/edit', path);
  if (m) return <PartnerEditPage key={`edit-${m.id}`} id={m.id} />;
  m = match('/partners/:id', path);
  if (m) return <ChatPage key={m.id} id={m.id} />;
  return (
    <div className="page">
      <TopBar back="/" title="見つかりません" />
      <div className="empty">ページが見つかりません</div>
    </div>
  );
}

export default function App() {
  const authenticated = useStore((s) => s.authenticated);
  const authRequired = useStore((s) => s.authRequired);

  const loadApp = useCallback(async () => {
    try {
      const [config, settings] = await Promise.all([api.get<AppConfig>('/config'), api.get<Settings>('/settings')]);
      setState({ appTitle: config.appTitle, settings });
      document.title = config.appTitle;
    } catch {
      /* 401 のときはログイン画面に戻る（setUnauthorizedHandler） */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ authenticated: false }));
    (async () => {
      try {
        const s = await api.get<{ authenticated: boolean; authRequired: boolean }>('/session');
        setState({ authenticated: s.authenticated, authRequired: s.authRequired });
        if (s.authenticated) await loadApp();
      } catch {
        // サーバーに届かないときもログイン画面で止めない（中で個別にエラーを出す）
        setState({ authenticated: true });
      }
    })();
  }, [loadApp]);

  if (authenticated === null) return <div className="loading" style={{ paddingTop: '40dvh' }}>読み込み中…</div>;

  return (
    <>
      {authRequired && !authenticated ? <LoginPage onLogin={loadApp} /> : <Routes />}
      <Toasts />
      <ConfirmHost />
    </>
  );
}
