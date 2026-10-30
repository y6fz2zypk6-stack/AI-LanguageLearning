// クライアントのビルド（esbuild）。
//   node scripts/build.mjs           本番ビルド → dist/
//   node scripts/build.mjs --watch   変更を見張って作り直す（開発用。サーバーが dist を配信する）
//
// やること: src/main.tsx を束ねる → public/ を写す → index.html にファイル名を差し込む →
// 実際の成果物を precache する sw.js を作る
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

/** dist 配下を再帰的に集める（URLパスで返す） */
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = `${base}/${name}`;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}

function finish(metafile) {
  // 入口の js と、それに付く css を探す
  const outputs = Object.entries(metafile.outputs);
  const entry = outputs.find(([, o]) => o.entryPoint === 'src/main.tsx');
  if (!entry) throw new Error('main.tsx の出力が見つかりません');
  const js = '/' + path.relative(dist, path.resolve(root, entry[0])).split(path.sep).join('/');
  const cssOut = entry[1].cssBundle;
  const css = cssOut ? '/' + path.relative(dist, path.resolve(root, cssOut)).split(path.sep).join('/') : null;

  cpSync(path.join(root, 'public'), dist, { recursive: true });

  const html = readFileSync(path.join(root, 'index.html'), 'utf-8')
    .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="${css}" />` : '')
    .replace('<!--JS-->', `<script type="module" src="${js}"></script>`);
  writeFileSync(path.join(dist, 'index.html'), html);

  // 起動に要るものを precache する。ファイル名にハッシュが入るので、版番号は中身から作る
  const all = walk(dist).filter((p) => p !== '/sw.js');
  const precache = ['/', ...all.filter((p) => p !== '/index.html'), '/index.html'];
  const hash = createHash('sha256');
  for (const p of all) {
    hash.update(p);
    hash.update(readFileSync(path.join(dist, p)));
  }
  const version = hash.digest('hex').slice(0, 12);
  const sw = readFileSync(path.join(root, 'sw.template.js'), 'utf-8')
    .replaceAll('__VERSION__', version)
    .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2));
  writeFileSync(path.join(dist, 'sw.js'), sw);
  console.log(`[build] ${js}${css ? ` + ${css}` : ''} / precache ${precache.length}件 / ${version}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  // ピンインの辞書（pinyin-pro）は大きいので、中国語の画面を開いたときだけ読む
  splitting: true,
  outdir: 'dist/assets',
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  assetNames: '[name]-[hash]',
  jsx: 'automatic',
  target: ['es2020', 'safari15'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  metafile: true,
  logLevel: 'warning',
  alias: { '@shared': path.join(root, '..', 'shared') },
  define: {
    __DEV__: watch ? 'true' : 'false',
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
  },
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'finish',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length || !result.metafile) return;
            try {
              finish(result.metafile);
            } catch (err) {
              console.error('[build]', err.message);
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('[build] 変更を見張っています（サーバーの http://localhost:3002 で確認）');
} else {
  const result = await esbuild.build(options);
  finish(result.metafile);
}
