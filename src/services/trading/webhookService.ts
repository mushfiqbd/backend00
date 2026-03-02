import pool from '../../config/database';
import logger from '../../utils/logger';
import {
  ApiKeyRow,
  ExchangeName,
  Mode,
  cancelEntryOrderByClientId,
  computeOrderQuantity,
  getModeApiKeysForUser,
  getRiskSettingForSymbol,
  placeMarketOrder,
  updateStopLossOrder,
} from './exchangeService';

type NormalizedPayload = {
  passphrase?: string;
  secret?: string;
  event_id: string;
  event_type: string;
  symbol?: string;
  side?: string;
  strategy_id?: string;
  quantity?: number;
  price?: number;
  stop_loss?: number;
  sl_price?: number;
  tp_percentages?: number[];
  exchange?: 'binance' | 'bybit';
  is_testnet?: boolean;
  dry_run?: boolean;
  [k: string]: unknown;
};

const ALLOWED_EVENT_TYPES = new Set([
  'LONG_ENTRY',
  'SHORT_ENTRY',
  'TP1_HIT',
  'TP2_HIT',
  'TP3_HIT',
  'TP4_HIT',
  'TP5_HIT',
  'STOP',
  'CLOSE',
  'SL_UPDATE',
]);

const ENTRY_TIMEOUT_SECONDS = Math.max(5, Number(process.env.PENDING_ENTRY_TIMEOUT_SEC ?? 90));
const EXECUTE_ALL_EXCHANGES_BY_DEFAULT = String(process.env.WEBHOOK_EXECUTE_ALL_EXCHANGES ?? 'true').toLowerCase() !== 'false';
const TP_FRACTIONS: Record<string, number> = {
  TP1_HIT: 0.2,
  TP2_HIT: 0.2,
  TP3_HIT: 0.2,
  TP4_HIT: 0.2,
  TP5_HIT: 0.2,
};

function normalizeSymbol(symbol: unknown): string | undefined {
  if (symbol == null) return undefined;
  let s = String(symbol).trim().toUpperCase();
  if (!s) return undefined;
  s = s.replace(/^(BINANCE|BYBIT):/, '');
  s = s.replace(/\.P$/i, '');
  s = s.replace(/PERP$/i, '');
  return s.replace(/[^A-Z0-9]/g, '');
}

function tryParseEmbeddedJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep trying fallback candidates.
    }
  }
  return null;
}

function parseTextPayload(text: string): Record<string, unknown> {
  const embeddedJson = tryParseEmbeddedJson(text);
  if (embeddedJson) return embeddedJson;

  const out: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.includes(':') ? trimmed.indexOf(':') : trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function toNumberOrUndefined(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseTpPercentages(v: unknown): number[] | undefined {
  if (Array.isArray(v)) {
    const arr = v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0 && n <= 1);
    return arr.length ? arr : undefined;
  }
  if (typeof v === 'string') {
    const arr = v
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 1);
    return arr.length ? arr : undefined;
  }
  return undefined;
}

