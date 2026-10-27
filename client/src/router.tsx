import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';

/** URLベースの最小限のルーター（画面が少ないので react-router は使わない） */

const listeners = new Set<() => void>();

/** アプリ内で積んだ履歴の深さ。0 なら「戻る」でアプリの外へ出てしまう */
let depth = 0;
window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1);
});

function subscribe(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener('popstate', l);
  return () => {
    listeners.delete(l);
    window.removeEventListener('popstate', l);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname) return;
  if (opts.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
    depth++;
  }
  for (const l of listeners) l();
}

/** 戻る。アプリ内の履歴が無ければ（URLを直接開いた場合など）fallback へ */
export function goBack(fallback = '/'): void {
  if (depth > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

/** `/partners/:id` のような形とパスを照合し、パラメータを返す。合わなければ null */
export function match(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  if (ps.length !== xs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return params;
}

export function Link(props: { to: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(props.to);
  };
  return (
    <a href={props.to} className={props.className} onClick={onClick} aria-label={props.ariaLabel}>
      {props.children}
    </a>
  );
}
