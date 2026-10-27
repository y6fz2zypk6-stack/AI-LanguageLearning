import type { Language, Partner } from '@shared/types';

const pad = (n: number) => String(n).padStart(2, '0');

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 一覧の時刻: 今日なら時刻、昨日なら「昨日」、それ以前は日付 */
export function shortTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return `${d.getHours()}:${pad(d.getMinutes())}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return '昨日';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 区切り線の日付 */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return '今日';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return '昨日';
  const w = '日月火水木金土'[d.getDay()];
  const md = `${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

/** 名前からアバターの色を決める（同じ相手はいつも同じ色） */
const AVATAR_COLORS = ['#2a9d8f', '#e07a5f', '#5b7fc7', '#c9873f', '#8e6fbf', '#3f8f5a', '#c4577a', '#4f8fa8'];
export function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function langShort(l: Language): string {
  return l === 'zh' ? '中' : 'EN';
}

/** 「成都出身、上海在住・27歳・会社員」のような一行 */
export function personaLine(p: Pick<Partner, 'persona' | 'level'>): string {
  const parts = [p.persona.hometown, p.persona.age && (/^\d+$/.test(p.persona.age) ? `${p.persona.age}歳` : p.persona.age), p.persona.occupation];
  return parts.filter(Boolean).join('・');
}
