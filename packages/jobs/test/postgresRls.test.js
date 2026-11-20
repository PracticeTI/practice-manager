import test from 'node:test'
import assert from 'node:assert/strict'

import { ensurePermissiveRowLevelSecurity } from '../src/jobs/postgresRls.js'

test('ensures PostgreSQL RLS and a permissive policy for a table', async () => {
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
        }
    }

    const result = await ensurePermissiveRowLevelSecurity(connection, 'patient_analysis', 'patient_analysis_rls_policy')

    assert.equal(result, true)
    assert.deepEqual(queries, [
        'ALTER TABLE "patient_analysis" ENABLE ROW LEVEL SECURITY',
        'DROP POLICY IF EXISTS "patient_analysis_rls_policy" ON "patient_analysis"',
        'CREATE POLICY "patient_analysis_rls_policy" ON "patient_analysis" FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true)',
    ])
})

test('the permissive policy is scoped to the worker role, never PUBLIC', async () => {
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
        }
    }

    await ensurePermissiveRowLevelSecurity(connection, 'inbound_messages')

    const createPolicy = queries.find((sql) => sql.startsWith('CREATE POLICY'))
    assert.match(createPolicy, /TO CURRENT_USER/)
    // RLS ORs policies, so a PUBLIC one would widen every other role's rows too.
    assert.doesNotMatch(createPolicy, /\bTO\s+PUBLIC\b/)
    assert.doesNotMatch(createPolicy, /FOR ALL USING/)
    assert.match(createPolicy, /"inbound_messages_access_policy"/)
})
