# Supabase database branches

Status: branching is **on**. A pull request gets a Supabase preview branch built from
`packages/db/supabase/migrations` and `seed.sql` — the Supabase Preview check runs `config`,
`migrations` and `seeding` on every push, and fails the pull request when a migration does not
apply. Two things are still missing before a preview deployment *uses* that branch: the Vercel
project has no `POSTGRES_URL` from the Supabase integration, so previews still connect to the
shared preview database through `DATABASE_URL`, and `preview` has no branch protection, so
neither check is required.

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
- **Deploy to production:** hold until the production-branch question below is settled.

The integration adds a **Supabase Preview** check to each pull request. Make it required; a
migration that fails there otherwise merges and breaks every later branch. `preview` is not
protected today, so no check is required yet — that is a repository setting, not something this
directory can enforce.

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
the owner credential (the pooler URL for `postgres`), before enabling the integration:

```bash
npx supabase@latest --workdir packages/db link --project-ref <ref>

# Optional check: the dump this writes should match the baseline. Delete the generated file
# after comparing; it is not part of the migration history.
npx supabase@latest --workdir packages/db db pull --remote="$SUPABASE_OWNER_URL"

# Record the baseline without running it, then apply only the migrations that came after it.
npx supabase@latest --workdir packages/db migration repair --status applied 20261126033000 --remote <ref>
npx supabase@latest --workdir packages/db db push --include-all
npx supabase@latest --workdir packages/db migration list --linked
```

`db push` applies each remaining file in one transaction. Do not mark
`20261126040000_runtime_role_default_privileges.sql` as applied with `migration repair`: it has
not run on the hosted project yet, and it is what gives later migrations' objects their grants.

## Pointing a preview deployment at its branch

The Supabase Vercel integration writes each preview branch's connection string into the
connected Vercel project as `POSTGRES_URL`. [`apps/core/src/lib/database.js`](../../apps/core/src/lib/database.js)
prefers `POSTGRES_URL` over `DATABASE_URL`, so a preview deployment follows its branch with no
code change — provided the Vercel project does not override `POSTGRES_URL` with the preview
database by hand. That URL is the transaction-mode pooler (port 6543); re-read the pooler
caveat in [postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md) before relying
on session-level `SET` state there.

The branch connection logs in as `postgres`, not as the runtime role, and `POSTGRES_RLS_RUNTIME_ROLE`
is set on the preview project. That works because `20261126050000_runtime_role_membership.sql`
makes the migrating role a member of `practice_manager_app`, so the `SET LOCAL ROLE` succeeds.
`rls:verify` also needs that membership: run it with the branch URL and the same
`POSTGRES_RLS_RUNTIME_ROLE`, and it probes as the constrained role instead of warning that the
login bypasses every policy.

A branch with no schema and no data is indistinguishable from a broken app, so check the
database, not just the health endpoint:

```bash
POSTGRES_URL="<branch pooler URL>" npm run rls:verify --workspace @practice-manager/core -- --domain default
```

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
3. **Production branch.** The integration maps one GitHub branch to the base project. The base
  is the only Supabase project, so it is production; releases are cut from `main` and pull
  requests target `preview`. Set the production branch to `main` and leave **Deploy to
  production** off, so the integration never writes to the production database.
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
npx supabase@latest --workdir packages/db db pull --remote="postgres://postgres.<ref>:<password>@<pooler-host>:5432/postgres"
npx supabase@latest --workdir packages/db migration list --linked
npx supabase@latest --workdir packages/db migration repair --status applied <version> --remote <ref>
npx supabase@latest --workdir packages/db db push --include-all

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
