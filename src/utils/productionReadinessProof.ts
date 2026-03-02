import crypto from 'crypto';
import pool from '../config/database';
import { getModeApiKeysForUser } from '../services/trading/exchangeService';
import { processWebhook } from '../services/trading/webhookService';

type CheckResult = {
  name: string;
  ok: boolean;
  details?: string;
};

async function setupProofUser() {
  await pool.query(
    `DO $$
     DECLARE
       tbl TEXT;
       cname TEXT;
     BEGIN
       IF to_regclass('public.users') IS NOT NULL THEN
        FOREACH tbl IN ARRAY ARRAY['trades', 'positions', 'webhook_events', 'app_settings', 'api_keys', 'risk_settings', 'demo_balances', 'execution_history']
         LOOP
           IF to_regclass('public.' || tbl) IS NULL THEN
             CONTINUE;
           END IF;
           cname := tbl || '_user_id_fkey';
           IF EXISTS (
             SELECT 1
             FROM pg_constraint
             WHERE conname = cname
               AND conrelid = ('public.' || tbl)::regclass
           ) THEN
             EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, cname);
           END IF;
           EXECUTE format(
             'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID',
             tbl,
             cname
           );
         END LOOP;
       END IF;
     END$$;`,
  );

  await pool.query(
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'api_keys_user_id_exchange_key'
           AND conrelid = 'public.api_keys'::regclass
       ) THEN
         ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_user_id_exchange_key;
       END IF;
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'api_keys_user_id_exchange_is_testnet_key'
           AND conrelid = 'public.api_keys'::regclass
       ) THEN
         ALTER TABLE public.api_keys
           ADD CONSTRAINT api_keys_user_id_exchange_is_testnet_key
           UNIQUE (user_id, exchange, is_testnet);
       END IF;
     END$$;`,
  );

  const proofEmail = `proof-${Date.now()}@example.com`;
  const proofHash = crypto.createHash('sha256').update(`proof-${Date.now()}`).digest('hex');
  const secret = `proof-secret-${Date.now()}`;

  let userId: string | null = null;
  let createdUser = false;
  try {
    const userInsert = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id`,
      [proofEmail, proofHash],
    );
    userId = String(userInsert.rows[0].id);
    await pool.query(
      `INSERT INTO app_settings (user_id, trading_mode, webhook_secret)
       VALUES ($1, 'demo', $2)`,
      [userId, secret],
    );
    createdUser = true;
  } catch {
    const settings = await pool.query(
      `SELECT user_id, webhook_secret
       FROM app_settings
       WHERE webhook_secret IS NOT NULL
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_settings.user_id)
       ORDER BY updated_at DESC
       LIMIT 1`,
    );
    if (!settings.rows[0]) {
      throw new Error('No app_settings row found. Create one user first.');
    }
    userId = String(settings.rows[0].user_id);
  }

  if (!userId) {
    throw new Error('Unable to resolve proof user');
  }

  const stamp = Date.now();
  await pool.query(
    `INSERT INTO api_keys (user_id, exchange, api_key, api_secret, is_testnet)
     VALUES
       ($1, 'binance', $2, $3, true),
       ($1, 'bybit', $4, $5, false)
     ON CONFLICT (user_id, exchange, is_testnet) DO NOTHING`,
    [userId, `proof-key-demo-${stamp}`, `proof-secret-demo-${stamp}`, `proof-key-real-${stamp}`, `proof-secret-real-${stamp}`],
  );
  return { userId, secret, createdUser };
}

