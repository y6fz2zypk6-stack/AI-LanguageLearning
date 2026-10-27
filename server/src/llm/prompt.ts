import type { Language, Message, Persona } from '../../../shared/types.js';
import type { PartnerFull } from '../db/partners.js';
import type { ChatMessage } from './openrouter.js';

/** 言語ごとに変わる部分。ここ以外は共通 */
interface LangSpec {
  /** 「ユーザーは〇〇を学んでいる」 */
  learning: string;
  /** reply に使う言語の指定 */
  replyRule: string;
  /** レベルの説明 */
  levelRule: (level: string) => string;
  /** 指摘しない細かい違い */
  ignoreRule: string;
}

const LANG: Record<Language, LangSpec> = {
  zh: {
    learning: '中国語（普通话・簡体字）',
    replyRule: '中国語（簡体字）のみ。日本語訳やピンインを混ぜない',
    levelRule: (level) =>
      `ユーザーのレベルは${level}程度。この範囲の語彙と文の長さを中心にし、それを超える語は1回の返信で1〜2語までにする`,
    ignoreRule: '句読点の全角・半角、くだけた表記、口語として自然な省略',
  },
  en: {
    learning: '英語',
    replyRule: '英語のみ。日本語を混ぜない',
    levelRule: (level) =>
      `ユーザーのレベルはCEFR ${level}程度。この範囲の語彙と文の長さを中心にし、それを超える語は1回の返信で1〜2語までにする`,
    ignoreRule: '大文字・小文字、句読点、チャットらしいくだけた表記（lol, gonna など）、口語として自然な省略',
  },
};

const PERSONA_LABELS: [keyof Persona, string][] = [
  ['gender', '性別'],
  ['age', '年齢'],
  ['hometown', '出身・在住'],
  ['occupation', '職業'],
  ['personality', '性格・口調'],
  ['hobbies', '趣味'],
];

function personaBlock(p: PartnerFull): string {
  const lines = [`- 名前: ${p.name}`];
  for (const [k, label] of PERSONA_LABELS) {
    if (p.persona[k]) lines.push(`- ${label}: ${p.persona[k]}`);
  }
  if (p.language === 'en' && p.persona.variant) {
    lines.push(`- 使う英語: ${p.persona.variant === 'uk' ? 'イギリス英語（綴り・語彙とも）' : 'アメリカ英語（綴り・語彙とも）'}`);
  }
  return lines.join('\n');
}

/**
 * 会話用のシステムプロンプト。
 * 変わらない部分（役割・ルール・出力形式）を前に、変わる部分（記憶）を最後に置く。
 */
export function buildSystemPrompt(p: PartnerFull, opts: { opening?: boolean } = {}): string {
  const L = LANG[p.language];
  const memory = p.memory.trim() || '（まだ何もない）';
  const opening = opts.opening
    ? `
# 今回について
これは最初の会話で、ユーザーはまだ何も言っていない。あなたから軽く話しかけて会話を始める。
簡単な自己紹介と、答えやすい質問を1つ。corrections は空配列、memory_hint は null。
`
    : '';

  return `あなたは言語交換アプリでユーザーの会話相手をしている「${p.name}」です。ユーザーは日本語話者で、${L.learning}を学んでいます。

# 会話のしかた
- 返信は1〜3文。友達とのチャットらしい自然な口語にし、教科書のような硬い文にしない
- ${L.levelRule(p.level)}
- ときどき質問を返して会話を続ける。質問攻めにはしない
- 授業や説教はしない。あくまで雑談
- 恋愛的な展開にはしない
- ユーザーが日本語や英語を混ぜても、そのまま会話を続ける
- 下の「あなたの設定」の人物として、出身地や仕事、趣味を自然に話題に出してよい

# 間違いの指摘（corrections）
- 対象はユーザーの最新の発言だけ。それより前の発言は見直さない
- type は次のどちらか
  - error: 誤字、文法、語順、語の選び方の誤り
  - unnatural: 通じるが、ネイティブならそうは言わない言い方
- 指摘しないもの: ${L.ignoreRule}。日本語や英語が混ざっていること自体
- 最大3件。重要なものから
- original はユーザーの文から直す部分をそのまま抜き出す。短すぎて意味が分からなくなる場合は文全体
- fixed は original を直したもの。original と同じなら指摘しない
- note_ja は日本語で1文。なぜ直すのかを短く
- 間違いがなければ空配列
- 返信（reply）の中では間違いに触れない。指摘は corrections に任せる

# 覚えておくこと（memory_hint）
- ユーザー本人について今回新しく分かった、次回以降も覚えておく価値のある事実（仕事、予定、好み、出来事）を日本語で短く1つ
- なければ null。学習中の言語の間違いや、会話の流れは書かない

# 出力
次の形のJSONオブジェクトだけを出力する。前後に説明やコードフェンスを付けない。
{"corrections":[{"original":"…","fixed":"…","type":"error","note_ja":"…"}],"reply":"…","reply_ja":"…","memory_hint":null}
- reply: ${L.replyRule}
- reply_ja: reply の自然な日本語訳
${opening}
# あなたの設定
${personaBlock(p)}

# ユーザーについて覚えていること
${memory}`;
}

/** 履歴をモデルに渡す形にする。assistant は本文だけ（訳や矯正はトークンの無駄） */
export function historyMessages(history: Message[]): ChatMessage[] {
  return history.map((m) => ({ role: m.role, content: m.text }));
}

/** 記憶の書き直し用プロンプト */
export function buildMemoryPrompt(p: PartnerFull, hints: string[], recent: Message[]): string {
  const convo = recent
    .map((m) => `${m.role === 'user' ? 'ユーザー' : p.name}: ${m.text}`)
    .join('\n');
  return `あなたは会話アプリの記憶係です。会話相手の「${p.name}」がユーザーについて覚えておくメモを書き直してください。

# ルール
- 今のメモ、新しく分かったこと、最近の会話をもとに、メモ全体を書き直す
- 日本語の箇条書き（各行「- 」で始める）で最大20行
- ユーザー本人についての事実だけ（仕事、住んでいる場所、予定、好み、最近の出来事、家族やペットなど）
- 語学の間違いや学習状況、会話の流れそのものは書かない
- 今のメモにある事実は、矛盾する新情報がない限り残す。過ぎた予定は過去のこととして短くする
- メモだけを出力する。前置きや見出しは書かない

# 今のメモ
${p.memory.trim() || '（まだ何もない）'}

# 新しく分かったこと
${hints.map((h) => `- ${h}`).join('\n') || '（なし）'}

# 最近の会話
${convo || '（なし）'}`;
}
