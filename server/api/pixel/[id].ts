import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../lib/db';
import { detectProxy } from '../../lib/proxy-detect';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Session deduplication window (ms).
 * Same email + same IP within this window = one session, skip the duplicate.
 * Prevents Gmail reading-pane → full-view re-render from counting twice.
 */
const SESSION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Never cache — every load must hit the server
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', TRANSPARENT_GIF.length);

  const { id } = req.query as { id: string };
  if (!id) {
    res.status(400).end();
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = req.headers['user-agent'] ?? null;
  const country   = (req.headers['x-vercel-ip-country'] as string) ?? null;

  const { isProxy, reason } = detectProxy(userAgent, ip);

  // ── DB write BEFORE response ───────────────────────────────────
  // In Vercel serverless, the process is frozen the moment res.end() is
  // called, so any async work queued after that is silently dropped.
  // Writing synchronously (from the caller's perspective) guarantees the
  // event is persisted before we return the pixel.
  try {
    await ensureSchema();
    const sql = getDb();
    const sessionStart = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();

    const inserted = await sql`
      INSERT INTO open_events (email_id, ip, user_agent, country, is_proxy, proxy_reason)
      SELECT ${id}, ${ip}, ${userAgent}, ${country}, ${isProxy}, ${reason}
      WHERE NOT EXISTS (
        SELECT 1 FROM open_events
        WHERE email_id  = ${id}
          AND ip        = ${ip}
          AND opened_at > ${sessionStart}::timestamptz
      )
      RETURNING id
    `;

    if (inserted.length === 0) {
      console.log(`⏭️  Duplicate skipped (same session): ${id} — ${ip}`);
    } else {
      console.log(
        `${isProxy ? '🤖 Machine' : '👤 Human'} open: ${id} — ${
          isProxy ? reason : (userAgent?.slice(0, 60) ?? 'unknown')
        }`,
      );
    }
  } catch (err) {
    // Log but don't block pixel delivery on DB errors
    console.error('[pixel] Failed to log open event:', err);
  }

  // Serve the 1×1 transparent GIF
  res.status(200).end(TRANSPARENT_GIF);
}
