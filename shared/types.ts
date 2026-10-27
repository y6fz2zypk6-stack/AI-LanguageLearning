// API境界の共有型。サーバーとクライアントの両方から読む

export type Language = 'zh' | 'en';

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'zh', label: '中国語' },
  { id: 'en', label: '英語' },
];

/** 言語ごとのレベルの選択肢。先頭が既定 */
export const LEVELS: Record<Language, string[]> = {
  zh: ['HSK3', 'HSK1', 'HSK2', 'HSK4', 'HSK5', 'HSK6'],
  en: ['B1', 'A2', 'B2', 'C1'],
};

/** レベルの並び順（表示用。LEVELS の先頭は既定値なので順番どおりではない） */
export const LEVEL_ORDER: Record<Language, string[]> = {
  zh: ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'],
  en: ['A2', 'B1', 'B2', 'C1'],
};

export type CorrectionType = 'error' | 'unnatural';

export interface Correction {
  /** ユーザーの文から抜き出した、直す部分 */
  original: string;
  fixed: string;
  type: CorrectionType;
  note_ja: string;
}

export interface Persona {
  gender: string;
  age: string;
  /** 出身地・在住 */
  hometown: string;
  occupation: string;
  /** 性格・口調 */
  personality: string;
  hobbies: string;
  /** 英語のみ: us / uk */
  variant: string;
}

export const EMPTY_PERSONA: Persona = {
  gender: '',
  age: '',
  hometown: '',
  occupation: '',
  personality: '',
  hobbies: '',
  variant: '',
};

export interface Partner {
  id: string;
  name: string;
  language: Language;
  persona: Persona;
  level: string;
  /** 相手が覚えているユーザーのこと（箇条書き） */
  memory: string;
  created_at: number;
  updated_at: number;
  /** 一覧用。最後のメッセージ */
  last_message: { role: Role; text: string; created_at: number } | null;
}

/** 作成・更新で受け付ける項目 */
export interface PartnerInput {
  name: string;
  language: Language;
  persona: Persona;
  level: string;
  memory?: string;
}

export type Role = 'user' | 'assistant';

/**
 * ok: 形式どおり
 * raw: JSONとして読めなかったので、生の応答をそのまま本文にした
 */
export type MessageStatus = 'ok' | 'raw';

export interface Message {
  id: string;
  partner_id: string;
  seq: number;
  role: Role;
  /** 学習言語の本文（user は入力そのまま） */
  text: string;
  /** assistant のみ: 日本語訳 */
  text_ja: string;
  /** user のみ: この発言への矯正 */
  corrections: Correction[];
  status: MessageStatus;
  created_at: number;
}

export interface SendResult {
  /** 相手から話しかけた場合は null */
  user: Message | null;
  assistant: Message;
  warnings: string[];
}

export interface Mistake {
  id: string;
  partner_id: string | null;
  partner_name: string;
  message_id: string | null;
  language: Language;
  original: string;
  fixed: string;
  type: CorrectionType;
  note_ja: string;
  /** その間違いを含んでいた発言全体 */
  context: string;
  reviewed: boolean;
  created_at: number;
}

export interface MistakeStats {
  total: number;
  unreviewed: number;
}

export type PinyinMode = 'always' | 'tap' | 'off';

export interface Settings {
  chat_model: string;
  /** 空なら chat_model を使う */
  utility_model: string;
  pinyin_mode: PinyinMode;
  tone_colors: boolean;
  /** 読み上げの速さ（0.5〜1.5） */
  tts_rate: number;
  /** モデルに送る直近の往復数 */
  history_turns: number;
  /** 何往復ごとに記憶を書き直すか */
  memory_every: number;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface AppConfig {
  appTitle: string;
  authRequired: boolean;
}
