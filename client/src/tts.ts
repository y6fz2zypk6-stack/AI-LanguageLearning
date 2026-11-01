import type { Language, Persona } from '@shared/types';

/** 読み上げ（Web Speech API）。端末に入っている声を使う */

function langTag(language: Language, persona?: Persona): string {
  if (language === 'zh') return 'zh-CN';
  return persona?.variant === 'uk' ? 'en-GB' : 'en-US';
}

const norm = (s: string) => s.replace(/_/g, '-').toLowerCase();

/**
 * 声を選ぶ。完全一致（端末内の声を優先）→ 同じ言語の別地域、の順。
 * **中国語で香港の声（zh-HK）には落とさない。** 広東語で読まれてしまうため
 */
function pickVoice(tag: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const want = tag.toLowerCase();
  const exact = voices.filter((v) => norm(v.lang) === want);
  if (exact.length) return exact.find((v) => v.localService) ?? exact[0];
  const base = want.slice(0, 2);
  return voices.find((v) => {
    const l = norm(v.lang);
    return l.startsWith(base) && !(base === 'zh' && /hk|yue/.test(l));
  });
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string, language: Language, rate: number, persona?: Persona): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  // **読み上げ中のときだけ止める。** iPhone の Safari は、何も読んでいないときに cancel() してすぐ
  // speak() すると、その読み上げを黙って捨てることがある
  if (synth.speaking || synth.pending) synth.cancel();
  if (synth.paused) synth.resume();
  const u = new SpeechSynthesisUtterance(text);
  const tag = langTag(language, persona);
  u.lang = tag;
  u.rate = rate;
  const voice = pickVoice(tag);
  if (voice) u.voice = voice;
  synth.speak(u);
}

// iOS は声の一覧を後から読み込むので、先に一度触っておく
if (canSpeak()) {
  window.speechSynthesis.getVoices();
}
