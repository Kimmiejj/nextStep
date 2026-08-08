# Static app source

This folder is kept as the source template for the static build.

- `Index.html` contains the responsive UI.
- `Code.gs` contains the default question/config data read by `scripts/build-static.mjs`.
- The `Questions` sheet uses only `id`, `round`, `section`, `type`, `prompt`, `helper`, `options_json`, `required`, and `active`. Options contain labels only; scoring fields are not used.
- For an existing Google Sheet, run `migrateQuestionsSheet()` once to remove the old columns while preserving the current questions.
- Student university and faculty fields are searchable pickers. Universities load from the Hipo worldwide university list with a local fallback; both pickers include an `Other` option for custom names.
- Thai universities in the picker show their Thai name together with the English catalog name, while remaining searchable by either name.
- For a `radio` question that needs a text response, put a placeholder inside an option label such as `อื่น ๆ <โปรดระบุรายละเอียด>`; the app renders a textarea when that option is selected and stores `{ choice, text }` in `answers_json`.
- The `Responses` sheet uses only the 11 active response fields: student profile fields plus `answers_json`; legacy score columns are not used.
- A `university_targets` question renders three ranked target rows, each with university, faculty, and major fields, and stores the completed rows as an array in `answers_json`.
- Nothing in this folder is deployed to or executed by Google Apps Script.
