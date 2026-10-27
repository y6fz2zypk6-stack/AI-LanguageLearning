import { Router } from 'express';
import type { CorrectionType, Language } from '../../../shared/types.js';
import { deleteMistake, listMistakes, mistakeStats, setReviewed, type MistakeFilter } from '../db/mistakes.js';

export const mistakesRouter = Router();

function filterOf(q: Record<string, unknown>): MistakeFilter {
  const f: MistakeFilter = {};
  if (typeof q.partner === 'string' && q.partner) f.partnerId = q.partner;
  if (q.type === 'error' || q.type === 'unnatural') f.type = q.type as CorrectionType;
  if (q.language === 'zh' || q.language === 'en') f.language = q.language as Language;
  if (q.unreviewed === '1') f.unreviewed = true;
  if (q.limit) f.limit = Number(q.limit) || undefined;
  if (q.offset) f.offset = Number(q.offset) || undefined;
  return f;
}

mistakesRouter.get('/mistakes', (req, res) => {
  const f = filterOf(req.query as Record<string, unknown>);
  res.json({ items: listMistakes(f), stats: mistakeStats({ partnerId: f.partnerId, language: f.language }) });
});

mistakesRouter.put('/mistakes/:id', (req, res) => {
  const m = setReviewed(req.params.id, req.body?.reviewed === true);
  if (!m) {
    res.status(404).json({ error: '見つかりません' });
    return;
  }
  res.json(m);
});

mistakesRouter.delete('/mistakes/:id', (req, res) => {
  if (!deleteMistake(req.params.id)) {
    res.status(404).json({ error: '見つかりません' });
    return;
  }
  res.json({ ok: true });
});
