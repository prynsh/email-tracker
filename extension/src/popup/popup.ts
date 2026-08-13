/**
 * Gmail Email Tracker — Popup Script
 *
 * Reads data from chrome.storage.local (populated by the service worker)
 * and renders the dashboard. Also handles settings and manual refresh.
 */
export {}; // Treat as ES module

// ── Types ──────────────────────────────────────────────────────
interface TrackedEmail {
  id: string;
  to: string;
  subject: string;
  sentAt: string;
  pixelUrl: string;
  openCount?: number;
  machineOpenCount?: number;
  lastOpenedAt?: string | null;
}

interface OpenEvent {
  id: number;
  emailId: string;
  openedAt: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  isProxy: boolean;
  proxyReason: string | null;
}

interface StoredData {
  trackedEmails?: TrackedEmail[];
  openEvents?: TrackedEmail[]; // stats from server
  serverUrl?: string;
  lastPolledAt?: string;
}

// ── DOM refs ───────────────────────────────────────────────────
const emailList = document.getElementById('email-list')!;
const emptyState = document.getElementById('empty-state')!;
const loadingState = document.getElementById('loading-state')!;
const statTracked = document.getElementById('stat-tracked')!;
const statOpens = document.getElementById('stat-opens')!;
const statRate = document.getElementById('stat-rate')!;
const lastSyncedText = document.getElementById('last-synced-text')!;
const refreshBtn = document.getElementById('refresh-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsPanel = document.getElementById('settings-panel')!;
const serverUrlInput = document.getElementById('server-url-input') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings-btn')!;
const cancelSettingsBtn = document.getElementById('cancel-settings-btn')!;
const emailTemplate = document.getElementById('email-item-template') as HTMLTemplateElement;
const openEventTemplate = document.getElementById('open-event-template') as HTMLTemplateElement;

// ── Helpers ────────────────────────────────────────────────────
function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function parseDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown device';
}

function parseBrowser(ua: string | null): string {
  if (!ua) return '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome/.test(ua)) return 'Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Safari/.test(ua)) return 'Safari';
  return '';
}

// ── Render ─────────────────────────────────────────────────────
function renderStats(emails: TrackedEmail[], serverEmails: TrackedEmail[]): void {
  const tracked = emails.length;
  // Use server data for open counts if available, otherwise local
  const source = serverEmails.length > 0 ? serverEmails : emails;
  const totalOpens = source.reduce((s, e) => s + (e.openCount ?? 0), 0);
  const openedCount = source.filter((e) => (e.openCount ?? 0) > 0).length;
  const rate = tracked > 0 ? Math.round((openedCount / tracked) * 100) : 0;

  statTracked.textContent = String(tracked);
  statOpens.textContent = String(totalOpens);
  statRate.textContent = `${rate}%`;
}

function renderLastSynced(lastPolledAt: string | undefined): void {
  if (!lastPolledAt) {
    lastSyncedText.textContent = 'Not synced yet';
    return;
  }
  lastSyncedText.textContent = `Last synced ${timeAgo(lastPolledAt)}`;
}

