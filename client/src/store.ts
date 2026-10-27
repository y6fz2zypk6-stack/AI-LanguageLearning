import { useSyncExternalStore } from 'react';
import type { Settings } from '@shared/types';

/** アプリ全体で共有する小さな状態。zustand 相当を自前で持つ（依存を増やさないため） */

export interface Toast {
  id: number;
  text: string;
  warn?: boolean;
}

export interface ConfirmOpts {
  title: string;
  body?: string;
  /** 実行ボタンの文言（「削除する」など。「OK」にはしない） */
  okLabel: string;
  danger?: boolean;
}

interface State {
  /** null は確認中 */
  authenticated: boolean | null;
  authRequired: boolean;
  appTitle: string;
  settings: Settings | null;
  toasts: Toast[];
  confirm: { opts: ConfirmOpts; resolve: (ok: boolean) => void } | null;
}

let state: State = {
  authenticated: null,
  authRequired: false,
  appTitle: 'Language Partner',
  settings: null,
  toasts: [],
  confirm: null,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

let toastSeq = 0;

export function toast(text: string, warn = false): void {
  const id = ++toastSeq;
  setState({ toasts: [...state.toasts, { id, text, warn }] });
  setTimeout(() => dismissToast(id), warn ? 5200 : 3200);
}

export function dismissToast(id: number): void {
  setState({ toasts: state.toasts.filter((t) => t.id !== id) });
}

/** 確認ダイアログ。**true なら実行してよい** */
export function ask(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm?.resolve(false);
    setState({ confirm: { opts, resolve } });
  });
}

export function answerConfirm(ok: boolean): void {
  const cur = state.confirm;
  if (!cur) return;
  setState({ confirm: null });
  cur.resolve(ok);
}
