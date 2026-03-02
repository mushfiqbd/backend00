import { Router } from 'express';
import logger from '../utils/logger';
import { processWebhook } from '../services/trading/webhookService';

const router = Router();
const WEBHOOK_ALLOWED_ORIGIN = process.env.WEBHOOK_CORS_ORIGIN || '*';

function applyWebhookCors(res: any) {
  res.header('Access-Control-Allow-Origin', WEBHOOK_ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function mirrorWebhookForVerification(req: any): Promise<void> {
  const mirrorUrl = process.env.WEBHOOK_VERIFY_MIRROR_URL;
  if (!mirrorUrl) return;
  try {
    const headers: Record<string, string> = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    const incomingAuth = req.headers.authorization;
    if (incomingAuth) headers.Authorization = incomingAuth;
    const payload =
      typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    const mirrorRes = await fetch(mirrorUrl, {
      method: 'POST',
      headers,
      body: payload,
    });
    logger.info('Webhook mirror verification result', {
      mirrorUrl,
      status: mirrorRes.status,
      ok: mirrorRes.ok,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.warn('Webhook mirror verification failed', {
      mirrorUrl,
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Handle OPTIONS preflight requests for CORS
router.options('/', (req, res) => {
  logger.debug('OPTIONS request received for webhook', {
    ip: req.ip || req.connection.remoteAddress,
    timestamp: new Date().toISOString()
  });
  
  applyWebhookCors(res);
  res.status(204).end();
});

// Handle GET requests for webhook testing
router.get('/', (req, res) => {
  applyWebhookCors(res);
  
  res.status(200).json({
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString(),
    status: 'ready'
  });
});

// Handle webhook requests
router.post('/', async (req, res) => {
  try {
    logger.info('POST request received for webhook', {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    
    applyWebhookCors(res);
    
    const result = await processWebhook(req.body, req.headers['content-type'], req.query as Record<string, unknown>);
    await mirrorWebhookForVerification(req);
    logger.info('Webhook route processed by backend service', {
      status: result.status,
      eventId: (result.body as any)?.event_id,
      eventType: (result.body as any)?.event_type,
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString(),
    });
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    logger.error('Error processing webhook:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to process webhook',
      message: 'Internal server error'
    });
  }
});

export default router;