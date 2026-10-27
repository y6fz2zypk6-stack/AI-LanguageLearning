import type { Correction, CorrectionType } from '../../../shared/types.js';

export interface ParsedReply {
  corrections: Correction[];
  reply: string;
  reply_ja: string;
  memory_hint: string | null;
}

const MAX_CORRECTIONS = 3;

/** 前後の説明やコードフェンスを除いて、最初の `{` から最後の `}` までを取り出す */
export function extractJsonObject(raw: string): string {
  const s = raw.trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return '';
  return s.slice(start, end + 1);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function toType(v: unknown): CorrectionType {
  return v === 'unnatural' ? 'unnatural' : 'error';
}

/**
 * モデルの応答を読む。**reply が取れなければ失敗（null）。**
 * corrections の壊れた要素は捨てるが、全体は失敗にしない（会話を止めないため）
 */
export function parseReply(raw: string): ParsedReply | null {
  const body = extractJsonObject(raw);
  if (!body) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  const reply = str(obj.reply);
  if (!reply) return null;

  const corrections: Correction[] = [];
  const list = Array.isArray(obj.corrections) ? obj.corrections : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const original = str(c.original);
    const fixed = str(c.fixed);
    // 同じものを「直した」とする指摘は出さない
    if (!original || !fixed || original === fixed) continue;
    corrections.push({ original, fixed, type: toType(c.type), note_ja: str(c.note_ja) });
    if (corrections.length >= MAX_CORRECTIONS) break;
  }

  const hint = str(obj.memory_hint);
  return {
    corrections,
    reply,
    reply_ja: str(obj.reply_ja),
    // "null" や「なし」を文字列で返すモデルがある
    memory_hint: hint && !/^(null|none|なし|特になし)$/i.test(hint) ? hint.slice(0, 200) : null,
  };
}

const MAX_MEMORY_LINES = 20;

/** 記憶の書き直しの出力から箇条書きの行だけを拾う。1行も無ければ null（＝今のメモを残す） */
export function cleanMemory(raw: string): string | null {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-・*•]\s*/.test(l))
    .map((l) => `- ${l.replace(/^[-・*•]\s*/, '').trim()}`)
    .filter((l) => l.length > 2)
    .slice(0, MAX_MEMORY_LINES);
  return lines.length ? lines.join('\n') : null;
}

/** JSONとして読めなかった応答を、吹き出しに出せる形にする */
export function rawFallbackText(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}
