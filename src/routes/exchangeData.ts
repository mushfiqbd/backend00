import { Router } from 'express';
import logger from '../utils/logger';
import { closeAllPositionsForUser, getExchangeDataForUser } from '../services/trading/exchangeService';

const router = Router();

type Mode = 'demo' | 'real';

function normalizeMode(raw: unknown): Mode {
  return raw === 'real' ? 'real' : 'demo';
}

async function mirrorExchangeRequest(req: any): Promise<void> {
  const mirrorUrl = process.env.EXCHANGE_VERIFY_MIRROR_URL;
  if (!mirrorUrl) return;
  try {
    const auth = req.headers.authorization;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    const response = await fetch(mirrorUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body ?? {}),
    });
    logger.info('Exchange mirror verification result', {
      mirrorUrl,
      status: response.status,
      ok: response.ok,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.warn('Exchange mirror verification failed', {
      mirrorUrl,
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
  }
}

router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const mode = normalizeMode(req.body?.mode);
    const action = req.body?.action;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.info('Exchange data endpoint invoked', {
      userId,
      mode,
      action,
      timestamp: new Date().toISOString(),
    });

    if (action === 'close_all') {
      const closed = await closeAllPositionsForUser(userId, mode);
      await mirrorExchangeRequest(req);
      return res.status(200).json(closed);
    }

    const data = await getExchangeDataForUser(userId, mode);
    await mirrorExchangeRequest(req);
    return res.status(200).json(data);
  } catch (error: any) {
    logger.error('Error in exchange-data route', {
      error: error?.message,
      stack: error?.stack,
      userId: (req as any).user?.userId,
      mode: req.body?.mode,
      timestamp: new Date().toISOString(),
    });

    if (String(error?.message || '').startsWith('NO_KEYS:')) {
      return res.status(400).json({
        error: 'Missing API keys',
        message: String(error.message).replace('NO_KEYS: ', ''),
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch exchange data',
      message: process.env.NODE_ENV === 'development' ? error?.message : 'Internal server error',
    });
  }
});

router.post('/close-all', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const mode = normalizeMode(req.body?.mode);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const closed = await closeAllPositionsForUser(userId, mode);
    return res.status(200).json(closed);
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to close all positions',
      message: process.env.NODE_ENV === 'development' ? error?.message : 'Internal server error',
    });
  }
});

export default router;