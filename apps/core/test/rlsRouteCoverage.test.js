import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildRouteCoverage,
  buildRouteCoverageCheck,
  classifyRoute,
  parseRouteCoverage,
} from '../src/lib/rlsRouteCoverage.js'
import { collectRouteCoverage } from '../src/lib/rlsRouteCoverageFiles.js'

const BOUND_SOURCE = `
  const connection = await getDomainBoundConnection({ domain })
  await connection.query('SELECT * FROM "chats" WHERE id = $1', [id])
`

const PLAIN_SOURCE = `
  const connection = await getConnection()
  await connection.query('INSERT INTO appointments (id) VALUES ($1)', [id])
`

test('a route that binds the domain is classified as bound', () => {
  const entry = classifyRoute({ route: 'database/chats', source: BOUND_SOURCE })

  assert.equal(entry.status, 'bound')
  assert.deepEqual(entry.tables, ['chats'])
})

test('a route that opens a plain connection is classified as unwired with its tables', () => {
  const entry = classifyRoute({ route: 'scheduling/confirm', source: PLAIN_SOURCE })

  assert.equal(entry.status, 'unwired')
  assert.deepEqual(entry.tables, ['appointments'])
})

test('operator DDL routes are not reported as unwired work', () => {
  const entry = classifyRoute({ route: 'database/migrate/consolidate-metadata', source: PLAIN_SOURCE })

  assert.equal(entry.status, 'operator')
})

test('a route that never mentions a tenant table is ignored', () => {
  assert.equal(classifyRoute({ route: 'database/health', source: "console.log('ok')" }), null)
  assert.equal(classifyRoute({ route: '', source: PLAIN_SOURCE }), null)
})

test('a superadmin session counts as bound, because it sets the role the policies read', () => {
  const source = `
    const connection = await getSuperAdminConnection()
    await connection.query('SELECT * FROM "chats" WHERE id = $1', [id])
  `
  const entry = classifyRoute({ route: 'database/recent-activity', source })

  assert.equal(entry.status, 'bound')
  assert.deepEqual(entry.tables, ['chats'])
})

test('coverage groups by status and sorts every list by route', () => {
  const coverage = buildRouteCoverage([
    classifyRoute({ route: 'settings/activities', source: PLAIN_SOURCE }),
    classifyRoute({ route: 'database/chats', source: BOUND_SOURCE }),
    classifyRoute({ route: 'database/calendar-connections', source: PLAIN_SOURCE }),
  ])

  assert.equal(coverage.total, 3)
  assert.deepEqual(coverage.unwired.map((entry) => entry.route), ['database/calendar-connections', 'settings/activities'])
  assert.deepEqual(coverage.bound.map((entry) => entry.route), ['database/chats'])
})

test('the build-captured value round-trips, and junk reads as unknown', () => {
  const coverage = buildRouteCoverage([classifyRoute({ route: 'scheduling/confirm', source: PLAIN_SOURCE })])
  const parsed = parseRouteCoverage(JSON.stringify(coverage))

  assert.equal(parsed.total, 1)
  assert.deepEqual(parsed.unwired, coverage.unwired)
  assert.equal(parseRouteCoverage(undefined), null)
  assert.equal(parseRouteCoverage(''), null)
  assert.equal(parseRouteCoverage('{"bound":[]}'), null)
  assert.equal(parseRouteCoverage('not json'), null)
})

test('the coverage check names the count and points at the listed routes', () => {
  const warning = buildRouteCoverageCheck(
    buildRouteCoverage([classifyRoute({ route: 'scheduling/confirm', source: PLAIN_SOURCE })])
  )

  assert.equal(warning.status, 'warn')
  assert.match(warning.detail, /1 of 1 routes/)
  assert.match(warning.detail, /Routes without a domain binding/)

  const passing = buildRouteCoverageCheck(
    buildRouteCoverage([classifyRoute({ route: 'database/chats', source: BOUND_SOURCE })])
  )
  assert.equal(passing.status, 'pass')

  assert.equal(buildRouteCoverageCheck(null).status, 'warn')
})

test('the filesystem walker reads route.js files and ignores helpers', () => {
  const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rls-coverage-'))
  try {
    const routeDir = path.join(apiRoot, 'database', 'chats')
    fs.mkdirSync(routeDir, { recursive: true })
    fs.writeFileSync(path.join(routeDir, 'route.js'), PLAIN_SOURCE)
    fs.writeFileSync(path.join(routeDir, 'helpers.js'), PLAIN_SOURCE)

    const coverage = collectRouteCoverage(apiRoot)

    assert.equal(coverage.total, 1)
    assert.equal(coverage.unwired[0].route, 'database/chats')
  } finally {
    fs.rmSync(apiRoot, { recursive: true, force: true })
  }
})

test('a missing API tree reports no routes instead of throwing', () => {
  assert.equal(collectRouteCoverage(path.join(os.tmpdir(), 'rls-coverage-does-not-exist')).total, 0)
})
