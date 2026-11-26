# Deployment topology

How the app is intended to be hosted, and which features can run on a managed host.
This records decisions; it is not a compliance opinion. Southern-hemisphere data
residency questions belong with a privacy adviser.

## Target topology

```
Vercel (functions pinned to syd1)          worker.example.com (Cloud Run, australia-southeast1)
├─ public frontend                        └─ domain-backend worker:
├─ /admin                                     report generation, analysis,
└─ /intake (public, patient-facing)           scribe, quote drafting, billing,
        │                                     email queue
        └───────────── PostgreSQL (Sydney) ───┘
```

| Piece | Host | Notes |
|-------|------|-------|
| Public frontend, `/admin`, `/intake` | Vercel Functions in `syd1` (configured in [`vercel.json`](../vercel.json)) | Vercel Functions default to `iad1` (Washington DC) for new projects, so the region must be pinned explicitly. Static assets still serve from CDN PoPs globally; they carry no personal data. |
| Background worker | Cloud Run via `DOMAIN_BACKEND_URL` | This repo calls it through [`src/lib/serviceClient.js`](../src/lib/serviceClient.js). Without it, report/analysis/scribe/quote jobs never run. |
| Database | PostgreSQL in Sydney | See [Database connectivity](#database-connectivity) for the Vercel → database caveat. |

The rules below assume this pair of hosts. [Host portability](#host-portability) marks which
of them stop holding somewhere else.

`/intake` is a **public** page, which means patient-entered health information reaches
whatever region serves it. If intake must stay in Australia, it has to be served by the
Australian compute rather than a US-pinned deployment. Note that pinning Vercel Functions to
`syd1` moves the function execution, not the CDN that serves static assets.

### Private domain overlay

The Vercel build must mount the private overlay (see [private-domains.md](./private-domains.md)).
Without it the build still succeeds, but every customer hostname resolves to the default domain
and serves that domain's site and branding under the customer's URL. Set
`PRIVATE_OVERLAY_REQUIRED=1` (with `PRIVATE_OVERLAY_TOKEN`, or Vercel GitHub app access to the
overlay repository) so a build that cannot see the overlay fails instead of deploying.

## Preview deployments

Decision: one Vercel **Preview environment** remains the pre-production sign-off target. Branch
and pull-request deployments run alongside it for feedback; they do not replace it.

| Deployment | Source | Purpose | Database |
|---|---|---|---|
| Preview environment | `preview` branch | Sign-off gate before `main`. The only pre-production deployment with a stable hostname and the overlay mounted. | Dedicated preview database. |
| Pull-request previews | Every other branch | Fast review of one change; parallel work without clobbering QA. | Its own [database branch](../../../docs/deployment/supabase-branching.md), or no write access to the preview database. |

Per-PR deployments are cheap on Vercel, but three properties of this app make them unsafe as a
drop-in replacement for the Preview environment:

- **Hostname-resolved domains.** [`detectDomainFromHostname`](../src/lib/domainMode.js) resolves
  the domain from the host, and every `*.vercel.app` URL resolves to the default domain. The
  `?domain=` override is admin-only — `getDomainModeOverrideFromSearch()` returns `null` for any
  other path — so domain-scoped public surfaces, including `/intake`, cannot be validated on a
  per-PR URL. Those changes are signed off on the Preview environment.
- **A shared schema.** Tables are partly self-creating (`ensureTables()` in
  [`providersStore.js`](../src/lib/providersStore.js) and
  [`equipmentStore.js`](../src/lib/equipmentStore.js)) and migrations are scripts run by hand
  (`npm run migrate:*`, `npm run rls:*`). Two branches sharing one preview database repair each
  other's schema silently and hide the breakage, so any branch that changes a table shape needs
  its own database branch.
- **Public, patient-facing routes.** `/intake` accepts health information, so preview
  deployments must have Vercel Deployment Protection enabled — a preview URL is reachable by
  anyone it is shared with.

`ADMIN_PREVIEW_BYPASS=true` is honoured only when `VERCEL_ENV === 'preview'` as well — enforced
server-side by [`resolveBypassAdmin()`](../src/lib/adminBypassTokens.js), the same condition the
client uses to mint the token. Because that covers every branch preview, not just the Preview
environment, treat it as "trust the preview scope", not "trust one deployment". The localhost
bypass token is honoured only when `NODE_ENV === 'development'`.

The bypass session is a **domain-scoped admin, not a superadmin**. `ADMIN_PREVIEW_DOMAIN` names the
only domain it can read; without it the token resolves to no principal and the bypass does not
exist. This matters because a superadmin on preview reads every tenant — route handlers take
`domain` from the query string, and the RLS predicates short-circuit on the superadmin role — so a
scoped principal is what keeps the tenant boundary intact at both layers. Every accepted bypass
writes a `[admin-bypass]` audit line naming the principal, domain, route and deployment.

Changing either variable does not affect a deployment that already exists: Vercel applies
environment variable changes only to **new** deployments, so redeploy after editing them and
confirm the new `revision` before assuming the bypass is off. Deleting the old deployment is
separate — a superseded deployment stays reachable at its own URL.

Deployment Protection is the only control keeping the token off the internet. It is a dashboard
setting with no code backstop, so a build that expects customer domains should also ship
`PRIVATE_OVERLAY_REQUIRED=1` and should be assumed exposed if protection is ever disabled.

[`GET /api/health`](../src/app/api/health/route.js) reports the environment and build identity
without touching the database, the worker, or a model vendor, so a tester holding several preview
URLs can tell which deployment they are on. Superadmins see the same identity in the admin header.

For private custom-domain uptime checks, use [`GET /health`](../src/app/health/route.js), optionally
with `?domain=<domain-key>` (for example, `https://www.example.com.au/health?domain=<domain-key>`).
It checks that the request hostname resolves to a configured private domain, that middleware
resolved that same domain, and—when supplied—that it matches the expected domain. A failed check
returns HTTP 503; an unknown expected domain returns HTTP 400. Like `/api/health`, it reports
build/runtime identity without probing the database or external services.

For worker freshness, use [`GET /env-health`](../src/app/env-health/route.js) with
`?environment=<name>` (or `?domain=<name>`). It reads `system_settings` at
`env_health_<name>` and returns HTTP 200 only when `workersRan` is `true` and its timestamp
is within the past two hours; missing, stale, or unsuccessful records return HTTP 503.

## Skipping builds for documentation

[`ignoreCommand`](../vercel.json) runs
[`scripts/check-docs-only-change.mjs`](../scripts/check-docs-only-change.mjs) before Vercel
installs anything. The script exits 0 — Vercel skips the build — only when every changed path is
documentation: markdown anywhere, or the repository-level `docs/` tree. It diffs from the
repository root rather than from `apps/core`, because the app bundles `packages/` at build time
and a change there has to rebuild. Every failure path (no checkout, a shallow clone without the
parent commit, a git error) exits 1, so the rule can waste a build but never hide one.

Redeploys run the same check, with **Use project's Ignore Build Step** ticked in the redeploy
dialog. Untick it when the new deployment is the point — after changing environment variables,
for example.

## Developer-only tooling

Provider hero capture is a **workstation workflow**, not a deployed feature. It shells out
to a local Chrome/Chromium install and its approval step writes PNGs into `public/`, which
is read-only on Vercel and ephemeral on Cloud Run.

Decision: the capture code is committed and deployed to Vercel with everything else, but it
is inert in production. Cloud Run does not need Chromium, so the worker image stays small.

| Surface | Production behaviour |
|---------|---------------------|
| `GET /api/allied-health/provider-screenshot` | `501` with a dev-only message (never spawns a browser) |
| `POST /api/allied-health/provider-screenshot` (approve) | `403` — writes into `public/` |
| `POST /api/allied-health/provider-capture-session` | `403` — needs local Chrome |
| `POST /api/allied-health/provider-ua-override` | `403` — writes into `public/` |
| `/admin/settings/hero-review` and its `/settings/hero-review` alias | `404` |
| Dev Tools → Hero Review button on `/admin/settings` | Hidden |

The gate is [`isDevToolingEnabled()`](../src/lib/devTools.js) (`NODE_ENV !== 'production'`),
shared by the route and the UI so the two cannot drift.

### Maintenance routes

Everything under `/api/database/migrate/*`, plus `create-tables`, `seed`, `sync` and
`migrate-to-attributes`, runs DDL or bulk writes against whichever database `DATABASE_URL`
points at. They are gated by [`requireOperatorAuth()`](../src/lib/operatorRouteAuth.js), which
accepts a superadmin bearer token or the shared service secret.

An unauthenticated route under this prefix is a table drop for any anonymous caller —
`POST /api/database/migrate/drop-old-tables` is the plainest example — so new operator routes use
the same helper rather than hand-rolling a check.

Read-only posture routes (`check`, `rls-check`, `summary`, `search-query`) use
`requireAdminAuth()` instead: any signed-in admin may see them, because their payloads carry
no tenant data and no credentials. `detect-local` is operator-only for the opposite reason — it
returns a `suggestedUrl` containing the local database password it found in `pgpass`.

### Deny-by-default for the API surface

Route-level checks only hold until the next route is added. [`middleware.js`](../middleware.js)
therefore refuses anonymous requests to the whole `/api` prefix before any handler runs, using
[`decideApiAccess()`](../src/lib/apiGate.js):

| Request | Result |
|---------|--------|
| `OPTIONS` (CORS preflight) | allowed — carries no credentials by design |
| `Authorization: Bearer <admin JWT or bypass token>` | allowed |
| `Authorization: Bearer <PLUGIN_SIGNING_SECRET>` | allowed (worker → app calls) |
| Path and method on `PUBLIC_API_ROUTES` | allowed |
| Anything else | `401` |

`PUBLIC_API_ROUTES` is method-scoped, because a prefix is not a permission: `/api/content` is a
public `GET` and an authenticated `POST`, and `/api/intake/save` accepts an anonymous `POST`
(the visitor's own form) while its `GET`, which returns every submission, is gated. The
`/api/database/*` prefix keeps its own stricter decision in
[`databaseApiGate.js`](../src/lib/databaseApiGate.js) — its allowlist is empty, so every route
under it needs an authenticated caller. Adding an entry to either list is a security decision:
check that the route exposes no tenant data, no PHI and no infrastructure detail.

`API_GATE` is the only knob, and it governs both this gate and the `/api/database` one.
`API_GATE=report` logs `[api-gate] would deny …` and lets the request through, which is how a
surface whose callers you cannot fully exercise — a fresh deployment, or an overlay shipping
routes the allowlist does not yet name — is checked without taking the app down. `enforce` is the
default and the mode to run everywhere once the reports are quiet.

The gate is a coarse "authenticated" check and does not replace the in-route work: tenant
scoping still happens in the handler, where `app.current_domain` is bound for RLS. Anything
that authenticates without a token therefore bypasses the gate — see the warning about the
preview bypass token above.

### Running the API without Vercel Deployment Protection

Deployment Protection is not a substitute for either control, and neither is a substitute for
it. Two things must be true before it is switched off for an environment:

1. `ADMIN_PREVIEW_BYPASS` must be unset. The preview bypass token is a constant in the bundle
   ([`adminBypassTokens.js`](../src/lib/adminBypassTokens.js)), so a preview deployment without
   protection hands a domain-scoped admin session to anyone who sends
   `Authorization: Bearer vercel-preview-admin-bypass-token`. The gate sees a valid principal
   and lets the request through.
2. `API_GATE` must not be `report`, and the `[api-gate] would deny …` lines must be quiet.

### Preventing preview from reaching production data

Vercel scopes environment variables per environment, but a variable set to **All Environments**
silently hands preview the production database: preview then runs table initialisers and
migrations against production, and nothing fails. That silence is the problem.

Every deployment declares which database it expects:

```bash
DATABASE_ENVIRONMENT=production   # production deployment
DATABASE_ENVIRONMENT=preview      # preview deployments
```

[`checkDatabaseEnvironment()`](../src/lib/databaseEnvironmentGuard.js) refuses two combinations:

| Deployment (`VERCEL_ENV`) | Database (`DATABASE_ENVIRONMENT`) | Result |
|---|---|---|
| `preview` | `production` | `503` on every path except `/api/health` |
| `production` | anything other than `production` | `503` |

Unset (or an unrecognised value) means "no claim" and the guard stays dormant, so deploying
this cannot break an environment that has not adopted it. `ALLOW_PRODUCTION_DATABASE_IN_PREVIEW=1`
re-opens the first row for a deliberate one-off check.

The guard runs in two places on purpose: in middleware, so the request never reaches a handler,
and in `getDatabaseConnectionString()`, so a route that builds its own `pg` client still fails.
`/api/health` stays reachable so an uptime check can tell a misconfigured deployment from a dead
one.

### Capture workflow

Approved captures are repository content, not runtime state:

1. Capture and approve locally (Chrome must be installed, or set `CHROME_PATH`).
2. Commit the PNGs plus `index.json` and `ua-overrides.json` under
   `public/allied-health/provider-heroes/`.
3. Deploy. Vercel serves those files as build-time static assets.

Because the review state lives in committed files, runtime writes in production would be
discarded anyway — which is exactly why the tool is gated rather than relocated.

## Host portability

The frontend is a plain Next.js app, so the hosting choice is reversible in principle. What does
not move is the set of rules above that are written in Vercel's vocabulary. This section records
which ones a second host would have to re-earn; it is not a deployment guide for that host.

| Concern | Vercel (intended) | Cloud Run | AWS (ECS Fargate / App Runner) |
|---------|-------------------|-----------|--------------------------------|
| Region pin | `regions` in [`vercel.json`](../vercel.json) | `--region` per service and per job | one region per VPC and subnet set, ALB in front |
| Egress IP | none below Enterprise Secure Compute | VPC connector with Cloud NAT, or the Cloud SQL connector | NAT gateway with an elastic IP, or RDS Proxy |
| Database reachable from | the internet, on a public IP with TLS | a private IP over the connector | a security group pinned to the NAT address |
| Environment signal | `VERCEL_ENV` | `APP_ENV`, plus `K_SERVICE` and `K_REVISION` | `APP_ENV` |
| Preview isolation | one Deployment Protection setting per deployment | a revision tag is the nearest thing; no per-branch URL | separate services or stages |
| Writable `public/` | read-only at build | writable but ephemeral | writable but ephemeral, S3 elsewhere |

Two rows are already load-bearing in code, and both are one-way on another host:

- [`checkDatabaseEnvironment()`](../src/lib/databaseEnvironmentGuard.js) takes the deployment's
  side of the comparison from `VERCEL_ENV`. Anywhere else that is unset, the claim is `null`, and
  the guard permits every pairing — including production data from a preview, which is the
  failure it exists to stop. [`resolveDeploymentRuntime()`](../src/lib/deploymentRuntime.js)
  already reads `APP_ENV` first for exactly this reason; the guard does not.
- [`isPreviewBypassEnabled()`](../src/lib/adminBypassTokens.js) requires `VERCEL_ENV === 'preview'`,
  so off Vercel the bypass is inert — the safe direction — but the token is a constant in the
  bundle ([`PREVIEW_DEPLOYMENT_ADMIN_TOKEN`](../src/lib/adminBypassTokens.js)) and there is no
  Deployment Protection equivalent standing in front of it by default. The "assume exposed"
  warning above becomes the whole posture rather than the fallback.

Everything else ports: the API gate, the tenant scoping, the overlay build step, and the
`/api/health` and `/health` identity reports already read `K_SERVICE`/`K_REVISION` alongside the
Vercel variables. The hero-capture decision is host-independent as well — it is a workstation
workflow because a deployed filesystem is never the source of truth for committed content.

Decision: Vercel Functions in `syd1` with the Cloud Run worker stays the intended topology.
Adding a host means closing the two guards above and re-answering
[Database connectivity](#database-connectivity), because egress is what decides it — not adding a
parallel set of steps here. Host-specific steps belong beside the packaging they describe:
[`deploy/cloud/`](../../../deploy/cloud/) today (a stub that fails closed) and one page per mode
under [`docs/deployment/modes/`](../../../docs/deployment/modes/). There is no `deploy/aws/`
equivalent yet.

## Database connectivity

Vercel Functions have no static egress IP unless the account has Enterprise Secure Compute,
so Cloud SQL authorized-network pinning is not available. Options, in order of preference:

1. **A serverless-native Postgres in `ap-southeast-2`** (Neon, Supabase). Works with the
   existing `pg` code and supplies a pooler.
2. **Cloud SQL with public IP + TLS + IAM/auth-proxy connector.** Keeps the instance
   restricted, but needs the connector library and workload credentials.
3. **Public IP open to `0.0.0.0/0` with a strong password.** What happens by default when
   neither of the above is chosen. Not appropriate for patient data.

Any option needs a connection pooler: serverless functions opening direct `pg` connections
will exhaust `max_connections`.

## Open items

- Tighten CORS. `next.config.js` currently returns `Access-Control-Allow-Origin: *` on all
  `/api/*`, and admin sessions are bearer tokens held in `localStorage`.
- `/api/health` reports deployment liveness and build identity only. For private custom-domain
  monitoring, use `/health?domain=<domain-key>` to also verify hostname-to-domain routing; neither
  endpoint probes the database or the worker.
- Move API configuration out of `.env.local`. The `*/setup` routes already refuse to write in
  production and return instructions instead, but the config they edit should live in the
  database or a dedicated config directory before multi-instance deploys.
- Cloud Run ingress should be authenticated with IAM (ID token from a service account) rather
  than only the shared `CORE_BACKEND_SECRET`. The secret remains as defense in depth.
