import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getConfig,
    resolveInboundEmailTableName,
    ensureInboundEmailTable
} from '../src/jobs/inboundEmailWorker.js'

test('resolveInboundEmailTableName returns default when env unset', () => {
    delete process.env.INBOUND_EMAIL_TABLE
    delete process.env.INBOUND_MESSAGES_TABLE
    assert.equal(resolveInboundEmailTableName(), 'inbound_messages')
})

test('getConfig returns valid defaults and honors environment overrides', () => {
    process.env.EMAIL_WORKER_ENABLED = 'true'
    process.env.INBOUND_EMAIL_WORKER_ENABLED = 'true'
    const config = getConfig()
    assert.equal(config.enabled, true)
    assert.equal(config.table, 'inbound_messages')
    assert.equal(config.batchSize, 10)
    assert.equal(config.pollSeconds, 200)
    assert.equal(config.maxAttempts, 5)
})

test('ensureInboundEmailTable executes expected postgres DDL', async () => {
    const executedQueries = []
    const mockConnection = {
        query: async (sql) => {
            executedQueries.push(sql)
            return { rows: [] }
        }
    }

    await ensureInboundEmailTable(mockConnection, 'postgresql', 'inbound_messages')
    const combinedSql = executedQueries.join('\n')
    assert.ok(combinedSql.includes('CREATE TABLE IF NOT EXISTS inbound_messages'))
    assert.ok(combinedSql.includes('status VARCHAR(32)'))
    assert.ok(combinedSql.includes('from_email VARCHAR(320)'))
    assert.ok(combinedSql.includes('to_email VARCHAR(320)'))
    assert.ok(combinedSql.includes('payload_json JSONB'))
    assert.ok(combinedSql.includes('ENABLE ROW LEVEL SECURITY'))
})
