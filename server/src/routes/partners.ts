import { Router, type Response } from 'express';
import { ChatError, greet, sendMessage } from '../domain/chat.js';
import { clearMessages, listMessages } from '../db/messages.js';
import { renamePartnerInMistakes } from '../db/mistakes.js';
import {
  createPartner,
  deletePartner,
  getPartner,
  listPartners,
  publicPartner,
  updatePartner,
  validatePartnerInput,
} from '../db/partners.js';

export const partnersRouter = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof ChatError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = (err as Error).message || '不明なエラー';
  console.warn('[chat]', message);
  // 上流（OpenRouter）の失敗は 502 で返す
  res.status(502).json({ error: message });
}

partnersRouter.get('/partners', (_req, res) => {
  res.json(listPartners().map(publicPartner));
});

partnersRouter.post('/partners', (req, res) => {
  const v = validatePartnerInput(req.body);
  if ('error' in v) {
    res.status(400).json({ error: v.error });
    return;
  }
  res.status(201).json(publicPartner(createPartner(v.input)));
});

partnersRouter.get('/partners/:id', (req, res) => {
  const p = getPartner(req.params.id);
  if (!p) {
    res.status(404).json({ error: '相手が見つかりません' });
    return;
  }
  res.json(publicPartner(p));
});

partnersRouter.put('/partners/:id', (req, res) => {
  const v = validatePartnerInput(req.body);
  if ('error' in v) {
    res.status(400).json({ error: v.error });
    return;
  }
  const before = getPartner(req.params.id);
  // 言語は作成後に変えない（会話と間違いログの言語が食い違うため）
  if (before && before.language !== v.input.language) {
    res.status(400).json({ error: '言語はあとから変えられません。別の相手として作ってください' });
    return;
  }
  const p = updatePartner(req.params.id, v.input);
  if (!p) {
    res.status(404).json({ error: '相手が見つかりません' });
    return;
  }
  if (before && before.name !== p.name) renamePartnerInMistakes(p.id, p.name);
  res.json(publicPartner(p));
});

partnersRouter.delete('/partners/:id', (req, res) => {
  if (!deletePartner(req.params.id)) {
    res.status(404).json({ error: '相手が見つかりません' });
    return;
  }
  res.json({ ok: true });
});

partnersRouter.get('/partners/:id/messages', (req, res) => {
  if (!getPartner(req.params.id)) {
    res.status(404).json({ error: '相手が見つかりません' });
    return;
  }
  const before = Number(req.query.before) || undefined;
  const limit = Number(req.query.limit) || 100;
  res.json(listMessages(req.params.id, { before, limit }));
});

partnersRouter.post('/partners/:id/messages', async (req, res) => {
  try {
    res.json(await sendMessage(req.params.id, req.body?.text));
  } catch (err) {
    fail(res, err);
  }
});

partnersRouter.post('/partners/:id/greet', async (req, res) => {
  try {
    res.json(await greet(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

/** 会話をリセットする（相手の設定・記憶・間違いログは残る） */
partnersRouter.delete('/partners/:id/messages', (req, res) => {
  if (!getPartner(req.params.id)) {
    res.status(404).json({ error: '相手が見つかりません' });
    return;
  }
  res.json({ deleted: clearMessages(req.params.id) });
});
