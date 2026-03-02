import pool from '../config/database';

async function postWebhook(payload: Record<string, unknown>) {
  const res = await fetch('http://127.0.0.1:3000/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const userRow = await pool.query(
    `SELECT a.user_id, a.webhook_secret, u.email
     FROM app_settings a
     JOIN users u ON u.id = a.user_id
     WHERE EXISTS (SELECT 1 FROM api_keys k WHERE k.user_id = a.user_id AND k.is_testnet = true)
     ORDER BY a.updated_at DESC
     LIMIT 1`,
  );
  if (!userRow.rows[0]) throw new Error('No user with webhook_secret + demo keys found');

  const userId = String(userRow.rows[0].user_id);
  const secret = String(userRow.rows[0].webhook_secret);
  const email = String(userRow.rows[0].email);
  const stamp = Date.now();

  const entryEventId = `full-entry-${stamp}`;
  const tpEventId = `full-tp1-${stamp}`;

  const entryPayload = {
    passphrase: secret,
    event_id: entryEventId,
    event_type: 'LONG_ENTRY',
    strategy_id: 'full-params-strategy',
    symbol: 'BTCUSDT',
    side: 'buy',
    exchange: 'binance',
    is_testnet: true,
    quantity: 0.002,
    price: 65000,
    stop_loss: 64000,
    tp_percentages: [0.33, 0.33, 0.34, 0, 0],
    dry_run: false,
  };

  const tpPayload = {
    passphrase: secret,
    event_id: tpEventId,
    event_type: 'TP1_HIT',
    strategy_id: 'full-params-strategy',
    symbol: 'BTCUSDT',
    exchange: 'binance',
    is_testnet: true,
    tp_percentages: [0.33, 0.33, 0.34, 0, 0],
    dry_run: false,
  };

  const entry = await postWebhook(entryPayload);
  const tp1 = await postWebhook(tpPayload);

  const trades = await pool.query(
    `SELECT
       webhook_payload->>'event_id' AS event_id,
       exchange, status, order_id, exchange_order_id, client_order_id,
       strategy_id, quantity, price, close_reason, error_message, created_at
     FROM trades
     WHERE user_id = $1
       AND webhook_payload->>'event_id' IN ($2, $3)
     ORDER BY created_at ASC`,
    [userId, entryEventId, tpEventId],
  );

  const events = await pool.query(
    `SELECT event_id, event_type, exchange, strategy_id, created_at
     FROM webhook_events
     WHERE user_id = $1
       AND event_id IN ($2, $3)
     ORDER BY created_at ASC`,
    [userId, entryEventId, tpEventId],
  );

  console.log(`Test user: ${email} (${userId})`);
  console.log('ENTRY response:', JSON.stringify(entry));
  console.log('TP1 response:', JSON.stringify(tp1));
  console.log('Events rows:', JSON.stringify(events.rows));
  console.log('Trade rows:', JSON.stringify(trades.rows));

  await pool.end();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Full-parameter alert test failed:', error?.message || error);
    await pool.end();
    process.exit(1);
  });
}
