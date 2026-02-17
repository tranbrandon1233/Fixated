# Instagram Operations Runbook

## Purpose
- Keep Instagram scraping reliable under UI drift, auth churn, and rate limits.
- Provide on-call actions for degraded collection quality.

## Guardrails Implemented
- Rate limits for sensitive endpoints:
  - `POST /api/instagram/session`
  - `POST /api/instagram/refresh`
  - `POST /api/instagram/disconnect`
- Retry/backoff for transient collector failures.
- Collector failure taxonomy (`auth_required`, `challenge_required`, `rate_limited`, `timeout`, `ui_changed`, `temporary_network`, `collector_unavailable`).
- Automatic alerting on:
  - failure streak threshold per user
  - rolling failure-rate threshold.
- Operational metrics endpoint: `GET /api/instagram/ops`.
- Cross-instance persistence for ops snapshots in Supabase:
  - `Organizations.connected_accounts[]` (jsonb array)
  - each Instagram account entry may include `instagramOps`.

## Key Endpoints
- `GET /health`
  - includes Instagram health summary.
- `GET /api/instagram/ops`
  - includes run outcomes, queue depth, failure rates, recent alerts, and persisted account snapshots.
- `GET /api/instagram/refresh/:jobId`
  - job status and error details.

## Common Incident Patterns
1. `collector_unavailable`
- Cause: Playwright not installed in runtime.
- Action: install Playwright browsers/deps in deploy image, or set `INSTAGRAM_COLLECTOR_MODE=mock` temporarily.

2. `auth_required` or `challenge_required`
- Cause: expired cookies or challenge flow.
- Action: refresh cookie vault via `POST /api/instagram/session` for affected account.

3. `ui_changed`
- Cause: Instagram DOM selectors changed.
- Action: update `server/instagramSelectors.js`, redeploy, validate with one account refresh.

4. `rate_limited`
- Cause: too many scrape requests.
- Action: lower `INSTAGRAM_REFRESH_MAX_CONCURRENCY`, increase retry delay, reduce refresh frequency.

## Tuning Knobs
- `INSTAGRAM_REFRESH_MAX_CONCURRENCY`
- `INSTAGRAM_COLLECTOR_MAX_RETRIES`
- `INSTAGRAM_COLLECTOR_RETRY_BASE_DELAY_MS`
- `INSTAGRAM_COLLECTOR_RETRY_JITTER_MS`
- `INSTAGRAM_RATE_LIMIT_WINDOW_MS`
- `INSTAGRAM_REFRESH_RATE_LIMIT_MAX`
- `INSTAGRAM_SESSION_RATE_LIMIT_MAX`
- `INSTAGRAM_ALERT_FAILURE_STREAK_THRESHOLD`
- `INSTAGRAM_ALERT_FAILURE_RATE_THRESHOLD_PCT`

## Verification Checklist
1. Trigger manual refresh for one account and confirm `status=succeeded`.
2. Confirm `GET /api/instagram/ops` shows recent run and no critical alert storm.
3. Confirm `GET /health` includes Instagram section with sane values.
4. Confirm campaign available posts include Instagram entries when cached summary has top posts.
5. Confirm `Organizations.connected_accounts[]` contains `instagramOps` for refreshed Instagram accounts.