export function normalizeWebhookPayload(input: unknown): NormalizedPayload {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const rawMessage = src.raw_message ? String(src.raw_message) : '';
  const kvFromRaw = rawMessage ? parseTextPayload(rawMessage) : {};
  const merged = { ...kvFromRaw, ...src };
  const eventTypeRaw = String(merged.event_type ?? merged.signal ?? merged.action ?? '').trim().toUpperCase();
  const sideRaw = String(merged.side ?? '').trim().toLowerCase();
  const eventId = String(merged.event_id ?? merged.id ?? merged.alert_id ?? '').trim();
  const eventTypeNormalized = normalizeLegacyEventType(eventTypeRaw, sideRaw);
  const fallbackEventId = `tv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    ...merged,
    passphrase: merged.passphrase ? String(merged.passphrase) : undefined,
    secret: merged.secret ? String(merged.secret) : undefined,
    event_id: eventId || fallbackEventId,
    event_type: eventTypeNormalized,
    symbol: normalizeSymbol(merged.symbol ?? merged.ticker ?? merged.pair),
    side: sideRaw || undefined,
    strategy_id: merged.strategy_id ? String(merged.strategy_id) : merged.strategyId ? String(merged.strategyId) : undefined,
    quantity: toNumberOrUndefined(merged.quantity ?? merged.qty),
    price: toNumberOrUndefined(merged.price),
    stop_loss: toNumberOrUndefined(merged.stop_loss ?? merged.stopLoss ?? merged.sl),
    sl_price: toNumberOrUndefined(merged.sl_price ?? merged.stop_price ?? merged.stopPrice),
    tp_percentages: parseTpPercentages(merged.tp_percentages),
    exchange:
      String(merged.exchange ?? '').toLowerCase() === 'bybit'
        ? 'bybit'
        : String(merged.exchange ?? '').toLowerCase() === 'binance'
          ? 'binance'
          : undefined,
    is_testnet:
      typeof merged.is_testnet === 'boolean'
        ? merged.is_testnet
        : String(merged.is_testnet ?? '').toLowerCase() === 'true'
          ? true
          : undefined,
    dry_run:
      typeof merged.dry_run === 'boolean'
        ? merged.dry_run
        : String(merged.dry_run ?? '').toLowerCase() === 'true'
          ? true
          : undefined,
  };
}

function normalizeLegacyEventType(eventTypeRaw: string, sideRaw: string): string {
  const normalized = eventTypeRaw.replace(/[\s-]+/g, '_');
  if (ALLOWED_EVENT_TYPES.has(normalized)) return normalized;

  if (normalized === 'ENTRY' || normalized === 'OPEN') {
    if (sideRaw === 'sell' || sideRaw === 'short') return 'SHORT_ENTRY';
    return 'LONG_ENTRY';
  }
  if (normalized === 'BUY' || normalized === 'LONG' || normalized === 'LONG_ENTRY_SIGNAL') return 'LONG_ENTRY';
  if (normalized === 'SELL' || normalized === 'SHORT' || normalized === 'SHORT_ENTRY_SIGNAL') return 'SHORT_ENTRY';
  if (normalized === 'EXIT' || normalized === 'CLOSE_ALL' || normalized === 'FLAT') return 'CLOSE';
  if (normalized === 'SL' || normalized === 'STOP_LOSS' || normalized === 'STOPLOSS') return 'STOP';

  const tpMatch = /^TP_?([1-5])(?:_HIT)?$/.exec(normalized);
  if (tpMatch) return `TP${tpMatch[1]}_HIT`;
  if (normalized === 'TAKE_PROFIT') return 'TP1_HIT';

  return normalized || 'UNKNOWN';
}

async function resolveUserFromWebhookSecret(payload: NormalizedPayload): Promise<{ userId: string; mode: Mode } | null> {
  const providedSecret = payload.passphrase || payload.secret;
  if (!providedSecret) return null;
  const result = await pool.query(
    `SELECT user_id, trading_mode
     FROM app_settings
     WHERE webhook_secret = $1
     LIMIT 1`,
    [providedSecret],
  );
  if (!result.rows.length) return null;
  return {
    userId: result.rows[0].user_id,
    mode: result.rows[0].trading_mode === 'real' ? 'real' : 'demo',
  };
}

async function resolveUserFromPayloadIdentity(
  payload: NormalizedPayload,
): Promise<{ userId: string; mode: Mode } | null> {
  const userIdRaw = String(payload.user_id ?? payload.userId ?? '').trim();
  const emailRaw = String(payload.email ?? '').trim().toLowerCase();

  if (userIdRaw) {
    const byId = await pool.query(
      `SELECT user_id, trading_mode
       FROM app_settings
       WHERE user_id = $1::uuid
       LIMIT 1`,
      [userIdRaw],
    );
    if (byId.rows.length) {
      return {
        userId: String(byId.rows[0].user_id),
        mode: String(byId.rows[0].trading_mode) === 'real' ? 'real' : 'demo',
      };
    }
  }

  if (emailRaw) {
    const byEmail = await pool.query(
      `SELECT a.user_id, a.trading_mode
       FROM app_settings a
       JOIN users u ON u.id = a.user_id
       WHERE lower(u.email) = $1
       LIMIT 1`,
      [emailRaw],
    );
    if (byEmail.rows.length) {
      return {
        userId: String(byEmail.rows[0].user_id),
        mode: String(byEmail.rows[0].trading_mode) === 'real' ? 'real' : 'demo',
      };
    }
  }

  return null;
}

async function upsertWebhookSecretForUser(userId: string, secret: string): Promise<void> {
  const trimmed = String(secret || '').trim();
  if (!trimmed) return;
  await pool.query(
    `UPDATE app_settings
     SET webhook_secret = $2, updated_at = NOW()
     WHERE user_id = $1::uuid`,
    [userId, trimmed],
  );
}

async function isDuplicateEvent(userId: string, eventId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM webhook_events WHERE user_id = $1 AND event_id = $2 LIMIT 1',
    [userId, eventId],
  );
  return result.rows.length > 0;
}

async function insertWebhookEvent(userId: string, payload: NormalizedPayload, exchange: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_events (user_id, event_id, event_type, symbol, exchange, strategy_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      userId,
      payload.event_id,
      payload.event_type,
      payload.symbol ?? null,
      exchange,
      payload.strategy_id ?? null,
      JSON.stringify(payload),
    ],
  );
}

async function upsertPositionForEntry(userId: string, payload: NormalizedPayload, mode: Mode, state: 'PENDING_ENTRY' | 'OPEN') {
  if (!payload.symbol) return;
  const side = payload.event_type === 'SHORT_ENTRY' ? 'short' : 'long';
  const qty = Number(payload.quantity ?? 0);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const exchanges = payload.exchange ? [payload.exchange] : ['binance', 'bybit'];

  for (const exchange of exchanges) {
    await pool.query(
      `INSERT INTO positions (
         user_id, exchange, symbol, side, entry_price, quantity, leverage, unrealized_pnl, mode,
         strategy_id, state, pending_since, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 1, 0, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (user_id, exchange, symbol, mode)
       DO UPDATE SET
         side = EXCLUDED.side,
         quantity = EXCLUDED.quantity,
         strategy_id = EXCLUDED.strategy_id,
         state = $9,
         pending_since = NOW(),
         updated_at = NOW()`,
      [userId, exchange, payload.symbol, side, payload.price ?? 0, safeQty, mode, payload.strategy_id ?? null, state],
    );
  }
}

async function closePositionForExit(userId: string, payload: NormalizedPayload, mode: Mode) {
  if (!payload.symbol) return;
  const exchanges = payload.exchange ? [payload.exchange] : ['binance', 'bybit'];
  for (const exchange of exchanges) {
    await pool.query(
      `UPDATE positions
       SET state = 'CLOSED', closed_at = NOW(), close_reason = $1, updated_at = NOW()
       WHERE user_id = $2
         AND exchange = $3
         AND symbol = $4
         AND mode = $5
         AND state IN ('PENDING_ENTRY', 'OPEN', 'CLOSING')`,
      [payload.event_type, userId, exchange, payload.symbol, mode],
    );
  }
}

async function insertTrade(
  userId: string,
  payload: NormalizedPayload,
  mode: Mode,
  statusOverride?: string,
  errorMessage?: string,
  orderIdOverride?: string,
  exchangeOrderIdOverride?: string | null,
  clientOrderIdOverride?: string | null,
) {
  const isEntry = payload.event_type === 'LONG_ENTRY' || payload.event_type === 'SHORT_ENTRY';
  const side =
    payload.event_type === 'SHORT_ENTRY'
      ? 'sell'
      : payload.event_type === 'LONG_ENTRY'
        ? 'buy'
        : payload.side === 'sell'
          ? 'sell'
          : 'buy';
  const exchanges = payload.exchange ? [payload.exchange] : ['binance', 'bybit'];
  const qty = Number(payload.quantity ?? 0);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;

  for (const exchange of exchanges) {
    await pool.query(
      `INSERT INTO trades (
         user_id, exchange, symbol, side, order_type, quantity, price, leverage, mode, status,
         order_id, exchange_order_id, client_order_id, strategy_id, webhook_payload, close_reason, error_message, created_at
       )
       VALUES ($1, $2, $3, $4, 'market', $5, $6, 1, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, NOW())`,
      [
        userId,
        exchange,
        payload.symbol ?? 'UNKNOWN',
        side,
        safeQty,
        payload.price ?? null,
        mode,
        statusOverride ?? (isEntry ? 'queued' : 'executed'),
        orderIdOverride ?? payload.event_id ?? null,
        exchangeOrderIdOverride ?? null,
        clientOrderIdOverride ?? payload.event_id ?? null,
        payload.strategy_id ?? null,
        JSON.stringify(payload),
        isEntry ? null : payload.event_type,
        errorMessage ?? null,
      ],
    );
  }
}

function isHealthEvent(payload: Record<string, unknown>): boolean {
  return Boolean(payload.ping || payload.health_check || payload.type === 'ping' || payload.type === 'health_check');
}

function isExitEvent(eventType: string): boolean {
  return (
    eventType === 'STOP' ||
    eventType === 'CLOSE' ||
    eventType.startsWith('TP') ||
    eventType === 'SL_UPDATE'
  );
}

async function getTrackedPosition(
  userId: string,
  exchange: ExchangeName,
  symbol: string,
  mode: Mode,
): Promise<any | null> {
  const result = await pool.query(
    `SELECT id, state, queued_actions, pending_since
     FROM positions
     WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, exchange, symbol, mode],
  );
  return result.rows[0] || null;
}

