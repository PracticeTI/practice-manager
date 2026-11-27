# Versioning & Releases

This repository uses [semantic-release](https://semantic-release.org/) to derive versions
automatically from commit messages. Nobody edits the version by hand.

## How a version is chosen

`release.config.mjs` reads [Conventional Commits](https://www.conventionalcommits.org/) landed on
the `main` branch since the last release and picks the next version from them:

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
`Merge pull request #47 from contributor:preview` and the `chore: merge main into preview`
back-merge are harmless.

## Branches

| Branch | Role |
| --- | --- |
| `preview` | Integration and sign-off. Feature pull requests land here; the Preview deployment is the pre-production gate. A push to it runs the `Lint` and private-overlay gates but publishes nothing. A repository ruleset requires `Supabase Preview`, `Lint`, `Schema`, `Private overlay` and `Secrets` before a pull request can merge; direct pushes are still possible, so the push-time gates remain the backstop. |
| `main` | Production. Promotions from `preview` land here, and so does the release pull request that turns what landed into a version. Classic branch protection requires `Lint` and `Private overlay` and refuses direct pushes; no release step bypasses it. |
| `release/next` | The next release — the version bump and CHANGELOG entry — rebuilt from `main` on every push to it and merged back through a pull request. Bot-owned: never commit to it. |

GitHub's **default branch is `preview`**, so a new pull request targets the integration branch
instead of production. Vercel's production branch is a separate setting and stays `main`: the two
are independent, and they must stay that way. Vercel applies a Preview environment variable to every
branch that is not its production branch, so pointing Vercel's production branch at `preview` would
flip the overlay variables — `preview` would build with the Production values and `main` would build
as a preview. `main` keeps a ruleset that refuses its deletion; the default branch is the only branch
GitHub protects that way on its own.

Releases were cut on `preview` until [#35](https://github.com/PracticeTI/practice-manager/issues/35).
That published a stable version ahead of the sign-off gate, so "released" could mean "not deployed",
and a revert before promotion burned a version. New tags land on `main`; `v1.2.0` was the last one
cut on `preview` and arrives on `main` with the first promotion after the switch, without being
released a second time — the tag already exists.

Because only `main` cuts releases, a `feat:` or `fix:` merged into `preview` stays unreleased until
the promotion request merges.

## How a release is cut

`main` only takes pull requests and requires the `Lint` and `Private overlay` checks, so
semantic-release cannot push its release commit there. `@semantic-release/git` used to try, and the
push was rejected with `GH006: Protected branch update failed` ([#50](https://github.com/PracticeTI/practice-manager/issues/50)).
A release is therefore two pushes to `main`, and the repository itself records which half comes next:

1. **A promotion merges.** The `Release PR` job asks semantic-release, in dry-run mode, for the next
   version and its release notes, writes them into the manifests and [CHANGELOG.md](../../CHANGELOG.md),
   and opens — or refreshes — `release/next` as a pull request into `main`.
2. **That pull request merges.** `main` now carries a `package.json` version with no matching
   `v<version>` tag. That mismatch is what the `Publish` job waits for: it tags the merge commit and
   creates the GitHub Release, and pushes no commit to `main` at all.

A push that only adds commits is never published on its own, and a release whose publish failed is
retried by the next push to `main` — or by running the workflow manually — because the version is
still untagged. `scripts/semantic-release/verify-release-version.mjs` fails the publish before the
tag if the commits analyse to a version other than the one on `main`, so the tag, `package.json` and
the changelog entry cannot drift apart.

The release pull request is opened by `RELEASE_TOKEN` rather than the workflow's `GITHUB_TOKEN`:
GitHub starts no workflow for a pull request created with `GITHUB_TOKEN`, so the required checks
would never report. The token only needs to push a branch and open a pull request — it does **not**
need to bypass `main`'s protection, because nothing is pushed to `main` any more.

## What happens on a release

A release-worthy commit reaching `main` runs
[.github/workflows/release.yml](../../.github/workflows/release.yml), which has four jobs:

**`Lint`** runs `npm run lint` (`eslint .`). It exits non-zero on any lint *error*, and both release
jobs are gated on it with `needs: lint`, so a lint regression fails the workflow instead of shipping
inside a published release. Lint warnings do not fail the build. The same check also runs on pull
requests via [.github/workflows/ci.yml](../../.github/workflows/ci.yml), and on every push to
`preview` — together with the private-overlay guard, because the `preview` ruleset gates merges, not
direct pushes, so a push there would otherwise never be scanned.

**`Release PR`** runs [release-pr.mjs](../../scripts/semantic-release/release-pr.mjs) on every push
to `main`. semantic-release runs in dry-run mode, so this half computes the release without tagging
or publishing anything:

1. Computes the next version and generates release notes from the commits since the last tag.
2. Writes the version into `package.json` and `apps/core/package.json`, refreshes the lockfile, and
   prepends the notes to [CHANGELOG.md](../../CHANGELOG.md) — the writes
   `@semantic-release/changelog` and `@semantic-release/npm` used to make during the release itself.
3. Commits them as `chore(release): <version>` on `release/next` and opens or updates a pull request
   into `main`.

The commit deliberately carries no `[skip ci]`. GitHub applies that keyword to every workflow for a
pull request whose head commit contains it, so a commit carrying it would leave the release
request's own required checks unreported. Closing the request publishes nothing.

**`Publish`** runs `semantic-release` on a push whose `package.json` version has no tag. It tags the
merge commit `v<version>` and creates the GitHub Release with the notes it generated for it.
`release.config.mjs` has no prepare step left — no changelog, version bump or commit — because all of
that is already on `main`; it analyses the commits, checks the version, and tags. It uses the
workflow's own `GITHUB_TOKEN`, which is enough for a tag.

**`Merge main into preview`** back-merges `main` into `preview` after a successful publish. The
release pull request only merges into `main`, so this is what keeps `preview` carrying the version
and CHANGELOG it wrote. Without it the next promotion conflicts on `package.json` and the Preview
deployment keeps reporting the previous version. A conflicting back-merge fails the job with nothing
pushed; resolve it locally with a normal `main` → `preview` merge.

Nothing is published to the public npm registry — `package.json` is `"private": true`, so the npm
plugin is not part of the release at all.

Only `main` tags a release. A promotion whose commits were already tagged creates no second release,
because the version on `main` already has its tag.

## App version in the UI

[next.config.js](../../apps/core/next.config.js) exposes `NEXT_PUBLIC_APP_VERSION` from the `package.json`
version, which the release pull request keeps current, and the admin/public footers render it as
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
- Do not edit the `version` field in `package.json`, hand-edit released entries in `CHANGELOG.md`,
  or commit to `release/next`. The release pull request regenerates all three on every push to
  `main`.
- Do not commit git tags with the `v<major>.<minor>.<patch>` shape by hand; semantic-release uses
  them to find the previous release, and whether `package.json` has been tagged is what decides
  which half of a release runs next.

## Previewing a release without publishing

Run the `Release` workflow manually (Actions → Release → Run workflow) with **dry_run** enabled.
It prints the version semantic-release would publish and the release notes it would generate,
without writing anything, opening a pull request, or creating a tag.

## Troubleshooting

**The workflow fails with `RELEASE_TOKEN is not set`.** The release pull request has to be opened by
an actor, not by the workflow's `GITHUB_TOKEN`: GitHub starts no workflow for a pull request created
with `GITHUB_TOKEN`, so the `Lint` and `Private overlay` checks `main` requires would never report
and the request could never merge. Create the `RELEASE_TOKEN` repository secret from a fine-grained
PAT for an account with `contents: write` and `pull-requests: write`. It needs no bypass — nothing
is pushed to `main` — and no `issues: write`: the release comments and labels are posted by the
`Publish` job's own `GITHUB_TOKEN`, whose permissions that job sets.

**The release pull request never gets its checks.** It was created without triggering a workflow,
which only happens when the request came from `GITHUB_TOKEN` rather than a PAT. Close it, fix
`RELEASE_TOKEN`, and re-run the `Release PR` job — it updates the existing request instead of
opening a second one.

**`Publish` failed after the tag was created.** The version is tagged but has no GitHub Release, so
later pushes only run `Release PR`. Publish the release for the tag by hand,
`gh release create v<version> --notes-file <notes>`, or delete the tag and re-run the workflow.

**`package.json is at X, but the commits on this branch analyse to Y`.** A release only publishes
the version its release pull request merged, and `main` now carries commits that would release
something else. Re-run the `Release PR` job, merge what it opens, and let `Publish` run again.

**No release is created.** That is expected when the new commits are all non-release types
(`docs:`, `chore:`, `refactor:` …), when the same commits were already released on `preview` before
the switch, or when the promotion contained no release-worthy commit. The `Release PR` job logs
`No release-worthy commits since v<version>`.

**`Error: ERELEASEBRANCHES`.** semantic-release was run on a branch other than `main`.

**A request is blocked on `Lint` / `Private overlay`.** Those checks are required on `main`, and
GitHub starts no `pull_request` workflow at all when the pull request's head commit message contains
`[skip ci]` (or `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]`) **anywhere in the
message, not just in the subject** — so a body that merely mentions the keyword suppresses the run
too, and the checks stay "Expected". Push a normal commit to `preview` to give a promotion request a
new head commit, and let the release request be regenerated from `main`; do not add the keyword to a
commit message.

## Adding a verification gate

Releases are gated on `npm run lint`: the `Lint` job runs it, and both `Release PR` and `Publish`
declare `needs: lint`. They are **not** gated on `npm test` — CI runs only the two privacy suites.
What ships is what the release pull request carries, so the natural place for anything heavier is
[.github/workflows/ci.yml](../../.github/workflows/ci.yml), which already reports the checks `main`
requires: a regression there keeps the request from merging. A gate that must also hold at tag time
is another job that `publish` declares `needs:`, following the
[upstream recipe](https://semantic-release.org/recipes/ci-configurations/github-actions/).
