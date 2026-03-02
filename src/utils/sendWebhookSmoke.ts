import pool from '../config/database';

type WebhookResult = {
  name: string;
  status: number;
  body: any;
};

async function postWebhook(payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await fetch('http://127.0.0.1:3000/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = { parse_error: true };
  }
  return { status: res.status, body };
}

async function main() {
  const userRow = await pool.query(
    `SELECT a.user_id, a.webhook_secret, u.email
     FROM app_settings a
     JOIN users u ON u.id = a.user_id
     WHERE EXISTS (
       SELECT 1
       FROM api_keys k
       WHERE k.user_id = a.user_id
         AND k.is_testnet = true
     )
     ORDER BY a.updated_at DESC
     LIMIT 1`,
  );
  if (!userRow.rows[0]) {
    throw new Error('No app_settings + users row found');
  }
  const userId = String(userRow.rows[0].user_id);
  const secret = String(userRow.rows[0].webhook_secret);
  const email = String(userRow.rows[0].email);
  const ts = Date.now();
  const symbol = 'PRFSMOKEUSDT';
  const bybitKeyRow = await pool.query(
    `SELECT 1
     FROM api_keys
     WHERE user_id = $1 AND exchange = 'bybit' AND is_testnet = true
     LIMIT 1`,
    [userId],
  );
  const hasBybitTestnet = bybitKeyRow.rows.length > 0;

  await pool.query(
    `DELETE FROM trades WHERE user_id = $1 AND (symbol = $2 OR webhook_payload->>'event_id' LIKE 'smoke-%')`,
    [userId, symbol],
  );
  await pool.query(
    `DELETE FROM webhook_events WHERE user_id = $1 AND event_id LIKE 'smoke-%'`,
    [userId],
  );
  await pool.query(
    `DELETE FROM positions WHERE user_id = $1 AND symbol = $2`,
    [userId, symbol],
  );

  const out: WebhookResult[] = [];

  // Validation checks
  out.push({
    name: 'invalid-symbol',
    ...(await postWebhook({
      event_id: `smoke-invalid-${ts}`,
      event_type: 'LONG_ENTRY',
      strategy_id: 'smoke-strategy',
      symbol: 'BTC/USDT!',
      passphrase: secret,
      is_testnet: true,
    })),
  });
  out.push({
    name: 'missing-fields',
    ...(await postWebhook({
      event_id: `smoke-missing-${ts}`,
      event_type: 'LONG_ENTRY',
      strategy_id: 'smoke-strategy',
      passphrase: secret,
      is_testnet: true,
    })),
  });

  // Entry with missing quantity (fallback path)
  out.push({
    name: 'entry-missing-qty',
    ...(await postWebhook({
      event_id: `smoke-entry-${ts}`,
      event_type: 'LONG_ENTRY',
      strategy_id: 'smoke-strategy',
      symbol: 'BTCUSDT',
      exchange: 'binance',
      passphrase: secret,
      is_testnet: true,
    })),
  });
  if (hasBybitTestnet) {
    out.push({
      name: 'entry-missing-qty-bybit',
      ...(await postWebhook({
        event_id: `smoke-entry-bybit-${ts}`,
        event_type: 'LONG_ENTRY',
        strategy_id: 'smoke-strategy',
        symbol: 'BTCUSDT',
        exchange: 'bybit',
        passphrase: secret,
        is_testnet: true,
      })),
    });
  }

  // Pending position for TP/SL gate checks
  await pool.query(
    `INSERT INTO positions (user_id, exchange, symbol, side, entry_price, quantity, leverage, mode, state, pending_since, queued_actions)
     VALUES ($1, 'binance', $2, 'long', 100, 1, 1, 'demo', 'PENDING_ENTRY', NOW(), '[]'::jsonb)
     ON CONFLICT (user_id, exchange, symbol, mode)
     DO UPDATE SET state = 'PENDING_ENTRY', pending_since = NOW(), queued_actions = '[]'::jsonb, updated_at = NOW()`,
    [userId, symbol],
  );

  for (const evt of ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'TP4_HIT', 'TP5_HIT', 'SL_UPDATE', 'STOP', 'CLOSE']) {
    out.push({
      name: `pending-${evt}`,
      ...(await postWebhook({
        event_id: `smoke-${evt.toLowerCase()}-${ts}`,
        event_type: evt,
        strategy_id: 'smoke-strategy',
        symbol,
        exchange: 'binance',
        passphrase: secret,
        is_testnet: true,
        stop_loss: evt === 'SL_UPDATE' ? 99.5 : undefined,
      })),
    });
  }

  const tradeRows = await pool.query(
    `SELECT event_id, status, error_message, close_reason, created_at
     FROM (
       SELECT
         webhook_payload->>'event_id' AS event_id,
         status,
         error_message,
         close_reason,
         created_at
       FROM trades
       WHERE user_id = $1
         AND (webhook_payload->>'event_id' LIKE 'smoke-%' OR symbol = $2)
     ) t
     ORDER BY created_at DESC
     LIMIT 30`,
    [userId, symbol],
  );

  const posRows = await pool.query(
    `SELECT symbol, state, quantity, close_reason, queued_actions
     FROM positions
     WHERE user_id = $1 AND symbol = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, symbol],
  );

  console.log(`Webhook smoke for user: ${email} (${userId})`);
  console.log(`Bybit testnet key available: ${hasBybitTestnet}`);
  for (const r of out) {
    console.log(`[${r.name}] status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  console.log('--- Recent smoke trade rows ---');
  for (const row of tradeRows.rows) {
    console.log(JSON.stringify(row));
  }
  console.log('--- Smoke position snapshot ---');
  console.log(JSON.stringify(posRows.rows[0] ?? null));

  await pool.end();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Smoke test failed:', error?.message || error);
    await pool.end();
    process.exit(1);
  });
}
