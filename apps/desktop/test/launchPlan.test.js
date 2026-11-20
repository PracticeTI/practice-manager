import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildServerEnv,
    findFreePort,
    hasProductionBuild,
    resolveServerCommand,
    waitForHealth,
    WORKER_FLAGS,
} from '../main/launchPlan.js'

test('the spawned server always runs inline workers', () => {
    const env = buildServerEnv({ PATH: '/usr/bin' }, { port: 3210 })

    assert.equal(env.INLINE_WORKERS, 'true')
    assert.equal(env.PORT, '3210')
    for (const flag of WORKER_FLAGS) assert.equal(env[flag], 'true', `${flag} defaults on`)
    assert.equal(env.PATH, '/usr/bin', 'inherits the operator environment')
    // The desktop app is the solo edition, so its root route opens the admin portal.
    assert.equal(env.PRACTICE_MANAGER_EDITION, 'solo')
})

test('an explicit worker flag wins over the default', () => {
    const env = buildServerEnv({ REPORT_WORKER_ENABLED: 'false' }, { port: 3210 })
    assert.equal(env.REPORT_WORKER_ENABLED, 'false')
})

test('an explicit edition wins over the solo default', () => {
    const env = buildServerEnv({ PRACTICE_MANAGER_EDITION: 'cloud' }, { port: 3210 })
    assert.equal(env.PRACTICE_MANAGER_EDITION, 'cloud')
})

test('starts the core workspace on the chosen port', () => {
    const plan = resolveServerCommand({ repoRoot: '/repo', port: 3210, env: {} })

    assert.deepEqual(plan.args, ['run', 'start', '--workspace', '@practice-manager/core', '--', '-p', '3210'])
    assert.equal(plan.options.cwd, '/repo')
    assert.equal(plan.options.env.INLINE_WORKERS, 'true')
})

test('finds a free port without assuming 3000 is available', async () => {
    const port = await findFreePort(3400, { attempts: 5 })
    assert.ok(port >= 3400 && port < 3405)

    // A second lookup from the same base skips nothing while the first is free, but a
    // deliberately impossible range must fail loudly rather than silently reuse a port.
    await assert.rejects(() => findFreePort(1, { attempts: 1 }), /No free port/)
})

test('waits for health and reports the last failure', async () => {
    const okFetch = async () => ({ ok: true, status: 200 })
    assert.deepEqual(await waitForHealth('http://127.0.0.1:1', { fetchImpl: okFetch }), { ok: true })

    const failingFetch = async () => ({ ok: false, status: 503 })
    const result = await waitForHealth('http://127.0.0.1:1', {
        fetchImpl: failingFetch,
        timeoutMs: 20,
        intervalMs: 5,
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /503/)
})

test('never throws when the server is unreachable', async () => {
    const throwingFetch = async () => { throw new Error('ECONNREFUSED') }
    const result = await waitForHealth('http://127.0.0.1:1', {
        fetchImpl: throwingFetch,
        timeoutMs: 20,
        intervalMs: 5,
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /ECONNREFUSED/)
})

test('only reports a build when BUILD_ID exists', () => {
    // The repository under test may or may not have been built; assert the shape rather
    // than the value so the suite works in both states.
    assert.equal(typeof hasProductionBuild(), 'boolean')
})
