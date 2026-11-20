# Versioning & Releases

This repository uses [semantic-release](https://semantic-release.org/) to derive versions
automatically from commit messages. Nobody edits the version by hand.

## How a version is chosen

`release.config.mjs` reads [Conventional Commits](https://www.conventionalcommits.org/) landed on
the `preview` branch since the last release and picks the next version from them:

| Commit | Version effect | Example |
| --- | --- | --- |
| `fix: …` | patch (`1.2.3` → `1.2.4`) | `fix: stop double-charging equipment quotes` |
| `feat: …` | minor (`1.2.3` → `1.3.0`) | `feat: add per-admin notification preferences` |
| `feat!: …` or a `BREAKING CHANGE:` footer | major (`1.2.3` → `2.0.0`) | `feat!: drop the /api/database endpoints` |
| `perf:` / `revert:` | patch | `perf: avoid refetching the patient list` |
| `refactor:`, `docs:`, `style:`, `test:`, `build:`, `ci:`, `chore:` | no release | — |

A `BREAKING CHANGE:` footer works on any commit type. The `!` shorthand goes immediately after the
type or scope: `feat!:` or `feat(api)!:`.

Commits that match nothing above are ignored, so merge commits such as
`Merge pull request #47 from contributor:preview` are harmless.

## What happens on a release

Pushing a release-worthy commit to `preview` triggers
[.github/workflows/release.yml](../../.github/workflows/release.yml), which runs two jobs:

**`Lint`** runs `npm run lint` (`eslint .`). It exits non-zero on any lint *error*, and the
`Release` job is gated on it with `needs: lint`, so a lint regression fails the workflow instead of
shipping inside a published release. Lint warnings do not fail the build. The same check also runs
on pull requests via [.github/workflows/ci.yml](../../.github/workflows/ci.yml).

**`Release`** runs `semantic-release`, which:

1. Computes the next version and generates release notes.
2. Creates and pushes the `v<version>` git tag.
3. Commits the new version into `package.json`, `package-lock.json` and `apps/core/package.json`
   and prepends the release notes to [CHANGELOG.md](../../CHANGELOG.md) as
   `chore(release): <version> [skip ci]`.
4. Publishes a GitHub Release.

Nothing is published to the public npm registry — `package.json` is `"private": true` and the npm
plugin is configured with `npmPublish: false`.

Only `preview` cuts releases. Merging `preview` into `main` does not create a second release for
the same commits, because the tag already exists.

## App version in the UI

[next.config.js](../../apps/core/next.config.js) exposes `NEXT_PUBLIC_APP_VERSION` from the `package.json`
version, which semantic-release keeps current, and the admin/public footers render it as
`v<version> · <build time>`. Between releases the version stays constant, which is expected: the
version identifies the release, and the build timestamp identifies the individual deployment.

Because the version is a *release* identifier, it cannot say which **build** is running — every
deployment between two releases carries the same number. `next.config.js` therefore also injects a
build identity, resolved provider-neutrally so the fields keep working when the app moves hosts:

| Field | Source, in order |
| --- | --- |
| `NEXT_PUBLIC_BUILD_COMMIT` | `BUILD_COMMIT_SHA` → `VERCEL_GIT_COMMIT_SHA` → `COMMIT_SHA` (Cloud Build) → `GITHUB_SHA` → `git rev-parse HEAD` |
| `NEXT_PUBLIC_BUILD_REF` | `BUILD_COMMIT_REF` → `VERCEL_GIT_COMMIT_REF` → `GITHUB_REF_NAME` → `git rev-parse --abbrev-ref HEAD` |
| `NEXT_PUBLIC_BUILD_ID` | `BUILD_ID` (Cloud Build) → `GITHUB_RUN_NUMBER` |

Each entry is skipped when empty, so the first value the builder actually supplies wins. The git
fallback covers local builds only: an image that excludes `.git` (see [`.dockerignore`](../../.dockerignore))
has to set `BUILD_COMMIT_SHA` in the build environment instead.

The runtime half — deployment environment, service and revision — cannot be inlined at build time,
so [the setup-status route](../../apps/core/src/app/api/auth/setup-status/route.js) reports it in a `runtime`
block: `APP_ENV`/`VERCEL_ENV`/`NODE_ENV` for the environment label, `K_SERVICE`/`VERCEL_URL` for
the service, and `K_REVISION`/`VERCEL_DEPLOYMENT_ID` for the revision (Cloud Run's revision plays
the role Vercel's deployment id does). The admin header renders both halves for superadmins as a
status block: release and build time, then the runtime service, and finally the deployment identity
(`rev`, `ref`, `build`) on its own line so a long service hostname cannot wrap it out of place.
Set `APP_ENV` on Cloud Run, which has no environment concept of its own.

## Day-to-day rules

- Write Conventional Commit subjects. This is the only input to versioning, so a stray
  `update stuff` commit silently produces no release.
- Do not edit the `version` field in `package.json`, and do not hand-edit released entries in
  `CHANGELOG.md`. The release job overwrites both.
- Do not commit git tags with the `v<major>.<minor>.<patch>` shape by hand; semantic-release uses
  them to find the previous release.

## Previewing a release without publishing

Run the `Release` workflow manually (Actions → Release → Run workflow) with **dry_run** enabled.
It prints the version semantic-release would publish and the release notes it would generate,
without creating a tag, commit, or release.

## Troubleshooting

**The workflow fails pushing to `preview`.** The branch is protected against the workflow's
`GITHUB_TOKEN`. Either allow the GitHub Actions app to bypass the protection, or create a
`RELEASE_TOKEN` repository secret (fine-grained PAT, or a GitHub App installation token with
`contents: write`) — the workflow already prefers it when present.

**No release is created.** That is expected when the new commits are all non-release types
(`docs:`, `chore:`, `refactor:` …), or when the same commits were already released.

**`Error: ERELEASEBRANCHES`.** semantic-release was run on a branch other than `preview`.

## Adding a verification gate

Releases are gated on `npm run lint`: the `Lint` job runs it and `release` declares
`needs: lint`. They are **not** gated on `npm test` — CI runs only the two privacy suites. The full
suite is green (958 passing, 1 skipped), so gating it is one more step in `Lint`, or a separate
`verify` job that `release` needs, following the
[upstream recipe](https://semantic-release.org/recipes/ci-configurations/github-actions/).
