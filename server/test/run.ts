// 結合テスト。OpenRouter互換のモックとサーバーを立て、実際のAPIを叩いて確かめる。
// 一時ディレクトリのDBを使うので、本番のDBには触らない。OPENROUTER_API_KEY も不要
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Message, Mistake, MistakeStats, Partner, SendResult, Settings } from '../../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');

const MOCK_PORT = 4620;
const PORT = 3620;
const AUTH_PORT = 3621;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'langpartner-test-'));
const children: ChildProcess[] = [];

function start(cmd: string[], env: Record<string, string>, ready: RegExp): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cmd, {
      cwd: serverDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let log = '';
    const onData = (d: Buffer) => {
      log += d.toString();
      if (ready.test(log)) resolve(child);
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', (code) => reject(new Error(`起動に失敗しました (${code}):\n${log}`)));
    setTimeout(() => reject(new Error(`起動待ちがタイムアウトしました:\n${log}`)), 20_000);
  });
}

function serverEnv(port: number, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PORT: String(port),
    BIND: '127.0.0.1',
    DB_PATH: path.join(tmp, `app-${port}.sqlite`),
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_BASE_URL: `${MOCK}/v1`,
    APP_PASSWORD: '',
    DEFAULT_MODEL: 'test/chat-model',
    UTILITY_MODEL: 'test/utility-model',
    ...extra,
  };
}

async function call<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T; headers: Headers }> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as T, headers: res.headers };
}

const api = <T = unknown>(method: string, p: string, body?: unknown) =>
  call<T>(method, `http://127.0.0.1:${PORT}/api${p}`, body);

async function queue(items: unknown[]): Promise<void> {
  await call('PUT', `${MOCK}/__queue`, items);
  await call('DELETE', `${MOCK}/__requests`);
}

interface SeenRequest {
  model: string;
  messages: { role: string; content: string }[];
  response_format?: unknown;
}
const seen = async () => (await call<SeenRequest[]>('GET', `${MOCK}/__requests`)).json;

const reply = (o: Record<string, unknown>) => ({
  content: JSON.stringify({ corrections: [], reply_ja: '', memory_hint: null, ...o }),
});

