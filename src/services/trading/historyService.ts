import pool from '../../config/database';

export type ClearMode = 'demo' | 'real' | 'all';

function inferDemoEvent(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return true;
  if (typeof payload.is_testnet === 'boolean') return payload.is_testnet;
  return true;
}

export async function clearExecutionHistoryForUser(userId: string, mode: ClearMode) {
  let deletedTrades = 0;
  let deletedEvents = 0;

  if (mode === 'all') {
    const tradesRes = await pool.query(
      'DELETE FROM trades WHERE user_id = $1 RETURNING id',
      [userId],
    );
    deletedTrades = tradesRes.rowCount ?? 0;

    const eventsRes = await pool.query(
      'DELETE FROM webhook_events WHERE user_id = $1 RETURNING id',
      [userId],
    );
    deletedEvents = eventsRes.rowCount ?? 0;

    return { deletedTrades, deletedEvents };
  }

  const tradesRes = await pool.query(
    'DELETE FROM trades WHERE user_id = $1 AND mode = $2 RETURNING id',
    [userId, mode],
  );
  deletedTrades = tradesRes.rowCount ?? 0;

  const eventsRes = await pool.query(
    'SELECT id, payload FROM webhook_events WHERE user_id = $1',
    [userId],
  );
  const targetIsDemo = mode === 'demo';
  const idsToDelete = (eventsRes.rows || [])
    .filter((row: any) => inferDemoEvent(row.payload) === targetIsDemo)
    .map((row: any) => row.id);

  if (idsToDelete.length > 0) {
    const delRes = await pool.query(
      'DELETE FROM webhook_events WHERE user_id = $1 AND id = ANY($2::uuid[]) RETURNING id',
      [userId, idsToDelete],
    );
    deletedEvents = delRes.rowCount ?? 0;
  }

  return { deletedTrades, deletedEvents };
}
