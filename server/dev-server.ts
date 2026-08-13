/**
 * Local development server for the Email Tracker API.
 * Mirrors all Vercel API routes using Express so you can test
 * without deploying — just run: npm run dev
 */
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { getDb, ensureSchema } from './lib/db';
import { detectProxy } from './lib/proxy-detect';
import { v4 as uuidv4 } from 'uuid';
import type { TrackRequest, TrackResponse, TrackedEmailWithStats, OpenEvent } from './lib/types';

const app = express();
const PORT = process.env.PORT ?? 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json());

// CORS — allow Chrome extension requests
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  next();
});

app.options('*', (_req, res) => res.status(204).end());

// ── DB init ────────────────────────────────────────────────────
await ensureSchema();
console.log('✓ Database schema ready');

// ── POST /api/track ────────────────────────────────────────────
app.post('/api/track', async (req: Request, res: Response) => {
  const body = req.body as TrackRequest;
  const { to, subject } = body;

  if (!to || !subject) {
    res.status(400).json({ error: 'Missing required fields: to, subject' });
    return;
  }

  const sql = getDb();
  const id = body.id ?? uuidv4();
  const sentAt = body.sentAt ?? new Date().toISOString();
  const pixelUrl = `${SERVER_URL}/api/pixel/${id}`;

  await sql`
    INSERT INTO tracked_emails (id, "to", subject, sent_at)
    VALUES (${id}, ${to}, ${subject}, ${sentAt})
    ON CONFLICT (id) DO NOTHING
  `;

  const response: TrackResponse = { id, pixelUrl };
  res.status(200).json(response);
});

// ── GET /api/pixel/:id ─────────────────────────────────────────
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

app.get('/api/pixel/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? null;
  const userAgent = req.headers['user-agent'] ?? null;

  const { isProxy, reason } = detectProxy(userAgent, ip);

  // Log open asynchronously — don't block pixel response
  (async () => {
    try {
      const sql = getDb();
      const sessionStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Skip if same IP already opened this email within 5-minute session window.
      // Prevents Gmail reading pane + full-view re-render double-counting.
      const inserted = await sql`
        INSERT INTO open_events (email_id, ip, user_agent, is_proxy, proxy_reason)
        SELECT ${id}, ${ip}, ${userAgent}, ${isProxy}, ${reason}
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
        return;
      }

      console.log(
        `${isProxy ? '🤖 Machine' : '👤 Human'} open: ${id} — ${
          isProxy ? reason : (userAgent?.slice(0, 60) ?? 'unknown')
        }`,
      );
    } catch (err) {
      console.error('Failed to log open:', err);
    }
  })();

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', PIXEL.length);
  res.status(200).end(PIXEL);
});


// ── GET /api/events ────────────────────────────────────────────
app.get('/api/events', async (_req: Request, res: Response) => {
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

  const emails: TrackedEmailWithStats[] = rows.map((r) => ({
    id:               r.id as string,
    to:               r.to as string,
    subject:          r.subject as string,
    sentAt:           (r.sentAt as Date).toISOString(),
    pixelUrl:         `${SERVER_URL}/api/pixel/${r.id}`,
    openCount:        r.openCount as number,
    machineOpenCount: r.machineOpenCount as number,
    lastOpenedAt:     r.lastOpenedAt ? (r.lastOpenedAt as Date).toISOString() : null,
  }));

  res.status(200).json(emails);
});

// ── GET /api/events/:id ────────────────────────────────────────
app.get('/api/events/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
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

  const humanOpens = opens.filter((o) => !o.isProxy);

  const email: TrackedEmailWithStats = {
    id:               emailRows[0].id as string,
    to:               emailRows[0].to as string,
    subject:          emailRows[0].subject as string,
    sentAt:           (emailRows[0].sentAt as Date).toISOString(),
    pixelUrl:         `${SERVER_URL}/api/pixel/${id}`,
    openCount:        humanOpens.length,
    machineOpenCount: opens.length - humanOpens.length,
    lastOpenedAt:     humanOpens[0]?.openedAt ?? null,
    opens,
  };

  res.status(200).json(email);
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Email Tracker dev server running at ${SERVER_URL}`);
  console.log(`   POST ${SERVER_URL}/api/track`);
  console.log(`   GET  ${SERVER_URL}/api/pixel/:id`);
  console.log(`   GET  ${SERVER_URL}/api/events`);
  console.log(`   GET  ${SERVER_URL}/api/events/:id\n`);
});
