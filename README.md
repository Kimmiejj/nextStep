# nextStep

TCAS Compass is a responsive, static student assessment website for mobile, iPad, and desktop.

## How it works

- `apps-script/Index.html` is the UI template.
- `apps-script/Code.gs` supplies bundled fallback data and saves submitted responses to the `Responses` sheet.
- `scripts/build-static.mjs` creates `dist/index.html` with browser-side logic and a live Apps Script response backend.
- `.github/workflows/deploy-pages.yml` builds and deploys the static site to GitHub Pages.

The deployed site is served from GitHub Pages. It reads the public `Questions` tab directly for live question updates and sends submitted answers to the `Responses` sheet. PDF reports are generated on demand in the browser as an in-memory blob; no PDF is uploaded to Apps Script, Google Drive, or any other server.

The Google Sheet must allow `Anyone with the link` to view the `Questions` tab for live updates to load; otherwise the site uses the bundled fallback questions.

The teacher mode is available from the `โหมดคุณครู` button. Teachers can filter shared `Responses` data, open a student detail, and download a CSV. The PDF download is intentionally ephemeral: the browser creates it live and revokes the temporary object URL after starting the download.

## Local build

```bash
node scripts/build-static.mjs
```

The generated site is written to `dist/index.html`.
