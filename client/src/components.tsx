import { Fragment, type ReactNode } from 'react';
import type { Language } from '@shared/types';
import { avatarColor } from './format';
import { IconBack } from './icons';
import { toPieces, usePinyinReady } from './pinyin';
import { goBack } from './router';
import { answerConfirm, dismissToast, useStore } from './store';

export function Avatar(props: { id: string; name: string; size?: 'sm' | 'lg' }) {
  const initial = Array.from(props.name.trim())[0] ?? '?';
  return (
    <div
      className={`avatar${props.size ? ` ${props.size}` : ''}`}
      style={{ background: avatarColor(props.id) }}
      aria-hidden="true"
    >
      {initial.toUpperCase()}
    </div>
  );
}

export function TopBar(props: {
  title: ReactNode;
  sub?: ReactNode;
  back?: string | false;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="topbar">
      {props.back !== false && (
        <button className="icon-btn" aria-label="戻る" onClick={() => goBack(props.back || '/')}>
          <IconBack />
        </button>
      )}
      {props.left}
      <div className="topbar-title">
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      {props.right}
    </header>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-holder" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.warn ? ' warn' : ''}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const c = useStore((s) => s.confirm);
  if (!c) return null;
  return (
    <div className="overlay" onClick={() => answerConfirm(false)}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{c.opts.title}</h3>
        {c.opts.body && <p>{c.opts.body}</p>}
        <div className="row">
          <button className="btn" onClick={() => answerConfirm(false)}>
            キャンセル
          </button>
          <button className={`btn ${c.opts.danger ? 'danger-fill' : 'primary'}`} onClick={() => answerConfirm(true)}>
            {c.opts.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`toggle${props.on ? ' on' : ''}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper(props: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const step = props.step ?? 1;
  return (
    <div className="stepper">
      <button type="button" aria-label="減らす" onClick={() => props.onChange(Math.max(props.min, props.value - step))}>
        −
      </button>
      <span className="value">{props.value}</span>
      <button type="button" aria-label="増やす" onClick={() => props.onChange(Math.min(props.max, props.value + step))}>
        +
      </button>
    </div>
  );
}

/**
 * 学習言語の本文。中国語でピンインを出すときはルビを付ける。
 * ピンインが使えない間（読み込み中・失敗）は本文だけを出す
 */
export function LangText(props: { text: string; language: Language; pinyin: boolean }) {
  const want = props.language === 'zh' && props.pinyin;
  const ready = usePinyinReady(want);
  const pieces = want && ready ? toPieces(props.text) : null;
  if (props.language !== 'zh') return <span lang="en">{props.text}</span>;
  if (!pieces) {
    return (
      <span lang="zh-CN" className="zh">
        {props.text}
      </span>
    );
  }
  // ネイティブの <ruby> は読みが漢字より長いと隣とくっつくので、1字ずつ縦に積んだ箱で組む。
  // 句読点や英字も同じ箱に入れて、行の高さと下端をそろえる
  return (
    <span lang="zh-CN" className="zh py-text">
      {pieces.map((p, i) =>
        p.py ? (
          <span key={i} className="rb">
            <span className={`rt t${p.tone}`} aria-hidden="true">
              {p.py}
            </span>
            <span className="rh">{p.text}</span>
          </span>
        ) : (
          <Fragment key={i}>
            {p.text.split(/(\s+)/).map((tok, j) =>
              !tok ? null : /^\s+$/.test(tok) ? (
                tok
              ) : (
                <span key={j} className="rb">
                  <span className="rt" aria-hidden="true">
                    {' '}
                  </span>
                  <span className="rh">{tok}</span>
                </span>
              ),
            )}
          </Fragment>
        ),
      )}
    </span>
  );
}

/** ピンインを出す状態か（ルビ用の行の高さを付けるため） */
export function useHasRuby(text: string, language: Language, pinyin: boolean): boolean {
  const want = language === 'zh' && pinyin;
  const ready = usePinyinReady(want);
  return want && ready && toPieces(text) !== null;
}
