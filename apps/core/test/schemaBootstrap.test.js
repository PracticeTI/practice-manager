import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = ''
process.env.POSTGRES_URL = ''

const { SCHEMA_STEPS } = await import('../src/lib/schemaBootstrap.js')
const { coreSchemaStatements } = await import('../src/lib/coreSchema.js')

test('lists the schema steps in a stable, unique order', () => {
    const names = SCHEMA_STEPS.map((step) => step.name)

    assert.ok(names.length >= 25, 'covers the clinical, settings and queue tables')
    assert.equal(new Set(names).size, names.length, 'no duplicate steps')

    // Patients come first: every clinical record references them.
    assert.equal(names[0], 'patients')

    for (const step of SCHEMA_STEPS) {
        assert.equal(typeof step.run, 'function', `${step.name} has a run function`)
    }

    for (const required of ['patients', 'appointments', 'notes', 'identity', 'queue-report', 'queue-email']) {
        assert.ok(names.includes(required), `${required} is part of the bootstrap`)
    }
})

test('refuses to run without PostgreSQL', async () => {
    const { bootstrapSchema } = await import('../src/lib/schemaBootstrap.js')
    await assert.rejects(
        () => bootstrapSchema(),
        /Schema bootstrap requires PostgreSQL/
    )
})

test('core content statements are idempotent and ordered', () => {
    const statements = coreSchemaStatements()

    // The public site reads these on the first request, so they must exist before any
    // worker or route touches content.
    const creates = statements.filter((sql) => sql.includes('CREATE TABLE'))
    for (const table of ['system_settings', 'domain_settings', 'content', 'content_relationships', 'billing']) {
        assert.ok(
            creates.some((sql) => sql.includes(`IF NOT EXISTS ${table}`)),
            `${table} is created`
        )
    }

    // content must precede content_relationships: it is a foreign-key target.
    const contentIndex = statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS content ('))
    const relationshipsIndex = statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS content_relationships'))
    assert.ok(contentIndex >= 0 && relationshipsIndex > contentIndex)
})
