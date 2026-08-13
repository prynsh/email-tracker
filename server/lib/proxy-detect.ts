/**
 * Detects whether a pixel request came from a known email proxy/bot
 * rather than a real human opening the email.
 *
 * Covers:
 * - Gmail (GoogleImageProxy) — pre-fetches all images
 * - Apple Mail Privacy Protection (iOS 15+) — pre-fetches via Apple IPs (17.x.x.x)
 * - Outlook / Microsoft — proxies images via Microsoft servers
 * - Common crawlers and link-preview bots
 */

interface ProxyResult {
  isProxy: boolean;
  reason: string | null;
}

// ── User-Agent patterns ────────────────────────────────────────
// These substrings in the UA reliably indicate a proxy or bot request.
const PROXY_UA_PATTERNS: string[] = [
  'googleimageproxy',
  'googlebot',
  'apis-google',
  'adsbot-google',
  'google-read-aloud',
  'yahoo! slurp',
  'bingbot',
  'msnbot',
  'microsoft office',    // Outlook desktop link-preview
  'ms-office',
  'outlook',
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'whatsapp',
  'preview',
  'spider',
  'crawler',
  'bot/',
  '/bot',
];

// ── IP prefixes for known proxy infrastructure ─────────────────
// Keep this list tight — better to miss a machine open than
// misclassify a human open.

/** Google datacenter ranges (serves Gmail image proxy) */
const GOOGLE_IP_PREFIXES: string[] = [
  '66.249.',
  '74.125.',
  '209.85.',
  '216.239.',
  '64.233.',
  '216.58.',
  '172.217.',
  '142.250.',
];

/** Apple's entire IP space starts with 17. (Mail Privacy Protection) */
const APPLE_IP_PREFIXES: string[] = ['17.'];

/** Microsoft / Outlook safe-link proxy */
const MICROSOFT_IP_PREFIXES: string[] = [
  '40.94.',
  '40.107.',
  '52.100.',
  '52.101.',
  '104.47.',
];

export function detectProxy(
  userAgent: string | null,
  ip: string | null,
): ProxyResult {
  // ── User-Agent check ─────────────────────────────────────────
  if (userAgent) {
    const ua = userAgent.toLowerCase();
    for (const pattern of PROXY_UA_PATTERNS) {
      if (ua.includes(pattern)) {
        return { isProxy: true, reason: `UA:${pattern}` };
      }
    }
  }

  // ── IP range check ───────────────────────────────────────────
  if (ip) {
    for (const prefix of GOOGLE_IP_PREFIXES) {
      if (ip.startsWith(prefix)) {
        return { isProxy: true, reason: 'IP:Google' };
      }
    }
    for (const prefix of APPLE_IP_PREFIXES) {
      if (ip.startsWith(prefix)) {
        return { isProxy: true, reason: 'IP:Apple-MPP' };
      }
    }
    for (const prefix of MICROSOFT_IP_PREFIXES) {
      if (ip.startsWith(prefix)) {
        return { isProxy: true, reason: 'IP:Microsoft' };
      }
    }
  }

  return { isProxy: false, reason: null };
}
