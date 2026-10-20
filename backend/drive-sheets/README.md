# ATPL Google Drive / Sheets relay — STAGING ONLY

**Status: NOT integrated with live ERP. Do NOT merge to main or enable POST.**

The Google Apps Script `/dev` link is an **editor-only health check**. It cannot be called by the public GitHub Pages HR ERP or anonymous Cloud Run code. The user's staging backend returned `environment:STAGING,postEnabled:false,liveERPConnected:false`.

This branch stages a server-side relay through the existing Node/Cloud Run backend:

GitHub Pages ERP (HTTPS browser) -> ATPL Cloud Run relay -> Apps Script versioned `/exec` -> Restricted Google Sheets + Drive.

**Critical security barrier**: Cloud Run holds a random per-service relay key in Secret Manager; a corresponding Script Property in Apps Script must be verified BEFORE POST actions. Never expose key to GitHub Pages, query strings or code. The user-specific ERP login still validates against the original restricted Users spreadsheet; script sessions and module access are server-checked. The relay does not independently authenticate users (except enforcing session-token shape), and needs rate limits and audit review before public staging.

## Work in this branch

- `backend/drive-sheets/drive-stage-relay.js`: feature-gated API; allows only eight actions, only the GitHub Pages origin in browsers, and only a configured versioned `/exec` URL.
- `appscript/ATPL_Transport_Guard_STAGING.gs`: optional Apps Script relay-key verifier. **It is NOT automatically installed in the user's Apps Script editor**.
- `tests/drive-stage-relay.test.js`: offline tests for fail-closed defaults, origin, auth-shape checks.
- `server.js` mounts relay only when `ATPL_DRIVE_STAGE_RELAY_ENABLED=1`; default live ERP behavior is unchanged.

## Safe next milestones before staging writes

1. Confirm owner controls the existing Cloud Run service settings and billing/Secret Manager; previous Google Cloud signup issues may block this. If no such access exists, design an alternative trusted proxy or serve ERP within Apps Script HTML rather than pretending direct GitHub Pages -> /dev works.
2. Owner creates random 64+ char URL-safe secret; add to Apps Script Script Properties as `ATPL_STAGE_RELAY_KEY`, and Cloud Run Secret Manager as `ATPL_DRIVE_STAGE_RELAY_KEY`. No secret goes into the git repository/chat.
3. Copy `ATPL_Transport_Guard_STAGING.gs` into staging Apps Script and add the following before the action switch in `atplStageProcessPost_`, IMMEDIATELY after its existing post-enabled guard:

   `atplStageVerifyRelaySecret_(body);`

   *All data-changing POST requests must fail without this guard.* Verify fake secret is rejected while POST is still disabled.
4. Add rate limiting, caps, auditing and a real staging access verification. Review legacy default admin login, public file blobs, exposed historical GitHub token. Rotate compromised credentials.
5. Only after audit + secure guard, deploy a **versioned /exec** backend with a deliberate service access policy. A trusted Cloud Run server cannot call editor-only `/dev`. If web app access is broadened, its relay guard + user auth must both be enforced.
6. Add relay environment settings in Cloud Run (never GitHub Pages):

   - `ATPL_DRIVE_STAGE_RELAY_ENABLED=1` (leave 0 for now)
   - `ATPL_DRIVE_STAGE_EXEC_URL=https://script.google.com/macros/s/<deployment-id>/exec`
   - `ATPL_DRIVE_STAGE_RELAY_KEY` from Secret Manager (48–128 URL-safe characters)

7. Test access denial, session expiry, role restrictions, 2-browser updates, 2-device reconciliation, file content integrity, worker restarts. Backup all existing records, resolve conflicts and disable old GitHub/Firebase/App Script background writers before production cutover.

**Google Apps Script restrictions:** `/dev` is only for script editors; `/exec` runs a versioned deployment. `ContentService` redirects JSON response to `script.googleusercontent.com`, which the Cloud Run relay follows server-side.

No live data migration is included here.
