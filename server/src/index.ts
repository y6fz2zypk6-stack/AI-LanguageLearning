// .env の読み込み。**最上段の副作用importであることに意味がある**（env.ts の説明を参照）
import './env.js';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeDb } from './db/index.js';
import { bindsAllInterfaces, isReachRestricted } from './bind.js';
import { authRouter, cookieSecure, requireAuth } from './routes/auth.js';
import { mistakesRouter } from './routes/mistakes.js';
import { partnersRouter } from './routes/partners.js';
import { settingsRouter } from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[db] 使用中:', describeDb());

const app = express();

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const n = Number(trustProxy);
  app.set('trust proxy', Number.isFinite(n) && trustProxy.trim() !== '' ? n : trustProxy);
}

app.use(compression());
app.use(cookieParser());
app.use('/api', express.json({ limit: '64kb' }));

// 認証（APP_PASSWORD 未設定時は素通り）
app.use('/api', authRouter);
app.use('/api', requireAuth);

app.use('/api', settingsRouter);
app.use('/api', partnersRouter);
app.use('/api', mistakesRouter);

app.use('/api', (_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'not found' });
});

// クライアントの静的配信
const clientDist = [
  path.resolve(__dirname, '../../../../client/dist'), // ビルド後: server/dist/server/src から
  path.resolve(__dirname, '../../client/dist'), // tsx実行時: server/src から
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
].find((p) => fs.existsSync(path.join(p, 'index.html')));

if (clientDist) {
  app.use(
    express.static(clientDist, {
      // sw.js と index.html は毎回確かめさせる（古いまま掴み続けないように）
      setHeaders: (res, file) => {
        if (/(?:sw\.js|index\.html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send('client/dist が見つかりません。`npm run build` を実行してください（開発時は Vite を使用）');
  });
}

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as Error & { status?: number; statusCode?: number; type?: string };
  const status = Number(e.status ?? e.statusCode) || 500;
  if (status >= 500) console.error('[server]', err);
  if (res.headersSent) return;
  if (status === 413) {
    res.status(413).json({ error: '送信されたデータが大きすぎます' });
    return;
  }
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSONとして読めませんでした' });
    return;
  }
  res.status(status).json({ error: err.message });
});

const port = Number(process.env.PORT || 3002);
const bind = (process.env.BIND || '').trim();
const allInterfaces = bindsAllInterfaces(bind);
const reachRestricted = isReachRestricted(bind);

/**
 * 到達範囲を絞らないままパスワードも無い構成は、待ち受ける前に止める（aI-chatv2 と同じ）。
 * 漏れるのは会話だけでなく OpenRouter の利用権（＝請求）でもある
 */
function refuseUnsafeStart(): boolean {
  if (reachRestricted || process.env.APP_PASSWORD) return false;
  if (process.env.ALLOW_UNAUTHENTICATED === '1') {
    console.warn('[server] 警告: ALLOW_UNAUTHENTICATED=1 のため、認証なしで外部から届く状態で公開します');
    return false;
  }
  console.error(
    [
      `[server] 起動を中止しました: 認証なしで外部から届く状態にしようとしています（BIND=${bind || '未設定（全インターフェース）'}）。`,
      '  次のいずれかを設定してください。',
      '    APP_PASSWORD=<パスワード>      パスワードで保護する',
      '    BIND=127.0.0.1                このホストだけに絞る（Tailscale等の背後に置く場合）',
      '    ALLOW_UNAUTHENTICATED=1       承知のうえで無認証のまま公開する',
    ].join('\n'),
  );
  return true;
}

if (refuseUnsafeStart()) process.exit(1);

const server = bind ? app.listen(port, bind) : app.listen(port);
server.on('listening', () => {
  console.log(`[server] ${bind || '0.0.0.0'}:${port} で待ち受けています`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[server] 警告: OPENROUTER_API_KEY が未設定です。会話は動作しません');
  }
  if (allInterfaces) {
    console.warn('[server] 注意: 全インターフェースで待ち受けています。VPN内だけなら BIND=127.0.0.1 を設定してください');
  }
  if (process.env.APP_PASSWORD && !cookieSecure()) {
    console.warn('[server] 注意: HTTPS運用時は APP_URL を https:// にするか COOKIE_SECURE=1 を設定してください');
  }
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`[server] ポート ${port} は既に使われています`);
  else if (err.code === 'EADDRNOTAVAIL') console.error(`[server] BIND=${bind} のアドレスがこのホストに存在しません`);
  else console.error('[server] 起動に失敗しました:', err.message);
  process.exit(1);
});
