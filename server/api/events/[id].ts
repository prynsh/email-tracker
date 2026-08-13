import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../lib/db';
import { setCorsHeaders, handlePreflight } from '../../lib/cors';
import type { OpenEvent, TrackedEmailWithStats } from '../../lib/types';

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

  const { id } = req.query as { id: string };
  if (!id) { res.status(400).json({ error: 'Missing email ID' }); return; }

  await ensureSchema();
  const sql = getDb();

  const emailRows = await sql`
    SELECT id, "to", subject, sent_at AS "sentAt"
    FROM tracked_emails
    WHERE id = ${id}
    LIMIT 1
  `;

  if (emailRows.length === 0) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }

  const openRows = await sql`
    SELECT
      id,
      email_id      AS "emailId",
      opened_at     AS "openedAt",
      ip,
      user_agent    AS "userAgent",
      country,
      is_proxy      AS "isProxy",
      proxy_reason  AS "proxyReason"
    FROM open_events
    WHERE email_id = ${id}
    ORDER BY opened_at DESC
  `;

  const serverUrl =
    process.env.SERVER_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const opens = openRows.map((r) => ({
    id:          r.id as number,
    emailId:     r.emailId as string,
    openedAt:    (r.openedAt as Date).toISOString(),
    ip:          r.ip as string | null,
    userAgent:   r.userAgent as string | null,
    country:     r.country as string | null,
    isProxy:     r.isProxy as boolean,
    proxyReason: r.proxyReason as string | null,
  })) as OpenEvent[];

  const humanOpens   = opens.filter((o) => !o.isProxy);
  const machineOpens = opens.filter((o) => o.isProxy);

  const email: TrackedEmailWithStats = {
    id:               emailRows[0].id as string,
    to:               emailRows[0].to as string,
    subject:          emailRows[0].subject as string,
    sentAt:           (emailRows[0].sentAt as Date).toISOString(),
    pixelUrl:         `${serverUrl}/api/pixel/${id}`,
    openCount:        humanOpens.length,
    machineOpenCount: machineOpens.length,
    lastOpenedAt:     humanOpens[0]?.openedAt ?? null,
    opens,
  };

  res.status(200).json(email);
}
