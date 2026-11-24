/**
 * semantic-release configuration.
 *
 * Version numbers are derived from the Conventional Commits landed on the release branch, so
 * commit messages are the source of truth: `fix:` -> patch, `feat:` -> minor, and a `!` or
 * `BREAKING CHANGE:` footer -> major. See docs/developer-guide/versioning.md.
 *
 * The repository has a single version across all workspaces, so the release commits touch the
 * root manifests plus the app manifest that `next.config.js` reads its version from.
 *
 * @type {import('semantic-release').GlobalConfig}
 */
const config = {
  // Releases are cut from the integration branch, not `main`.
  branches: ['preview'],
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    // The `conventionalcommits` preset is pinned to 9.x on purpose: 10.x rejects the
    // conventional-changelog-writer@8 that @semantic-release/release-notes-generator@14 installs
    // ("requires conventional-changelog-writer@9 or newer") and fails every release.
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    [
      '@semantic-release/changelog',
      { changelogFile: 'CHANGELOG.md', changelogTitle: '# Changelog' },
    ],
    [
      '@semantic-release/npm',
      // This package is deployed from the repository rather than distributed via npm, but the
      // plugin is still required: its prepare step is what writes the version into package.json
      // (and package-lock.json), which is what the app reads at build time.
      { npmPublish: false },
    ],
    // Runs after @semantic-release/npm so the app manifest follows the version the root just
    // received; the plugin also refreshes the lockfile for the new workspace version.
    './scripts/semantic-release/sync-app-version.mjs',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json', 'apps/core/package.json'],
        // Deliberately no `[skip ci]`: GitHub treats that keyword on a pull request's head commit
        // as "skip every workflow in this run set", including `opened`, `reopened` and
        // `synchronize`. This commit is the tip of `preview`, so it is the head of the
        // preview -> main release pull request, and the keyword would leave `Lint` and
        // `Private overlay` pending forever, blocking the merge. `release.yml` skips the release
        // job for this commit instead.
        message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}',
      },
    ],
    '@semantic-release/github',
  ],
}

export default config
