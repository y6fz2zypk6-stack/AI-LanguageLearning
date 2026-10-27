import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromRoot } from '../env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 相対パスは cwd ではなくリポジトリルート基準
const DB_PATH = fromRoot(process.env.DB_PATH || './data/app.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
export const DB_FILE = DB_PATH;

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'));

// ---- 番号付きマイグレーション ----
// 列の追加・型変更はここに追記する。適用済みの番号は PRAGMA user_version に持つ。
const migrations: { version: number; up: (d: Database.Database) => void }[] = [];

const current = db.pragma('user_version', { simple: true }) as number;
for (const m of migrations) {
  if (m.version <= current) continue;
  db.transaction(() => {
    m.up(db);
    db.pragma(`user_version = ${m.version}`);
  })();
}

/** どのDBを開いたかを1行で（取り違えても画面は普通に動くので、起動ログで気づけるように） */
export function describeDb(): string {
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
  return `${DB_FILE}（相手${count('partners')} / メッセージ${count('messages')} / 間違い${count('mistakes')}）`;
}

export const now = (): number => Date.now();
