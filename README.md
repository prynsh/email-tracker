# Gmail Email Tracker

A Chrome Extension + Vercel backend that injects tracking pixels into your outgoing Gmail emails and notifies you the moment they're opened.

## How It Works

1. **Send** an email from Gmail → the extension silently injects a 1×1 pixel
2. **Recipient opens** the email → their client fetches the pixel from your Vercel server
3. **You're notified** via a Chrome notification within 60 seconds
4. **Dashboard** in the popup shows open counts, timestamps, device, and location

---

## Stack

| Layer | Tech |
|---|---|
| Extension | Chrome MV3, TypeScript, esbuild |
| Backend | Vercel Serverless Functions (TypeScript) |
| Database | Neon serverless Postgres |

---

## Setup

### 1. Server (Vercel + Neon)

```bash
cd server
npm install

# Create a free Postgres DB at https://neon.tech
# Then add the connection string to Vercel env vars:
# DATABASE_URL = postgresql://...
# SERVER_URL   = https://your-app.vercel.app

npm run deploy
```

> **Tip:** Use the Vercel ↔ Neon integration in your Vercel dashboard for one-click `DATABASE_URL` setup.

### 2. Extension

```bash
cd extension
npm install
npm run build      # compiles TypeScript → dist/
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/dist/` folder
4. Click the extension icon → **Settings** → paste your Vercel URL → **Save**

---

## Development

```bash
# Extension (watch mode — reloads on save)
cd extension && npm run watch

# Server (local Vercel dev server)
cd server && npm run dev
```

For local testing, set the extension's Server URL to `http://localhost:3000`.

---

## Project Structure

```
email-tracker/
├── extension/
│   ├── src/
│   │   ├── service-worker.ts      # Polling + notifications
│   │   ├── content/
│   │   │   └── gmail-content.ts   # Intercepts Gmail send
│   │   └── popup/
│   │       └── popup.ts           # Dashboard UI
│   ├── public/
│   │   ├── manifest.json
│   │   └── popup/
│   │       ├── popup.html
│   │       └── popup.css
│   └── dist/                      # Chrome loads this folder
│
└── server/
    ├── api/
    │   ├── track.ts               # POST /api/track
    │   ├── pixel/[id].ts          # GET  /api/pixel/:id
    │   └── events/
    │       ├── index.ts           # GET  /api/events
    │       └── [id].ts            # GET  /api/events/:id
    └── lib/
        ├── db.ts                  # Neon client + schema
        ├── cors.ts                # CORS helpers
        └── types.ts               # Shared types
```

---

## Privacy Notes

- Only **your own outgoing emails** are tracked (the extension only runs on mail.google.com)
- Open events store: timestamp, IP address, user agent, and country (from Vercel geo headers)
- All data lives in **your own** Neon Postgres database — nothing is shared with third parties
