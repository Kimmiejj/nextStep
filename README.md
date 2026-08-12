# nextStep

TCAS Compass is a responsive, static student assessment website for mobile, iPad, and desktop.

## How it works

- `apps-script/Index.html` is the UI template.
- `apps-script/Code.gs` supplies bundled fallback data and saves submitted responses to the `Responses` sheet.
- `scripts/build-static.mjs` creates `dist/index.html` with browser-side logic and a live Apps Script response backend.
- `.github/workflows/deploy-pages.yml` builds and deploys the static site to GitHub Pages.
- The visible build version is generated from Git history as `v1.0.<commit-count>-<short-sha>`, so every pushed commit gets a distinct version in both student and teacher modes and in generated PDF reports.

The deployed site is served from GitHub Pages. It reads the public `Questions` tab directly for live question updates and sends submitted answers to the `Responses` sheet. PDF reports are generated on demand in the browser as an in-memory blob; no PDF is uploaded to Apps Script, Google Drive, or any other server.

The Google Sheet must allow `Anyone with the link` to view the `Questions` tab for live updates to load; otherwise the site uses the bundled fallback questions.

Student startup does not wait for Apps Script: it reads the public `Questions` CSV with an 8-second fallback deadline. Teacher API reads retry transient Apps Script failures up to three times per cycle; if a dashboard cycle still fails, the UI starts another cycle automatically after five seconds while the teacher session remains active. Student submissions use a longer non-retrying write timeout to avoid duplicate writes.

The teacher mode is available from the `โหมดคุณครู` button. Teachers can filter shared `Responses` data, open a student detail, and download a CSV. The PDF download is intentionally ephemeral: the browser creates it live and revokes the temporary object URL after starting the download.

## Local build

```bash
node scripts/build-static.mjs
```

The generated site is written to `dist/index.html`.

## Tests

```bash
node --test tests/*.test.mjs
```

The tests cover backend caching, direct student question loading, teacher retries, non-retryable API errors, late JSONP callbacks, and concurrent teacher requests.

## Apps Script deployment

GitHub Pages deploys only the generated static site. Changes in `apps-script/Code.gs` must also be pushed to the Apps Script project and published as a new version of the existing Web app deployment before the backend cache and Spreadsheet connection fixes are live.
