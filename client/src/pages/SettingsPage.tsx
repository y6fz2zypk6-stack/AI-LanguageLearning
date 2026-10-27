import { useEffect, useRef, useState } from 'react';
import type { ModelInfo, PinyinMode, Settings } from '@shared/types';
import { api } from '../api';
import { LangText, Segmented, Stepper, Toggle, TopBar } from '../components';
import { IconLogout, IconVolume } from '../icons';
import { getState, setState, toast, useStore } from '../store';
import { canSpeak, speak } from '../tts';

const SAMPLE = '你今天想聊什么？';

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const authRequired = useStore((s) => s.authRequired);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [chatModel, setChatModel] = useState(settings?.chat_model ?? '');
  const [utilityModel, setUtilityModel] = useState(settings?.utility_model ?? '');
  const [rate, setRate] = useState(settings?.tts_rate ?? 0.9);
  const rateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .get<Settings>('/settings')
      .then((s) => {
        setState({ settings: s });
        setChatModel(s.chat_model);
        setUtilityModel(s.utility_model);
        setRate(s.tts_rate);
      })
      .catch((err) => toast((err as Error).message, true));
    api
      .get<ModelInfo[]>('/models')
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    const cur = getState().settings;
    if (cur) setState({ settings: { ...cur, ...patch } });
    try {
      setState({ settings: await api.put<Settings>('/settings', patch) });
    } catch (err) {
      if (cur) setState({ settings: cur });
      toast((err as Error).message, true);
    }
  };

  const saveModel = (key: 'chat_model' | 'utility_model', value: string) => {
    const v = value.trim();
    if (!settings || settings[key] === v) return;
    if (key === 'chat_model' && !v) {
      setChatModel(settings.chat_model);
      return;
    }
    void save({ [key]: v }).then(() => toast('モデルを変更しました'));
  };

  const onRate = (v: number) => {
    setRate(v);
    if (rateTimer.current) clearTimeout(rateTimer.current);
    rateTimer.current = setTimeout(() => void save({ tts_rate: v }), 400);
  };

  const logout = async () => {
    try {
      await api.post('/logout');
    } finally {
      setState({ authenticated: false });
    }
  };

  if (!settings) {
    return (
      <div className="page">
        <TopBar back="/" title="設定" />
        <div className="loading">読み込み中…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar back="/" title="設定" />
      <div className="scroll">
        <div className="form">
          <datalist id="model-list">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>

          <div className="section">
            <div className="section-title">モデル（OpenRouter）</div>
            <div className="card">
              <div className="field stack">
                <label htmlFor="st-chat">会話と矯正</label>
                <input
                  id="st-chat"
                  className="input"
                  list="model-list"
                  value={chatModel}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setChatModel(e.target.value)}
                  onBlur={() => saveModel('chat_model', chatModel)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <div className="field stack">
                <label htmlFor="st-util">記憶の書き直し</label>
                <input
                  id="st-util"
                  className="input"
                  list="model-list"
                  value={utilityModel}
                  placeholder="空なら会話と同じモデル"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setUtilityModel(e.target.value)}
                  onBlur={() => saveModel('utility_model', utilityModel)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            </div>
            <div className="section-note">
              候補から選ぶか、モデルIDをそのまま入力します。「~anthropic/claude-sonnet-latest」のように ~ で始まる名前は、いつも最新版に振り向けられます。
            </div>
          </div>

          <div className="section">
            <div className="section-title">中国語の表示</div>
            <div className="card">
              <div className="field stack">
                <span className="label">ピンイン</span>
                <Segmented<PinyinMode>
                  value={settings.pinyin_mode}
                  options={[
                    { value: 'always', label: '常に出す' },
                    { value: 'tap', label: 'タップで出す' },
                    { value: 'off', label: '出さない' },
                  ]}
                  onChange={(v) => save({ pinyin_mode: v })}
                />
              </div>
              <div className="field">
                <span className="label" style={{ width: 'auto', flex: 1 }}>
                  声調で色分け
                </span>
                <Toggle on={settings.tone_colors} label="声調で色分け" onChange={(v) => save({ tone_colors: v })} />
              </div>
              <div className={`field${settings.tone_colors ? ' tones' : ''}`} style={{ lineHeight: 1.3, fontSize: 18 }}>
                <LangText text={SAMPLE} language="zh" pinyin />
              </div>
            </div>
            <div className="section-note">「タップで出す」は、吹き出しの下の「拼」ボタンで1つずつ出せます。間違いの直し文には「出さない」以外のとき常に付きます。</div>
          </div>

          <div className="section">
            <div className="section-title">読み上げ</div>
            <div className="card">
              <div className="field">
                <label htmlFor="st-rate">速さ</label>
                <input
                  id="st-rate"
                  className="range"
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={rate}
                  onChange={(e) => onRate(Number(e.target.value))}
                />
                <span className="value">{rate.toFixed(2)}</span>
                {canSpeak() && (
                  <button className="icon-btn" aria-label="試しに読み上げ" onClick={() => speak(SAMPLE, 'zh', rate)}>
                    <IconVolume />
                  </button>
                )}
              </div>
            </div>
            <div className="section-note">端末に入っている音声を使います。iPhoneは「設定 → アクセシビリティ → 読み上げコンテンツ → 声」で中国語の声を追加できます。</div>
          </div>

          <div className="section">
            <div className="section-title">記憶と履歴</div>
            <div className="card">
              <div className="field">
                <span className="label" style={{ width: 'auto', flex: 1 }}>
                  記憶を書き直す間隔（往復）
                </span>
                <Stepper value={settings.memory_every} min={3} max={50} onChange={(v) => save({ memory_every: v })} />
              </div>
              <div className="field">
                <span className="label" style={{ width: 'auto', flex: 1 }}>
                  モデルに送る履歴（往復）
                </span>
                <Stepper value={settings.history_turns} min={4} max={60} step={2} onChange={(v) => save({ history_turns: v })} />
              </div>
            </div>
            <div className="section-note">履歴を長くすると前の話題を覚えていやすくなる代わりに、1回あたりの料金が上がります。</div>
          </div>

          {authRequired && (
            <div className="section">
              <button className="btn danger block" onClick={logout}>
                <IconLogout />
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
