# Practice Manager — Runtime

The worker, queue and health service. It is one deployable with two run modes:

- **Service** — `npm run dev` / `npm start`. Next.js serves `/api/*` and the enabled
  worker poll loops start with the server (`src/instrumentation.js`).
- **Job** — `npm run jobs:once --workspace @practice-manager/jobs`. One cycle of each
  enabled worker, then exit; suits a Cloud Run job, a cron entry or a manual retry.

A single-install deployment (Solo Desktop, Solo Docker) has no runtime service: `apps/core`
starts the same workers in-process when `INLINE_WORKERS=true` and writes the queues
directly. The runtime exists for LAN and Cloud deployments, where the core reaches it
through `DOMAIN_BACKEND_URL`.

## Routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness probe; touches no database |
| `POST /api/<queue>/queue` | Enqueue a report, analysis, scribe, billing or email job |
| `GET /api/<queue>/queue/status` | Latest job for `?domain=&patient_id=` plus a per-status tally |
| `GET,POST /api/<queue>/worker/run` | Run one worker cycle on demand |
| `GET,POST /api/report/patient` | Read or replace a patient's formal report |
| `POST /api/email/inbound` | Provider inbound-email webhook |

`<queue>` is `report`, `analysis`, `scribe`, `billing` or `email`; the inbound-email worker
lives at `/api/email/inbound/worker/run`. Every route is also served under
`/api/practice-manager/*` for deployments that publish the service behind a path prefix.

The routes are transport only. Each one calls the function in `@practice-manager/jobs` that
a single-install core app imports directly — `enqueue*`, `get*JobStatus`, `getPatientReport`,
`savePatientReport` and the worker cycles registered in `driver.js` — so the two deployment
shapes cannot disagree about what a queue write does.

## Setup

```bash
cp .env.example .env     # DATABASE_URL and CORE_BACKEND_SECRET at minimum
npm run dev              # http://localhost:3003
```

The port matches the `DOMAIN_BACKEND_URL` default (`http://localhost:3003`) used by
`apps/core/src/lib/serviceClient.js`.

## Authentication

- Queue and status routes: `Authorization: Bearer $CORE_BACKEND_SECRET`, or
  `adminToken` in the JSON body. An unset secret leaves them open — acceptable only for
  local development.
- Worker triggers: `Authorization: Bearer $WORKER_RUN_TOKEN`, falling back to
  `CORE_BACKEND_SECRET`.
- The inbound-email webhook is unauthenticated so the provider can post to it; give it a
  URL that is not otherwise reachable, or leave it out of deployments that let the core
  receive the webhook itself (`apps/core/src/app/api/webhooks/resend/inbound`).
