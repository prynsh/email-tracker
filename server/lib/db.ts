import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export function getDb(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(process.env.DATABASE_URL);
}

/**
 * Creates / migrates tables on every cold start.
 * Uses IF NOT EXISTS and ADD COLUMN IF NOT EXISTS so it is safe to call repeatedly.
 */
export async function ensureSchema(): Promise<void> {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS tracked_emails (
      id       TEXT PRIMARY KEY,
      "to"     TEXT        NOT NULL,
      subject  TEXT        NOT NULL,
      sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS open_events (
      id            SERIAL      PRIMARY KEY,
      email_id      TEXT        NOT NULL,
      opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip            TEXT,
      user_agent    TEXT,
      country       TEXT,
      is_proxy      BOOLEAN     NOT NULL DEFAULT false,
      proxy_reason  TEXT
    )
  `;

  // Non-destructive migration: add columns if an older schema exists
  await sql`
    ALTER TABLE open_events
      ADD COLUMN IF NOT EXISTS is_proxy     BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS proxy_reason TEXT
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_open_events_email_id
    ON open_events (email_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_open_events_is_proxy
    ON open_events (email_id, is_proxy)
  `;
}
