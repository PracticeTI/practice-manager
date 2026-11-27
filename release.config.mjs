/**
 * semantic-release configuration — the publish half of a release.
 *
 * Version numbers are derived from the Conventional Commits landed on the release branch, so
 * commit messages are the source of truth: `fix:` -> patch, `feat:` -> minor, and a `!` or
 * `BREAKING CHANGE:` footer -> major. See docs/developer-guide/versioning.md.
 *
 * `main` is protected, so a release cannot push its version commit into it. The version bump and
 * the CHANGELOG entry are therefore prepared ahead of time on a `release/next` branch that reaches
 * `main` through a pull request (scripts/semantic-release/release-pr.mjs). This configuration runs
 * once that pull request has merged, and only tags the merge commit and publishes the GitHub
 * Release: the manifests and the changelog are already on `main` by then, so nothing is written or
 * pushed back to the branch. That is why no `@semantic-release/changelog`, `@semantic-release/npm`
 * or `@semantic-release/git` step remains: each of them would duplicate that commit or try to push
 * it to `main` again.
 *
 * @type {import('semantic-release').GlobalConfig}
 */
const config = {
  branches: ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    // The `conventionalcommits` preset is pinned to 9.x on purpose: 10.x rejects the
    // conventional-changelog-writer@8 that @semantic-release/release-notes-generator@14 installs
    // ("requires conventional-changelog-writer@9 or newer") and fails every release.
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    // The version is written by the release pull request, so refuse to tag any other one.
    './scripts/semantic-release/verify-release-version.mjs',
    // Creates the GitHub Release for the tag semantic-release itself creates and pushes.
    '@semantic-release/github',
  ],
}

export default config
