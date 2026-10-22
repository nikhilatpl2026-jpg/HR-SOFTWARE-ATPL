# ATPL HR ERP — Google Cloud Run deployment preparation

This branch prepares the existing Express backend to build on Cloud Run. **It is not a completed data-sync fix. Do not send production employee data to a new deployment until the safeguards below are implemented and tested.**

## Verified from this repository
- `package.json` starts the app using `node server.js`.
- `server.js` binds to `process.env.PORT` and `0.0.0.0`, which Cloud Run needs.
- The backend stores records and uploads under its local `data/` directory and has an optional GitHub write-back. **Cloud Run container files are ephemeral**: they are NOT a durable multi-device database, even with a single instance.
- Server code formerly embedded a GitHub credential fallback. This branch removes the hardcoded fallback. **Revoke/rotate that exposed credential immediately**, since changing source does not erase git history.

## Before turning on for real employees
1. Plan and verify a durable external data store (e.g. Firestore or PostgreSQL) and object storage (e.g. Cloud Storage) for uploads. Migrate existing local/GitHub data safely, including deletion state. Run backup + restore tests.
2. Replace local-file read/write and GitHub-as-storage logic with the durable backend; coordinate concurrent edits and enforce permanent deletes.
3. Require server-side authentication and authorization for **all employee-data APIs**. Existing permissive CORS is not authentication. Restrict origins and secure sessions; do not expose employee records via public unauthenticated endpoints.
4. Keep secrets out of source. Set runtime secrets through Google Secret Manager/Cloud Run configuration. Do not reuse the exposed GitHub token. Only configure `ATPL_GITHUB_TOKEN` if a carefully reviewed non-sensitive GitHub integration genuinely requires it.
5. Test with **non-sensitive sample data** first: add, edit, delete, Excel bulk import, browser A → browser B, phone → desktop, reload, container restart, and two simultaneous sessions.

## Cloud Run setup (after the preceding safeguards)
1. Open https://console.cloud.google.com/ and choose/create a project. Link a billing account, enable Cloud Run and Cloud Build APIs, and configure budget alerts.
2. Open Cloud Run > Services and choose the GitHub repository deployment/connect-repository flow (menu wording may vary). Authorize GitHub and select `nikhilatpl2026-jpg/HR-SOFTWARE-ATPL`.
3. Choose the branch, repository root, and **Dockerfile** build method (`Dockerfile`). Pick a service name like `atpl-erp-backend`, location `asia-south1` if available, and a request-based service. Set minimum instances to 0 for low idle cost; monitor cold starts and usage.
4. Keep service **private** until your API access controls and browser-authentication approach are deliberately configured. A GitHub Pages browser cannot just call a private IAM-protected Cloud Run service unauthenticated.
5. Configure runtime environment and secrets that the app requires. Redeploy and verify logs, health, and backend behavior with sample data before connecting the live ERP.
6. After backend authentication and persistence are verified, point frontend API base URLs to the resulting Cloud Run URL. Run two-device acceptance tests before production cutover.

## Cost and operations
Cloud Run has a request-based free tier in eligible regions, but Cloud Build, database, object storage, egress, logs and other services can be billable. A Google Cloud project/billing setup is still required; create billing budgets and alerts. A build succeeding **does not** imply that persistence or sync is fixed.

## Immediate production safety
This is a **draft-only preparatory change**. Do not merge/deploy directly into production just because the image builds. Resolve exposed credentials, per-user authorization, cross-device persistence and recoverability first.
