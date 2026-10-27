/**
 * `.env` と相対 `DB_PATH` の基準を「リポジトリルート」に固定する（aI-chatv2 と同じ方式）。
 *
 * **index.ts の最上段で副作用importすること。** ESMは本体より先にすべてのimportを
 * 評価するので、本体で dotenv.config() を呼ぶと、その前に db/index.js が
 * DB_PATH 未設定のままDBを開いてしまう。
 *
 * cwd は基準にできない。`npm start` は `-w server` 付きで走るので cwd が `server/` になる。
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isRepoRoot(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as {
      workspaces?: unknown;
    };
    return Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0;
  } catch {
    return false;
  }
}

function findRepoRoot(): string {
  for (const start of [path.dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let dir = start;
    for (;;) {
      if (isRepoRoot(dir)) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

/** 相対パスをリポジトリルート基準で解決する */
export function fromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

if (fs.existsSync(path.join(REPO_ROOT, 'server', '.env'))) {
  console.warn('[server] 注意: server/.env は読まれません。設定はリポジトリルートの .env に置いてください');
}
