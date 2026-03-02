/**
 * Crypto helper functions for exchange API interactions
 */

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );
  
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  return usp.toString();
}

export async function bybitSignHeaders(apiKey: string, apiSecret: string, payload: string) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const prehash = `${timestamp}${apiKey}${recvWindow}${payload}`;
  const sign = await hmacSha256Hex(apiSecret, prehash);
  return {
    'Content-Type': 'application/json',
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-SIGN': sign,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': recvWindow,
  };
}