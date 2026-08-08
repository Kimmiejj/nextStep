# nextStep

TCAS Compass is a responsive, static student assessment website for mobile, iPad, and desktop.

## How it works

- `apps-script/Index.html` is the UI template.
- `apps-script/Code.gs` supplies bundled fallback data; the deployed site refreshes questions from the public `Questions` tab in Google Sheets when it opens.
- `scripts/build-static.mjs` creates `dist/index.html` with browser-side logic and `localStorage`.
- `.github/workflows/deploy-pages.yml` builds and deploys the static site to GitHub Pages.

The deployed site does not call Google Apps Script. It reads the public `Questions` tab directly for the latest question text, sections, helpers, and options. Student responses are saved locally in the visitor's browser and are not shared between devices.

The Google Sheet must allow `Anyone with the link` to view the `Questions` tab for live updates to load; otherwise the site uses the bundled fallback questions.

The teacher mode is available from the `โหมดคุณครู` button. In the static version, credentials are checked locally without storing a plaintext password in the repository. Submissions are saved in the same browser, where teachers can filter them, open a student detail, download a CSV, or print a student report. This local-only mode is for classroom use on one device; it is not a shared multi-device database.

## Local build

```bash
node scripts/build-static.mjs
```

The generated site is written to `dist/index.html`.
