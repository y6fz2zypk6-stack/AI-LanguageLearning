import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Correction, Language, Message, Partner, PinyinMode, SendResult, Settings } from '@shared/types';
import { api } from '../api';
import { Avatar, LangText, TopBar, useHasRuby } from '../components';
import { dayKey, dayLabel, personaLine } from '../format';
import { IconBook, IconCheck, IconEdit, IconMore, IconSend, IconTranslate, IconVolume } from '../icons';
import { navigate } from '../router';
import { getState, setState, toast, useStore } from '../store';
import { canSpeak, speak } from '../tts';

const PAGE = 100;

const NEXT_MODE: Record<PinyinMode, PinyinMode> = { always: 'tap', tap: 'off', off: 'always' };
const MODE_LABEL: Record<PinyinMode, string> = { always: 'ピンイン', tap: 'タップ', off: 'オフ' };

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 入力欄の高さを中身に合わせる */
function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export default function ChatPage({ id }: { id: string }) {
  const settings = useStore((s) => s.settings);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showJa, setShowJa] = useState<Set<string>>(new Set());
  const [showPy, setShowPy] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 次の描画で一番下へ送るか（古いメッセージを足したときは送らない） */
  const stickBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, ms] = await Promise.all([
          api.get<Partner>(`/partners/${id}`),
          api.get<Message[]>(`/partners/${id}/messages?limit=${PAGE}`),
        ]);
        if (!alive) return;
        setPartner(p);
        setMessages(ms);
        setHasMore(ms.length === PAGE);
      } catch (err) {
        toast((err as Error).message, true);
        navigate('/', { replace: true });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      // 古いメッセージを上に足したときは、見ていた位置を保つ
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending, waiting, showJa, showPy, loading]);

  // ピンインのルビは読み込みが終わってから付くので、その分の高さが増えても一番下に留める
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const inner = el.firstElementChild;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (stickBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [loading]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const older = await api.get<Message[]>(`/partners/${id}/messages?limit=${PAGE}&before=${first.seq}`);
      prevHeight.current = scrollRef.current?.scrollHeight ?? null;
      setMessages((ms) => [...older, ...ms]);
      setHasMore(older.length === PAGE);
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const afterReply = (r: SendResult) => {
    stickBottom.current = true;
    setMessages((ms) => [...ms, ...(r.user ? [r.user] : []), r.assistant]);
    setPartner((p) => (p ? { ...p, last_message: { role: 'assistant', text: r.assistant.text, created_at: r.assistant.created_at } } : p));
    if (r.warnings.length) toast(r.warnings[r.warnings.length - 1]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || waiting) return;
    stickBottom.current = true;
    setInput('');
    setPending(text);
    setWaiting(true);
    requestAnimationFrame(() => autosize(inputRef.current));
    try {
      afterReply(await api.post<SendResult>(`/partners/${id}/messages`, { text }));
    } catch (err) {
      // 失敗したら何も保存されていないので、文を入力欄に戻して送り直せるようにする
      setInput((cur) => (cur.trim() ? `${text}\n${cur}` : text));
      requestAnimationFrame(() => autosize(inputRef.current));
      toast((err as Error).message, true);
    } finally {
      setPending(null);
      setWaiting(false);
    }
  };

  const greet = async () => {
    if (waiting) return;
    setWaiting(true);
    try {
      afterReply(await api.post<SendResult>(`/partners/${id}/greet`));
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setWaiting(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // PCでは Enter で送信（Shift+Enter で改行）。スマホは改行のまま。変換中の Enter は送らない
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || coarsePointer) return;
    e.preventDefault();
    void send();
  };

  const cycleMode = useCallback(async () => {
    const cur = getState().settings;
    if (!cur) return;
    const next: Settings = { ...cur, pinyin_mode: NEXT_MODE[cur.pinyin_mode] };
    setState({ settings: next });
    try {
      setState({ settings: await api.put<Settings>('/settings', { pinyin_mode: next.pinyin_mode }) });
    } catch (err) {
      setState({ settings: cur });
      toast((err as Error).message, true);
    }
  }, []);

  if (loading || !partner || !settings) {
    return (
      <div className="page">
        <TopBar title="" back="/" />
        <div className="loading">読み込み中…</div>
      </div>
    );
  }

  const lang = partner.language;
  const zh = lang === 'zh';
  const mode = settings.pinyin_mode;
  const tones = settings.tone_colors;
  const sub = [zh ? `中国語 ${partner.level}` : `英語 ${partner.level}`, personaLine(partner)].filter(Boolean).join(' · ');

  return (
    <div className="page">
      <TopBar
        back="/"
        title={partner.name}
        sub={sub}
        right={
          <>
            {zh && (
              <button
                className={`pill-btn${mode !== 'off' ? ' on' : ''}`}
                onClick={cycleMode}
                aria-label={`ピンインの表示: ${MODE_LABEL[mode]}`}
              >
                <span lang="zh-CN" className="zh">
                  拼
                </span>
                {MODE_LABEL[mode]}
              </button>
            )}
            <button className="icon-btn" aria-label="メニュー" onClick={() => setMenu(true)}>
              <IconMore />
            </button>
          </>
        }
      />
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(false)} />
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => navigate(`/partners/${id}/edit`)}>
              <IconEdit />
              相手の設定と記憶
            </button>
            <button role="menuitem" onClick={() => navigate(`/mistakes?partner=${id}`)}>
              <IconBook />
              この相手との間違いログ
            </button>
          </div>
        </>
      )}

      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-scroll">
          {hasMore && (
            <button className="pill-btn load-older" onClick={loadOlder}>
              前のメッセージを読み込む
            </button>
          )}

          {messages.length === 0 && !waiting && (
            <div className="chat-empty">
              <Avatar id={partner.id} name={partner.name} size="lg" />
              <h2>{partner.name}</h2>
              <div className="persona">{personaLine(partner) || (zh ? '中国語の話し相手' : '英語の話し相手')}</div>
              <button className="btn primary" onClick={greet}>
                {partner.name}から話しかけてもらう
              </button>
              <div className="hint">もちろん、下の入力欄から自分で話しかけてもOK</div>
            </div>
          )}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const sep = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const next = messages[i + 1];
            return (
              <Fragment key={m.id}>
                {sep && (
                  <div className="day-sep">
                    <span>{dayLabel(m.created_at)}</span>
                  </div>
                )}
                {m.role === 'assistant' ? (
                  <PartnerMessage
                    m={m}
                    partner={partner}
                    settings={settings}
                    ja={showJa.has(m.id)}
                    py={mode === 'always' || (mode === 'tap' && showPy.has(m.id))}
                    onToggleJa={() => setShowJa((s) => toggleIn(s, m.id))}
                    onTogglePy={() => setShowPy((s) => toggleIn(s, m.id))}
                  />
                ) : (
                  <UserMessage
                    m={m}
                    language={lang}
                    tones={tones}
                    mode={mode}
                    py={mode === 'always' || (mode === 'tap' && showPy.has(m.id))}
                    onTogglePy={() => setShowPy((s) => toggleIn(s, m.id))}
                    checked={next?.role === 'assistant' && next.status === 'ok'}
                    rate={settings.tts_rate}
                  />
                )}
              </Fragment>
            );
          })}

          {pending !== null && (
            <div className="msg user">
              <div className="col">
                <div className="bubble user pending">{pending}</div>
              </div>
            </div>
          )}
          {waiting && (
            <div className="msg">
              <Avatar id={partner.id} name={partner.name} size="sm" />
              <div className="typing" aria-label="入力中">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={zh ? '中国語で話しかけてみよう' : '英語で話しかけてみよう'}
          lang={zh ? 'zh-CN' : 'en'}
          onChange={(e) => {
            setInput(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={onKeyDown}
        />
        <button className="send-btn" aria-label="送信" disabled={!input.trim() || waiting} onClick={send}>
          <IconSend />
        </button>
      </div>
    </div>
  );
}

function PartnerMessage(props: {
  m: Message;
  partner: Partner;
  settings: Settings;
  ja: boolean;
  py: boolean;
  onToggleJa: () => void;
  onTogglePy: () => void;
}) {
  const { m, partner, settings } = props;
  const zh = partner.language === 'zh';
  const ruby = useHasRuby(m.text, partner.language, props.py);
  return (
    <div className="msg">
      <Avatar id={partner.id} name={partner.name} size="sm" />
      <div className="col">
        <div
          className={`bubble partner${ruby ? ' has-ruby' : ''}${settings.tone_colors ? ' tones' : ''}`}
          onClick={m.text_ja ? props.onToggleJa : undefined}
        >
          <LangText text={m.text} language={partner.language} pinyin={props.py} />
          {props.ja && m.text_ja && <span className="ja">{m.text_ja}</span>}
          {m.status === 'raw' && <span className="raw-note">形式どおりに返ってこなかったので、そのまま表示しています</span>}
        </div>
        <div className="msg-actions">
          {canSpeak() && (
            <button
              className="mini-btn"
              aria-label="読み上げ"
              onClick={() => speak(m.text, partner.language, settings.tts_rate, partner.persona)}
            >
              <IconVolume />
            </button>
          )}
          {zh && settings.pinyin_mode === 'tap' && (
            <button className={`mini-btn${props.py ? ' on' : ''}`} aria-label="ピンイン" onClick={props.onTogglePy}>
              <span lang="zh-CN" className="zh">
                拼
              </span>
            </button>
          )}
          {m.text_ja && (
            <button className={`mini-btn${props.ja ? ' on' : ''}`} aria-label="日本語訳" onClick={props.onToggleJa}>
              <IconTranslate />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserMessage(props: {
  m: Message;
  language: Language;
  tones: boolean;
  mode: PinyinMode;
  py: boolean;
  onTogglePy: () => void;
  checked: boolean;
  rate: number;
}) {
  const { m, language } = props;
  const ruby = useHasRuby(m.text, language, props.py);
  const tapPy = language === 'zh' && props.mode === 'tap';
  return (
    <div className="msg user">
      <div className="col">
        <div
          className={`bubble user${ruby ? ' has-ruby' : ''}`}
          onClick={tapPy ? props.onTogglePy : undefined}
          style={tapPy ? { cursor: 'pointer' } : undefined}
        >
          <LangText text={m.text} language={language} pinyin={props.py} />
        </div>
        {m.corrections.length > 0 ? (
          <Fixes items={m.corrections} language={language} tones={props.tones} mode={props.mode} rate={props.rate} />
        ) : (
          props.checked && (
            <span className="ok-mark">
              <IconCheck />
              直すところなし
            </span>
          )
        )}
      </div>
    </div>
  );
}

function Fixes(props: { items: Correction[]; language: Language; tones: boolean; mode: PinyinMode; rate: number }) {
  return (
    <div className={`fixes${props.tones ? ' tones' : ''}`}>
      {props.items.map((c, i) => (
        <FixRow key={i} c={c} language={props.language} pinyin={props.mode !== 'off'} rate={props.rate} />
      ))}
    </div>
  );
}

export function FixRow(props: { c: Correction; language: Language; pinyin: boolean; rate: number; head?: ReactNode }) {
  const { c, language } = props;
  const ruby = useHasRuby(c.fixed, language, props.pinyin);
  return (
    <div className={`fix ${c.type}`}>
      <div className="fix-head">
        <span className={`chip ${c.type === 'error' ? 'err' : 'unnat'}`}>{c.type === 'error' ? '誤り' : 'より自然に'}</span>
        {props.head}
        <span style={{ flex: 1 }} />
        {canSpeak() && (
          <button className="mini-btn" aria-label="直した文を読み上げ" onClick={() => speak(c.fixed, language, props.rate)}>
            <IconVolume />
          </button>
        )}
      </div>
      <div className={`fix-line${ruby ? ' has-ruby' : ''}`}>
        <span className="from" lang={language === 'zh' ? 'zh-CN' : 'en'}>
          {c.original}
        </span>
        <span className="arrow">→</span>
        <span className="to">
          <LangText text={c.fixed} language={language} pinyin={props.pinyin} />
        </span>
      </div>
      {c.note_ja && <div className="fix-note">{c.note_ja}</div>}
    </div>
  );
}
