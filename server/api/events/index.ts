import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../lib/db';
import { setCorsHeaders, handlePreflight } from '../../lib/cors';
import type { TrackedEmailWithStats } from '../../lib/types';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCorsHeaders(res);
  if (handlePreflight(req.method, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await ensureSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT
      te.id,
      te."to",
      te.subject,
      te.sent_at                                                    AS "sentAt",
      COUNT(oe.id)          FILTER (WHERE oe.is_proxy = false)::int AS "openCount",
      COUNT(oe.id)          FILTER (WHERE oe.is_proxy = true)::int  AS "machineOpenCount",
      MAX(oe.opened_at)     FILTER (WHERE oe.is_proxy = false)      AS "lastOpenedAt"
    FROM tracked_emails te
    LEFT JOIN open_events oe ON oe.email_id = te.id
    GROUP BY te.id, te."to", te.subject, te.sent_at
    ORDER BY te.sent_at DESC
    LIMIT 200
  `;

  const serverUrl =
    process.env.SERVER_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const emails: TrackedEmailWithStats[] = rows.map((r) => ({
    id:               r.id as string,
    to:               r.to as string,
    subject:          r.subject as string,
    sentAt:           (r.sentAt as Date).toISOString(),
    pixelUrl:         `${serverUrl}/api/pixel/${r.id}`,
    openCount:        r.openCount as number,
    machineOpenCount: r.machineOpenCount as number,
    lastOpenedAt:     r.lastOpenedAt ? (r.lastOpenedAt as Date).toISOString() : null,
  }));

  res.status(200).json(emails);
}
