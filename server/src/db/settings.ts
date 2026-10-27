import type { PinyinMode, Settings } from '../../../shared/types.js';
import { db } from './index.js';

export function defaultSettings(): Settings {
  return {
    chat_model: process.env.DEFAULT_MODEL || '~anthropic/claude-sonnet-latest',
    utility_model: process.env.UTILITY_MODEL || '',
    pinyin_mode: 'tap',
    tone_colors: true,
    tts_rate: 0.9,
    history_turns: 20,
    memory_every: 10,
  };
}

const PINYIN_MODES: PinyinMode[] = ['always', 'tap', 'off'];

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** 受け取った値を型と範囲に収める。知らないキーは捨てる */
function sanitize(input: Partial<Record<keyof Settings, unknown>>, base: Settings): Settings {
  const out = { ...base };
  if (typeof input.chat_model === 'string' && input.chat_model.trim()) {
    out.chat_model = input.chat_model.trim();
  }
  if (typeof input.utility_model === 'string') out.utility_model = input.utility_model.trim();
  if (PINYIN_MODES.includes(input.pinyin_mode as PinyinMode)) {
    out.pinyin_mode = input.pinyin_mode as PinyinMode;
  }
  if (typeof input.tone_colors === 'boolean') out.tone_colors = input.tone_colors;
  if (input.tts_rate !== undefined) {
    const r = Number(input.tts_rate);
    if (Number.isFinite(r)) out.tts_rate = Math.min(1.5, Math.max(0.5, Math.round(r * 20) / 20));
  }
  if (input.history_turns !== undefined) {
    out.history_turns = clampInt(input.history_turns, 4, 60, base.history_turns);
  }
  if (input.memory_every !== undefined) {
    out.memory_every = clampInt(input.memory_every, 3, 50, base.memory_every);
  }
  return out;
}

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      // 壊れた値は既定に任せる
    }
  }
  return sanitize(stored, defaultSettings());
}

export function updateSettings(input: Partial<Record<keyof Settings, unknown>>): Settings {
  const next = sanitize(input, getSettings());
  const put = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(next)) put.run(k, JSON.stringify(v));
  })();
  return next;
}

/** 記憶の要約に使うモデル */
export function utilityModel(s: Settings): string {
  return s.utility_model || s.chat_model;
}
