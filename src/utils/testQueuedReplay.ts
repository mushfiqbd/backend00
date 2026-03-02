import pool from '../config/database';
import { processWebhook } from '../services/trading/webhookService';

async function main() {
  const userRow = await pool.query(
    `SELECT a.user_id, a.webhook_secret
     FROM app_settings a
     WHERE EXISTS (
       SELECT 1 FROM api_keys k WHERE k.user_id = a.user_id AND k.exchange = 'binance' AND k.is_testnet = true
     )
     ORDER BY a.updated_at DESC
     LIMIT 1`,
  );
  if (!userRow.rows[0]) throw new Error('No eligible user with binance testnet key found');
  const userId = String(userRow.rows[0].user_id);
  const secret = String(userRow.rows[0].webhook_secret);
  const symbol = 'BTCUSDT';
  const stamp = Date.now();
  const queuedEventId = `replay-queued-tp1-${stamp}`;

  await pool.query(
    `DELETE FROM trades WHERE user_id = $1 AND webhook_payload->>'event_id' LIKE 'replay-%'`,
    [userId],
  );
  await pool.query(
    `DELETE FROM webhook_events WHERE user_id = $1 AND event_id LIKE 'replay-%'`,
    [userId],
  );
  await pool.query(
    `INSERT INTO positions (user_id, exchange, symbol, side, entry_price, quantity, leverage, mode, state, pending_since, queued_actions)
     VALUES (
       $1, 'binance', $2, 'long', 70000, 0.002, 1, 'demo', 'PENDING_ENTRY', NOW(),
       $3::jsonb
     )
     ON CONFLICT (user_id, exchange, symbol, mode)
     DO UPDATE SET
       state = 'PENDING_ENTRY',
       pending_since = NOW(),
       quantity = 0.002,
       queued_actions = $3::jsonb,
       updated_at = NOW()`,
    [
      userId,
      symbol,
      JSON.stringify([{ event_id: queuedEventId, event_type: 'TP1_HIT', quantity: 0.001, at: new Date().toISOString() }]),
    ],
  );

  const entryRes = await processWebhook(
    {
      event_id: `replay-entry-${stamp}`,
      event_type: 'LONG_ENTRY',
      strategy_id: 'replay-strategy',
      symbol,
      exchange: 'binance',
      quantity: 0.002,
      passphrase: secret,
      is_testnet: true,
    },
    'application/json',
    {},
  );

  const tradeRows = await pool.query(
    `SELECT webhook_payload->>'event_id' AS event_id, status, close_reason, error_message, created_at
     FROM trades
     WHERE user_id = $1
       AND (webhook_payload->>'event_id' LIKE 'replay-%')
     ORDER BY created_at ASC`,
    [userId],
  );
  const pos = await pool.query(
    `SELECT state, quantity, queued_actions
     FROM positions
     WHERE user_id = $1 AND exchange = 'binance' AND symbol = $2 AND mode = 'demo'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, symbol],
  );

  console.log('entryResponse:', JSON.stringify(entryRes.body));
  console.log('replayTrades:', JSON.stringify(tradeRows.rows));
  console.log('positionAfter:', JSON.stringify(pos.rows[0]));
  await pool.end();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Queued replay test failed:', error?.message || error);
    await pool.end();
    process.exit(1);
  });
}