async function queuePendingAction(userId: string, exchange: ExchangeName, symbol: string, mode: Mode, payload: NormalizedPayload) {
  const pos = await getTrackedPosition(userId, exchange, symbol, mode);
  if (!pos) return;
  const existing = Array.isArray(pos.queued_actions) ? pos.queued_actions : [];
  existing.push({
    event_id: payload.event_id,
    event_type: payload.event_type,
    quantity: payload.quantity ?? null,
    price: payload.price ?? null,
    stop_loss: payload.stop_loss ?? payload.sl_price ?? null,
    at: new Date().toISOString(),
  });
  await pool.query(
    `UPDATE positions
     SET queued_actions = $5::jsonb, updated_at = NOW()
     WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4`,
    [userId, exchange, symbol, mode, JSON.stringify(existing)],
  );
}

async function applyPendingTimeouts(userId: string): Promise<void> {
  const timeoutCutoff = new Date(Date.now() - ENTRY_TIMEOUT_SECONDS * 1000).toISOString();
  const pending = await pool.query(
    `SELECT id, user_id, exchange, symbol, mode, queued_actions
     FROM positions
     WHERE user_id = $1
       AND state = 'PENDING_ENTRY'
       AND pending_since IS NOT NULL
       AND pending_since < $2`,
    [userId, timeoutCutoff],
  );
  for (const row of pending.rows) {
    const rowMode: Mode = String(row.mode) === 'real' ? 'real' : 'demo';
    const modeKeys = await getModeApiKeysForUser(row.user_id, rowMode);
    const key = modeKeys.find((k) => k.exchange === row.exchange);
    const entryEvent = await pool.query(
      `SELECT webhook_payload->>'event_id' AS event_id
       FROM trades
       WHERE user_id = $1
         AND exchange = $2
         AND symbol = $3
         AND mode = $4
         AND (webhook_payload->>'event_type') IN ('LONG_ENTRY', 'SHORT_ENTRY')
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.user_id, row.exchange, row.symbol, rowMode],
    );
    const pendingEntryEventId = String(entryEvent.rows[0]?.event_id ?? '');
    if (key && pendingEntryEventId) {
      try {
        await cancelEntryOrderByClientId(key, rowMode, row.symbol, pendingEntryEventId);
      } catch {
        // Do not block timeout lifecycle closing if exchange cancel fails.
      }
    }

    await pool.query(
      `UPDATE positions
       SET state = 'CLOSED',
           closed_at = NOW(),
           close_reason = 'pending_entry_timeout',
           updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
    const queued = Array.isArray(row.queued_actions) ? row.queued_actions : [];
    for (const action of queued) {
      await pool.query(
        `INSERT INTO trades (
           user_id, exchange, symbol, side, order_type, quantity, price, leverage, mode, status,
           webhook_payload, close_reason, error_message, created_at
         )
         VALUES ($1, $2, $3, 'sell', 'market', 0, NULL, 1, $4, 'not_executed', $5::jsonb, 'pending_entry_timeout', 'Pending entry timed out; queued exit not executed', NOW())`,
        [row.user_id, row.exchange, row.symbol, rowMode, JSON.stringify(action)],
      );
    }
  }
}

async function resolveExchangeKeys(
  userId: string,
  mode: Mode,
  requested?: ExchangeName,
  options?: { forceRequestedOnly?: boolean },
): Promise<ApiKeyRow[]> {
  const all = await getModeApiKeysForUser(userId, mode);
  if (!all.length) throw new Error(`No ${mode === 'demo' ? 'testnet' : 'mainnet'} API keys configured`);
  if (EXECUTE_ALL_EXCHANGES_BY_DEFAULT && !options?.forceRequestedOnly) {
    return all;
  }
  if (requested) {
    const only = all.filter((k) => k.exchange === requested);
    if (!only.length) throw new Error(`No ${requested} API key configured for ${mode} mode`);
    return only;
  }
  return all;
}

async function drainQueuedActionsForPosition(
  userId: string,
  mode: Mode,
  exchange: ExchangeName,
  symbol: string,
): Promise<any[]> {
  const row = await getTrackedPosition(userId, exchange, symbol, mode);
  if (!row || row.state !== 'OPEN') return [];
  const queued = Array.isArray(row.queued_actions) ? row.queued_actions : [];
  if (!queued.length) return [];

  // Clear first to avoid duplicate replays on retries.
  await pool.query(
    `UPDATE positions
     SET queued_actions = '[]'::jsonb, updated_at = NOW()
     WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4`,
    [userId, exchange, symbol, mode],
  );

  const replayDetails: any[] = [];
  for (const action of queued) {
    const eventType = String(action?.event_type ?? '');
    if (!isExitEvent(eventType)) continue;
    const eventId = String(action?.event_id ?? `queued-${Date.now()}-${Math.random()}`);
    const replayPayload: NormalizedPayload = {
      event_id: eventId,
      event_type: eventType,
      symbol,
      exchange,
      quantity: action?.quantity != null ? Number(action.quantity) : undefined,
      price: action?.price != null ? Number(action.price) : undefined,
      stop_loss: action?.stop_loss != null ? Number(action.stop_loss) : undefined,
      sl_price: action?.stop_loss != null ? Number(action.stop_loss) : undefined,
    };
    const out = await executeExit(userId, mode, replayPayload, { forceRequestedOnly: true });
    replayDetails.push(
      ...out.details.map((d) => ({
        ...d,
        replayed_from_queue: true,
        queued_event_id: eventId,
        queued_event_type: eventType,
      })),
    );
  }
  return replayDetails;
}

function validatePayloadStrict(payload: NormalizedPayload): string | null {
  if (!payload.event_id) return 'event_id is required';
  if (!payload.event_type || payload.event_type === 'UNKNOWN') return 'event_type is required';
  if (!ALLOWED_EVENT_TYPES.has(payload.event_type)) return `Unsupported event_type: ${payload.event_type}`;
  if (!payload.symbol || !/^[A-Z0-9]{5,30}$/.test(payload.symbol)) return 'Invalid symbol format (expected like BTCUSDT)';
  if (payload.event_type === 'SL_UPDATE') {
    const slPrice = payload.stop_loss ?? payload.sl_price ?? payload.price;
    if (!Number.isFinite(Number(slPrice ?? NaN)) || Number(slPrice) <= 0) {
      return 'SL_UPDATE requires stop_loss/sl_price';
    }
  }
  const providedSecret = payload.passphrase || payload.secret;
  if (!providedSecret) return 'passphrase/secret is required';
  return null;
}

function resolveExitQuantity(eventType: string, positionQty: number, payloadQty?: number): number {
  if (!Number.isFinite(positionQty) || positionQty <= 0) return 0;
  if (Number.isFinite(payloadQty) && Number(payloadQty) > 0) {
    return Math.min(positionQty, Number(payloadQty));
  }
  if (eventType in TP_FRACTIONS) {
    const fraction = TP_FRACTIONS[eventType] ?? 1;
    const computed = positionQty * fraction;
    return Math.max(0.001, Number(computed.toFixed(3)));
  }
  return positionQty;
}

function resolveTpFraction(eventType: string, payload: NormalizedPayload): number | undefined {
  const m = /^TP([1-5])_HIT$/.exec(eventType);
  if (!m) return undefined;
  const idx = Number(m[1]) - 1;
  const arr = Array.isArray(payload.tp_percentages) ? payload.tp_percentages : undefined;
  if (arr && Number.isFinite(arr[idx]) && arr[idx] > 0 && arr[idx] <= 1) return Number(arr[idx]);
  return TP_FRACTIONS[eventType];
}

async function updatePositionAfterExitFill(
  userId: string,
  exchange: ExchangeName,
  symbol: string,
  mode: Mode,
  positionQty: number,
  exitQty: number,
  closeReason: string,
): Promise<{ closed: boolean; remaining: number }> {
  const remaining = Number((positionQty - exitQty).toFixed(6));
  if (!Number.isFinite(remaining) || remaining <= 0.000001) {
    await closePositionForExit(userId, { event_type: closeReason, symbol, exchange, event_id: 'system' } as NormalizedPayload, mode);
    return { closed: true, remaining: 0 };
  }
  await pool.query(
    `UPDATE positions
     SET quantity = $5, updated_at = NOW(), state = 'OPEN'
     WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4 AND state IN ('OPEN', 'CLOSING', 'PENDING_ENTRY')`,
    [userId, exchange, symbol, mode, Number(remaining.toFixed(3))],
  );
  return { closed: false, remaining: Number(remaining.toFixed(3)) };
}

async function executeEntry(userId: string, mode: Mode, payload: NormalizedPayload): Promise<{ queued: boolean; details: any[] }> {
  const keys = await resolveExchangeKeys(userId, mode, payload.exchange);
  const details: any[] = [];
  await upsertPositionForEntry(userId, payload, mode, 'PENDING_ENTRY');
  for (const key of keys) {
    let computedQty: number | undefined;
    try {
      const risk = await getRiskSettingForSymbol(userId, key.exchange, payload.symbol!);
      const quantity = await computeOrderQuantity(key, mode, payload.symbol!, payload.quantity, risk);
      computedQty = quantity;
      const side: 'buy' | 'sell' = payload.event_type === 'SHORT_ENTRY' ? 'sell' : 'buy';
      const order = await placeMarketOrder(key, mode, payload.symbol!, side, quantity, false, payload.event_id);
      details.push({
        exchange: key.exchange,
        success: true,
        order_id: payload.event_id,
        exchange_order_id: order.orderId,
        quantity,
      });
      await insertTrade(
        userId,
        { ...payload, exchange: key.exchange, quantity },
        mode,
        'executed',
        undefined,
        payload.event_id,
        order.orderId,
        payload.event_id,
      );
      await upsertPositionForEntry(userId, { ...payload, exchange: key.exchange, quantity }, mode, 'OPEN');
      const replayed = await drainQueuedActionsForPosition(userId, mode, key.exchange, payload.symbol!);
      if (replayed.length) details.push(...replayed);
    } catch (error: any) {
      details.push({
        exchange: key.exchange,
        success: false,
        error: error?.message ?? 'Order execution failed',
      });
      await insertTrade(
        userId,
        { ...payload, exchange: key.exchange, quantity: computedQty ?? payload.quantity },
        mode,
        'queued',
        error?.message ?? 'Entry queued due to execution error',
        payload.event_id,
        null,
        payload.event_id,
      );
    }
  }
  const allFailed = details.every((d) => !d.success);
  return { queued: allFailed, details };
}

async function executeExit(
  userId: string,
  mode: Mode,
  payload: NormalizedPayload,
  options?: { forceRequestedOnly?: boolean },
): Promise<{ queued: boolean; details: any[] }> {
  const keys = await resolveExchangeKeys(userId, mode, payload.exchange, {
    forceRequestedOnly: options?.forceRequestedOnly,
  });
  const details: any[] = [];
  for (const key of keys) {
    const pos = await getTrackedPosition(userId, key.exchange, payload.symbol!, mode);
    if (pos?.state === 'PENDING_ENTRY') {
      await queuePendingAction(userId, key.exchange, payload.symbol!, mode, payload);
      await insertTrade(userId, { ...payload, exchange: key.exchange }, mode, 'queued', 'Exit queued while entry pending');
      details.push({ exchange: key.exchange, success: false, queued: true, reason: 'PENDING_ENTRY' });
      continue;
    }
    if (pos?.state === 'CLOSING') {
      await insertTrade(
        userId,
        { ...payload, exchange: key.exchange },
        mode,
        'ignored',
        'Duplicate close signal ignored while position is CLOSING',
        payload.event_id,
      );
      details.push({ exchange: key.exchange, success: false, ignored: true, reason: 'CLOSING_DUPLICATE' });
      continue;
    }
    try {
      const snap = await pool.query(
        `SELECT side, quantity FROM positions
         WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, key.exchange, payload.symbol!, mode],
      );
      const position = snap.rows[0];
      if (!position) {
        await insertTrade(userId, { ...payload, exchange: key.exchange }, mode, 'not_executed', 'No open position found');
        details.push({ exchange: key.exchange, success: false, error: 'No open position found' });
        continue;
      }
      const qty = Number(position.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        await insertTrade(userId, { ...payload, exchange: key.exchange }, mode, 'not_executed', 'Invalid open position quantity');
        details.push({ exchange: key.exchange, success: false, error: 'Invalid open quantity' });
        continue;
      }
      const positionSide = String(position.side).toLowerCase() === 'short' ? 'short' : 'long';
      if (payload.event_type === 'SL_UPDATE') {
        const slPrice = Number(payload.stop_loss ?? payload.sl_price ?? payload.price ?? 0);
        const updated = await updateStopLossOrder(key, mode, payload.symbol!, positionSide, slPrice);
        await insertTrade(
          userId,
          { ...payload, exchange: key.exchange, quantity: 0, side: positionSide === 'long' ? 'sell' : 'buy', price: slPrice },
          mode,
          'executed',
          'Stop-loss updated',
          payload.event_id,
          updated.orderId,
          payload.event_id,
        );
        details.push({
          exchange: key.exchange,
          success: true,
          order_id: payload.event_id,
          exchange_order_id: updated.orderId,
          action: 'sl_update',
          stop_price: slPrice,
        });
        continue;
      }

      const closeSide: 'buy' | 'sell' = positionSide === 'long' ? 'sell' : 'buy';
      const tpFraction = resolveTpFraction(payload.event_type, payload);
      const qtyFromTp = tpFraction ? Number((qty * tpFraction).toFixed(3)) : undefined;
      const exitQty = resolveExitQuantity(payload.event_type, qty, payload.quantity ?? qtyFromTp);
      if (!Number.isFinite(exitQty) || exitQty <= 0) {
        await insertTrade(userId, { ...payload, exchange: key.exchange }, mode, 'not_executed', 'Computed exit quantity is invalid');
        details.push({ exchange: key.exchange, success: false, error: 'Computed exit quantity invalid' });
        continue;
      }
      await pool.query(
        `UPDATE positions
         SET state = 'CLOSING', updated_at = NOW()
         WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4 AND state = 'OPEN'`,
        [userId, key.exchange, payload.symbol!, mode],
      );
      const order = await placeMarketOrder(key, mode, payload.symbol!, closeSide, exitQty, true, payload.event_id);
      await insertTrade(
        userId,
        { ...payload, exchange: key.exchange, quantity: exitQty, side: closeSide },
        mode,
        'executed',
        payload.event_type.startsWith('TP') ? `Partial TP exit executed (${payload.event_type})` : undefined,
        payload.event_id,
        order.orderId,
        payload.event_id,
      );
      const after = await updatePositionAfterExitFill(
        userId,
        key.exchange,
        payload.symbol!,
        mode,
        qty,
        exitQty,
        payload.event_type,
      );
      details.push({
        exchange: key.exchange,
        success: true,
        order_id: payload.event_id,
        exchange_order_id: order.orderId,
        quantity: exitQty,
        remaining_quantity: after.remaining,
        closed: after.closed,
      });
    } catch (error: any) {
      await pool.query(
        `UPDATE positions
         SET state = 'OPEN', updated_at = NOW()
         WHERE user_id = $1 AND exchange = $2 AND symbol = $3 AND mode = $4 AND state = 'CLOSING'`,
        [userId, key.exchange, payload.symbol!, mode],
      );
      await insertTrade(
        userId,
        { ...payload, exchange: key.exchange },
        mode,
        'failed',
        error?.message ?? 'Exit execution failed',
        payload.event_id,
        null,
        payload.event_id,
      );
      details.push({ exchange: key.exchange, success: false, error: error?.message ?? 'Exit execution failed' });
    }
  }
  const allQueued = details.every((d) => d.queued === true);
  return { queued: allQueued, details };
}

export async function processWebhook(rawBody: unknown, contentType: string | undefined, query: Record<string, unknown>) {
  const source =
    typeof rawBody === 'string'
      ? parseTextPayload(rawBody)
      : (rawBody as Record<string, unknown> | null) ?? {};

  if (isHealthEvent(source)) {
    return {
      status: 200,
      body: { ok: true, status: 'healthy', timestamp: new Date().toISOString(), version: 'node-backend' },
    };
  }

  const payload = normalizeWebhookPayload(source);
  const providedSecret = payload.passphrase || payload.secret;
  const envSecret = String(process.env.WEBHOOK_PASSPHRASE ?? '').trim();
  if (envSecret && providedSecret !== envSecret) {
    logger.warn('Webhook env passphrase mismatch; falling back to DB secret validation', {
      hasProvidedSecret: Boolean(providedSecret),
      envSecretConfigured: Boolean(envSecret),
      providedLength: String(providedSecret ?? '').trim().length,
      envLength: envSecret.length,
      timestamp: new Date().toISOString(),
    });
  }
  const validationError = validatePayloadStrict(payload);
  if (validationError && !payload.dry_run) {
    logger.warn('Webhook payload validation failed', {
      error: validationError,
      eventType: payload.event_type,
      symbol: payload.symbol,
      hasPassphrase: Boolean(payload.passphrase || payload.secret),
      contentType,
      timestamp: new Date().toISOString(),
    });
    return {
      status: 400,
      body: { error: 'Invalid payload', message: validationError },
    };
  }
  const dryRunQuery = String(query.dry_run ?? '').toLowerCase();
  const dryRun = payload.dry_run || dryRunQuery === '1' || dryRunQuery === 'true';

  if (dryRun) {
    return {
      status: 200,
      body: {
        ok: true,
        dry_run: true,
        parsed: payload,
      },
    };
  }

  let user = await resolveUserFromWebhookSecret(payload);
  if (!user && providedSecret) {
    const identified = await resolveUserFromPayloadIdentity(payload);
    if (identified) {
      await upsertWebhookSecretForUser(identified.userId, providedSecret);
      user = identified;
      logger.info('Webhook secret auto-synced from payload for identified user', {
        userId: identified.userId,
        mode: identified.mode,
        usedIdentity: payload.user_id || payload.userId ? 'user_id' : payload.email ? 'email' : 'unknown',
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (!user) {
    logger.warn('Webhook rejected: DB webhook_secret not matched', {
      hasProvidedSecret: Boolean(providedSecret),
      providedLength: String(providedSecret ?? '').trim().length,
      timestamp: new Date().toISOString(),
    });
    return { status: 401, body: { error: 'Invalid webhook secret' } };
  }

  if (await isDuplicateEvent(user.userId, payload.event_id)) {
    return {
      status: 200,
      body: { success: true, duplicate: true, event_id: payload.event_id, event_type: payload.event_type },
    };
  }

  const mode: Mode = payload.is_testnet === true ? 'demo' : user.mode;
  await applyPendingTimeouts(user.userId);
  await insertWebhookEvent(user.userId, payload, payload.exchange ?? null);
  let execution: { queued: boolean; details: any[] } = { queued: false, details: [] };
  if (payload.event_type === 'LONG_ENTRY' || payload.event_type === 'SHORT_ENTRY') {
    execution = await executeEntry(user.userId, mode, payload);
  } else if (isExitEvent(payload.event_type)) {
    execution = await executeExit(user.userId, mode, payload);
  } else {
    await insertTrade(user.userId, payload, mode);
  }

  logger.info('Webhook processed by backend service', {
    userId: user.userId,
    eventId: payload.event_id,
    eventType: payload.event_type,
    symbol: payload.symbol,
    mode,
    queued: execution.queued,
  });

  return {
    status: 200,
    body: {
      success: true,
      mode,
      event_id: payload.event_id,
      event_type: payload.event_type,
      strategy_id: payload.strategy_id ?? null,
      queued: execution.queued,
      results: execution.details,
    },
  };
}
