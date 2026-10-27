import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { setState, useStore } from '../store';

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const appTitle = useStore((s) => s.appTitle);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/login', { password });
      setState({ authenticated: true });
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <form className="login" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" />
        <h1>{appTitle}</h1>
        <div className="card">
          <div className="field">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" type="submit" disabled={!password || busy}>
          ログイン
        </button>
      </form>
    </div>
  );
}
