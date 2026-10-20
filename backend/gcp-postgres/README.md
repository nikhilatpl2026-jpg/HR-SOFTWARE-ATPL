# ATPL Cloud SQL / PostgreSQL sync foundation (NOT LIVE)

This branch prepares a PostgreSQL-backed replacement for the old in-memory/JSON-file central sync routes.
It is **disabled by default**. Production traffic still uses the existing backend until a separately approved cutover.

## Audit findings

- The current server uses process-local variables and data/*.json files for its authoritative state. Cloud Run instances do not share writable local disks and local filesystem changes are not durable.
- The frontend writes to Cloud Run, Firebase, Apps Script and local IndexedDB. These conflicting authorities can cause deleted entries to reappear.
- The existing SSE broadcaster uses a process-local Set. It does not broadcast across independent Cloud Run instances.
- A GitHub token has been hard-coded in public server source. **Revoke/rotate the compromised token immediately**. Deleting it from the current code does not erase repository history.
- Public repository data/ includes documents and exports. Move sensitive assets to private storage and review public history/access.

## What is implemented in this foundation

- schema.sql: PostgreSQL file records, SHA-256 unique identity, binary file payloads, irreversible delete tombstones, employees and employee deletion markers, durable event journal.
- postgres-sync-router.js: database-backed file list/upload/download/delete, employee list/upsert/delete, basic legacy list surfaces, health check, and cross-instance SSE event polling.
- server.js mounts this router *only* if ATPL_PG_MODE=1; otherwise existing behavior is unchanged.
- Authentication for the preview is a long, server-side bearer token; every data endpoint requires it. It is **not safe to put this token in GitHub Pages source, URLs, or browser JavaScript**. A user-specific login-to-backend auth exchange is required before enabling the browser UI.
- Unknown sync routes in PG mode fail closed (501) instead of writing legacy local data.

## NOT YET COMPLETE / DO NOT SWITCH PROD

1. Create GCP project with billing, Cloud SQL PostgreSQL instance, database, limited database user, and Cloud Run service identity with Cloud SQL Client permissions.
2. Create secrets in Secret Manager, attach Cloud SQL to Cloud Run (INSTANCE_UNIX_SOCKET/PGHOST), deploy to isolated STAGING service.
3. Implement server-verified ERP session authentication and role checks. Existing client is Apps Script session-based; a public bearer secret is not an acceptable browser solution.
4. Port the remaining compatibility routes (salary-file upload, HR docs, DOL upload and /functions/v1/dol-api) and update frontend to write to **ONE** authority only. Disable legacy Firebase/GitHub/Apps Script background restores and block offline re-uploads of tombstoned records.
5. BACK UP AND RECONCILE live records before one-time migration. Never seed from every browser; do not resurrect tombstoned records.
6. Test concurrent upload, SHA matching, delete + offline old-browser reconnect, cross-device/event stream, restart, two Cloud Run instances, permissions, backups, and restore. Plan rollback.

## Database setup (STAGING, not production)

In Cloud SQL Studio or psql, run schema.sql on a new database.
Use the Cloud SQL connection for Node.js: PGHOST=/cloudsql/PROJECT:REGION:INSTANCE.
Cloud Run service account needs roles/cloudsql.client.
PGPASSWORD and ATPL_SYNC_BEARER must be injected from Secret Manager, not GitHub.
PG_MAX_CONNECTIONS default is 5 per Cloud Run instance.

For staging, set ATPL_PG_MODE=1 only **after** the SQL schema exists.
GET /api/sync/health returns database connectivity without exposing employee data.
To call other preview routes, send Authorization: Bearer <secret> from a trusted server-side client only.
Cloud SQL incurs charges; set a budget alert.

This PR is the first safe development milestone. It is **not** an assertion that production sync is fixed.
