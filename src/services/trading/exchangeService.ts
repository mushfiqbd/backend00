import pool from '../../config/database';
import logger from '../../utils/logger';
import { bybitSignHeaders, hmacSha256Hex, toQuery } from '../../utils/cryptoHelpers';

export type Mode = 'demo' | 'real';
export type ExchangeName = 'binance' | 'bybit';

export type ApiKeyRow = {
  exchange: ExchangeName;
  api_key: string;
  api_secret: string;
  is_testnet: boolean;
};

export type RiskSettingRow = {
  exchange: string;
  symbol: string;
  size_type: 'fixed_usdt' | 'equity_percent' | 'risk_percent';
  size_value: number;
  leverage: number;
  margin_mode: 'cross' | 'isolated';
  max_position_usdt: number | null;
  max_daily_trades: number | null;
};

const BYBIT_ENABLED = String(process.env.BYBIT_ENABLED ?? 'true').toLowerCase() !== 'false';
const BINANCE_MAINNET = 'https://fapi.binance.com';
const BINANCE_TESTNET = 'https://testnet.binancefuture.com';
const BYBIT_MAINNET = 'https://api.bytick.com';
const BYBIT_TESTNET = 'https://api-testnet.bybit.com';
const qtyConstraintCache = new Map<
  string,
  { minQty: number; stepQty: number; minNotional: number; expiresAt: number }
>();

async function getUserApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const query = `
    SELECT exchange, api_key, api_secret, is_testnet
    FROM api_keys
    WHERE user_id = $1
      AND api_key IS NOT NULL
      AND api_secret IS NOT NULL
      AND api_key <> ''
      AND api_secret <> ''
  `;
  const result = await pool.query(query, [userId]);
  return (result.rows || []) as ApiKeyRow[];
}

export async function getModeApiKeysForUser(userId: string, mode: Mode): Promise<ApiKeyRow[]> {
  const desiredIsTestnet = mode === 'demo';
  return (await getUserApiKeys(userId)).filter((k) => Boolean(k.is_testnet) === desiredIsTestnet);
}

export async function getRiskSettingForSymbol(
  userId: string,
  exchange: ExchangeName,
  symbol: string,
): Promise<RiskSettingRow> {
  const query = `
    SELECT exchange, symbol, size_type, size_value, leverage, margin_mode, max_position_usdt, max_daily_trades
    FROM risk_settings
    WHERE user_id = $1
      AND (
        (exchange = $2 AND symbol = $3) OR
        (exchange = $2 AND symbol = '__DEFAULT__') OR
        (exchange = 'default' AND symbol = '__DEFAULT__')
      )
    ORDER BY
      CASE
        WHEN exchange = $2 AND symbol = $3 THEN 0
        WHEN exchange = $2 AND symbol = '__DEFAULT__' THEN 1
        ELSE 2
      END
    LIMIT 1
  `;
  const result = await pool.query(query, [userId, exchange, symbol]);
  const row = result.rows[0] || {
    exchange,
    symbol: '__DEFAULT__',
    size_type: 'fixed_usdt',
    size_value: 150,
    leverage: 1,
    margin_mode: 'cross',
    max_position_usdt: null,
    max_daily_trades: null,
  };
  return {
    exchange: row.exchange,
    symbol: row.symbol,
    size_type: row.size_type,
    size_value: Number(row.size_value ?? 150),
    leverage: Number(row.leverage ?? 1),
    margin_mode: row.margin_mode === 'isolated' ? 'isolated' : 'cross',
    max_position_usdt: row.max_position_usdt != null ? Number(row.max_position_usdt) : null,
    max_daily_trades: row.max_daily_trades != null ? Number(row.max_daily_trades) : null,
  };
}