async function fetchOpenDetails(
  emailId: string,
  serverUrl: string,
): Promise<OpenEvent[]> {
  try {
    const res = await fetch(`${serverUrl}/api/events/${emailId}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { opens?: OpenEvent[] };
    return data.opens ?? [];
  } catch {
    return [];
  }
}

function renderOpensList(
  container: HTMLElement,
  opens: OpenEvent[],
): void {
  container.innerHTML = '';

  if (opens.length === 0) {
    container.innerHTML = `<div class="opens-list-header">No open events</div>`;
    return;
  }

  const humanOpens   = opens.filter((o) => !o.isProxy);
  const machineOpens = opens.filter((o) =>  o.isProxy);

  const header = document.createElement('div');
  header.className = 'opens-list-header';
  header.textContent = [
    humanOpens.length   > 0 ? `${humanOpens.length} human open${humanOpens.length   !== 1 ? 's' : ''}` : '',
    machineOpens.length > 0 ? `${machineOpens.length} machine`                                           : '',
  ].filter(Boolean).join(' · ');
  container.appendChild(header);

  for (const open of opens) {
    const tmpl = openEventTemplate.content.cloneNode(true) as DocumentFragment;
    const el = tmpl.querySelector('.open-event') as HTMLElement;
    const timeEl = el.querySelector('.open-event-time') as HTMLElement;
    const metaEl = el.querySelector('.open-event-meta') as HTMLElement;

    if (open.isProxy) el.classList.add('open-event-machine');

    timeEl.textContent = formatTime(open.openedAt);

    const parts: string[] = [];
    if (open.isProxy) {
      parts.push(`🤖 Machine open`);
      if (open.proxyReason) parts.push(open.proxyReason.replace('IP:', '').replace('UA:', ''));
    } else {
      const device  = parseDevice(open.userAgent);
      const browser = parseBrowser(open.userAgent);
      if (browser) parts.push(`${browser} on ${device}`);
      else parts.push(device);
      if (open.country) parts.push(open.country);
      if (open.ip)      parts.push(open.ip);
    }

    metaEl.textContent = parts.join(' · ');
    container.appendChild(tmpl);
  }
}

function renderEmailItem(
  email: TrackedEmail,
  serverEmail: TrackedEmail | undefined,
  serverUrl: string,
): HTMLElement {
  const tmpl = emailTemplate.content.cloneNode(true) as DocumentFragment;
  const item = tmpl.querySelector('.email-item') as HTMLElement;
  const subjectEl = item.querySelector('.email-subject') as HTMLElement;
  const toEl = item.querySelector('.email-to') as HTMLElement;
  const timeEl = item.querySelector('.email-time') as HTMLElement;
  const badgeEl = item.querySelector('.email-open-badge') as HTMLElement;
  const expandBtn = item.querySelector('.email-expand-btn') as HTMLButtonElement;
  const opensList = item.querySelector('.email-opens-list') as HTMLElement;

  const openCount        = serverEmail?.openCount        ?? email.openCount        ?? 0;
  const machineOpenCount = serverEmail?.machineOpenCount ?? email.machineOpenCount ?? 0;

  subjectEl.textContent = email.subject;
  toEl.textContent      = email.to;
  timeEl.textContent    = timeAgo(email.sentAt);

  if (openCount === 0 && machineOpenCount === 0) {
    badgeEl.textContent = 'Not opened';
    item.classList.remove('opened', 'multi-opened');
  } else if (openCount === 0 && machineOpenCount > 0) {
    // Only machine opens — don't count as "opened" by a human
    badgeEl.innerHTML = `<span class="badge-machine">${machineOpenCount} machine</span>`;
    item.classList.remove('opened', 'multi-opened');
  } else if (openCount === 1) {
    badgeEl.innerHTML = `1 open${machineOpenCount > 0 ? ` <span class="badge-machine">${machineOpenCount}🤖</span>` : ''}`;
    item.classList.add('opened');
  } else {
    badgeEl.innerHTML = `${openCount} opens${machineOpenCount > 0 ? ` <span class="badge-machine">${machineOpenCount}🤖</span>` : ''}`;
    item.classList.add('opened', 'multi-opened');
  }

  // Expand/collapse on click
  let loaded = false;

  expandBtn.addEventListener('click', async () => {
    const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';

    if (isExpanded) {
      expandBtn.setAttribute('aria-expanded', 'false');
      opensList.hidden = true;
    } else {
      expandBtn.setAttribute('aria-expanded', 'true');
      opensList.hidden = false;

      if (!loaded) {
        loaded = true;
        opensList.innerHTML = `<div class="opens-list-header"><span class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:middle;"></span>Loading…</div>`;
        const opens = await fetchOpenDetails(email.id, serverUrl);
        renderOpensList(opensList, opens);
      }
    }
  });

  return item;
}

function setLoading(show: boolean): void {
  loadingState.style.display = show ? 'flex' : 'none';
}

async function render(): Promise<void> {
  setLoading(true);
  emailList.innerHTML = '';
  emptyState.hidden = true;

  const stored = (await chrome.storage.local.get([
    'trackedEmails',
    'openEvents',
    'serverUrl',
    'lastPolledAt',
  ])) as StoredData;

  const serverUrl = stored.serverUrl ?? 'https://email-tracker-liard.vercel.app';
  const localEmails: TrackedEmail[] = stored.trackedEmails ?? [];
  const serverEmails: TrackedEmail[] = stored.openEvents ?? [];

  renderStats(localEmails, serverEmails);
  renderLastSynced(stored.lastPolledAt);

  setLoading(false);

  if (localEmails.length === 0) {
    emptyState.hidden = false;
    return;
  }

  // Build a lookup of server data by ID
  const serverById = new Map(serverEmails.map((e) => [e.id, e]));

  for (const email of localEmails) {
    const serverEmail = serverById.get(email.id);
    const item = renderEmailItem(email, serverEmail, serverUrl);
    emailList.appendChild(item);
  }

  // Clear badge when popup opens
  await chrome.action.setBadgeText({ text: '' });
}

// ── Refresh ────────────────────────────────────────────────────
async function refresh(): Promise<void> {
  refreshBtn.classList.add('spinning');
  refreshBtn.setAttribute('disabled', 'true');

  try {
    await chrome.runtime.sendMessage({ type: 'POLL_NOW' });
    await render();
  } catch (err) {
    console.warn('Refresh failed:', err);
  } finally {
    refreshBtn.classList.remove('spinning');
    refreshBtn.removeAttribute('disabled');
  }
}

// ── Settings ───────────────────────────────────────────────────
function openSettings(): void {
  chrome.storage.local.get('serverUrl', (result) => {
    serverUrlInput.value = (result.serverUrl as string) ?? '';
  });
  settingsPanel.hidden = false;
}

function closeSettings(): void {
  settingsPanel.hidden = true;
}

async function saveSettings(): Promise<void> {
  const url = serverUrlInput.value.trim().replace(/\/$/, '');
  await chrome.storage.local.set({ serverUrl: url || 'https://email-tracker-liard.vercel.app' });

  // Close the panel first so the main view is visible
  closeSettings();
  await render();

  // Then show the toast on the main view (needs two rAF frames to reliably trigger the CSS transition)
  const toast = document.createElement('div');
  toast.className = 'save-toast';
  toast.textContent = '✓ Settings saved';
  document.getElementById('app')!.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}


// ── Event listeners ────────────────────────────────────────────
refreshBtn.addEventListener('click', refresh);
settingsBtn.addEventListener('click', openSettings);
saveSettingsBtn.addEventListener('click', saveSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);

serverUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveSettings();
  if (e.key === 'Escape') closeSettings();
});

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', render);
