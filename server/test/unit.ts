// 外部に依存しない部分の単体テスト（DBもHTTPも使わない）
import assert from 'node:assert/strict';
import { EMPTY_PERSONA } from '../../shared/types.js';
import type { PartnerFull } from '../src/db/partners.js';
import { cleanMemory, extractJsonObject, parseReply, rawFallbackText } from '../src/llm/parse.js';
import { buildMemoryPrompt, buildSystemPrompt } from '../src/llm/prompt.js';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok ${name}`);
}

console.log('unit');

test('形式どおりのJSONを読む', () => {
  const r = parseReply(
    JSON.stringify({
      corrections: [{ original: '我因该去', fixed: '我应该去', type: 'error', note_ja: '誤字' }],
      reply: '那你应该去试试！',
      reply_ja: 'じゃあ行ってみなよ！',
      memory_hint: '週末に上海へ行く',
    }),
  );
  assert.ok(r);
  assert.equal(r.reply, '那你应该去试试！');
  assert.equal(r.corrections.length, 1);
  assert.equal(r.corrections[0].type, 'error');
  assert.equal(r.memory_hint, '週末に上海へ行く');
});

test('コードフェンスや前置きがあっても読む', () => {
  const r = parseReply('はい、どうぞ。\n```json\n{"corrections":[],"reply":"好啊","reply_ja":"いいよ","memory_hint":null}\n```');
  assert.ok(r);
  assert.equal(r.reply, '好啊');
  assert.equal(r.memory_hint, null);
});

test('reply が無ければ失敗', () => {
  assert.equal(parseReply('{"corrections":[]}'), null);
  assert.equal(parseReply('不是JSON'), null);
  assert.equal(parseReply('{"reply": "壊れた'), null);
});

test('壊れた矯正は捨て、同じ文の「訂正」も捨て、最大3件', () => {
  const r = parseReply(
    JSON.stringify({
      corrections: [
        { original: 'a', fixed: 'a', type: 'error' },
        null,
        'x',
        { original: '1', fixed: '2', type: 'weird' },
        { original: '3', fixed: '4', type: 'unnatural' },
        { original: '5', fixed: '6' },
        { original: '7', fixed: '8' },
      ],
      reply: 'ok',
    }),
  );
  assert.ok(r);
  assert.deepEqual(
    r.corrections.map((c) => [c.original, c.type]),
    [
      ['1', 'error'],
      ['3', 'unnatural'],
      ['5', 'error'],
    ],
  );
  assert.equal(r.reply_ja, '');
});

test('memory_hint の「null」文字列は null 扱い', () => {
  assert.equal(parseReply('{"reply":"x","memory_hint":"null"}')?.memory_hint, null);
  assert.equal(parseReply('{"reply":"x","memory_hint":"なし"}')?.memory_hint, null);
});

test('extractJsonObject / rawFallbackText', () => {
  assert.equal(extractJsonObject('xx {"a":1} yy'), '{"a":1}');
  assert.equal(extractJsonObject('no json'), '');
  assert.equal(rawFallbackText('```json\n你好\n```'), '你好');
});

test('記憶の整形: 箇条書きだけ拾い、20行まで', () => {
  assert.equal(cleanMemory('前置き\n- 仕事は金融\n・猫を飼っている\n\nおわり'), '- 仕事は金融\n- 猫を飼っている');
  assert.equal(cleanMemory('箇条書きなし'), null);
  const many = Array.from({ length: 30 }, (_, i) => `- ${i}`).join('\n');
  assert.equal(cleanMemory(many)?.split('\n').length, 20);
});

const partner: PartnerFull = {
  id: 'p1',
  name: '陈宇',
  language: 'zh',
  persona: { ...EMPTY_PERSONA, hometown: '成都出身、上海在住', age: '27' },
  level: 'HSK3',
  memory: '- 仕事は金融',
  created_at: 0,
  updated_at: 0,
  last_message: null,
  pending_hints: [],
  turns_since_memory: 0,
};

test('システムプロンプト: 設定・レベル・記憶が入り、空の項目は出ない', () => {
  const s = buildSystemPrompt(partner);
  assert.match(s, /「陈宇」/);
  assert.match(s, /HSK3程度/);
  assert.match(s, /- 出身・在住: 成都出身、上海在住/);
  assert.doesNotMatch(s, /- 職業:/);
  assert.match(s, /- 仕事は金融$/);
  assert.doesNotMatch(s, /最初の会話/);
  assert.match(buildSystemPrompt(partner, { opening: true }), /最初の会話/);
});

test('英語の相手はCEFRと英語の指定になる', () => {
  const s = buildSystemPrompt({ ...partner, language: 'en', level: 'B1', persona: { ...partner.persona, variant: 'uk' } });
  assert.match(s, /CEFR B1/);
  assert.match(s, /reply: 英語のみ/);
  assert.match(s, /イギリス英語/);
});

test('記憶のプロンプトにヒントと会話が入る', () => {
  const s = buildMemoryPrompt(partner, ['週末に上海へ行く'], [
    { id: 'm', partner_id: 'p1', seq: 1, role: 'user', text: '我周末去上海', text_ja: '', corrections: [], status: 'ok', created_at: 0 },
  ]);
  assert.match(s, /- 週末に上海へ行く/);
  assert.match(s, /ユーザー: 我周末去上海/);
});

console.log(`unit: ${passed} passed`);