async function cleanupProofUser(userId: string, createdUser: boolean) {
  await pool.query(
    `DELETE FROM trades WHERE user_id = $1 AND (
      webhook_payload->>'event_id' LIKE 'proof-%' OR symbol LIKE 'PRF%'
    )`,
    [userId],
  );
  await pool.query(
    `DELETE FROM webhook_events WHERE user_id = $1 AND event_id LIKE 'proof-%'`,
    [userId],
  );
  await pool.query(
    `DELETE FROM positions WHERE user_id = $1 AND symbol LIKE 'PRF%'`,
    [userId],
  );
  await pool.query(
    `DELETE FROM api_keys WHERE user_id = $1 AND api_key LIKE 'proof-key-%'`,
    [userId],
  );
  await pool.query(
    `DELETE FROM app_settings WHERE user_id = $1 AND webhook_secret LIKE 'proof-secret-%'`,
    [userId],
  );
  if (createdUser) {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
}

async function runProofChecks() {
  const checks: CheckResult[] = [];
  const { userId, secret, createdUser } = await setupProofUser();
  const runScenario = async (name: string, fn: () => Promise<{ ok: boolean; details?: string }>) => {
    try {
      const out = await fn();
      checks.push({ name, ok: out.ok, details: out.details });
    } catch (error: any) {
      checks.push({ name, ok: false, details: `error=${error?.message ?? 'unknown'}` });
    }
  };
  try {
    const demoKeys = await getModeApiKeysForUser(userId, 'demo').catch(() => []);
    const executionExchange = demoKeys[0]?.exchange ?? 'binance';

    await runScenario('invalid symbol rejected', async () => {
      const invalidSymbol = await processWebhook(
        {
          event_id: `proof-inv-${Date.now()}`,
          event_type: 'LONG_ENTRY',
          strategy_id: 'proof-strategy',
          symbol: 'BTC/USDT!',
          passphrase: secret,
        },
        'application/json',
        {},
      );
      return { ok: invalidSymbol.status === 400, details: `status=${invalidSymbol.status}` };
    });

    await runScenario('missing fields rejected', async () => {
      const missingField = await processWebhook(
        { event_id: `proof-miss-${Date.now()}`, event_type: 'LONG_ENTRY', strategy_id: 'proof-strategy', passphrase: secret },
        'application/json',
        {},
      );
      return { ok: missingField.status === 400, details: `status=${missingField.status}` };
    });

    await runScenario('quantity fallback when missing', async () => {
      const eventIdFallback = `proof-qty-${Date.now()}`;
      const quantityFallback = await processWebhook(
        {
          event_id: eventIdFallback,
          event_type: 'LONG_ENTRY',
          strategy_id: 'proof-strategy',
          symbol: 'BTCUSDT',
          exchange: executionExchange,
          passphrase: secret,
          is_testnet: true,
        },
        'application/json',
        {},
      );
      const fallbackTrade = await pool.query(
        `SELECT quantity, status
         FROM trades
         WHERE user_id = $1 AND webhook_payload->>'event_id' = $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, eventIdFallback],
      );
      const qty = Number(fallbackTrade.rows[0]?.quantity ?? 0);
      return {
        ok: quantityFallback.status === 200 && qty > 0,
        details: `status=${quantityFallback.status}, qty=${qty}, trade_status=${fallbackTrade.rows[0]?.status ?? 'none'}`,
      };
    });

    await runScenario('TP/SL blocked during PENDING_ENTRY', async () => {
      await pool.query(
        `INSERT INTO positions (user_id, exchange, symbol, side, entry_price, quantity, leverage, mode, state, pending_since)
         VALUES ($1, $2, 'PRFETHUSDT', 'long', 2500, 0.01, 1, 'demo', 'PENDING_ENTRY', NOW())
         ON CONFLICT (user_id, exchange, symbol, mode)
         DO UPDATE SET state = 'PENDING_ENTRY', pending_since = NOW(), updated_at = NOW(), queued_actions = '[]'::jsonb`,
        [userId, executionExchange],
      );
      const pendingEventId = `proof-pending-${Date.now()}`;
      const pendingExit = await processWebhook(
        {
          event_id: pendingEventId,
          event_type: 'TP1_HIT',
          strategy_id: 'proof-strategy',
          symbol: 'PRFETHUSDT',
          exchange: executionExchange,
          passphrase: secret,
          is_testnet: true,
        },
        'application/json',
        {},
      );
      const queuedTrade = await pool.query(
        `SELECT status, error_message
         FROM trades
         WHERE user_id = $1 AND webhook_payload->>'event_id' = $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, pendingEventId],
      );
      return {
        ok: pendingExit.status === 200 && queuedTrade.rows[0]?.status === 'queued',
        details: `status=${pendingExit.status}, trade_status=${queuedTrade.rows[0]?.status ?? 'none'}`,
      };
    });

    await runScenario('pending timeout auto-cancel', async () => {
      await pool.query(
        `INSERT INTO positions (user_id, exchange, symbol, side, entry_price, quantity, leverage, mode, state, pending_since, queued_actions)
         VALUES (
           $1, $2, 'PRFSOLUSDT', 'long', 120, 1, 1, 'demo', 'PENDING_ENTRY',
           NOW() - INTERVAL '3 hour',
           '[{"event_id":"queued-old","event_type":"TP1_HIT"}]'::jsonb
         )
         ON CONFLICT (user_id, exchange, symbol, mode)
         DO UPDATE SET state = 'PENDING_ENTRY', pending_since = NOW() - INTERVAL '3 hour', queued_actions = '[{"event_id":"queued-old","event_type":"TP1_HIT"}]'::jsonb, updated_at = NOW()`,
        [userId, executionExchange],
      );
      await processWebhook(
        {
          event_id: `proof-trigger-${Date.now()}`,
          event_type: 'CLOSE',
          strategy_id: 'proof-strategy',
          symbol: 'PRFXRPUSDT',
          exchange: executionExchange,
          passphrase: secret,
          is_testnet: true,
        },
        'application/json',
        {},
      );
      const timedOutPos = await pool.query(
        `SELECT state, close_reason
         FROM positions
         WHERE user_id = $1 AND exchange = $2 AND symbol = 'PRFSOLUSDT' AND mode = 'demo'`,
        [userId, executionExchange],
      );
      return {
        ok: timedOutPos.rows[0]?.state === 'CLOSED' && timedOutPos.rows[0]?.close_reason === 'pending_entry_timeout',
        details: `state=${timedOutPos.rows[0]?.state ?? 'none'}, reason=${timedOutPos.rows[0]?.close_reason ?? 'none'}`,
      };
    });

    const realKeys = await getModeApiKeysForUser(userId, 'real');
    checks.push({
      name: 'demo/live key routing',
      ok: demoKeys.some((k) => k.is_testnet) && realKeys.some((k) => !k.is_testnet),
      details: `demo=${demoKeys.length}, real=${realKeys.length}`,
    });
  } finally {
    await cleanupProofUser(userId, createdUser);
  }

  return checks;
}

async function main() {
  try {
    console.log('Running production readiness proof checks...');
    const checks = await runProofChecks();
    let passed = 0;
    for (const check of checks) {
      const label = check.ok ? 'PASS' : 'FAIL';
      if (check.ok) passed += 1;
      console.log(`[${label}] ${check.name}${check.details ? ` -> ${check.details}` : ''}`);
    }
    console.log(`Result: ${passed}/${checks.length} checks passed`);
    if (passed !== checks.length) process.exitCode = 1;
  } finally {
    // Ensure script exits cleanly after checks.
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Proof script failed:', error?.message || error);
    process.exit(1);
  });
}
