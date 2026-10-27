import { Router } from 'express';
import type { AppConfig } from '../../../shared/types.js';
import { defaultSettings, getSettings, updateSettings } from '../db/settings.js';
import { listModels } from '../llm/openrouter.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.get('/settings/defaults', (_req, res) => {
  res.json(defaultSettings());
});

settingsRouter.put('/settings', (req, res) => {
  res.json(updateSettings(req.body ?? {}));
});

settingsRouter.get('/config', (_req, res) => {
  const config: AppConfig = {
    appTitle: process.env.APP_TITLE || 'Language Partner',
    authRequired: !!process.env.APP_PASSWORD,
  };
  res.json(config);
});

/** OpenRouter のモデル一覧（設定画面の候補） */
settingsRouter.get('/models', async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
