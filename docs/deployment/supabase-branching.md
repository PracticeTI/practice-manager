# Supabase database branches

Status: the project is scaffolded in [`packages/db/supabase`](../../packages/db/supabase) and the
GitHub integration is **not** enabled. Until the baseline migration lands
([#38](https://github.com/PracticeTI/practice-manager/issues/38)), a branch comes up with an
empty database.

Database branches give each pull request its own PostgreSQL, so a change that alters a table
shape cannot repair or break the shared preview database. The reasoning for wanting them, and
why per-PR Vercel deployments are not a substitute for the preview environment, is in
[deployment-topology.md](../../apps/core/docs/deployment-topology.md).

## Layout

| Path | Role |
|------|------|
| [`config.jsonc`](../../packages/db/supabase/config.jsonc) | Published config-as-code. Only declared properties are pushed to a project or branch, so a section this deployment does not use is left exactly as the base project has it. |
| [`migrations/`](../../packages/db/supabase/migrations) | The migration of record. A branch is built from these files alone — the base project's schema is never cloned. |
| [`seed.sql`](../../packages/db/supabase/seed.sql) | Applied after migrations by `supabase db reset` and on every preview branch. |

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

1. **Baseline migration.** Branching does not clone the base schema, and `schemaBootstrap.js`
  is not part of the replay. Dump the hosted project (`db pull`, below) and commit the result as
  the first migration — see [#38](https://github.com/PracticeTI/practice-manager/issues/38).
2. **RLS policies as migrations.** `npm run db:prepare` installs policies from
  `rlsPolicies.js`, which a branch never runs. A Supabase project grants `anon` and
  `authenticated` full DML on every public table, so tables that arrive without policies are
  open to the anon key whenever the Data API is reachable. The exposure and the revoke are
  described in [postgres-rls-rollout.md](../../apps/core/docs/postgres-rls-rollout.md).
3. **Production branch.** The integration maps one GitHub branch to the base project. This
  repository's pull requests target `preview`, and `preview` already has its own sign-off
  database, while releases are cut from `main`. Either the base project is the preview project
  with `preview` as its production branch, or `main` is the base and `preview` becomes a
  persistent branch through a `remotes` entry in `config.jsonc`. Decide before turning on
  **Deploy to production**.
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
