import { useEffect, useState } from 'react';

/**
 * ピンイン（pinyin-pro）。辞書が大きいので、中国語を表示するときに初めて読み込む。
 *
 * **表示を壊さないことを最優先にする。** 読み込みに失敗した・結果が元の文と合わない、
 * といった場合はピンイン無しの本文に落とす。
 */

export interface Piece {
  /** 元の文字（漢字なら1文字、それ以外はまとまり） */
  text: string;
  /** 漢字のときだけ */
  py: string | null;
  /** 1〜4、軽声は 5 */
  tone: number;
}

type PinyinFn = (text: string, opts: { type: 'all' }) => unknown;

let pinyinFn: PinyinFn | null = null;
let loading: Promise<void> | null = null;
let failed = false;
const readyListeners = new Set<() => void>();

export function loadPinyin(): Promise<void> {
  if (pinyinFn || failed) return Promise.resolve();
  loading ??= import('pinyin-pro')
    .then((m) => {
      pinyinFn = (m as unknown as { pinyin: PinyinFn }).pinyin;
    })
    .catch((err) => {
      failed = true;
      console.warn('[pinyin] 読み込めませんでした', err);
    })
    .finally(() => {
      for (const l of readyListeners) l();
    });
  return loading;
}

/** ピンインが使えるようになったら再描画する */
export function usePinyinReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(pinyinFn !== null);
  useEffect(() => {
    if (!enabled || pinyinFn) return;
    const l = () => setReady(pinyinFn !== null);
    readyListeners.add(l);
    void loadPinyin();
    return () => {
      readyListeners.delete(l);
    };
  }, [enabled]);
  return ready;
}

const HAN = /\p{Script=Han}/u;

const TONE_MARKS: [RegExp, number][] = [
  [/[āēīōūǖĀĒĪŌŪǕ]/, 1],
  [/[áéíóúǘÁÉÍÓÚǗ]/, 2],
  [/[ǎěǐǒǔǚǍĚǏǑǓǙ]/, 3],
  [/[àèìòùǜÀÈÌÒÙǛ]/, 4],
];

/** 声調記号から声調を読む。記号が無ければ軽声 */
export function toneOf(py: string): number {
  for (const [re, t] of TONE_MARKS) if (re.test(py)) return t;
  return 5;
}

interface AllItem {
  origin?: unknown;
  pinyin?: unknown;
  num?: unknown;
  isZh?: unknown;
}

interface ZhItem {
  origin: string;
  py: string;
  tone: number;
}

/**
 * 返ってきた読みを、元の文の1文字ずつに突き合わせる。
 * **本文は必ず元の文から組み立てる**ので、ライブラリが句読点や英字をどう返しても本文は欠けない。
 * 読みが対応しない漢字は、ピンイン無しで出す
 */
function align(text: string, items: unknown): Piece[] | null {
  if (!Array.isArray(items)) return null;
  const zh: ZhItem[] = [];
  for (const raw of items as AllItem[]) {
    if (!raw || !raw.isZh || typeof raw.origin !== 'string' || typeof raw.pinyin !== 'string') continue;
    const py = raw.pinyin.trim();
    if (!py) continue;
    const tone = typeof raw.num === 'number' && raw.num >= 1 && raw.num <= 4 ? raw.num : toneOf(py);
    zh.push({ origin: raw.origin, py, tone });
  }
  const out: Piece[] = [];
  let k = 0;
  for (const ch of Array.from(text)) {
    if (HAN.test(ch)) {
      // ずれていたら少し先まで探して合わせ直す
      let j = k;
      while (j < zh.length && j < k + 4 && zh[j].origin !== ch) j++;
      if (j < zh.length && zh[j].origin === ch) {
        out.push({ text: ch, py: zh[j].py, tone: zh[j].tone });
        k = j + 1;
        continue;
      }
    }
    const last = out[out.length - 1];
    if (last && last.py === null) last.text += ch;
    else out.push({ text: ch, py: null, tone: 0 });
  }
  return out.some((p) => p.py) ? out : null;
}

const cache = new Map<string, Piece[]>();

/**
 * 文をピンイン付きの断片に分ける。使えないときは null（呼び出し側は本文だけを出す）。
 * 多音字の読み分けのため、1文字ずつではなく文全体を渡す
 */
export function toPieces(text: string): Piece[] | null {
  if (!pinyinFn || !HAN.test(text)) return null;
  const hit = cache.get(text);
  if (hit) return hit;
  try {
    const pieces = align(text, pinyinFn(text, { type: 'all' }));
    if (!pieces) return null;
    if (cache.size > 500) cache.clear();
    cache.set(text, pieces);
    return pieces;
  } catch {
    return null;
  }
}