async function binanceSignedGet(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const timestamp = Date.now();
  const recvWindow = 5000;
  const query = toQuery({ ...params, timestamp, recvWindow });
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;
  const res = await fetch(url, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Binance ${path} error (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function binanceSignedPost(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const timestamp = Date.now();
  const recvWindow = 5000;
  const query = toQuery({ ...params, timestamp, recvWindow });
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Binance ${path} error (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function binanceSignedDelete(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const timestamp = Date.now();
  const recvWindow = 5000;
  const query = toQuery({ ...params, timestamp, recvWindow });
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Binance ${path} error (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function bybitSignedGet(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const query = toQuery(params);
  const headers = await bybitSignHeaders(apiKey, apiSecret, query);
  const url = `${baseUrl}${path}?${query}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit ${path} error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (json?.retCode !== 0) throw new Error(`Bybit ${path} failed: ${json?.retMsg ?? text}`);
  return json;
}

async function bybitSignedPost(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  payload: Record<string, unknown>,
) {
  const body = JSON.stringify(payload);
  const headers = await bybitSignHeaders(apiKey, apiSecret, body);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit ${path} error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (json?.retCode !== 0) throw new Error(`Bybit ${path} failed: ${json?.retMsg ?? text}`);
  return json;
}

async function getBinanceMarkPrice(baseUrl: string, symbol: string): Promise<number> {
  const url = `${baseUrl}/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Binance ticker error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  const price = Number(json?.price ?? 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Binance returned invalid mark price');
  return price;
}

async function getBybitMarkPrice(baseUrl: string, symbol: string): Promise<number> {
  const url = `${baseUrl}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit ticker error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  const price = Number(json?.result?.list?.[0]?.lastPrice ?? 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Bybit returned invalid mark price');
  return price;
}

export async function getMarkPrice(exchange: ExchangeName, symbol: string, mode: Mode): Promise<number> {
  if (exchange === 'binance') {
    return getBinanceMarkPrice(mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET, symbol);
  }
  return getBybitMarkPrice(mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET, symbol);
}

export async function getWalletUsdtBalance(keys: ApiKeyRow, mode: Mode): Promise<number> {
  if (keys.exchange === 'binance') {
    const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
    const balances = await binanceSignedGet(baseUrl, '/fapi/v2/balance', keys.api_key, keys.api_secret, {});
    const usdt = Array.isArray(balances) ? balances.find((b) => b?.asset === 'USDT') : null;
    return Number(usdt?.availableBalance ?? usdt?.balance ?? 0);
  }
  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  const json = await bybitSignedGet(baseUrl, '/v5/account/wallet-balance', keys.api_key, keys.api_secret, {
    accountType: 'UNIFIED',
    coin: 'USDT',
  });
  const coin = json?.result?.list?.[0]?.coin?.find?.((c: any) => c?.coin === 'USDT');
  return Number(coin?.availableToWithdraw ?? coin?.availableBalance ?? coin?.equity ?? 0);
}

function normalizeQty(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Number(qty.toFixed(3));
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const units = Math.floor(value / step);
  const out = units * step;
  return Number(out.toFixed(8));
}

async function getBinanceQtyConstraints(
  mode: Mode,
  symbol: string,
): Promise<{ minQty: number; stepQty: number; minNotional: number }> {
  const cacheKey = `binance:${mode}:${symbol}`;
  const now = Date.now();
  const cached = qtyConstraintCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { minQty: cached.minQty, stepQty: cached.stepQty, minNotional: cached.minNotional };
  }

  const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
  const res = await fetch(`${baseUrl}/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Binance exchangeInfo error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  const sym = json?.symbols?.[0];
  const lot = (sym?.filters || []).find((f: any) => f?.filterType === 'LOT_SIZE');
  const minNotionalFilter = (sym?.filters || []).find((f: any) => f?.filterType === 'MIN_NOTIONAL');
  const minQty = Number(lot?.minQty ?? 0.001);
  const stepQty = Number(lot?.stepSize ?? 0.001);
  const minNotional = Number(minNotionalFilter?.notional ?? 5);
  qtyConstraintCache.set(cacheKey, { minQty, stepQty, minNotional, expiresAt: now + 10 * 60 * 1000 });
  return { minQty, stepQty, minNotional };
}

async function getBybitQtyConstraints(
  mode: Mode,
  symbol: string,
): Promise<{ minQty: number; stepQty: number; minNotional: number }> {
  const cacheKey = `bybit:${mode}:${symbol}`;
  const now = Date.now();
  const cached = qtyConstraintCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { minQty: cached.minQty, stepQty: cached.stepQty, minNotional: cached.minNotional };
  }

  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  const res = await fetch(
    `${baseUrl}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`,
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit instruments-info error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  const item = json?.result?.list?.[0];
  const minQty = Number(item?.lotSizeFilter?.minOrderQty ?? 0.001);
  const stepQty = Number(item?.lotSizeFilter?.qtyStep ?? 0.001);
  const minNotional = Number(item?.lotSizeFilter?.minNotionalValue ?? 5);
  qtyConstraintCache.set(cacheKey, { minQty, stepQty, minNotional, expiresAt: now + 10 * 60 * 1000 });
  return { minQty, stepQty, minNotional };
}

async function normalizeOrderQuantity(
  exchange: ExchangeName,
  mode: Mode,
  symbol: string,
  rawQty: number,
  enforceMin: boolean,
): Promise<number> {
  const qty = Number(rawQty);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  try {
    const constraints =
      exchange === 'binance'
        ? await getBinanceQtyConstraints(mode, symbol)
        : await getBybitQtyConstraints(mode, symbol);
    let normalized = floorToStep(qty, constraints.stepQty);
    if (enforceMin && normalized < constraints.minQty) {
      normalized = constraints.minQty;
    }
    return Number(normalized.toFixed(8));
  } catch {
    const fallback = normalizeQty(qty);
    if (enforceMin && fallback <= 0) return 0.001;
    return fallback;
  }
}

export async function computeOrderQuantity(
  keys: ApiKeyRow,
  mode: Mode,
  symbol: string,
  quantityFromPayload: number | undefined,
  risk: RiskSettingRow,
): Promise<number> {
  if (Number.isFinite(quantityFromPayload) && (quantityFromPayload as number) > 0) {
    return normalizeQty(quantityFromPayload as number);
  }
  const markPrice = await getMarkPrice(keys.exchange, symbol, mode);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error('Unable to derive mark price for quantity fallback');
  }

  let notional = 0;
  if (risk.size_type === 'fixed_usdt') {
    notional = Math.max(0, Number(risk.size_value || 0));
  } else {
    const balance = await getWalletUsdtBalance(keys, mode);
    const pct = Math.max(0, Number(risk.size_value || 0));
    notional = balance * (pct / 100);
  }
  if (!Number.isFinite(notional) || notional <= 0) {
    throw new Error('Invalid risk sizing configuration');
  }
  if (risk.max_position_usdt && notional > risk.max_position_usdt) {
    notional = risk.max_position_usdt;
  }
  const qty = notional / markPrice;
  const normalized = await normalizeOrderQuantity(keys.exchange, mode, symbol, qty, true);
  const constraints =
    keys.exchange === 'binance'
      ? await getBinanceQtyConstraints(mode, symbol)
      : await getBybitQtyConstraints(mode, symbol);
  const normalizedNotional = normalized * markPrice;
  if (Number.isFinite(constraints.minNotional) && constraints.minNotional > 0 && normalizedNotional < constraints.minNotional) {
    const bumpedQty = await normalizeOrderQuantity(
      keys.exchange,
      mode,
      symbol,
      constraints.minNotional / markPrice,
      true,
    );
    if (!Number.isFinite(bumpedQty) || bumpedQty <= 0) {
      throw new Error('Computed quantity is below minNotional');
    }
    return bumpedQty;
  }
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('Computed quantity is invalid');
  }
  return normalized;
}

export async function placeMarketOrder(
  keys: ApiKeyRow,
  mode: Mode,
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  reduceOnly: boolean,
  clientOrderId?: string,
): Promise<{ orderId: string | null; response: any }> {
  const qty = await normalizeOrderQuantity(keys.exchange, mode, symbol, quantity, false);
  if (qty <= 0) throw new Error('Quantity must be greater than zero');
  const normalizedClientId =
    clientOrderId && clientOrderId.trim()
      ? clientOrderId
          .trim()
          .replace(/[^A-Za-z0-9:_\-./]/g, '_')
          .slice(0, 36)
      : undefined;
  if (keys.exchange === 'binance') {
    const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
    const res = await binanceSignedPost(baseUrl, '/fapi/v1/order', keys.api_key, keys.api_secret, {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: qty,
      reduceOnly: reduceOnly ? true : undefined,
      newClientOrderId: normalizedClientId,
    });
    return { orderId: res?.orderId ? String(res.orderId) : null, response: res };
  }

  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  const res = await bybitSignedPost(baseUrl, '/v5/order/create', keys.api_key, keys.api_secret, {
    category: 'linear',
    symbol,
    side: side === 'buy' ? 'Buy' : 'Sell',
    orderType: 'Market',
    qty: String(qty),
    reduceOnly,
    closeOnTrigger: reduceOnly ? true : undefined,
    positionIdx: 0,
    orderLinkId: normalizedClientId,
  });
  return { orderId: res?.result?.orderId ? String(res.result.orderId) : null, response: res };
}

export async function updateStopLossOrder(
  keys: ApiKeyRow,
  mode: Mode,
  symbol: string,
  positionSide: 'long' | 'short',
  stopPrice: number,
): Promise<{ orderId: string | null; response: any }> {
  const normalizedPrice = Number(stopPrice);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    throw new Error('SL_UPDATE requires a valid stop price');
  }

  if (keys.exchange === 'binance') {
    const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
    const closeSide = positionSide === 'long' ? 'SELL' : 'BUY';
    const res = await binanceSignedPost(baseUrl, '/fapi/v1/order', keys.api_key, keys.api_secret, {
      symbol,
      side: closeSide,
      type: 'STOP_MARKET',
      stopPrice: Number(normalizedPrice.toFixed(6)),
      closePosition: true,
      workingType: 'MARK_PRICE',
    });
    return { orderId: res?.orderId ? String(res.orderId) : null, response: res };
  }

  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  const res = await bybitSignedPost(baseUrl, '/v5/position/trading-stop', keys.api_key, keys.api_secret, {
    category: 'linear',
    symbol,
    tpslMode: 'Full',
    slTriggerBy: 'LastPrice',
    stopLoss: String(Number(normalizedPrice.toFixed(6))),
    positionIdx: 0,
  });
  return { orderId: null, response: res };
}

export async function cancelEntryOrderByClientId(
  keys: ApiKeyRow,
  mode: Mode,
  symbol: string,
  clientOrderId: string,
): Promise<void> {
  const clientId =
    String(clientOrderId || '')
      .trim()
      .replace(/[^A-Za-z0-9:_\-./]/g, '_')
      .slice(0, 36);
  if (!clientId) return;

  if (keys.exchange === 'binance') {
    const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
    try {
      await binanceSignedDelete(baseUrl, '/fapi/v1/order', keys.api_key, keys.api_secret, {
        symbol,
        origClientOrderId: clientId,
      });
    } catch {
      // Ignore cancel errors to keep timeout lifecycle deterministic.
    }
    return;
  }

  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  try {
    await bybitSignedPost(baseUrl, '/v5/order/cancel', keys.api_key, keys.api_secret, {
      category: 'linear',
      symbol,
      orderLinkId: clientId,
    });
  } catch {
    // Ignore cancel errors to keep timeout lifecycle deterministic.
  }
}

async function getBinanceSnapshot(keys: ApiKeyRow, mode: Mode) {
  const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
  const balances = await binanceSignedGet(baseUrl, '/fapi/v2/balance', keys.api_key, keys.api_secret, {});
  const usdt = Array.isArray(balances) ? balances.find((b) => b?.asset === 'USDT') : null;
  const available = Number(usdt?.availableBalance ?? 0);
  const total = Number(usdt?.balance ?? usdt?.crossWalletBalance ?? usdt?.availableBalance ?? 0);

  const positionsRaw = await binanceSignedGet(baseUrl, '/fapi/v2/positionRisk', keys.api_key, keys.api_secret, {});
  const positions = (Array.isArray(positionsRaw) ? positionsRaw : [])
    .filter((p) => Number(p?.positionAmt) !== 0)
    .map((p) => {
      const qty = Number(p.positionAmt);
      return {
        exchange: 'binance',
        symbol: String(p.symbol),
        side: qty >= 0 ? 'long' : 'short',
        entry_price: Number(p.entryPrice ?? 0),
        quantity: Math.abs(qty),
        leverage: Number(p.leverage ?? 1),
        unrealized_pnl: Number(p.unRealizedProfit ?? 0),
        opened_at: new Date().toISOString(),
      };
    });

  // userTrades requires symbol; fetch for open symbols plus common futures symbols.
  const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
  const symbols = [...new Set([...positions.map((p) => p.symbol), ...defaultSymbols])].slice(0, 6);
  const tradeLists = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const list = await binanceSignedGet(baseUrl, '/fapi/v1/userTrades', keys.api_key, keys.api_secret, {
          symbol,
          limit: 50,
        });
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    }),
  );
  const trades = tradeLists
    .flat()
    .map((t: any) => {
      const createdAt = t?.time ? new Date(Number(t.time)).toISOString() : new Date().toISOString();
      const feeRaw = Number(t?.commission);
      const pnlRaw = Number(t?.realizedPnl);
      const priceRaw = Number(t?.price ?? 0);
      return {
        exchange: 'binance',
        symbol: String(t?.symbol ?? ''),
        side: String(t?.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy',
        order_type: String(t?.type ?? t?.orderType ?? 'market').toLowerCase(),
        quantity: Number(t?.qty ?? 0),
        price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
        mode,
        status: 'filled',
        order_id: t?.orderId ? String(t.orderId) : null,
        exchange_order_id: t?.orderId ? String(t.orderId) : null,
        client_order_id: t?.clientOrderId ? String(t.clientOrderId) : null,
        created_at: createdAt,
        executed_at: createdAt,
        fee: Number.isFinite(feeRaw) ? feeRaw : null,
        realized_pnl: Number.isFinite(pnlRaw) ? pnlRaw : null,
        maker: typeof t?.maker === 'boolean' ? t.maker : null,
        event_id: null,
        event_type: null,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 200);

  return {
    balance: {
      total: Number.isFinite(total) ? total : 0,
      available: Number.isFinite(available) ? available : 0,
    },
    positions,
    trades,
    income: [] as unknown[],
  };
}

async function getBybitSnapshot(keys: ApiKeyRow, mode: Mode) {
  if (!BYBIT_ENABLED) return null;
  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;

  const balanceJson = await bybitSignedGet(baseUrl, '/v5/account/wallet-balance', keys.api_key, keys.api_secret, {
    accountType: 'UNIFIED',
    coin: 'USDT',
  });
  const coin = balanceJson?.result?.list?.[0]?.coin?.find?.((c: any) => c?.coin === 'USDT');
  const total = Number(coin?.equity ?? coin?.walletBalance ?? 0);
  const available = Number(coin?.availableToWithdraw ?? coin?.availableBalance ?? 0);

  const posJson = await bybitSignedGet(baseUrl, '/v5/position/list', keys.api_key, keys.api_secret, {
    category: 'linear',
    settleCoin: 'USDT',
  });
  const positions = (posJson?.result?.list || [])
    .filter((p: any) => Number(p?.size ?? 0) > 0)
    .map((p: any) => ({
      exchange: 'bybit',
      symbol: String(p.symbol),
      side: String(p.side || '').toLowerCase() === 'buy' ? 'long' : 'short',
      entry_price: Number(p.avgPrice ?? 0),
      quantity: Number(p.size ?? 0),
      leverage: Number(p.leverage ?? 1),
      unrealized_pnl: Number(p.unrealisedPnl ?? 0),
      opened_at: new Date().toISOString(),
    }));

  const executionsJson = await bybitSignedGet(baseUrl, '/v5/execution/list', keys.api_key, keys.api_secret, {
    category: 'linear',
    limit: 100,
  });
  const trades = (executionsJson?.result?.list || [])
    .map((e: any) => {
      const execTime = e?.execTime ? new Date(Number(e.execTime)).toISOString() : new Date().toISOString();
      const priceRaw = Number(e?.execPrice ?? 0);
      const qtyRaw = Number(e?.execQty ?? 0);
      const feeRaw = Number(e?.execFee);
      const pnlRaw = Number(e?.execPnl);
      const makerRaw = e?.isMaker;
      const maker =
        typeof makerRaw === 'boolean'
          ? makerRaw
          : makerRaw === '1' || makerRaw === 1
            ? true
            : makerRaw === '0' || makerRaw === 0
              ? false
              : null;
      return {
        exchange: 'bybit',
        symbol: String(e?.symbol ?? ''),
        side: String(e?.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy',
        order_type: String(e?.orderType ?? 'market').toLowerCase(),
        quantity: Number.isFinite(qtyRaw) ? qtyRaw : 0,
        price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
        mode,
        status: 'filled',
        order_id: e?.orderId ? String(e.orderId) : null,
        exchange_order_id: e?.orderId ? String(e.orderId) : null,
        client_order_id: e?.orderLinkId ? String(e.orderLinkId) : null,
        created_at: execTime,
        executed_at: execTime,
        fee: Number.isFinite(feeRaw) ? feeRaw : null,
        realized_pnl: Number.isFinite(pnlRaw) ? pnlRaw : null,
        maker,
        event_id: null,
        event_type: null,
      };
    })
    .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 200);

  return {
    balance: {
      total: Number.isFinite(total) ? total : 0,
      available: Number.isFinite(available) ? available : 0,
    },
    positions,
    trades,
    income: [] as unknown[],
  };
}

export async function getExchangeDataForUser(userId: string, mode: Mode) {
  const desiredIsTestnet = mode === 'demo';
  const apiKeys = (await getUserApiKeys(userId)).filter((k) => Boolean(k.is_testnet) === desiredIsTestnet);
  if (!apiKeys.length) {
    throw new Error(
      mode === 'demo'
        ? 'NO_KEYS: No testnet API keys found for demo mode'
        : 'NO_KEYS: No mainnet API keys found for real mode',
    );
  }

  const result = {
    mode,
    balances: {} as Record<string, unknown>,
    positions: [] as unknown[],
    trades: [] as unknown[],
    income: { binance: [] as unknown[], bybit: [] as unknown[] },
    errors: {} as Record<string, string>,
  };

  for (const key of apiKeys) {
    try {
      if (key.exchange === 'binance') {
        const data = await getBinanceSnapshot(key, mode);
        if (data) {
          result.balances.binance = data.balance;
          result.positions.push(...data.positions);
          result.trades.push(...data.trades);
          result.income.binance = data.income;
        }
      } else if (key.exchange === 'bybit' && BYBIT_ENABLED) {
        const data = await getBybitSnapshot(key, mode);
        if (data) {
          result.balances.bybit = data.balance;
          result.positions.push(...data.positions);
          result.trades.push(...data.trades);
          result.income.bybit = data.income;
        }
      }
    } catch (error: any) {
      result.errors[key.exchange] = error?.message ?? 'Unknown exchange error';
      logger.error('Error fetching real exchange data', {
        userId,
        exchange: key.exchange,
        error: error?.message,
      });
    }
  }

  // Keep combined trade history chronological across exchanges.
  result.trades = (result.trades as any[]).sort((a: any, b: any) => {
    const aTs = Date.parse(String(a?.created_at ?? a?.executed_at ?? ''));
    const bTs = Date.parse(String(b?.created_at ?? b?.executed_at ?? ''));
    const safeA = Number.isFinite(aTs) ? aTs : 0;
    const safeB = Number.isFinite(bTs) ? bTs : 0;
    return safeB - safeA;
  });

  // Enrich exchange snapshot positions with local lifecycle metadata for UI consistency.
  const trackedPositions = await pool.query(
    `SELECT exchange, symbol, strategy_id, state
     FROM positions
     WHERE user_id = $1
       AND mode = $2
       AND state IN ('PENDING_ENTRY', 'OPEN', 'CLOSING')`,
    [userId, mode],
  );
  const trackedMap = new Map<string, { strategy_id: string | null; state: string | null }>();
  for (const row of trackedPositions.rows) {
    const key = `${String(row.exchange || '').toLowerCase()}|${String(row.symbol || '').toUpperCase()}`;
    trackedMap.set(key, {
      strategy_id: row.strategy_id ? String(row.strategy_id) : null,
      state: row.state ? String(row.state) : null,
    });
  }
  result.positions = (result.positions as any[]).map((p: any) => {
    const key = `${String(p?.exchange || '').toLowerCase()}|${String(p?.symbol || '').toUpperCase()}`;
    const tracked = trackedMap.get(key);
    if (!tracked) return p;
    return {
      ...p,
      strategy_id: tracked.strategy_id ?? p?.strategy_id ?? null,
      state: tracked.state ?? p?.state ?? null,
    };
  });

  return result;
}

async function closeAllBinance(keys: ApiKeyRow, mode: Mode): Promise<{ closed: number; results: unknown[] }> {
  const baseUrl = mode === 'demo' ? BINANCE_TESTNET : BINANCE_MAINNET;
  const positionsRaw = await binanceSignedGet(baseUrl, '/fapi/v2/positionRisk', keys.api_key, keys.api_secret, {});
  const open = (Array.isArray(positionsRaw) ? positionsRaw : []).filter((p) => Number(p?.positionAmt) !== 0);

  const results: unknown[] = [];
  let closed = 0;
  for (const p of open) {
    const qty = Math.abs(Number(p.positionAmt));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const side = Number(p.positionAmt) > 0 ? 'SELL' : 'BUY';
    const res = await binanceSignedPost(baseUrl, '/fapi/v1/order', keys.api_key, keys.api_secret, {
      symbol: String(p.symbol),
      side,
      type: 'MARKET',
      quantity: qty,
      reduceOnly: true,
    });
    results.push(res);
    closed += 1;
  }
  return { closed, results };
}

async function closeAllBybit(keys: ApiKeyRow, mode: Mode): Promise<{ closed: number; results: unknown[] }> {
  const baseUrl = mode === 'demo' ? BYBIT_TESTNET : BYBIT_MAINNET;
  const positionsJson = await bybitSignedGet(baseUrl, '/v5/position/list', keys.api_key, keys.api_secret, {
    category: 'linear',
    settleCoin: 'USDT',
  });
  const open = (positionsJson?.result?.list || []).filter((p: any) => Number(p?.size ?? 0) > 0);
  const results: unknown[] = [];
  let closed = 0;

  for (const p of open) {
    const qty = Number(p.size ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const side = String(p.side || '').toLowerCase() === 'buy' ? 'Sell' : 'Buy';
    const order = await bybitSignedPost(baseUrl, '/v5/order/create', keys.api_key, keys.api_secret, {
      category: 'linear',
      symbol: String(p.symbol),
      side,
      orderType: 'Market',
      qty: String(qty),
      reduceOnly: true,
      closeOnTrigger: true,
      positionIdx: 0,
    });
    results.push(order);
    closed += 1;
  }

  return { closed, results };
}

export async function closeAllPositionsForUser(userId: string, mode: Mode) {
  const desiredIsTestnet = mode === 'demo';
  const keys = (await getUserApiKeys(userId)).filter((k) => Boolean(k.is_testnet) === desiredIsTestnet);
  const binanceKey = keys.find((k) => k.exchange === 'binance');
  const bybitKey = keys.find((k) => k.exchange === 'bybit');

  const response = {
    success: true,
    message: 'Close-all processed',
    mode,
    action: 'close_all' as const,
    binance: { closed: 0, results: [] as unknown[], error: null as string | null },
    bybit: { closed: 0, results: [] as unknown[], error: null as string | null },
  };

  if (binanceKey) {
    try {
      const out = await closeAllBinance(binanceKey, mode);
      response.binance.closed = out.closed;
      response.binance.results = out.results;
    } catch (error: any) {
      response.binance.error = error?.message ?? 'Unknown Binance close-all error';
      response.success = false;
    }
  }

  if (bybitKey && BYBIT_ENABLED) {
    try {
      const out = await closeAllBybit(bybitKey, mode);
      response.bybit.closed = out.closed;
      response.bybit.results = out.results;
    } catch (error: any) {
      response.bybit.error = error?.message ?? 'Unknown Bybit close-all error';
      response.success = false;
    }
  }

  await pool.query(
    `UPDATE positions
     SET state = 'CLOSED', closed_at = NOW(), close_reason = 'manual_close_all', updated_at = NOW()
     WHERE user_id = $1 AND mode = 'real' AND state IN ('PENDING_ENTRY', 'OPEN', 'CLOSING')`,
    [userId],
  );

  return response;
}
