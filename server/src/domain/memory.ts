import { listMessages } from '../db/messages.js';
import { getPartner, saveMemory } from '../db/partners.js';
import { getSettings, utilityModel } from '../db/settings.js';
import { complete } from '../llm/openrouter.js';
import { cleanMemory } from '../llm/parse.js';
import { buildMemoryPrompt } from '../llm/prompt.js';

/** 同じ相手の書き直しを重ねて走らせない */
const running = new Set<string>();

/**
 * 決まった往復数ごとに、相手の記憶を書き直す。
 * 新しく分かったこと（memory_hint）が無ければモデルは呼ばずに数え直すだけ
 */
export async function maybeUpdateMemory(partnerId: string): Promise<'skipped' | 'updated' | 'kept'> {
  const settings = getSettings();
  const p = getPartner(partnerId);
  if (!p || p.turns_since_memory < settings.memory_every || running.has(partnerId)) return 'skipped';
  if (!p.pending_hints.length) {
    saveMemory(partnerId, null, 0);
    return 'skipped';
  }
  running.add(partnerId);
  try {
    const hints = p.pending_hints;
    const recent = listMessages(partnerId, { limit: settings.memory_every * 2 });
    const r = await complete({
      model: utilityModel(settings),
      messages: [{ role: 'user', content: buildMemoryPrompt(p, hints, recent) }],
      maxTokens: 800,
    });
    const memory = cleanMemory(r.text);
    // 書けなかったときは今のメモとヒントを残し、次の区切りでやり直す
    saveMemory(partnerId, memory, memory ? hints.length : 0);
    return memory ? 'updated' : 'kept';
  } catch (err) {
    // 毎ターン呼び直さないよう、数だけ戻してから投げる（ヒントは残る）
    saveMemory(partnerId, null, 0);
    throw err;
  } finally {
    running.delete(partnerId);
  }
}
