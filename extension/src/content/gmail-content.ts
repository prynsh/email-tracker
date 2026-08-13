/**
 * Gmail Email Tracker — Content Script
 *
 * Runs on mail.google.com. Uses a MutationObserver to detect Gmail compose
 * windows, intercepts the Send button click, generates a tracking ID,
 * injects a 1×1 pixel into the email body, and notifies the service worker.
 */
export {}; // Ensure this file is treated as an ES module

const DEFAULT_SERVER = 'http://localhost:3000';

// ── Cached server URL ──────────────────────────────────────────
let serverUrl = DEFAULT_SERVER;

chrome.storage.local.get('serverUrl', (result) => {
  if (result.serverUrl) serverUrl = result.serverUrl as string;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl?.newValue) {
    serverUrl = changes.serverUrl.newValue as string;
  }
});

// ── Helpers ────────────────────────────────────────────────────
function generateUUID(): string {
  return crypto.randomUUID();
}

// ── Gmail DOM helpers ──────────────────────────────────────────

/**
 * Walk up from an element to find the enclosing compose window.
 * Gmail renders compose in [role="dialog"] or in .nH containers.
 */
function getComposeWindow(el: Element): Element | null {
  let current: Element | null = el;
  while (current && current !== document.body) {
    if (
      current.getAttribute('role') === 'dialog' ||
      current.classList.contains('nH') ||
      current.classList.contains('AD')
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Extract recipient addresses from the compose window.
 * Gmail renders confirmed recipients as chips with an [email] attribute.
 */
function getRecipients(compose: Element): string {
  const chips = Array.from(compose.querySelectorAll<HTMLElement>('[email]'));
  if (chips.length > 0) {
    return chips
      .map((chip) => chip.getAttribute('email') ?? '')
      .filter(Boolean)
      .join(', ');
  }

  // Fallback: raw input value
  const input = compose.querySelector<HTMLInputElement>('input[name="to"]');
  return input?.value ?? 'Unknown';
}

/**
 * Extract the email subject from the compose window.
 */
function getSubject(compose: Element): string {
  const subjectInput = compose.querySelector<HTMLInputElement>(
    'input[name="subjectbox"]',
  );
  return subjectInput?.value?.trim() || '(No Subject)';
}

/**
 * Find the contenteditable email body within the compose window.
 */
function getComposeBody(compose: Element): HTMLElement | null {
  return (
    (compose.querySelector<HTMLElement>(
      '[aria-label="Message Body"]',
    ) ??
      compose.querySelector<HTMLElement>(
        'div[role="textbox"][contenteditable="true"]',
      ) ??
      compose.querySelector<HTMLElement>('.Am.Al.editable'))
  );
}

// ── Send interception ──────────────────────────────────────────

const attachedButtons = new WeakSet<Element>();

function handleSendClick(event: Event): void {
  const button = event.currentTarget as HTMLElement;
  const compose = getComposeWindow(button);
  if (!compose) return;

  const body = getComposeBody(compose);
  if (!body) return;

  const to = getRecipients(compose);
  const subject = getSubject(compose);
  const sentAt = new Date().toISOString();
  const trackingId = generateUUID();
  const pixelUrl = `${serverUrl}/api/pixel/${trackingId}`;

  // 1. Inject the tracking pixel synchronously (before Gmail reads the body)
  const pixel = document.createElement('img');
  pixel.src = pixelUrl;
  pixel.width = 1;
  pixel.height = 1;
  pixel.style.cssText =
    'display:block;width:1px;height:1px;opacity:0;border:none;padding:0;margin:0;';
  pixel.setAttribute('alt', '');
  pixel.setAttribute('aria-hidden', 'true');
  body.appendChild(pixel);

  // 2. Register with the server (fire-and-forget)
  fetch(`${serverUrl}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: trackingId, to, subject, sentAt }),
  }).catch((err) =>
    console.warn('[EmailTracker] Failed to register email:', err),
  );

  // 3. Notify the service worker to persist locally
  chrome.runtime.sendMessage({
    type: 'EMAIL_SENT',
    payload: { id: trackingId, to, subject, sentAt, pixelUrl },
  });

  console.info(
    `[EmailTracker] Tracking pixel injected for "${subject}" → ${to}`,
  );
}

function attachSendHandler(button: Element): void {
  if (attachedButtons.has(button)) return;
  attachedButtons.add(button);
  // Capture phase — fires before Gmail's own click listeners
  button.addEventListener('click', handleSendClick, { capture: true });
}

// ── MutationObserver: watch for compose windows ────────────────
function findAndAttachSendButtons(root: Element | Document = document): void {
  // Gmail's send button is typically: [data-tooltip*="Send"] or [aria-label*="Send"]
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('[data-tooltip*="Send"], [aria-label*="Send \u2318"]'),
  );
  candidates.forEach(attachSendHandler);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      if (!(node instanceof HTMLElement)) continue;
      findAndAttachSendButtons(node);

      // Check the node itself
      if (
        node.matches?.('[data-tooltip*="Send"], [aria-label*="Send \u2318"]')
      ) {
        attachSendHandler(node);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan for any existing compose windows
findAndAttachSendButtons();

console.info('[EmailTracker] Content script loaded on Gmail.');
