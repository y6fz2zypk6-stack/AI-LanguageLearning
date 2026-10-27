// OpenRouter互換のモック。返す応答は PUT /__queue で積んでおき、1件ずつ取り出す。
// 受け取ったリクエストは GET /__requests で覗ける（プロンプトの中身と呼び出し回数の検証用）
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4020);
let queue = [];
let seen = [];

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__queue' && req.method === 'PUT') {
    queue = await readBody(req);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__requests') {
    if (req.method === 'DELETE') seen = [];
    return send(res, 200, seen);
  }
  if (url.pathname === '/v1/models') {
    return send(res, 200, {
      data: [
        { id: '~anthropic/claude-sonnet-latest', name: 'Anthropic: Claude Sonnet Latest' },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek: DeepSeek Chat' },
      ],
    });
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const body = await readBody(req);
    seen.push(body);
    const item = queue.shift();
    if (!item) return send(res, 500, { error: { message: 'mock queue is empty' } });
    if (item.delayMs) await new Promise((r) => setTimeout(r, item.delayMs));
    if (item.status) return send(res, item.status, { error: { message: item.error || 'mock error' } });
    return send(res, 200, {
      model: item.model || body.model,
      choices: [
        {
          message: { content: item.content ?? '' },
          finish_reason: item.finish_reason || 'stop',
        },
      ],
    });
  }
  send(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] 127.0.0.1:${PORT}`));
