-- スキーマ定義（初期化用、IF NOT EXISTS のみ）。変更は db/index.ts の番号付きマイグレーションで行う。
-- JSON列（persona / pending_hints / corrections）はJSON文字列で保存し、API境界で展開する。
-- PRAGMA foreign_keys = ON は接続ごとにアプリ側で有効化する。

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  persona TEXT NOT NULL DEFAULT '{}',
  level TEXT NOT NULL DEFAULT '',
  -- 相手が覚えているユーザーのこと（箇条書きの本文）
  memory TEXT NOT NULL DEFAULT '',
  -- 次の書き直しで取り込む memory_hint（JSON配列）
  pending_hints TEXT NOT NULL DEFAULT '[]',
  -- 前回の書き直しからのユーザー発言数
  turns_since_memory INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  -- 会話内の連番。順序はこれが正（ULIDの時系列性には頼らない）
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  text_ja TEXT NOT NULL DEFAULT '',
  corrections TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok',
  -- 応答したモデル（assistant のみ。調査用）
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_partner_seq ON messages(partner_id, seq);

-- 間違いログ。**相手を消しても残す**（学習の記録なので）。名前は控えを持つ
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  partner_id TEXT REFERENCES partners(id) ON DELETE SET NULL,
  partner_name TEXT NOT NULL DEFAULT '',
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  language TEXT NOT NULL,
  original TEXT NOT NULL,
  fixed TEXT NOT NULL,
  type TEXT NOT NULL,
  note_ja TEXT NOT NULL DEFAULT '',
  -- その間違いを含んでいた発言全体
  context TEXT NOT NULL DEFAULT '',
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mistakes_created ON mistakes(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
