import type { VercelResponse } from '@vercel/node';

/**
 * Adds CORS headers that allow requests from Chrome extensions
 * and any web origin (pixel requests come from arbitrary email clients).
 */
export function setCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Handles OPTIONS pre-flight requests.
 * Returns true if the request was handled so the caller can return early.
 */
export function handlePreflight(
  method: string | undefined,
  res: VercelResponse,
): boolean {
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}
