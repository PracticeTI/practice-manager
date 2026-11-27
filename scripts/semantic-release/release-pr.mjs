/**
 * Open — or refresh — the pull request that carries the next release into `main`.
 *
 * `main` requires a pull request and the `Lint` and `Private overlay` checks, so semantic-release
 * cannot push its release commit there; pushing to the branch is rejected however the token is
 * scoped, short of adding a bypass actor. This script runs in the `Release` workflow on every push
 * to `main` instead: it asks semantic-release, in dry-run mode so that nothing is tagged or
 * published, for the next version and its release notes, writes them onto a `release/next` branch
 * (`write-release-files.mjs`) and opens that branch as a pull request. The publish job tags the
 * merge commit once the pull request merges.
 *
 * The branch is rebuilt from `main` on every push, so it is force-pushed: do not commit to it.
 */

import { execFileSync } from 'node:child_process'

import semanticRelease from 'semantic-release'

import { readReleaseState } from './release-state.mjs'
import { RELEASE_MANIFESTS, writeReleaseFiles } from './write-release-files.mjs'

const BASE_BRANCH = 'main'
const RELEASE_BRANCH = 'release/next'
const ASSETS = ['CHANGELOG.md', 'package-lock.json', ...RELEASE_MANIFESTS]

const BOT_NAME = 'github-actions[bot]'
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'

const cwd = process.cwd()
const dryRun = process.argv.includes('--dry-run')
const logger = { log: (...args) => console.log(...args) }

function git(args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...options })
}

function gh(args) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // `gh` reads GH_TOKEN; the workflow supplies the actor that also pushes the branch.
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN },
  })
}

async function main() {
  const state = readReleaseState(cwd)

  if (state.pending) {
    logger.log(
      `package.json is at ${state.version} and the latest tag is ${state.latestTag}: that release is merged but not published, so the publish job owns this push.`
    )
    return
  }

  const next = await semanticRelease(
    { dryRun: true },
    { cwd, env: { ...process.env }, stdout: process.stdout, stderr: process.stderr }
  )

  if (!next) {
    logger.log(
      `semantic-release would not prepare a release since ${state.latestTag ?? 'the first commit'} — its log above says why; nothing to open.`
    )
    return
  }

  const { version, notes } = next.nextRelease
  if (!notes) throw new Error(`semantic-release computed ${version} without release notes`)

  if (dryRun) {
    logger.log(`Would open a release pull request for ${version}:\n\n${notes}`)
    return
  }

  git(['checkout', '--force', '-B', RELEASE_BRANCH], { stdio: 'inherit' })
  await writeReleaseFiles({ cwd, version, notes, logger })

  git(['add', '--', ...ASSETS])
  if (git(['status', '--porcelain', '--', ...ASSETS]).trim() === '') {
    logger.log(`${BASE_BRANCH} already carries the ${version} release commit; nothing to push.`)
    return
  }

  // The message is the one the release commit used to carry. No `[skip ci]` anywhere in it: GitHub
  // suppresses every workflow for a pull request whose head commit mentions the keyword, which
  // would leave this request's required checks unreported.
  const releaseEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
  }
  git(['commit', '-m', `chore(release): ${version}`, '-m', notes], { env: releaseEnv, stdio: 'inherit' })
  git(['push', '--force', 'origin', `HEAD:${RELEASE_BRANCH}`], { env: releaseEnv, stdio: 'inherit' })

  const open = JSON.parse(
    gh(['pr', 'list', '--head', RELEASE_BRANCH, '--state', 'open', '--json', 'number'])
  )

  const title = `chore(release): ${version}`
  const body = [
    `Merging this pull request publishes **${version}**: the \`v${version}\` tag and the GitHub Release`,
    'are created from the merge commit, and nothing is pushed back to `main`.',
    '',
    'The branch is rebuilt from `main` on every push to it, so do not commit to this branch.',
    '',
    notes,
  ].join('\n')

  if (open.length > 0) {
    gh(['pr', 'edit', String(open[0].number), '--title', title, '--body', body])
    logger.log(`Updated the release pull request #${open[0].number} for ${version}.`)
  } else {
    const url = gh([
      'pr',
      'create',
      '--base',
      BASE_BRANCH,
      '--head',
      RELEASE_BRANCH,
      '--title',
      title,
      '--body',
      body,
    ])
    logger.log(`Opened ${url.trim()} for ${version}.`)
  }
}

await main()
