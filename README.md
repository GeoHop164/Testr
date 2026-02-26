# QA Swipe Console (`testr.noetic.studio`)

A retro-styled, Tinder-swipe QA runner built with Next.js.

Users import a JSON test plan (paste or file upload), then execute each test by swiping **Pass/Fail** with optional comments. The app generates a report, supports printing/export, and keeps report history in local storage.

## Features

- Start -> Input -> Swipe -> Report flow
- JSON import via file (`.json`) or copy/paste
- Per-test optional comment before verdict
- Swipe gestures:
  - Swipe right = Pass
  - Swipe left = Fail
- Keyboard controls:
  - `P` or `Right Arrow` = Pass
  - `F` or `Left Arrow` = Fail
  - `U` or `Cmd/Ctrl + Z` = Undo
- Undo support during test execution
- Report page with:
  - totals (pass/fail/total)
  - category summary
  - detailed per-test results + comments
- Print report
- Export report as JSON
- Local report history in `localStorage` (re-open/download/delete)
- PWA install prompt with `Don't Show Again` preference saved in `localStorage`

## JSON Input Format

```json
{
  "Category 1": [
    {
      "action": "click the log in button",
      "result": "user is logged in"
    },
    {
      "action": "click the log out button",
      "result": "user is logged out"
    }
  ],
  "Category 2": [
    {
      "action": "click the log in button",
      "result": "user is logged in"
    }
  ]
}
```

Validation rules:
- Root must be an object
- Keys are category names
- Category values must be arrays
- Each test item must include non-empty `action` and `result` strings

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Production checks:

```bash
npm run lint
npm run build
npm run start
```

## PWA Setup (Implemented)

This app is configured as an installable PWA for `https://testr.noetic.studio`.

Implemented assets/config:
- Web manifest route: `app/manifest.ts` -> `/manifest.webmanifest`
- Service worker: `public/sw.js`
- Service worker registration: `app/pwa-register.tsx`
- Offline fallback page: `app/offline/page.tsx`
- PWA metadata/icons: `app/layout.tsx`
- Icons:
  - `public/icons/icon-192.png`
  - `public/icons/icon-512.png`
  - `public/icons/icon-maskable-512.png`
  - `public/icons/apple-touch-icon.png`
  - `public/icons/icon.svg`
- Response headers for SW/manifest: `next.config.ts`

## Deploy Requirements for Valid PWA

To keep installability valid in production:
- Serve over HTTPS (required)
- Deploy on `https://testr.noetic.studio`
- Ensure `/sw.js` is served from the app origin root
- Do not block `manifest.webmanifest` or icon files
- Keep service worker scope at `/`

Recommended post-deploy checks:
- Chrome DevTools -> Application -> Manifest (all icons recognized)
- Chrome DevTools -> Application -> Service Workers (active + controlling page)
- Lighthouse PWA audit (installable + offline support)

## Cloudflare Pages (No Workers)

Yes, this app can be deployed to Cloudflare Pages without Workers by using static export mode.

Build command:

```bash
npm run build:pages
```

Output directory:

```text
out
```

Cloudflare Pages settings:
- Framework preset: `None` (or Next.js with custom static settings)
- Build command: `npm run build:pages`
- Build output directory: `out`
- Node.js: 18+ recommended

Notes:
- In `build:pages`, Next runs with `STATIC_EXPORT=true`, which enables `output: "export"` in `next.config.ts`.
- `public/_headers` is included for static hosting cache/content-type rules for `sw.js` and `manifest.webmanifest`.

## Data Storage

- Report history key: `qa-swipe-report-history-v1`
- Storage location: browser `localStorage`
- Data includes suite metadata, summary, detailed results, and source JSON

## Tech

- Next.js (App Router)
- React
- TypeScript
- Tailwind available (global CSS uses custom style system)
