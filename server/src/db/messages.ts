import type { Correction, Message, MessageStatus, Role } from '../../../shared/types.js';
import { ulid } from '../util/ulid.js';
import { db, now } from './index.js';

interface MessageRow {
  id: string;
  partner_id: string;
  seq: number;
  role: Role;
  text: string;
  text_ja: string;
  corrections: string;
  status: MessageStatus;
  created_at: number;
}

function fromRow(r: MessageRow): Message {
  let corrections: Correction[] = [];
  try {
    corrections = JSON.parse(r.corrections) as Correction[];
  } catch {
    // 壊れていれば矯正なし
  }
  return {
    id: r.id,
    partner_id: r.partner_id,
    seq: r.seq,
    role: r.role,
    text: r.text,
    text_ja: r.text_ja,
    corrections,
    status: r.status,
    created_at: r.created_at,
  };
}

const COLS = 'id, partner_id, seq, role, text, text_ja, corrections, status, created_at';

/** 古い順。before を渡すとその seq より前を limit 件 */
export function listMessages(partnerId: string, opts: { limit?: number; before?: number } = {}): Message[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = (
    opts.before
      ? db
          .prepare(`SELECT ${COLS} FROM messages WHERE partner_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`)
          .all(partnerId, opts.before, limit)
      : db
          .prepare(`SELECT ${COLS} FROM messages WHERE partner_id = ? ORDER BY seq DESC LIMIT ?`)
          .all(partnerId, limit)
  ) as MessageRow[];
  return rows.reverse().map(fromRow);
}

/** モデルに送る直近の履歴（ユーザー発言 turns 回分を含む範囲） */
export function recentForPrompt(partnerId: string, turns: number): Message[] {
  return listMessages(partnerId, { limit: turns * 2 });
}

export function countUserMessages(partnerId: string): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM messages WHERE partner_id = ? AND role = 'user'").get(partnerId) as {
      c: number;
    }
  ).c;
}

export interface NewMessage {
  role: Role;
  text: string;
  text_ja?: string;
  corrections?: Correction[];
  status?: MessageStatus;
  model?: string;
}

/** **トランザクションの中で呼ぶこと。** seq の採番と挿入を分けると、同時の書き込みで重複する */
export function insertMessage(partnerId: string, m: NewMessage): Message {
  const next =
    (
      db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 n FROM messages WHERE partner_id = ?').get(partnerId) as {
        n: number;
      }
    ).n;
  const id = ulid();
  db.prepare(
    `INSERT INTO messages (id, partner_id, seq, role, text, text_ja, corrections, status, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    partnerId,
    next,
    m.role,
    m.text,
    m.text_ja ?? '',
    JSON.stringify(m.corrections ?? []),
    m.status ?? 'ok',
    m.model ?? '',
    now(),
  );
  return fromRow(db.prepare(`SELECT ${COLS} FROM messages WHERE id = ?`).get(id) as MessageRow);
}

/** 会話をリセットする。間違いログは残る（message_id が外れるだけ） */
export function clearMessages(partnerId: string): number {
  return db.prepare('DELETE FROM messages WHERE partner_id = ?').run(partnerId).changes;
}
