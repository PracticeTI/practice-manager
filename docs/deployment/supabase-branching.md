# Supabase database branches

Status: the project is scaffolded in [`packages/db/supabase`](../../packages/db/supabase), with a
baseline migration that reproduces the schema the app creates, and the GitHub integration is
**not** enabled yet.

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
migration that fails there otherwise merges and breaks every later branch.

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

## Before enabling

1. **Baseline migration.** Done: `20261126033000_baseline.sql` is a dump of a database built by
  `db:init` + `db:prepare`, and applying it to an empty database reproduces that schema
  byte-for-byte. It was captured on PostgreSQL 14; if the hosted project runs a newer major
  version, check the policy and grant statements still apply cleanly (`supabase db reset` on a
  matching local stack) before enabling.
2. **RLS policies and grants.** Done: the policies, the `ENABLE ROW LEVEL SECURITY` toggles and
  the grants to `practice_manager_app` are in the baseline, because a branch never runs
  `npm run db:prepare`. A Supabase project grants `anon` and `authenticated` full DML on every
  public table, so a branch that arrived without policies would be open to the anon key wherever
  the Data API is reachable — the exposure and the revoke are described in
  [postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md).
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
