import { Fragment, useEffect, useState } from 'react';
import type { CorrectionType, Mistake, MistakeStats, Partner } from '@shared/types';
import { api } from '../api';
import { TopBar } from '../components';
import { clock, dayKey, dayLabel } from '../format';
import { IconCheckCircle, IconCircle, IconTrash } from '../icons';
import { ask, toast, useStore } from '../store';
import { FixRow } from './ChatPage';

const PAGE = 100;

type TypeFilter = 'all' | CorrectionType;

export default function MistakesPage() {
  const settings = useStore((s) => s.settings);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState(() => new URLSearchParams(window.location.search).get('partner') ?? '');
  const [type, setType] = useState<TypeFilter>('all');
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [items, setItems] = useState<Mistake[] | null>(null);
  const [stats, setStats] = useState<MistakeStats>({ total: 0, unreviewed: 0 });
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    api
      .get<Partner[]>('/partners')
      .then(setPartners)
      .catch(() => setPartners([]));
  }, []);

  const query = (offset: number) => {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (partnerId) q.set('partner', partnerId);
    if (type !== 'all') q.set('type', type);
    if (unreviewedOnly) q.set('unreviewed', '1');
    return `/mistakes?${q}`;
  };

  useEffect(() => {
    let alive = true;
    setItems(null);
    api
      .get<{ items: Mistake[]; stats: MistakeStats }>(query(0))
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setStats(r.stats);
        setHasMore(r.items.length === PAGE);
      })
      .catch((err) => {
        toast((err as Error).message, true);
        setItems([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, type, unreviewedOnly]);

  const loadMore = async () => {
    if (!items) return;
    try {
      const r = await api.get<{ items: Mistake[]; stats: MistakeStats }>(query(items.length));
      setItems([...items, ...r.items]);
      setHasMore(r.items.length === PAGE);
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const toggleReviewed = async (m: Mistake) => {
    try {
      const updated = await api.put<Mistake>(`/mistakes/${m.id}`, { reviewed: !m.reviewed });
      setItems((xs) => (xs ? xs.map((x) => (x.id === m.id ? updated : x)) : xs));
      setStats((s) => ({ ...s, unreviewed: s.unreviewed + (updated.reviewed ? -1 : 1) }));
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const remove = async (m: Mistake) => {
    const ok = await ask({ title: 'この記録を削除しますか？', okLabel: '削除する', danger: true });
    if (!ok) return;
    try {
      await api.del(`/mistakes/${m.id}`);
      setItems((xs) => (xs ? xs.filter((x) => x.id !== m.id) : xs));
      setStats((s) => ({ total: s.total - 1, unreviewed: s.unreviewed - (m.reviewed ? 0 : 1) }));
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const pinyin = settings ? settings.pinyin_mode !== 'off' : true;
  const tones = settings?.tone_colors ?? true;
  const rate = settings?.tts_rate ?? 0.9;
  // 削除済みの相手のログも絞り込めるように、ログにしか無い相手は出さない（「すべて」で見られる）
  const partnerOptions = partners;

  return (
    <div className="page">
      <TopBar back="/" title="間違いログ" />
      <div className="scroll">
        <div className="log-head">
          <div className="stats">
            <div className="stat">
              <div className="num">{stats.unreviewed}</div>
              <div className="lbl">未復習</div>
            </div>
            <div className="stat">
              <div className="num">{stats.total}</div>
              <div className="lbl">これまでの記録</div>
            </div>
          </div>
          <div className="filters">
            <button className={`pill-btn${unreviewedOnly ? ' on' : ''}`} onClick={() => setUnreviewedOnly(!unreviewedOnly)}>
              未復習だけ
            </button>
            <button className={`pill-btn${type === 'error' ? ' on' : ''}`} onClick={() => setType(type === 'error' ? 'all' : 'error')}>
              誤り
            </button>
            <button
              className={`pill-btn${type === 'unnatural' ? ' on' : ''}`}
              onClick={() => setType(type === 'unnatural' ? 'all' : 'unnatural')}
            >
              より自然に
            </button>
            {partnerOptions.length > 0 && (
              <select
                className="select-pill"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                aria-label="相手で絞り込む"
              >
                <option value="">すべての相手</option>
                {partnerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="log-list">
          {items === null ? (
            <div className="loading">読み込み中…</div>
          ) : items.length === 0 ? (
            <div className="empty">
              <h2>{stats.total === 0 ? 'まだ記録はありません' : '条件に合う記録はありません'}</h2>
              <p>会話で直された表現が、ここに自動でたまっていきます。</p>
            </div>
          ) : (
            items.map((m, i) => {
              const sep = i === 0 || dayKey(items[i - 1].created_at) !== dayKey(m.created_at);
              return (
                <Fragment key={m.id}>
                  {sep && <div className="log-day">{dayLabel(m.created_at)}</div>}
                  <div className={`log-item ${m.type}${m.reviewed ? ' reviewed' : ''}${tones ? ' tones' : ''}`}>
                    <div className="log-meta">
                      <span className="who">{m.partner_name || '（削除した相手）'}</span>
                      <span>·</span>
                      <span>{clock(m.created_at)}</span>
                    </div>
                    <div className="fix-wrap">
                      <FixRow
                        c={{ original: m.original, fixed: m.fixed, type: m.type, note_ja: m.note_ja }}
                        language={m.language}
                        pinyin={pinyin}
                        rate={rate}
                      />
                    </div>
                    {m.context && m.context !== m.original && (
                      <div className="log-context" lang={m.language === 'zh' ? 'zh-CN' : 'en'}>
                        元の文: {m.context}
                      </div>
                    )}
                    <div className="log-actions">
                      <button
                        className={`mini-btn${m.reviewed ? ' on' : ''}`}
                        onClick={() => toggleReviewed(m)}
                        aria-pressed={m.reviewed}
                      >
                        {m.reviewed ? <IconCheckCircle /> : <IconCircle />}
                        復習済み
                      </button>
                      <button className="mini-btn" aria-label="削除" onClick={() => remove(m)}>
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                </Fragment>
              );
            })
          )}
          {hasMore && (
            <button className="pill-btn load-older" onClick={loadMore}>
              さらに読み込む
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
