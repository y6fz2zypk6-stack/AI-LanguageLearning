import { useEffect, useState } from 'react';
import type { MistakeStats, Partner } from '@shared/types';
import { api } from '../api';
import { Avatar, TopBar } from '../components';
import { langShort, personaLine, shortTime } from '../format';
import { IconBook, IconChat, IconPlus, IconSettings } from '../icons';
import { navigate } from '../router';
import { toast, useStore } from '../store';

export default function PartnersPage() {
  const appTitle = useStore((s) => s.appTitle);
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [unreviewed, setUnreviewed] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [ps, log] = await Promise.all([
          api.get<Partner[]>('/partners'),
          api.get<{ stats: MistakeStats }>('/mistakes?limit=1'),
        ]);
        setPartners(ps);
        setUnreviewed(log.stats.unreviewed);
      } catch (err) {
        toast((err as Error).message, true);
        setPartners([]);
      }
    })();
  }, []);

  return (
    <div className="page">
      <TopBar
        back={false}
        title={appTitle}
        left={<span style={{ width: 8 }} />}
        right={
          <>
            <button className="icon-btn" aria-label="間違いログ" onClick={() => navigate('/mistakes')}>
              <IconBook />
              {unreviewed > 0 && <span className="badge">{unreviewed > 99 ? '99+' : unreviewed}</span>}
            </button>
            <button className="icon-btn" aria-label="設定" onClick={() => navigate('/settings')}>
              <IconSettings />
            </button>
          </>
        }
      />
      <div className="scroll">
        {partners === null ? (
          <div className="loading">読み込み中…</div>
        ) : partners.length === 0 ? (
          <div className="empty">
            <div style={{ color: 'var(--accent)', width: 44, margin: '0 auto' }}>
              <IconChat />
            </div>
            <h2>話し相手を作りましょう</h2>
            <p>
              名前と出身地くらいを決めるだけで始められます。
              <br />
              返信のペースは自分のペースで大丈夫。
            </p>
            <button className="btn primary" onClick={() => navigate('/partners/new')}>
              <IconPlus />
              最初の相手を作る
            </button>
          </div>
        ) : (
          <div className="partner-list">
            {partners.map((p) => {
              const last = p.last_message;
              const preview = last
                ? `${last.role === 'user' ? 'あなた: ' : ''}${last.text.replace(/\s+/g, ' ')}`
                : personaLine(p) || 'まだ話していません';
              return (
                <button key={p.id} className="partner-row" onClick={() => navigate(`/partners/${p.id}`)}>
                  <Avatar id={p.id} name={p.name} />
                  <div className="body">
                    <div className="name-line">
                      <span className="name">{p.name}</span>
                      <span className="chip lang">
                        {langShort(p.language)} {p.level}
                      </span>
                    </div>
                    <div className="preview" lang={last ? (p.language === 'zh' ? 'zh-CN' : 'en') : undefined}>
                      {preview}
                    </div>
                  </div>
                  {last && <span className="time">{shortTime(last.created_at)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {partners && partners.length > 0 && (
        <button className="fab" onClick={() => navigate('/partners/new')}>
          <IconPlus />
          相手を追加
        </button>
      )}
    </div>
  );
}
