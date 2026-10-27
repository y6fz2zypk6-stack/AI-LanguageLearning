import type { ModelInfo } from '../../../shared/types.js';

/**
 * OpenRouter の呼び出し。aI-chatv2 の llm/openrouter.ts の非ストリーミング部分を元にしている。
 * 返答はJSONで受け取るので、ストリーミングはしない（途中のJSONは表示に使えない）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteResult {
  text: string;
  /** 'stop' / 'length' / 'content_filter' など。空応答の原因の切り分けに使う */
  finishReason: string;
  refusal: string;
  /** 実際に答えたモデル */
  model: string;
}

/** OPENROUTER_BASE_URL はテストでモックへ向けるための差し込み口 */
function baseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
}

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY が設定されていません（.env を確認してください）');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'http://localhost',
    'X-Title': process.env.APP_TITLE || 'Language Partner',
  };
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 90_000;

export async function complete(opts: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  json?: boolean;
  temperature?: number;
}): Promise<CompleteResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') {
      throw new Error(`応答が${Math.round(TIMEOUT_MS / 1000)}秒以内に返ってきませんでした`);
    }
    throw new Error(`OpenRouter に接続できませんでした（${e.message}）`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      // JSONでなければ本文の頭をそのまま出す
    }
    throw new Error(`OpenRouter からエラー ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[];
  };
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? '',
    refusal: choice?.message?.refusal ?? '',
    model: json.model ?? opts.model,
  };
}

// ---- モデル一覧（設定画面の候補。1時間キャッシュ） ----

let modelCache: { at: number; models: ModelInfo[] } | null = null;

export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 60 * 60 * 1000) return modelCache.models;
  const res = await fetch(`${baseUrl()}/models`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`モデル一覧の取得に失敗しました: ${res.status}`);
  const json = (await res.json()) as { data?: { id: string; name?: string }[] };
  const models = (json.data ?? []).map((m) => ({ id: m.id, name: m.name || m.id }));
  modelCache = { at: Date.now(), models };
  return models;
}
