import {
  EMPTY_PERSONA,
  LANGUAGES,
  LEVELS,
  type Language,
  type Partner,
  type PartnerInput,
  type Persona,
} from '../../../shared/types.js';
import { ulid } from '../util/ulid.js';
import { db, now } from './index.js';

interface PartnerRow {
  id: string;
  name: string;
  language: string;
  persona: string;
  level: string;
  memory: string;
  pending_hints: string;
  turns_since_memory: number;
  created_at: number;
  updated_at: number;
}

/** サーバー内部で使う、記憶の作業用の列まで含んだ形 */
export interface PartnerFull extends Partner {
  pending_hints: string[];
  turns_since_memory: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toPersona(raw: unknown): Persona {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_PERSONA };
  for (const k of Object.keys(out) as (keyof Persona)[]) {
    if (typeof p[k] === 'string') out[k] = (p[k] as string).trim().slice(0, 200);
  }
  return out;
}

function toLanguage(raw: unknown): Language {
  return LANGUAGES.some((l) => l.id === raw) ? (raw as Language) : 'zh';
}

function lastMessage(partnerId: string): Partner['last_message'] {
  const row = db
    .prepare(
      'SELECT role, text, created_at FROM messages WHERE partner_id = ? ORDER BY seq DESC LIMIT 1',
    )
    .get(partnerId) as Partner['last_message'] | undefined;
  return row ?? null;
}

function fromRow(r: PartnerRow): PartnerFull {
  return {
    id: r.id,
    name: r.name,
    language: toLanguage(r.language),
    persona: toPersona(parseJson(r.persona, {})),
    level: r.level,
    memory: r.memory,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_message: lastMessage(r.id),
    pending_hints: parseJson<string[]>(r.pending_hints, []),
    turns_since_memory: r.turns_since_memory,
  };
}

/** API に出す形（作業用の列を落とす） */
export function publicPartner(p: PartnerFull): Partner {
  const { pending_hints: _h, turns_since_memory: _t, ...rest } = p;
  return rest;
}

export function listPartners(): PartnerFull[] {
  const rows = db.prepare('SELECT * FROM partners').all() as PartnerRow[];
  // 最後に話した順。まだ話していない相手は作成日時で
  return rows
    .map(fromRow)
    .sort(
      (a, b) =>
        (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at),
    );
}

export function getPartner(id: string): PartnerFull | null {
  const row = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as PartnerRow | undefined;
  return row ? fromRow(row) : null;
}

/** 入力の検証。問題があればメッセージを返す */
export function validatePartnerInput(body: unknown): { input: PartnerInput } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: '名前を入力してください' };
  if (name.length > 40) return { error: '名前は40文字までにしてください' };
  const language = toLanguage(b.language);
  const level =
    typeof b.level === 'string' && LEVELS[language].includes(b.level) ? b.level : LEVELS[language][0];
  const input: PartnerInput = { name, language, persona: toPersona(b.persona), level };
  if (typeof b.memory === 'string') input.memory = b.memory.slice(0, 4000);
  return { input };
}

export function createPartner(input: PartnerInput): PartnerFull {
  const id = ulid();
  const t = now();
  db.prepare(
    `INSERT INTO partners (id, name, language, persona, level, memory, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.language, JSON.stringify(input.persona), input.level, input.memory ?? '', t, t);
  return getPartner(id)!;
}

export function updatePartner(id: string, input: PartnerInput): PartnerFull | null {
  const cur = getPartner(id);
  if (!cur) return null;
  db.prepare(
    `UPDATE partners SET name = ?, language = ?, persona = ?, level = ?, memory = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name,
    input.language,
    JSON.stringify(input.persona),
    input.level,
    input.memory ?? cur.memory,
    now(),
    id,
  );
  return getPartner(id);
}

export function deletePartner(id: string): boolean {
  return db.prepare('DELETE FROM partners WHERE id = ?').run(id).changes > 0;
}

/** 1ターン分の記憶の作業列を進める（ユーザー発言1回につき1回呼ぶ） */
export function noteTurn(id: string, hint: string | null): void {
  const p = getPartner(id);
  if (!p) return;
  const hints = hint ? [...p.pending_hints, hint].slice(-30) : p.pending_hints;
  db.prepare('UPDATE partners SET pending_hints = ?, turns_since_memory = turns_since_memory + 1 WHERE id = ?').run(
    JSON.stringify(hints),
    id,
  );
}

/**
 * 記憶を書き直した結果を保存する。
 * **取り込んだヒントだけを消す。** 要約の最中に次のターンが届いて増えた分は残す
 */
export function saveMemory(id: string, memory: string | null, consumedHints: number): void {
  const p = getPartner(id);
  if (!p) return;
  const rest = p.pending_hints.slice(consumedHints);
  if (memory === null) {
    db.prepare('UPDATE partners SET turns_since_memory = 0 WHERE id = ?').run(id);
    return;
  }
  db.prepare(
    'UPDATE partners SET memory = ?, pending_hints = ?, turns_since_memory = 0 WHERE id = ?',
  ).run(memory, JSON.stringify(rest), id);
}
