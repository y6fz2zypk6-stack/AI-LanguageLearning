import type { Correction, CorrectionType, Language, Mistake, MistakeStats } from '../../../shared/types.js';
import { ulid } from '../util/ulid.js';
import { db, now } from './index.js';

interface MistakeRow {
  id: string;
  partner_id: string | null;
  partner_name: string;
  message_id: string | null;
  language: Language;
  original: string;
  fixed: string;
  type: CorrectionType;
  note_ja: string;
  context: string;
  reviewed: number;
  created_at: number;
}

function fromRow(r: MistakeRow): Mistake {
  return { ...r, reviewed: r.reviewed === 1 };
}

export interface MistakeFilter {
  partnerId?: string;
  type?: CorrectionType;
  unreviewed?: boolean;
  language?: Language;
  limit?: number;
  offset?: number;
}

function where(f: MistakeFilter): { sql: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (f.partnerId) {
    conds.push('partner_id = ?');
    args.push(f.partnerId);
  }
  if (f.type) {
    conds.push('type = ?');
    args.push(f.type);
  }
  if (f.language) {
    conds.push('language = ?');
    args.push(f.language);
  }
  if (f.unreviewed) conds.push('reviewed = 0');
  return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args };
}

export function listMistakes(f: MistakeFilter): Mistake[] {
  const { sql, args } = where(f);
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM mistakes ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as MistakeRow[];
  return rows.map(fromRow);
}

export function mistakeStats(f: MistakeFilter = {}): MistakeStats {
  const { sql, args } = where({ ...f, unreviewed: false });
  const row = db
    .prepare(
      `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END), 0) unreviewed
       FROM mistakes ${sql}`,
    )
    .get(...args) as MistakeStats;
  return row;
}

/** **トランザクションの中で呼ぶこと**（発言の保存と同時に記録する） */
export function insertMistakes(opts: {
  partnerId: string;
  partnerName: string;
  messageId: string;
  language: Language;
  context: string;
  corrections: Correction[];
}): void {
  const stmt = db.prepare(
    `INSERT INTO mistakes
       (id, partner_id, partner_name, message_id, language, original, fixed, type, note_ja, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const t = now();
  for (const c of opts.corrections) {
    stmt.run(
      ulid(),
      opts.partnerId,
      opts.partnerName,
      opts.messageId,
      opts.language,
      c.original,
      c.fixed,
      c.type,
      c.note_ja,
      opts.context,
      t,
    );
  }
}

export function setReviewed(id: string, reviewed: boolean): Mistake | null {
  const r = db.prepare('UPDATE mistakes SET reviewed = ? WHERE id = ?').run(reviewed ? 1 : 0, id);
  if (!r.changes) return null;
  return fromRow(db.prepare('SELECT * FROM mistakes WHERE id = ?').get(id) as MistakeRow);
}

export function deleteMistake(id: string): boolean {
  return db.prepare('DELETE FROM mistakes WHERE id = ?').run(id).changes > 0;
}

/** 相手の名前を変えたとき、ログの控えも合わせる */
export function renamePartnerInMistakes(partnerId: string, name: string): void {
  db.prepare('UPDATE mistakes SET partner_name = ? WHERE partner_id = ?').run(name, partnerId);
}
