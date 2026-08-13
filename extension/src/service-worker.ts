/**
 * Gmail Email Tracker — Service Worker
 *
 * Responsibilities:
 * - Stores emails sent by the content script into chrome.storage.local
 * - Polls the server every 60 seconds (via chrome.alarms) for open events
 * - Shows a Chrome notification when a new open is detected
 * - Updates the extension badge with unseen open count
 */
export {}; // Treat as ES module

const ALARM_NAME = 'poll-opens';
const POLL_INTERVAL_MINUTES = 1;
const DEFAULT_SERVER = 'https://email-tracker-liard.vercel.app';

// ── Icon helper (OffscreenCanvas — no file dependency) ─────────
async function getIconDataUrl(): Promise<string> {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  // Background circle
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Envelope body
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const mx = 22, my = 38, mw = size - 44, mh = size - 60;
  ctx.beginPath();
  ctx.roundRect(mx, my, mw, mh, 6);
  ctx.fill();

  // Envelope flap
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(size / 2, my + mh * 0.5);
  ctx.lineTo(mx + mw, my);
  ctx.closePath();
  ctx.fill();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// ── Setup alarm on install / startup ──────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: POLL_INTERVAL_MINUTES,
    });
  }
});

// ── Polling logic ──────────────────────────────────────────────
async function pollForOpens(): Promise<void> {
  const stored = await chrome.storage.local.get([
    'serverUrl',
    'seenOpenIds',
    'lastPolledAt',
  ]);

  const serverUrl: string = (stored.serverUrl as string) ?? DEFAULT_SERVER;
  const seenOpenIds: string[] = (stored.seenOpenIds as string[]) ?? [];

  try {
    const res = await fetch(`${serverUrl}/api/events`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Server responded ${res.status}`);

    const emails = (await res.json()) as Array<{
      id: string;
      subject: string;
      to: string;
      openCount: number;
      lastOpenedAt: string | null;
    }>;

    // Fetch full open details for emails that have new opens
    let newOpenCount = 0;
    const iconUrl = await getIconDataUrl();

    for (const email of emails) {
      if (!email.openCount || !email.lastOpenedAt) continue;

      const detailRes = await fetch(`${serverUrl}/api/events/${email.id}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!detailRes.ok) continue;

      const detail = (await detailRes.json()) as {
        opens: Array<{ id: number; openedAt: string; userAgent: string | null; isProxy: boolean }>;
      };

      for (const open of detail.opens ?? []) {
        const openKey = `${email.id}-${open.id}`;
        if (seenOpenIds.includes(openKey)) continue;

        seenOpenIds.push(openKey);

        // Skip machine/proxy opens — don't notify or count toward badge
        if (open.isProxy) continue;

        newOpenCount++;
        const device = parseDevice(open.userAgent);
        await chrome.notifications.create(`open-${openKey}`, {
          type: 'basic',
          iconUrl,
          title: '✉️ Email Opened',
          message: `"${email.subject}" was read${device ? ` on ${device}` : ''}`,
          priority: 1,
        });
      }
    }

    // Persist updated state
    await chrome.storage.local.set({
      openEvents: emails,
      seenOpenIds: seenOpenIds.slice(-500), // keep last 500 to avoid bloat
      lastPolledAt: new Date().toISOString(),
    });

    // Badge: total opens across all emails
    const totalOpens = emails.reduce((s, e) => s + (e.openCount ?? 0), 0);
    await chrome.action.setBadgeText({
      text: totalOpens > 0 ? String(totalOpens) : '',
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  } catch (err) {
    console.warn('[EmailTracker] Poll failed:', err);
  }
}

function parseDevice(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return null;
}

// ── Alarm listener ─────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await pollForOpens();
});

// ── Message listener (from content script) ────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EMAIL_SENT') {
    (async () => {
      const stored = await chrome.storage.local.get('trackedEmails');
      const trackedEmails = (stored.trackedEmails as unknown[]) ?? [];
      trackedEmails.unshift(message.payload);

      await chrome.storage.local.set({
        trackedEmails: trackedEmails.slice(0, 500), // keep last 500
      });

      sendResponse({ success: true });
    })();
    return true; // keep message channel open for async sendResponse
  }

  // Manual refresh triggered from popup
  if (message.type === 'POLL_NOW') {
    pollForOpens().then(() => sendResponse({ success: true }));
    return true;
  }
});
