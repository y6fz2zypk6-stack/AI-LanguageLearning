import { useEffect, useState } from 'react';
import {
  EMPTY_PERSONA,
  LANGUAGES,
  LEVEL_ORDER,
  LEVELS,
  type Language,
  type Partner,
  type PartnerInput,
  type Persona,
} from '@shared/types';
import { api } from '../api';
import { Segmented, TopBar } from '../components';
import { goBack, navigate } from '../router';
import { ask, toast } from '../store';

/** 言語ごとの入力例 */
const EXAMPLES: Record<Language, Record<keyof Persona | 'name', string>> = {
  zh: {
    name: '陈宇',
    gender: '男性',
    age: '27',
    hometown: '成都出身、上海在住',
    occupation: '会社員（IT）',
    personality: '落ち着いている、たまに冗談',
    hobbies: '火鍋、ゲーム',
    variant: '',
  },
  en: {
    name: 'Amy',
    gender: '女性',
    age: '29',
    hometown: 'マンチェスター出身、ロンドン在住',
    occupation: '看護師',
    personality: '明るい、話し好き',
    hobbies: 'サッカー観戦、料理',
    variant: '',
  },
};

const PERSONA_FIELDS: { key: Exclude<keyof Persona, 'variant'>; label: string }[] = [
  { key: 'gender', label: '性別' },
  { key: 'age', label: '年齢' },
  { key: 'hometown', label: '出身・在住' },
  { key: 'occupation', label: '職業' },
  { key: 'personality', label: '性格・口調' },
  { key: 'hobbies', label: '趣味' },
];

export default function PartnerEditPage({ id }: { id?: string }) {
  const isNew = !id;
  const [loaded, setLoaded] = useState(isNew);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('zh');
  const [level, setLevel] = useState(LEVELS.zh[0]);
  const [persona, setPersona] = useState<Persona>({ ...EMPTY_PERSONA });
  const [memory, setMemory] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const p = await api.get<Partner>(`/partners/${id}`);
        setName(p.name);
        setLanguage(p.language);
        setLevel(p.level);
        setPersona(p.persona);
        setMemory(p.memory);
        setLoaded(true);
      } catch (err) {
        toast((err as Error).message, true);
        navigate('/', { replace: true });
      }
    })();
  }, [id]);

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    setLevel(LEVELS[l][0]);
  };

  const save = async () => {
    if (!name.trim()) {
      toast('名前を入力してください', true);
      return;
    }
    setSaving(true);
    const body: PartnerInput = { name: name.trim(), language, level, persona };
    if (!isNew) body.memory = memory;
    try {
      if (isNew) {
        const p = await api.post<Partner>('/partners', body);
        navigate(`/partners/${p.id}`, { replace: true });
      } else {
        await api.put<Partner>(`/partners/${id}`, body);
        toast('保存しました');
        goBack(`/partners/${id}`);
      }
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  const resetChat = async () => {
    const ok = await ask({
      title: '会話をリセットしますか？',
      body: 'これまでのメッセージをすべて消します。相手の設定・記憶・間違いログは残ります。',
      okLabel: 'リセットする',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/partners/${id}/messages`);
      toast('会話をリセットしました');
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: `「${name}」を削除しますか？`,
      body: '会話と記憶も消えます。間違いログは残ります。',
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/partners/${id}`);
      navigate('/', { replace: true });
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const ex = EXAMPLES[language];

  return (
    <div className="page">
      <TopBar
        back={isNew ? '/' : `/partners/${id}`}
        title={isNew ? '新しい相手' : '相手の設定'}
        right={
          <button className="pill-btn on" onClick={save} disabled={saving || !loaded}>
            {isNew ? '作成' : '保存'}
          </button>
        }
      />
      <div className="scroll">
        {!loaded ? (
          <div className="loading">読み込み中…</div>
        ) : (
          <div className="form">
            <div className="section">
              <div className="section-title">基本</div>
              <div className="card">
                <div className="field">
                  <label htmlFor="pe-name">名前</label>
                  <input
                    id="pe-name"
                    className="input"
                    value={name}
                    maxLength={40}
                    placeholder={ex.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <span className="label">言語</span>
                  <Segmented
                    value={language}
                    options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
                    onChange={changeLanguage}
                    disabled={!isNew}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pe-level">レベル</label>
                  <select id="pe-level" className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {LEVEL_ORDER[language].map((l) => (
                      <option key={l} value={l}>
                        {language === 'zh' ? l : `CEFR ${l}`}
                      </option>
                    ))}
                  </select>
                </div>
                {language === 'en' && (
                  <div className="field">
                    <span className="label">英語の種類</span>
                    <Segmented
                      value={persona.variant === 'uk' ? 'uk' : 'us'}
                      options={[
                        { value: 'us', label: 'アメリカ' },
                        { value: 'uk', label: 'イギリス' },
                      ]}
                      onChange={(v) => setPersona({ ...persona, variant: v })}
                    />
                  </div>
                )}
              </div>
              {!isNew && <div className="section-note">言語はあとから変えられません。</div>}
              <div className="section-note">
                レベルに合わせて、相手が使う単語と文の長さを調整します。
              </div>
            </div>

            <div className="section">
              <div className="section-title">人物（空欄でもOK）</div>
              <div className="card">
                {PERSONA_FIELDS.map((f) => (
                  <div className="field" key={f.key}>
                    <label htmlFor={`pe-${f.key}`}>{f.label}</label>
                    <input
                      id={`pe-${f.key}`}
                      className="input"
                      value={persona[f.key]}
                      maxLength={200}
                      placeholder={ex[f.key]}
                      onChange={(e) => setPersona({ ...persona, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="section-note">出身地や趣味は、相手が振ってくる話題や口癖に効きます。</div>
            </div>

            {!isNew && (
              <div className="section">
                <div className="section-title">相手が覚えていること</div>
                <div className="card">
                  <div className="field stack">
                    <textarea
                      className="textarea"
                      value={memory}
                      placeholder="（まだ何もありません）"
                      onChange={(e) => setMemory(e.target.value)}
                    />
                  </div>
                </div>
                <div className="section-note">
                  会話の中で分かったあなたのことを、決まった往復数ごとに自動で書き直します。手で直しても大丈夫です。
                </div>
              </div>
            )}

            <div className="section">
              <button className="btn primary block" onClick={save} disabled={saving}>
                {isNew ? 'この相手と話し始める' : '保存する'}
              </button>
            </div>

            {!isNew && (
              <div className="section" style={{ display: 'grid', gap: 10 }}>
                <button className="btn danger block" onClick={resetChat}>
                  会話をリセット
                </button>
                <button className="btn danger block" onClick={remove}>
                  この相手を削除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
