import type { Message, SendResult } from '../../../shared/types.js';
import { db } from '../db/index.js';
import { insertMessage, recentForPrompt } from '../db/messages.js';
import { insertMistakes } from '../db/mistakes.js';
import { getPartner, noteTurn, type PartnerFull } from '../db/partners.js';
import { getSettings } from '../db/settings.js';
import { complete, type ChatMessage } from '../llm/openrouter.js';
import { parseReply, rawFallbackText, type ParsedReply } from '../llm/parse.js';
import { buildSystemPrompt, historyMessages } from '../llm/prompt.js';
import { maybeUpdateMemory } from './memory.js';

export class ChatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 相手ごとの生成中フラグ。二重送信で seq が食い違うのを防ぐ */
const busy = new Set<string>();

const MAX_INPUT = 1000;
const MAX_TOKENS = 1200;

/** モデルへ送るメッセージ列。**先頭は必ず user にする**（assistant 始まりを拒む接続先がある） */
function buildMessages(p: PartnerFull, history: Message[], userText: string | null): ChatMessage[] {
  const msgs: ChatMessage[] = historyMessages(history);
  if (userText !== null) msgs.push({ role: 'user', content: userText });
  if (!msgs.length || msgs[0].role !== 'user') {
    msgs.unshift({ role: 'user', content: '（チャットを開きました）' });
  }
  return [{ role: 'system', content: buildSystemPrompt(p, { opening: userText === null }) }, ...msgs];
}

interface Generated {
  parsed: ParsedReply | null;
  raw: string;
  model: string;
  warnings: string[];
}

/**
 * 1回生成する。JSONとして読めなければ1度だけやり直す。
 * JSONモードで空を返すモデルがあるので、2回目はJSONモードを外す
 */
async function generate(model: string, messages: ChatMessage[]): Promise<Generated> {
  const warnings: string[] = [];
  let last = { text: '', model };
  for (const json of [true, false]) {
    const r = await complete({ model, messages, maxTokens: MAX_TOKENS, json });
    if (r.refusal) throw new ChatError(502, `モデルが応答を拒否しました: ${r.refusal.slice(0, 120)}`);
    last = { text: r.text, model: r.model };
    const parsed = parseReply(r.text);
    if (parsed) return { parsed, raw: r.text, model: r.model, warnings };
    if (r.finishReason === 'length') {
      warnings.push('応答が長すぎて途中で切れました');
      break;
    }
    warnings.push('応答の形式が崩れていたので、もう一度生成しました');
  }
  if (!last.text.trim()) throw new ChatError(502, 'モデルが空の応答を返しました。設定でモデルを変えてみてください');
  warnings.push('形式どおりに返ってこなかったので、そのまま表示しています');
  return { parsed: null, raw: last.text, model: last.model, warnings };
}

async function withLock<T>(partnerId: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(partnerId)) throw new ChatError(409, '前のメッセージの返事を待っています');
  busy.add(partnerId);
  try {
    return await fn();
  } finally {
    busy.delete(partnerId);
  }
}

/**
 * ユーザーの発言を送り、返事と矯正を受け取る。
 * **成功したときだけ、発言と返事をまとめて保存する。** 失敗時は何も残さない
 * （画面側が入力欄に文を戻すので、送り直せばよい）
 */
export async function sendMessage(partnerId: string, rawText: unknown): Promise<SendResult> {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) throw new ChatError(400, 'メッセージが空です');
  if (text.length > MAX_INPUT) throw new ChatError(400, `メッセージは${MAX_INPUT}文字までにしてください`);

  return withLock(partnerId, async () => {
    const p = getPartner(partnerId);
    if (!p) throw new ChatError(404, '相手が見つかりません');
    const settings = getSettings();
    const history = recentForPrompt(partnerId, settings.history_turns);
    const g = await generate(settings.chat_model, buildMessages(p, history, text));

    const corrections = g.parsed?.corrections ?? [];
    const result = db.transaction((): SendResult => {
      const user = insertMessage(partnerId, { role: 'user', text, corrections });
      const assistant = insertMessage(partnerId, {
        role: 'assistant',
        text: g.parsed ? g.parsed.reply : rawFallbackText(g.raw),
        text_ja: g.parsed?.reply_ja ?? '',
        status: g.parsed ? 'ok' : 'raw',
        model: g.model,
      });
      if (corrections.length) {
        insertMistakes({
          partnerId,
          partnerName: p.name,
          messageId: user.id,
          language: p.language,
          context: text,
          corrections,
        });
      }
      noteTurn(partnerId, g.parsed?.memory_hint ?? null);
      return { user, assistant, warnings: g.warnings };
    })();

    // 記憶の書き直しは返事を待たせない。失敗しても会話には影響させない
    void maybeUpdateMemory(partnerId).catch((err) =>
      console.warn(`[memory] ${partnerId}: ${(err as Error).message}`),
    );
    return result;
  });
}

/** 会話がまだ無いときに、相手から話しかけてもらう */
export async function greet(partnerId: string): Promise<SendResult> {
  return withLock(partnerId, async () => {
    const p = getPartner(partnerId);
    if (!p) throw new ChatError(404, '相手が見つかりません');
    if (p.last_message) throw new ChatError(409, 'もう会話が始まっています');
    const settings = getSettings();
    const g = await generate(settings.chat_model, buildMessages(p, [], null));
    const assistant = db.transaction(() =>
      insertMessage(partnerId, {
        role: 'assistant',
        text: g.parsed ? g.parsed.reply : rawFallbackText(g.raw),
        text_ja: g.parsed?.reply_ja ?? '',
        status: g.parsed ? 'ok' : 'raw',
        model: g.model,
      }),
    )();
    return { user: null, assistant, warnings: g.warnings };
  });
}

/** テスト・調査用: いま生成中か */
export function isBusy(partnerId: string): boolean {
  return busy.has(partnerId);
}
