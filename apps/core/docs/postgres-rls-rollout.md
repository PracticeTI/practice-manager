# PostgreSQL RLS rollout

`patient_files` is the first domain-scoped table using enforced PostgreSQL row-level security.

## Policy set

Every table with RLS enabled now carries a policy. `src/lib/rlsPolicies.js` defines the set and
`scripts/setup-rls-policies.mjs` installs it. The tables are grouped by access model:

| Group | Tables | Rule |
|-------|--------|------|
| Tenant-scoped | `activities`, `appointments`, `forms`, `notes`, `patient_*`, `report_domain_settings`, `report_templates`, `services`, `waitlist_*`, … | `app.current_role = 'superadmin'` or `domain = app.current_domain` |
| Shared reference | `funders`, `funder_documents` | read for everyone, writes for superadmins |
| Directory | `allied_health_providers`, `equipment_suppliers` | one catalogue shared by every domain: read for everyone; writes for superadmins, the row's own domain, or a legacy row with no domain |
| Directory child | `*_favorites`, `*_admin_deletions` | read for everyone (the listing shows a cross-admin `favorite_count` beside the caller's own `is_favorite`); writes require an existing parent record. Ownership is `admin_key`, not the parent's domain |
| Service-only | `api_rate_limits`, `scheduling_rate_limits` | permissive; no tenant data, called from public routes |
| User-scoped | `user_settings` | `username = app.current_username` **and** `domain = app.current_domain`; superadmins bypass both. Replaces the retired `admin_notification_settings` |
| Public read | `content` | read for everyone; insert/update/delete only for superadmins or the row's own (or unowned) domain |
| Global state | `system_settings` | permissive; global key/value with no tenant column, written by unauthenticated routes |
| Admin identity | `admin_users` | read for everyone (login and notification lookup precede any user context); writes for superadmins |

Every policy is issued `TO` the runtime role (`POSTGRES_RLS_RUNTIME_ROLE`, default
`practice_manager_app`), never to `PUBLIC`. A Supabase project grants `anon` and `authenticated`
full DML on every public table and serves them through the Data API, so a `USING (true)` policy on
`PUBLIC` would publish `admin_users`, `system_settings` and `content` to anyone holding the public anon
key. Naming the runtime role costs nothing: table owners and `BYPASSRLS` logins ignore policies
regardless.

If the project does not use the Data API, revoke it at the database as defence in depth — existing
tables and the defaults that apply to tables created later:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
```

Install or refresh it as the schema owner:

```bash
npm run rls:policies:dry   # runs the DDL in a transaction, then rolls back
npm run rls:policies       # commits policies and grants for the runtime role
```

The script is idempotent, skips tables that do not exist yet, and grants the runtime role
(`POSTGRES_RLS_RUNTIME_ROLE`, default `practice_manager_app`) table plus sequence privileges. Both it
and `rls:verify` add TLS for any non-local host, so a hosted URL works as-is — do not append
`?sslmode=require`, which current `pg` treats as `verify-full` and fails on a pooler's certificate
chain. Policies
alone do not grant access, so the grants are part of the same transaction.

The application's own client config is built by `src/lib/pgClientConfig.js`, which applies the same
rule: TLS for every non-local host, and a URL's `sslmode` is ignored apart from `?sslmode=disable`,
the opt-out for a local server on another host. Route code must build `pg` options through that
helper rather than by hand — `pg` defaults to `ssl: false` and only decodes percent-encoded
credentials when it parses a connection string itself, so a hand-built config both connects in
plaintext to a hosted database and fails auth on a password containing `@`, `%` or `:`.

Sequence privileges cover both the sequences a table owns (`SERIAL`/`IDENTITY`) and the ones a column
default calls `nextval()` on without an ownership link. `admin_users` and `equipment_suppliers` are
built the second way, so an ownership-only query left their inserts failing with `permission denied
for sequence` once the app ran as the constrained role.

### Pooled connections

A hosted pooler can hand the script a session that is already running as another role: `ALTER ROLE
... SET role` does it at login, and a transaction-mode pooler (Supabase port 6543, pgbouncer) can
replay the residue of another client's session-level `SET ROLE`. `current_user` is then the
constrained runtime role, and the owner DDL fails with `permission denied for schema public` — or,
worse, succeeds on one run and fails on the next, because the pooler recycled a different backend.
The script resets to the login role before touching anything and refuses to continue when that login
still cannot create in `schema public`, naming the role it connected as.

The same residue makes an ambient-role reading unreliable: `GET /api/database/rls-check` reports
`current_user`, which on a pooled connection may be a role another client assumed, not the login
role. Read the login posture from the pooler's configured role, not from a single probe.

`patient_files` is the one exception to the `TO <runtime role>` rule: it is declared `FORCE ROW LEVEL
SECURITY`, so the owner is subject to its policy too, and its policy is issued to `PUBLIC` with a
domain predicate that denies every role without a bound domain. Scoping it to the runtime role would
lock out the owner connection those routes still use.

### What the cutover reveals

Moving the runtime to a non-owner login hides rows that were only visible because the owner bypassed
every policy. Three shapes are worth checking before the switch:

- **Catalogue tables with no tenant.** `equipment_suppliers` on preview held 119 rows, all imported
  before the `domain` column existed, so every row carried `domain = ''`. A tenant predicate matches
  none of them and the directory renders empty. They belong to the directory access model above.
- **Favourites on a catalogue row.** The `*_favorites` and `*_admin_deletions` policies used to
  resolve access through the parent record's domain. That reads as "own domain only", but the
  directory is shared, so a published record another domain added was visible everywhere and
  unfavouritable everywhere: the runtime session has no bound domain, the parent carries one, and the
  insert failed with `new row violates row-level security policy`. They belong to the directory child
  model above, where `admin_key` owns the row and the parent's domain is irrelevant.
- **Tables the app created for itself.** Lazy `CREATE TABLE IF NOT EXISTS` needs `CREATE` on the
  schema even when the table is already there, so those routes 500 rather than self-provision. They
  must probe first (see `missingTables` in `lib/pgOptionalDdl.js`) and the schema must come from an
  owner pass.


RLS is enabled but **not forced** on these tables. Forcing it would immediately lock out the owner
connection the application still uses. Force it per table only after the runtime connects as the
constrained role.

## Settings storage

Two tables hold application settings, split by scope:

| Table | Scope | Row |
|-------|-------|-----|
| `system_settings` | system-wide tools on the Settings page, caches, AI config, catalogues | `key`, `value` |
| `domain_settings` | per-domain values behind the Domains page | `(domain, key)` |

`domain_settings` is in the tenant registry, so its policy is `domain =
app.current_domain`. `system_settings` is in the global group and is reachable by the runtime role
only; `lib/systemState.js` is now a thin compatibility layer over it.

Both replaced the single `system_state` table, which stored per-domain values either as one JSON map
keyed by domain (`domain_management_settings_v1`, …) or with the domain baked into the key name
(`domain_hero_banner_v1`). That shape made the per-domain half invisible to row-level security.
`system_state` has been dropped: its rows were migrated into the two tables and every call site,
including the raw-SQL caches in `api/database/*`, now reads the new tables.

`npm run db:prepare` creates whichever of the two tables is missing and then installs the policy set,
so one command provisions a database. The runtime also creates them when they are missing — see
[Migrating a deployment](#migrating-a-deployment).

## Checking the deployed connection role

Policies are inert while the application connects as a superuser or a role with `BYPASSRLS` —
neither `ENABLE` nor `FORCE ROW LEVEL SECURITY` applies to those roles. `GET /api/diagnostics/rls`
reports what a deployment actually connected as, so you can tell whether RLS is a real control there
or only on paper:

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/api/diagnostics/rls
```

| Field | Meaning |
|-------|---------|
| `database.currentUser` | The role the runtime connected as |
| `database.isSuperuser`, `database.bypassesRls` | Either being `true` makes every policy inert |
| `database.rlsEnforcedByRole` | `true` only when the role is neither a superuser nor `BYPASSRLS` |
| `database.runtimeRoleSetting` | Whether `POSTGRES_RLS_RUNTIME_ROLE` is set, so `withPostgresRlsContext` issues `SET LOCAL ROLE` |
| `tables[]` | `rlsEnabled`, `rlsForced`, and `policyCount` per table |
| `missingTables` | Tables the registry expects that do not exist yet |

Run it against preview and production and compare. The endpoint is superadmin-only because the
answer reveals whether tenant isolation is enforced by the database or only by route authorization;
it reads `pg_roles`/`pg_class`/`pg_policies` and no tenant data.

`patient_files` is included even though it is absent from `RLS_POLICY_TABLES`: its policy is created
inline by `ensurePatientFilesTable()` and it is the only table declared `FORCE ROW LEVEL SECURITY`.
Its grants are likewise outside `buildGrantStatements()`, so a role constrained by that script alone
may have no privileges on it.

### Role posture in the admin panel

Settings → RLS Check → Details (`GET /api/database/rls-check`) reports the same posture without a
separate script, and adds the checks that decide whether an assumption can work at all:
`login-role-rls-enforced` (does the login role bypass RLS), `rls-runtime-role-configured`,
`rls-runtime-role-exists`, `rls-runtime-role-constrained`, `rls-runtime-role-assumable`
(`pg_has_role(current_user, <role>, 'MEMBER')`), and `rls-runtime-role-effective`, which performs
`SET LOCAL ROLE` in a transaction and rolls it back. It also reports `rls-route-coverage`, which names
the unwired routes described below. Any `fail` there means every domain-scoped
query fails or runs unconstrained; the `npm run rls:verify` output above is the per-domain
counterpart. See `lib/rlsRuntimeRole.js`.

The same payload has a standalone, read-only page at `/admin/settings/rls`, linked from Settings →
Management and from the footer of a simulated admin session. Both it and the API are limited to
superadmins and simulated admin sessions (`lib/rlsPanelAccess.js`): a real admin login, including the
scoped preview-bypass principal, is redirected away and gets `403` from the API. Use Settings →
Admin → Simulate admin to test what a domain admin's session is allowed to see; the `simulated` claim
only `POST /api/auth/simulate-admin` mints, and that route requires a superadmin, so an admin cannot
grant it to themselves.

`login-role-rls-enforced` counts table ownership alongside `SUPERUSER`/`BYPASSRLS`, because
`ENABLE ROW LEVEL SECURITY` never applies to the owner — only `FORCE` does. It is deliberately
environment-aware: outside production a privileged login role is reported as the expected development
setup, since that role owns the schema and runs migrations and enforcement is exercised by the
harnesses above; in production it stays a warning, where it means every unwired route reads across
tenants.

It reads `session_user`, the login credential, not `current_user`. On a transaction-mode pooler the
two diverge whenever another client's session-level `SET ROLE` is still in effect, and reading
`current_user` reports the borrowed role's attributes — passing a login that is actually a
`BYPASSRLS` role. When they differ the check says so in its detail instead of silently reporting the
assumed role.

### Which routes the warning refers to

`login-role-rls-enforced` says that routes opening a plain connection run unconstrained, and a
`rls-route-coverage` check plus a "Routes without a domain binding" table in the same panel names
them. The classification is the one `npm run rls:coverage` prints, from `lib/rlsRouteCoverage.js`:
`bound` routes bind `app.current_domain`, `operator` routes are the owner-only DDL handlers,
and `unwired` is everything that touches a tenant table on a plain connection.

A serverless deployment has no source tree to inspect, so the route walk runs at build time:
`next.config.js` calls `collectRouteCoverage()` from `lib/rlsRouteCoverageFiles.js` and injects the
result as `PRACTICE_RLS_ROUTE_COVERAGE`. That runs after the overlay sync in `prebuild`, so routes
copied in from the private repository are classified too. The list is therefore as current as the
deployment — a route added since the last build is absent, and a deployment built before this check
existed reports "unknown" rather than zero. Do not set `PRACTICE_RLS_ROUTE_COVERAGE` by hand.

`rls-route-coverage` is a warning, not a failure: an unwired route still serves requests, it just
does so outside the policies. Treating it as a warning keeps the card usable while routes are
migrated, and `npm run rls:coverage --fail-on-unwired` is the gate for when they all should be.

## Registry coverage and route wiring

`RLS_POLICY_TABLES` covers 58 tables: the original tenant set plus
`PATIENT_RECORD_TABLES`, which holds `patients`, `billing`, `chats`, the message
queues and the `patient_*` families. Those seventeen were previously absent, so the
script never touched them — locally each one kept a permissive `dev_allow_all_*`
policy, and the hosted database had none at all.

Tables created lazily at runtime (report settings, admin users, system state and
the content table) are part of the registry too. `lib/supabaseRls.js` enables RLS
on every `CREATE TABLE` it sees but installs no policy, so a hosted database built
by the application can end up with RLS enabled and no policy at all. Re-running
`npm run rls:policies` after the schema is created closes that gap; the RLS Check
panel reports any table left open.

Two tables stay out on purpose:

| Table | Why |
|-------|-----|
| `patient_files` | carries its own `FORCE`d policy in `lib/patientFilesTable.js` |
| `billing_old` | superseded legacy table |

`tenantPolicyStatements()` drops every permissive policy it knows about
(`dev_allow_all_*`, `*_rls_policy`, `*_access_policy`) before creating the domain
policy. RLS ORs the policies that apply to a row, so a single leftover
`USING (true)` row silenced the domain policy while still looking correct in
`pg_policies` — that is how `inbound_messages`, `patient_analysis` and
`patient_equipment_suggestions` stayed open after their policies were installed.
`lib/inboundMessages.js` used to recreate that permissive policy on every boot; it
now installs the domain policy instead.

### Route wiring status

`npm run rls:coverage` classifies every route that touches a registry table: `bound` (uses one of
the context helpers), `operator` (schema or whole-table maintenance that must keep an owner
credential), or `unwired` (plain connection — the remaining work). Add `--unwired` to list only the
work left and `--fail-on-unwired` to make it a gate.

Wiring a tenant CRUD route that already resolves its scope is one change: replace
`getDatabaseConnection()` with `getDomainBoundConnection(domain)`, and hand the same connection to
`recordActivity` (its second argument). Wired today: notes, forms, contacts, activities,
appointments (including reminders and import), billing, availability, cases and case usage, quotes
(including items and assist), service agreements, patient transcriptions, patient analysis, scribe
summaries, reports, the domain settings routes (hero banner/thumbnail, menu, homepage palette, admin
background colour, cache/quick-actions/email/AI-usage reads), and the existing
`patients`/`patient_files` families.

Nothing is unwired today. The last batch needed three patterns beyond the one-liner above:

- **Public routes** — the booking, waitlist-offer, calendar-feed, OAuth-callback, content and
  practice-news handlers have no admin token, so they bind the tenant they already validated: the
  HMAC/action token's domain, the OAuth `state.domain`, or `?domain=` with `DEFAULT_CONTENT_DOMAIN`
  as the fallback.
- **Deliberate cross-tenant routes** — `settings/activities`, `database/recent-activity` (superadmin
  with no `?domain`), the cron sweep in `scheduling/reminders/run` and the inbound SMS webhook open
  `getSuperAdminConnection()`. That sets `app.current_role = 'superadmin'` rather than
  `app.current_domain`, so the policies see the escape hatch they are written for. The classifier
  counts it as `bound`.
- **Global state** — `system_settings` has no domain column, so the routes touching it
  (`database/search-query`, `database/recent-images`, the settings stores) still bind a session: the
  policy is permissive, but the runtime role expects a scope to be set.

### Binding the request's domain

A policy needs `app.current_domain`, and a route only has it if it says so. Two
options, both in `lib/postgresRlsContext.js` and `lib/domainScopedConnection.js`:

| Helper | Shape | Use |
|--------|-------|-----|
| `withPostgresRlsContext(connection, ctx, fn)` | transaction, `SET LOCAL` | a handler that makes one call |
| `getDomainBoundConnection(domain)` | session `SET ROLE` + `set_config(…, false)` | a handler that holds the connection across several statements |
| `openDomainScopedConnection(request, domain)` | resolves scope and opens | a handler that has not resolved the domain yet |
| `getSuperAdminConnection()` | `SET ROLE` + `app.current_role = superadmin`, no domain | a verified superadmin route that spans tenants (domain settings, cross-domain lists) |

The session form exists because most handlers hold a connection open across an
insert, an activity row, a contact sync and a queue enqueue; `SET LOCAL` would be
lost outside its transaction. Connections are created and closed per request, so
the settings die with the session.

The bound role is always `admin`, even for a superadmin — the requested domain is
the target, so no session is cross-tenant at the database.

### Wired today

`patients` (list, create, read, update, delete) uses `getDomainBoundConnection()`.
Verified end to end against a constrained role: reads return only the bound domain,
a foreign `?domain=` is refused with `403`, and create/update/delete succeed.

**Everything else still uses a plain connection.** Pointing `DATABASE_URL` at a role
without `BYPASSRLS` before those routes are wired makes them return zero rows —
correct policy behaviour, wrong-looking result. Wire the route family first, then
move the connection string.

## Local setup

Run the owner connection from `.env.local` once:

```bash
npm run rls:setup:local
```

This creates a non-login, non-superuser `practice_manager_app` role, grants the local database user permission to assume it, grants only the patient table privileges needed by the current slice, and installs the domain policy.

In development, patient-file requests use `SET LOCAL ROLE practice_manager_app` inside a transaction. Override the name with `POSTGRES_RLS_RUNTIME_ROLE` when needed.

Run both focused checks:

```bash
npm run test:rls
```

## Migrating a deployment

**A deployment never migrates the database.** The Vercel build runs `prebuild`
(`check-node-version`, `sync-private-overlay`) and `next build`; neither connects to Postgres, and
`.github/workflows` only lints and releases. So:

- a deploy that adds a table, a column or a policy ships code that expects schema it did not create;
- preview has **one** database shared by every preview deployment (`DATABASE_ENVIRONMENT=preview`,
  guarded by [lib/databaseEnvironmentGuard.js](../src/lib/databaseEnvironmentGuard.js)), so a schema
  change is applied once per database, not once per deploy;
- a new or restored database has no settings tables and no policies until someone runs the command.

Schema work is manual and idempotent, run by an operator holding the **owner** credential:

```bash
# preview — POSTGRES_URL wins over .env.local, so the owner URL never lands in a file
POSTGRES_URL="$PREVIEW_OWNER_URL" npm run db:prepare

# production
POSTGRES_URL="$PRODUCTION_OWNER_URL" npm run db:prepare
```

`db:prepare` is `rls:policies`: it creates `system_settings` and `domain_settings` if missing, then
installs every policy and grant the runtime role needs. It is re-runnable. Do not run two at once
against the same database — it takes no lock and issues DDL.

### There is one database

`DATABASE_REPLICA_URL` and the `database_operation_mode` switch are gone. The "replica" was a
second, manually synced copy of the same schema: the sync dropped and recreated every table in the
target database, so it discarded that database's policies and grants, and it carried `admin_users`,
`user_settings` and the encrypted calendar tokens with it. Failover is now the database provider's
job. If a second database is ever reintroduced it must be provisioned by the owner (policies and
grants are per-database) before the runtime points at it.

### Cutting the runtime over to the constrained login

`DATABASE_URL` is what decides whether RLS is a control at all. While it logs in as a role with
`SUPERUSER`, `BYPASSRLS` or table ownership, every policy is inert for any route that opens a plain
connection — `npm run rls:coverage` lists them. The order matters:

1. `npm run db:init` as the owner, so every table exists with its policies and grants. A database
   created from `packages/db/supabase/migrations` already has them, and the baseline creates the
   `practice_manager_app` role without LOGIN; `npm run db:prepare` is the compatibility path for
   a database that predates the migrations.
2. Give the runtime role a login. On Supabase `NOSUPERUSER`/`NOBYPASSRLS` are superuser-only
   clauses, so they are asserted rather than assigned — `postgres` there is not a superuser and the
   `ALTER` fails:

   ```sql
   ALTER ROLE practice_manager_app WITH LOGIN NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '…';
   GRANT USAGE ON SCHEMA public TO practice_manager_app;
   SELECT rolsuper, rolbypassrls FROM pg_authid WHERE rolname = 'practice_manager_app';
   ```

3. Point `DATABASE_URL` at `practice_manager_app.<project-ref>.<pooler-host>:6543`.
4. Redeploy. Vercel applies environment changes to new deployments only.

Do not skip step 1. The constrained login has no `CREATE` on `schema public`, so a table the app
would have created lazily cannot be created at all, and `db:prepare` cannot be run through that
credential — keep the owner URL for it.

A new route that opens a plain connection and touches a registry table loses its rows the moment the
login changes: no `app.current_domain`, and the policies fail closed rather than open.
`rls:coverage --fail-on-unwired` in CI is what stops one being added silently. Routes that live in the
private overlay (`settings/domain-homepage`, `domain-a/import`) are classified after the prebuild
overlay sync, so their wiring has to happen in that repository.

### When it bites

| Symptom | Cause | Fix |
|---|---|---|
| Settings read as empty/null, no error | Tables missing and the connection cannot create them | Run `db:prepare` for that environment |
| `500` from a settings route | Same, on a path that does not guard the read | Same |
| RLS Check: "N tables have no policies" | A table was created by the app; `lib/supabaseRls.js` enables RLS but installs no policy (only the Tasks ledger installs its own as it creates the table) | `npm run db:prepare` |
| `must be owner of table <queue table>` on a job request | Lazy DDL on a queue table owned by the worker, run through a constrained role | Was a bug; the upgrade is now skipped. Run `db:prepare` to apply the schema |
| `must be owner of table service_agreement_items`, `case_usage`, `quote_items`, `patients`, `patient_files`, `activities` or a `patient_*_jobs` queue | `CREATE INDEX` / `ALTER TABLE` issued unconditionally by a table initialiser, run as the runtime role | Was a bug; those initialisers now probe the table and treat the index DDL as optional. Run `db:prepare` so the indexes exist |

The runtime still creates the settings tables when they are missing, so a freshly provisioned
database degrades to defaults instead of throwing. That is a fallback, not the migration path: it
costs one probe per process (cached once the tables exist), and it cannot install policies. Adding a
CI migration job would remove the manual step; it was deliberately left out for now.

Lazy schema upgrades the runtime issues on its queue tables — `ADD COLUMN`, `CREATE INDEX`,
`ALTER COLUMN … DROP NOT NULL`, and the `ENABLE ROW LEVEL SECURITY` that
[lib/supabaseRls.js](../src/lib/supabaseRls.js) runs after every `CREATE TABLE` — are best-effort.
A role that does not own the table is refused with SQLSTATE 42501 (`must be owner of table …`)
even when the change is already in effect, so
[lib/pgOptionalDdl.js](../src/lib/pgOptionalDdl.js) skips the upgrade and warns once instead of
failing the request. The write that follows surfaces a missing column on its own.

The patient initialisers (`patientCasesTable`, `patientServiceAgreementsTable`,
`patientQuotesTable`, `patientsTable`, `patientFilesTable`, `patientTranscriptionsTable`,
`activitiesTable` and the queue helpers) follow the same rule: the `CREATE TABLE` runs only when
`whenTablesMissing()` reports the table absent — `CREATE TABLE IF NOT EXISTS` still asks for CREATE
on the schema — and every `CREATE INDEX`, `ALTER TABLE`, `ENABLE/FORCE ROW LEVEL SECURITY` and
inline policy goes through `runOptionalDdl()`. On a provisioned database all of them are no-ops, so
a constrained runtime role issues no DDL at all.

## Hosted PostgreSQL

1. Create a dedicated login role with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
2. Apply schema, grants, and policies using a separate owner/migration credential (`npm run rls:policies`).
3. Set `DATABASE_URL` to the constrained login role. Do not expose the owner credential to the application runtime.
4. Leave `POSTGRES_RLS_RUNTIME_ROLE` unset when `DATABASE_URL` already connects as the constrained role.
5. Run the integration test against a non-production database before enabling traffic.

The runtime table initializer still requires owner-level DDL access. See
[Migrating a deployment](#migrating-a-deployment): schema and policies are applied by an operator
with the owner credential, and a constrained `DATABASE_URL` must only be set once `db:prepare` has
run against that database.

### Before switching the runtime role

Policies fail closed: an unset `app.current_domain` matches no rows. Only the patient-file routes use
[`withPostgresRlsContext`](../src/lib/postgresRlsContext.js) today, so every other tenant route must
adopt it before the role change, or its queries will return empty results.

- Public routes (booking, intake, waitlist offers) have no admin token. They must set
  `app.current_domain` from the resolved request host, and for offers from the domain already bound
  into the signed token.
- Per-user values live in `user_settings`. `applySessionRlsContext` sets `app.current_username` when a
  caller passes one (`getDomainBoundConnection(domain, { username })`), and the appSettings user helpers
  do exactly that. Notification delivery needs to read other admins' rows, which the per-user policy
  forbids for a browser session, so that one path runs as an operator (`getSuperAdminConnection`).
- Tables created lazily at runtime are RLS-enabled by `src/lib/supabaseRls.js`. `task_entries` installs
  its domain policy as it creates the table ([lib/taskEntries.js](../src/lib/taskEntries.js)); any other
  table an initialiser adds still needs `npm run rls:policies` after the application has created its schema.

## Request context

The API derives the domain and role from the verified admin token. PostgreSQL receives them through transaction-local settings:

- `app.current_domain`
- `app.current_role` (`admin` or `superadmin`)
- `app.current_username` (per-admin and per-user tables; empty string when the caller did not name one)

The `patient_files_domain_policy` permits admins only when the row domain matches `app.current_domain`. Superadmins may access all domains, while API queries still select the requested domain.