async function waitFor(fn: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`待っても ${what} になりませんでした`);
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ok ${name}`);
}

async function main(): Promise<void> {
  await start([path.join(here, 'mock-llm.mjs')], { MOCK_PORT: String(MOCK_PORT) }, /\[mock\]/);
  await start([tsxCli, 'src/index.ts'], serverEnv(PORT), /待ち受けています/);
  console.log('run');

  let partner!: Partner;

  await test('認証なし構成ではセッションが通る', async () => {
    const r = await api<{ authenticated: boolean; authRequired: boolean }>('GET', '/session');
    assert.deepEqual(r.json, { authenticated: true, authRequired: false });
  });

  await test('相手の作成: 名前が空なら400、レベルは言語の候補に丸める', async () => {
    assert.equal((await api('POST', '/partners', { name: ' ' })).status, 400);
    const r = await api<Partner>('POST', '/partners', {
      name: '陈宇',
      language: 'zh',
      level: 'B2',
      persona: { gender: '男性', age: '27', hometown: '成都出身、上海在住', unknown: 'x' },
    });
    assert.equal(r.status, 201);
    partner = r.json;
    assert.equal(partner.level, 'HSK3');
    assert.equal(partner.persona.hometown, '成都出身、上海在住');
    assert.equal((partner.persona as unknown as Record<string, unknown>).unknown, undefined);
    assert.equal(partner.last_message, null);
  });

  await test('相手から話しかける。会話が始まっていれば409', async () => {
    await queue([reply({ reply: '你好！我是陈宇。你周末一般做什么？', reply_ja: 'こんにちは！陳宇です。週末は何してる？' })]);
    const r = await api<SendResult>('POST', `/partners/${partner.id}/greet`);
    assert.equal(r.status, 200);
    assert.equal(r.json.user, null);
    assert.equal(r.json.assistant.role, 'assistant');
    assert.equal(r.json.assistant.text_ja, 'こんにちは！陳宇です。週末は何してる？');
    const [req] = await seen();
    assert.match(req.messages[0].content, /最初の会話/);
    // assistant しかいなくても、先頭は user になっている
    assert.equal(req.messages[1].role, 'user');
    assert.equal(req.model, 'test/chat-model');
    assert.deepEqual(req.response_format, { type: 'json_object' });
    assert.equal((await api('POST', `/partners/${partner.id}/greet`)).status, 409);
  });

  await test('発言を送ると、返事・矯正・間違いログがまとめて保存される', async () => {
    await queue([
      reply({
        corrections: [
          { original: '我因该去', fixed: '我应该去', type: 'error', note_ja: '「因该」は誤字' },
          { original: '很好玩', fixed: '挺好玩的', type: 'unnatural', note_ja: '口語ではこちらが自然' },
        ],
        reply: '那你应该去试试！',
        reply_ja: 'じゃあ行ってみなよ！',
        memory_hint: '週末に上海へ行く予定',
      }),
    ]);
    const r = await api<SendResult>('POST', `/partners/${partner.id}/messages`, { text: '我因该去上海，很好玩' });
    assert.equal(r.status, 200);
    assert.equal(r.json.user!.corrections.length, 2);
    assert.equal(r.json.assistant.text, '那你应该去试试！');
    assert.deepEqual(r.json.warnings, []);
    assert.equal(r.json.user!.seq + 1, r.json.assistant.seq);

    const [req] = await seen();
    assert.doesNotMatch(req.messages[0].content, /最初の会話/);
    assert.match(req.messages[0].content, /成都出身、上海在住/);
    const last = req.messages[req.messages.length - 1];
    assert.deepEqual(last, { role: 'user', content: '我因该去上海，很好玩' });
    // 履歴の assistant は本文だけ（訳は送らない）
    assert.ok(req.messages.some((m) => m.role === 'assistant' && m.content === '你好！我是陈宇。你周末一般做什么？'));

    const log = await api<{ items: Mistake[]; stats: MistakeStats }>('GET', '/mistakes');
    assert.equal(log.json.items.length, 2);
    assert.deepEqual(log.json.stats, { total: 2, unreviewed: 2 });
    assert.equal(log.json.items[0].context, '我因该去上海，很好玩');
    assert.equal(log.json.items[0].partner_name, '陈宇');
  });

  await test('形式が崩れたら1度だけやり直す（2回目はJSONモードなし）', async () => {
    await queue([{ content: 'すみません、JSONではありません' }, reply({ reply: '好的' })]);
    const r = await api<SendResult>('POST', `/partners/${partner.id}/messages`, { text: '好' });
    assert.equal(r.status, 200);
    assert.equal(r.json.assistant.text, '好的');
    assert.equal(r.json.assistant.status, 'ok');
    assert.equal(r.json.warnings.length, 1);
    const reqs = await seen();
    assert.equal(reqs.length, 2);
    assert.ok(reqs[0].response_format);
    assert.equal(reqs[1].response_format, undefined);
  });

  await test('2回とも崩れたら、そのまま表示する（raw）', async () => {
    await queue([{ content: '```\n嗯嗯\n```' }, { content: '```\n嗯嗯\n```' }]);
    const r = await api<SendResult>('POST', `/partners/${partner.id}/messages`, { text: '嗯' });
    assert.equal(r.status, 200);
    assert.equal(r.json.assistant.status, 'raw');
    assert.equal(r.json.assistant.text, '嗯嗯');
    assert.equal(r.json.user!.corrections.length, 0);
  });

  await test('上流が失敗したら502で、何も保存しない', async () => {
    const before = (await api<Message[]>('GET', `/partners/${partner.id}/messages`)).json.length;
    await queue([{ status: 500, error: 'upstream down' }]);
    const r = await api<{ error: string }>('POST', `/partners/${partner.id}/messages`, { text: '在吗' });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /upstream down/);
    const after = (await api<Message[]>('GET', `/partners/${partner.id}/messages`)).json.length;
    assert.equal(after, before);
  });

  await test('空のメッセージは400、生成中の二重送信は409', async () => {
    assert.equal((await api('POST', `/partners/${partner.id}/messages`, { text: '  ' })).status, 400);
    await queue([{ ...reply({ reply: '慢' }), delayMs: 400 }]);
    const first = api('POST', `/partners/${partner.id}/messages`, { text: '一' });
    await new Promise((r) => setTimeout(r, 100));
    const second = await api('POST', `/partners/${partner.id}/messages`, { text: '二' });
    assert.equal(second.status, 409);
    assert.equal((await first).status, 200);
  });

  await test('設定は型と範囲に収められる', async () => {
    const r = await api<Settings>('PUT', '/settings', {
      pinyin_mode: 'weird',
      tts_rate: 9,
      memory_every: 3,
      tone_colors: false,
      chat_model: '  ',
    });
    assert.equal(r.json.pinyin_mode, 'tap');
    assert.equal(r.json.tts_rate, 1.5);
    assert.equal(r.json.memory_every, 3);
    assert.equal(r.json.tone_colors, false);
    assert.equal(r.json.chat_model, 'test/chat-model');
  });

  await test('決まった往復数ごとに記憶を書き直す（ヒントがあるときだけ）', async () => {
    // 新しい相手で数え直す（memory_every = 3）
    const p = (await api<Partner>('POST', '/partners', { name: 'Amy', language: 'en', level: 'B1' })).json;
    await queue([
      reply({ reply: 'Nice!', memory_hint: 'Works at a bank' }),
      reply({ reply: 'Cool.' }),
      reply({ reply: 'Wow.', memory_hint: 'Has a cat' }),
      { content: '- 銀行で働いている\n- 猫を飼っている' },
    ]);
    for (const t of ['I work at bank', 'yes', 'I have cat']) {
      assert.equal((await api('POST', `/partners/${p.id}/messages`, { text: t })).status, 200);
    }
    await waitFor(
      async () => (await api<Partner>('GET', `/partners/${p.id}`)).json.memory.includes('猫'),
      '記憶の書き直し',
    );
    const reqs = await seen();
    const memReq = reqs[reqs.length - 1];
    assert.equal(memReq.model, 'test/utility-model');
    assert.match(memReq.messages[0].content, /- Works at a bank\n- Has a cat/);
    assert.equal(memReq.response_format, undefined);

    // 次の会話からは記憶がプロンプトに入る
    await queue([reply({ reply: 'How is your cat?' })]);
    await api('POST', `/partners/${p.id}/messages`, { text: 'hi' });
    const [next] = await seen();
    assert.match(next.messages[0].content, /- 猫を飼っている/);
    assert.match(next.messages[0].content, /CEFR B1/);

    // ヒントが無い区切りではモデルを呼ばない
    await queue([reply({ reply: 'a' }), reply({ reply: 'b' })]);
    await api('POST', `/partners/${p.id}/messages`, { text: 'x' });
    await api('POST', `/partners/${p.id}/messages`, { text: 'y' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await seen()).length, 2);
  });

  await test('間違いログ: 絞り込み・復習済み・削除', async () => {
    const all = (await api<{ items: Mistake[] }>('GET', '/mistakes')).json.items;
    const unnatural = (await api<{ items: Mistake[] }>('GET', '/mistakes?type=unnatural')).json.items;
    assert.equal(unnatural.length, 1);
    assert.equal(unnatural[0].fixed, '挺好玩的');
    const m = (await api<Mistake>('PUT', `/mistakes/${unnatural[0].id}`, { reviewed: true })).json;
    assert.equal(m.reviewed, true);
    const r = await api<{ items: Mistake[]; stats: MistakeStats }>('GET', '/mistakes?unreviewed=1');
    assert.equal(r.json.items.length, all.length - 1);
    assert.equal(r.json.stats.unreviewed, all.length - 1);
    assert.equal((await api('DELETE', `/mistakes/${unnatural[0].id}`)).status, 200);
    assert.equal((await api('DELETE', `/mistakes/${unnatural[0].id}`)).status, 404);
  });

  await test('名前を変えるとログの控えも変わる。言語は変えられない', async () => {
    const body = { name: '小陈', language: 'zh', level: 'HSK4', persona: partner.persona };
    const r = await api<Partner>('PUT', `/partners/${partner.id}`, body);
    assert.equal(r.status, 200);
    assert.equal(r.json.level, 'HSK4');
    const log = (await api<{ items: Mistake[] }>('GET', `/mistakes?partner=${partner.id}`)).json.items;
    assert.ok(log.length > 0 && log.every((m) => m.partner_name === '小陈'));
    assert.equal((await api('PUT', `/partners/${partner.id}`, { ...body, language: 'en' })).status, 400);
  });

  await test('会話のリセットと相手の削除。間違いログは残る', async () => {
    const reset = await api<{ deleted: number }>('DELETE', `/partners/${partner.id}/messages`);
    assert.ok(reset.json.deleted > 0);
    assert.equal((await api<Message[]>('GET', `/partners/${partner.id}/messages`)).json.length, 0);
    const before = (await api<{ items: Mistake[] }>('GET', '/mistakes')).json.items.length;
    assert.equal((await api('DELETE', `/partners/${partner.id}`)).status, 200);
    const after = (await api<{ items: Mistake[] }>('GET', '/mistakes')).json.items;
    assert.equal(after.length, before);
    assert.ok(after.some((m) => m.partner_id === null && m.partner_name === '小陈'));
    assert.equal((await api('GET', `/partners/${partner.id}`)).status, 404);
  });

  await test('一覧は最後に話した順', async () => {
    const list = (await api<Partner[]>('GET', '/partners')).json;
    assert.equal(list[0].name, 'Amy');
    assert.equal(list[0].last_message?.text, 'b');
  });

  await test('モデル一覧と、存在しないAPIの404', async () => {
    const models = await api<{ id: string }[]>('GET', '/models');
    assert.ok(models.json.some((m) => m.id === '~anthropic/claude-sonnet-latest'));
    assert.equal((await api('GET', '/nope')).status, 404);
  });

  await test('APP_PASSWORD があるとログインが要る', async () => {
    await start([tsxCli, 'src/index.ts'], serverEnv(AUTH_PORT, { APP_PASSWORD: 'secret' }), /待ち受けています/);
    const base = `http://127.0.0.1:${AUTH_PORT}/api`;
    assert.equal((await call('GET', `${base}/partners`)).status, 401);
    assert.equal((await call('POST', `${base}/login`, { password: 'nope' })).status, 401);
    const ok = await call('POST', `${base}/login`, { password: 'secret' });
    assert.equal(ok.status, 200);
    const sid = /sid=([^;]+)/.exec(ok.headers.get('set-cookie') ?? '')?.[1];
    assert.ok(sid);
    assert.equal((await call('GET', `${base}/partners`, undefined, { Cookie: `sid=${sid}` })).status, 200);
  });

  await test('パスワードも到達制限も無い構成では起動しない', async () => {
    const r = await start([tsxCli, 'src/index.ts'], serverEnv(3622, { BIND: '' }), /起動を中止/).then(
      () => 'refused',
      (e: Error) => e.message,
    );
    assert.equal(r, 'refused');
  });

  console.log(`run: ${passed} passed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const c of children) c.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
