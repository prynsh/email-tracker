import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuidv4 } from 'uuid';
import { getDb, ensureSchema } from '../lib/db';
import { setCorsHeaders, handlePreflight } from '../lib/cors';
import type { TrackRequest, TrackResponse } from '../lib/types';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCorsHeaders(res);
  if (handlePreflight(req.method, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body as TrackRequest;
  const { to, subject } = body;

  if (!to || !subject) {
    res.status(400).json({ error: 'Missing required fields: to, subject' });
    return;
  }

  await ensureSchema();
  const sql = getDb();

  // Allow client-side UUID for zero-latency pixel injection,
  // but generate one server-side if not provided.
  const id = body.id ?? uuidv4();
  const sentAt = body.sentAt ?? new Date().toISOString();

  const serverUrl =
    process.env.SERVER_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000');

  const pixelUrl = `${serverUrl}/api/pixel/${id}`;

  await sql`
    INSERT INTO tracked_emails (id, "to", subject, sent_at)
    VALUES (${id}, ${to}, ${subject}, ${sentAt})
    ON CONFLICT (id) DO NOTHING
  `;

  const response: TrackResponse = { id, pixelUrl };
  res.status(200).json(response);
}
