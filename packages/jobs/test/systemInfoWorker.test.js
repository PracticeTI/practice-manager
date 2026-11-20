import test from 'node:test'
import assert from 'node:assert/strict'

import { runSystemInfoWorkerCycle } from '../src/jobs/systemInfoWorker.js'

test('upserts timestamp and worker status under the configured environment key', async () => {
    const previousName = process.env.ENV_HEALTH_NAME
    process.env.ENV_HEALTH_NAME = 'test-worker'
    const queries = []
    const connection = {
        async query(sql, values) {
            queries.push({ sql, values })
            return { rows: [{ key: values[0] }] }
        },
    }

    try {
        const now = new Date('2026-11-13T04:00:00.000Z')
        const result = await runSystemInfoWorkerCycle({
            connection,
            dbType: 'postgresql',
            now,
            workersRan: true,
        })

        assert.deepEqual(result, {
            skipped: false,
            ok: true,
            key: 'env_health_test-worker',
            health: { timestamp: now.toISOString(), workersRan: true },
        })
        assert.match(queries[0].sql, /ON CONFLICT \(key\) DO UPDATE/)
        assert.deepEqual(queries[0].values, [
            'env_health_test-worker',
            JSON.stringify({ timestamp: now.toISOString(), workersRan: true }),
            3600,
        ])
    } finally {
        if (previousName === undefined) delete process.env.ENV_HEALTH_NAME
        else process.env.ENV_HEALTH_NAME = previousName
    }
})

test('supports the MySQL system_settings upsert and records workersRan false', async () => {
    const connection = {
        async query(sql, values) {
            assert.match(sql, /ON DUPLICATE KEY UPDATE/)
            assert.deepEqual(values, [
                'env_health_development',
                JSON.stringify({ timestamp: '2026-11-13T04:00:00.000Z', workersRan: false }),
                3600,
                3600,
            ])
            return [{ affectedRows: 2 }]
        },
    }

    const result = await runSystemInfoWorkerCycle({
        connection,
        dbType: 'mysql',
        name: 'development',
        now: new Date('2026-11-13T04:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.equal(result.health.workersRan, false)
})

test('returns database write errors without throwing', async () => {
    const result = await runSystemInfoWorkerCycle({
        connection: {
            async query() {
                throw new Error('database unavailable')
            },
        },
        dbType: 'postgresql',
        name: 'test',
    })

    assert.equal(result.ok, false)
    assert.equal(result.key, 'env_health_test')
    assert.equal(result.error, 'database unavailable')
})

test('skips an update while the existing health record is still fresh', async () => {
    const result = await runSystemInfoWorkerCycle({
        connection: {
            async query() {
                return { rows: [] }
            },
        },
        dbType: 'postgresql',
        name: 'test',
        intervalSeconds: 1800,
    })

    assert.deepEqual(result, {
        skipped: true,
        reason: 'fresh',
        key: 'env_health_test',
        intervalSeconds: 1800,
    })
})

test('forceRun bypasses the configured interval', async () => {
    let query
    const result = await runSystemInfoWorkerCycle({
        connection: {
            async query(sql) {
                query = sql
                return { rows: [{ key: 'env_health_test' }] }
            },
        },
        dbType: 'postgresql',
        name: 'test',
        forceRun: true,
    })

    assert.equal(result.ok, true)
    assert.doesNotMatch(query, /updated_at <=/)
})

test('ENV_HEALTH_WORKER_ENABLED=false disables updates', async () => {
    const previousEnabled = process.env.ENV_HEALTH_WORKER_ENABLED
    process.env.ENV_HEALTH_WORKER_ENABLED = 'false'
    try {
        const result = await runSystemInfoWorkerCycle({
            connection: {
                async query() {
                    assert.fail('database should not be queried when the worker is disabled')
                },
            },
            dbType: 'postgresql',
        })

        assert.deepEqual(result, { skipped: true, reason: 'disabled' })
    } finally {
        if (previousEnabled === undefined) delete process.env.ENV_HEALTH_WORKER_ENABLED
        else process.env.ENV_HEALTH_WORKER_ENABLED = previousEnabled
    }
})
