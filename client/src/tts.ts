import type { Language, Persona } from '@shared/types';

/** 読み上げ（Web Speech API）。端末に入っている声を使う */

function langTag(language: Language, persona?: Persona): string {
  if (language === 'zh') return 'zh-CN';
  return persona?.variant === 'uk' ? 'en-GB' : 'en-US';
}

function pickVoice(tag: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const norm = (s: string) => s.replace('_', '-').toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === tag.toLowerCase() && v.localService) ??
    voices.find((v) => norm(v.lang) === tag.toLowerCase()) ??
    voices.find((v) => norm(v.lang).startsWith(tag.slice(0, 2).toLowerCase()))
  );
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string, language: Language, rate: number, persona?: Persona): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
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
