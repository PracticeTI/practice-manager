# Supabase database branches

Status: branching is **on**. A pull request that touches `packages/db/supabase` gets a Supabase
preview branch built from `packages/db/supabase/migrations` and `seed.sql` — the Supabase Preview
check runs `config`, `migrations` and `seeding` on every push, and fails the pull request when a
migration does not apply — and the Vercel project receives that branch's credentials, so the
preview deployment uses the branch instead of the shared preview database. Production and
Development are not synced on purpose: production keeps its own `DATABASE_URL` and its constrained
`practice_manager_app` login, and local development keeps the Supabase CLI stack in `.env.local`.
The repository has a `preview` ruleset that requires these checks — it blocks a merge on
`Supabase Preview`, `Lint`, `Schema`, `Private overlay` and `Secrets`. Still open: the hosted
baseline adoption in the checklist below, which is also what lets **Deploy to production** be
turned on.

Database branches give each pull request its own PostgreSQL, so a change that alters a table
shape cannot repair or break the shared preview database. The reasoning for wanting them, and
why per-PR Vercel deployments are not a substitute for the preview environment, is in
[deployment-topology.md](../../apps/core/docs/deployment-topology.md).

## Layout

| Path | Role |
|------|------|
| [`config.jsonc`](../../packages/db/supabase/config.jsonc) | Published config-as-code. Only declared properties are pushed to a project or branch, so a section this deployment does not use is left exactly as the base project has it. |
| [`migrations/`](../../packages/db/supabase/migrations) | The migration of record for every environment. A branch is built from these files alone — the base project's schema is never cloned — and the app's runner applies the same files to Docker, LAN and desktop installs. |
| [`seed.sql`](../../packages/db/supabase/seed.sql) | Applied after migrations by `supabase db reset` and on every preview branch. |

## How the app applies them

[`apps/core/src/lib/migrations.js`](../../apps/core/src/lib/migrations.js) is the runner behind
`npm run db:init`. It applies files in version order, records them in
`public.schema_migrations`, and treats a database that already has the schema but no history as
adopted rather than replaying the baseline over existing tables. It also reads
`supabase_migrations.schema_migrations` when that table exists, so running it against a Supabase
branch is a no-op instead of a second attempt at the baseline.

The SQL is plain PostgreSQL 14 DDL: no `auth` schema, no `supabase_migrations`, no `vault`. That
is what keeps desktop, Docker and LAN installs working from the same files. The baseline creates
the `practice_manager_app` role without LOGIN so the policies have something to name; a
deployment gives it a login out of band
([postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md)).

`npm run db:init -- --bootstrap` additionally runs the legacy per-table steps. Treat it as a
diagnostic: on a migrated database they are no-ops except for per-user permissive policies on
queue tables named after the connecting role, which the baseline deliberately does not create.
`npm run db:check-drift` snapshots the catalog around that run and fails on any other difference,
so a table added to an initialiser cannot silently exist on one machine and be missing from every
branch. The CI `Schema` job runs it against the database it built from migrations.

`20261126040000_runtime_role_default_privileges.sql` carries the baseline's grants to objects a
later migration creates: table and sequence privileges for `practice_manager_app`, and no
`EXECUTE` on new functions for `PUBLIC`. A branch starts secure by default and never copies the
base project's ACLs, so without it a new table would be invisible to the app on a branch. It does
not touch `anon`, `authenticated` or `service_role`; the defence-in-depth revoke for those is in
[postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md).

`20261126050000_runtime_role_membership.sql` makes the role that applies the migrations a member
of `practice_manager_app`. That is what lets a preview deployment assume the runtime role: the
Supabase Vercel integration gives it the branch's `postgres` URL, which is neither a superuser
nor — without this grant — able to run the `SET LOCAL ROLE practice_manager_app` that
`POSTGRES_RLS_RUNTIME_ROLE` triggers, so every RLS-bound route returned 500 on a branch.

There is no `packages/db/migrations`: the CLI fixes the path to `supabase/migrations` inside the
working directory, and the old placeholder would be a second home nothing replays.

