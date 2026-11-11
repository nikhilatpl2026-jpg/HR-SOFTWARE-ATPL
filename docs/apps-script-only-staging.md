# ATPL ERP — Apps Script-only (no Cloud Run, no PostgreSQL)

**User choice:** Keep existing GitHub Pages frontend but use ONLY **Google Drive + Google Sheets + Apps Script** as the backend. The previous Cloud Run and PostgreSQL experimental PRs were closed, unmerged. Production `main` and the live ERP are untouched.

**Important:** A GitHub Pages site is static; a Google Apps Script `/dev` deployment is editor-only, and direct cross-origin `fetch` POST does not reliably return an accessible JSON response. The browser must have a tested alternative transport.

## Safe prototype in this branch

- `appscript/ATPL_AppsScript_Only_Health.gs`: **health only**, returns an Apps Script `HtmlOutput` to an HTML-form POST inside a sandboxed hidden iframe, relaying a *non-sensitive* result via `postMessage`. This works without a Cloud Run proxy **if the browser permits Apps Script's iframe response**.
- `tools/atpl-apps-script-only-health-test.html`: local browser test page; submits only `action=health`. It never sends employee records, passwords, hashes or files.
- `tests/apps-script-only-health.test.js`: offline fail-closed tests.
- We have deliberately not implemented **data actions** via this transport yet. Authentication, real browser-origin control, reconciliation, quotas, file chunking, and security testing must come before writes.

## Owner test (safe)

1. Open the existing restricted `ATPL ERP Cloud Backend` Apps Script project; **do not replace** its current files.
2. Create a new Script named `ATPL_AppsScript_Only_Health` and paste `appscript/ATPL_AppsScript_Only_Health.gs`.
3. In your existing `ATPL_API_Bridge.gs`, find `function doPost(e) {`. Make **only this change**, at the beginning of that function:

   ```js
   if (e && e.parameter && e.parameter.atpl_form_probe === '1')
     return atplFormHealthResponse_(e);
   ```

4. Keep Script Property `ATPL_STAGE_POST_ENABLED` unset or `false`. Do not change the deployment's **Who has access: Only myself**.
5. Save, select `atplFormHealthSelfTest`, Run. Expect `SUCCESS - ALL DATA ACTIONS BLOCKED`.
6. Test deployments -> copy fresh `/dev` URL. Open `tools/atpl-apps-script-only-health-test.html` locally in Chrome, enter the full `/dev` URL and click Test.
7. If it returns success, we can build and test authenticated data actions. If it times out or says the iframe was blocked, **stop**. Google's login/iframe/CSP restrictions require another architecture; do not bypass by publishing data APIs.

## Security / future development

- This specific health-only response targets `'*'` in postMessage because it contains **no sensitive data**. Future authenticated results MUST target the exact intended origin and be correlated by a securely random per-request ID.
- Never put password hashes/session tokens in GET requests or query strings. For a future form POST, keep them only inside the POST body and never log or echo them.
- Apps Script `Execute as me` runs with the owner's full Drive/Sheets access; its data-changing endpoints must enforce *server-side* legacy login checks, role restrictions, request size limits, CSRF and rate limiting.
- A weak/default admin login in legacy code and a historically hardcoded GitHub token have been found. The owner should rotate those credentials and remove public employee files before broadening access.
- Apps Script has daily execution/concurrency/Drive quotas; no "always instant" realtime guarantee. Use version polling, Locks and tombstone protection. No parallel Firebase/GitHub/Cloud Run writebacks or stale-device re-uploads.
- Employee Master currently serializes a limited set of columns and could lose fields. Preserve complete employee records (e.g., versioned JSON records) before migrating actual employee data.
- Existing old data migration has **not** happened. There is **no live synchronization yet**.

## Alternatives if Google frame postMessage is blocked

1. Host the existing ERP UI from an Apps Script HTML Service web app, using `google.script.run` for backend; the public access URL would change from GitHub Pages unless a redirect is added.
2. Require a trusted backend/proxy, which the user **does not want**, so do not silently reintroduce Cloud Run.

Neither workaround is silently enabled.
