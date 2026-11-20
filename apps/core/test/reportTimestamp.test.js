import test from 'node:test'
import assert from 'node:assert/strict'
import { getReportDisplayTimestamp } from '../src/lib/reportTimestamp.js'

test('prefers createdAt for queued report jobs so the relative time reflects when the job was created', () => {
    const timestamp = getReportDisplayTimestamp({
        status: 'queued',
        createdAt: '2026-08-04T10:00:00.000Z',
        updatedAt: '2026-08-04T07:00:00.000Z',
        timestamp: '2026-08-04T07:00:00.000Z',
    })

    assert.equal(timestamp, '2026-08-04T10:00:00.000Z')
})

test('prefers generatedAt for completed reports when available', () => {
    const timestamp = getReportDisplayTimestamp({
        status: 'ready',
        generatedAt: '2026-08-04T11:00:00.000Z',
        createdAt: '2026-08-04T10:00:00.000Z',
        updatedAt: '2026-08-04T10:30:00.000Z',
    })

    assert.equal(timestamp, '2026-08-04T11:00:00.000Z')
})