`supabase/` is public and replayed on every branch. Two checks apply to it:
`npm run private:guard --workspace @practice-manager/core` refuses private domain names
([CONTRIBUTING.md](../../CONTRIBUTING.md#repository-hooks)) and
[`.gitleaks.toml`](../../.gitleaks.toml) refuses inline credentials.

## Dashboard settings

- **Working directory:** `packages/db`. This is the folder that *contains* `supabase/` — not
  `packages/db/supabase`, and not an absolute or leading-slash path.
- **Automatic branching:** on.
- **Supabase changes only:** on. Without it, a pull request that touches only app code still
  clones a database per commit.
- **Deploy to production:** off until the hosted baseline is adopted, then on. See the checklist.

The integration adds a **Supabase Preview** check to each pull request, and the `preview` ruleset
requires it along with `Lint`, `Schema`, `Private overlay` and `Secrets`. A migration that fails
there cannot merge and so cannot break every later branch. The ruleset gates merges only; direct
pushes to `preview` are still possible, so the push-triggered `Lint` and private-overlay gates in
[release.yml](../../.github/workflows/release.yml) remain the backstop.

## What runs on a branch

`configure` → `migrate` → `seed` → `deploy`, in that order, on creation and again on every push
to the git branch:

- `configure` applies the `db`, `api`, `auth`, `storage` and `experimental` sections of
  `config.jsonc` on top of the settings copied from the base project.
- `migrate` applies every file in `supabase/migrations` the branch has no history entry for,
  each inside one transaction. `CREATE INDEX CONCURRENTLY` fails there even though `supabase db
  push` accepts it.
- `seed` runs `seed.sql`.
- `deploy` handles Edge Functions, which this repository does not use.

## Adopting the baseline on the hosted project

The hosted project already has the schema, so it must record the baseline as applied before
`db push` runs — otherwise the first push tries to recreate existing tables. Run this once, with
the owner credential, before enabling **Deploy to production**.

Use the direct connection (`db.<ref>.supabase.co:5432`) — Supabase lists migrations and `pg_dump`
as direct-connection work — or the shared pooler in **session** mode
(`<pooler-host>:5432`) when the network is IPv4-only. Never the transaction pooler (port 6543):
it does not carry session state between statements, so migration DDL and the advisory locks
around it are not safe there. Percent-encode the password if it contains reserved characters.

```bash
# Record the baseline without running it, then apply only the migrations that came after it.
npx supabase@latest --workdir packages/db migration repair \
  --status applied 20261126033000 --remote="$SUPABASE_OWNER_URL" --yes

# Confirm the plan before writing anything: it should list exactly the two later migrations.
npx supabase@latest --workdir packages/db db push \
  --include-all --dry-run --remote="$SUPABASE_OWNER_URL" --yes

npx supabase@latest --workdir packages/db db push \
  --include-all --skip-vault --remote="$SUPABASE_OWNER_URL" --yes

npx supabase@latest --workdir packages/db migration list --linked
```

`--remote` accepts the connection URL, so no `supabase link` and no access token are needed; the
`link` form is only required for commands that talk to the Management API.

`db push` applies each remaining file in one transaction. Do not mark
`20261126040000_runtime_role_default_privileges.sql` as applied with `migration repair`: it has
not run on the hosted project yet, and it is what gives later migrations' objects their grants.

Do not run `npm run db:init` against the hosted project to do this either. Its runner adopts every
pending file when it finds the app's schema but no history, so the first run would record both
remaining migrations as applied without executing them, and `db push` would then skip them.
Repair the baseline first and let `db push` apply the rest.

Do not use `supabase db pull` as the pre-flight check against the hosted project: it writes the
difference as a migration file **and records it in that database's migration history**, which
leaves production with a migration that exists nowhere in the repository. Compare the live catalog
with the baseline instead — table set, `relrowsecurity`, policy counts and the runtime role's
grants — or diff a dump taken with `pg_dump --schema-only` outside the repository.

Compare in both directions. The hosted project can be *behind* the migrations, because it only
gains a table when `db:init` runs or a route creates one at runtime, and *ahead* of them, because
many routes create their table with `CREATE TABLE IF NOT EXISTS` and the baseline captured only
what `db:init` builds. Repair the baseline only when every object the migrations create exists on
the hosted project; a table the migrations lack belongs in a migration first — and it needs its
policy too, because a lazily created table gets `ENABLE ROW LEVEL SECURITY` but no policy on a
branch, where `db:prepare` never runs.

Turning **Deploy to production** on before the repair fails the other way round: the next push to
the production branch makes the integration apply the baseline to a database that already has
every table. Each file runs in one transaction, so nothing is lost, but every promotion fails
until the history is repaired.

## Pointing a preview deployment at its branch

Installed: the Supabase Vercel integration writes each preview branch's credentials into the
Vercel project as variables scoped to that git branch (`Preview (<branch>)`). Nothing is copied
into Production or Development, and a branch-scoped variable cannot reach a deployment of another
branch, so production's `DATABASE_URL` is never in play. The set is written when the pull request
opens, not when the branch is created.

[`apps/core/src/lib/database.js`](../../apps/core/src/lib/database.js) prefers `POSTGRES_URL` over
`DATABASE_URL`, so a preview deployment follows its branch with no code change. Do not also set
`POSTGRES_URL` by hand for Preview, and keep Production out of the integration: a production
`POSTGRES_URL` would beat the constrained `practice_manager_app` `DATABASE_URL` and make the
runtime login an owner that bypasses every policy. The integration can restore a deleted variable
on a re-install or a re-sync, so re-check the Production scope after either. That URL is the
transaction-mode pooler (port 6543); re-read the pooler caveat in
[postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md) before relying on
session-level `SET` state there.

The branch connection logs in as the branch's `postgres`, not as the runtime role, and
`POSTGRES_RLS_RUNTIME_ROLE` is set on the preview project. That works because
`20261126050000_runtime_role_membership.sql` makes the migrating role a member of
`practice_manager_app`, so the `SET LOCAL ROLE` succeeds.
`rls:verify` also needs that membership: run it with the branch URL and the same
`POSTGRES_RLS_RUNTIME_ROLE`, and it probes as the constrained role instead of warning that the
login bypasses every policy.

A branch with no schema and no data is indistinguishable from a broken app, so check the
database, not just the health endpoint. Supabase redeploys the pull request after it writes the
variables, so the first preview deployment can be built without `POSTGRES_URL` and serve from the
shared preview database — read the latest deployment, not the first:

```bash
vercel env pull --environment preview --git-branch <branch>
POSTGRES_RLS_RUNTIME_ROLE=practice_manager_app \
  node --env-file=.env.preview apps/core/scripts/rls-verify.mjs --env POSTGRES_URL --domain default
```

Two results say the branch is real and closed. `rls:verify` connects as `practice_manager_app`
with `rls enforced: yes`, reports only `content` readable across domains, and lists the tables the
migrations built. The branch's Data API refuses `anon` on every one of those tables, because a
branch starts with no grants — so an app that boots is not proof, and a reading anon key would be
the alarm. The URL the integration writes carries `?sslmode=require`, which `pg` now treats as
`verify-full` and fails against the pooler's chain; drop the query string when the script builds
its own `pg` config, as `rls-verify` does.

## Enablement checklist

Items 1 and 2 are done; 3–5 are still open.

1. **Baseline migration.** Done: `20261126033000_baseline.sql` is a dump of a database built by
  `db:init` + `db:prepare`, and applying it to an empty database reproduces that schema
  byte-for-byte. It was captured on PostgreSQL 14; if the hosted project runs a newer major
  version, check the policy and grant statements still apply cleanly (`supabase db reset` on a
  matching local stack) before enabling.
2. **RLS policies and grants.** Done: the policies, the `ENABLE ROW LEVEL SECURITY` toggles and
  the grants to `practice_manager_app` are in the baseline, because a branch never runs
  `npm run db:prepare`; `20261126040000_runtime_role_default_privileges.sql` extends those
  grants to objects a later migration creates. A Supabase project grants `anon` and
  `authenticated` full DML on every public table, so a branch that arrived without policies
  would be open to the anon key wherever the Data API is reachable — the exposure and the revoke
  are described in [postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md).
  Verify with `npm run rls:verify` against the branch: a branch is secure by default, so an app
  that boots is not proof that its tables and grants arrived.
3. **Production branch and Deploy to production.** The integration maps one GitHub branch to the
  base project. The base is the only Supabase project, so it is production; releases are cut from
  `main` and pull requests target `preview`. Set the production branch to `main`, and turn
  **Deploy to production** on only after the hosted baseline is adopted — then a merge to `main`
  applies migrations that already built on a branch, which is the point of the exercise. Before
  the repair it does the opposite: the next promotion tries to replay the baseline over existing
  tables and fails.
4. **Postgres version.** `config.jsonc` does not pin `db.major_version`, so the CLI default
  applies. Set it to the hosted project's `SHOW server_version` if they differ, or `db pull` and
  `db reset` will disagree with the server.
5. **Data API and Auth posture.** `config.jsonc` declares neither, so branches inherit the base
  project. The app talks to PostgreSQL through `pg` and runs its own auth and file storage;
  decide whether a branch should keep the Data API at all rather than inherit it.

## Commands

Run from the repository root:

```bash
npx supabase@latest --workdir packages/db status
npx supabase@latest --workdir packages/db config diff
npx supabase@latest --workdir packages/db migration list --linked
npx supabase@latest --workdir packages/db migration repair --status applied <version> --remote="$SUPABASE_OWNER_URL"
npx supabase@latest --workdir packages/db db push --include-all --dry-run --remote="$SUPABASE_OWNER_URL"
npx supabase@latest --workdir packages/db db push --include-all --skip-vault --remote="$SUPABASE_OWNER_URL"

# Writes the difference as a migration file and records it in the remote history — never point
# this at a database whose history you are trying to keep equal to the repository.
npx supabase@latest --workdir packages/db db pull --remote="$SUPABASE_OWNER_URL"

npm run db:init --workspace @practice-manager/core          # apply the same files locally
npm run db:check-drift --workspace @practice-manager/core   # initialisers vs migrations
```

`supabase link` writes its state to `supabase/.temp/` and `supabase/.branches/`; the repository
`.gitignore` covers both at any depth, so a nested working directory is safe.

`supabase status` is the offline parse check: a malformed `config.jsonc` reports
`StatusConfigLoadError` before it looks for Docker.

## Why `packages/db`

- The database is shared by `apps/core`, `apps/runtime` and `packages/jobs`. Putting the schema
  of record under one app's build root would place a shared artifact inside that app.
- Both guards that write about this directory already assume the nested layout:
  `.gitignore` names `packages/db/supabase` and
  [`privateOverlayGuard.test.js`](../../apps/core/test/privateOverlayGuard.test.js) uses it as
  the nested-project fixture.
- `packages/db` is already documented as the home for the identity migration of record
  ([auth roadmap](../roadmap/auth.md)).
