import test from 'node:test'
import assert from 'node:assert/strict'

import {
    ADMIN_IDENTITY_TABLES,
    DIRECTORY_TABLES,
    DIRECTORY_CHILD_TABLES,
    GLOBAL_STATE_TABLES,
    PATIENT_RECORD_TABLES,
    PUBLIC_READ_TABLES,
    RLS_POLICY_TABLES,
    SERVICE_ONLY_TABLES,
    SHARED_REFERENCE_TABLES,
    TENANT_SCOPED_TABLES,
    USER_SCOPED_TABLES,
    buildGrantStatements,
    buildPolicyStatements,
} from '../src/lib/rlsPolicies.js'

const AUDIT_TABLES = [
    'activities',
    'admin_suppressed_notifications',
    'admin_users',
    'allied_health_provider_admin_deletions',
    'allied_health_provider_favorites',
    'allied_health_providers',
    'api_rate_limits',
    'appointment_reminders',
    'appointments',
    'availability_exceptions',
    'availability_rules',
    'calendar_busy_blocks',
    'calendar_connections',
    'case_usage',
    'contact_patients',
    'contacts',
    'content',
    'domain_settings',
    'equipment_supplier_admin_deletions',
    'equipment_supplier_favorites',
    'equipment_suppliers',
    'forms',
    'funder_documents',
    'funders',
    'notes',
    'patient_cases',
    'patient_quote_jobs',
    'patient_quotes',
    'patient_service_agreements',
    'practice_locations',
    'practitioner_services',
    'practitioners',
    'quote_items',
    'report_domain_settings',
    'report_templates',
    'service_agreement_items',
    'services',
    'system_settings',
    'task_entries',
    'user_settings',
    'waitlist_entries',
    'waitlist_offers',
]

// Added after the initial audit: these carry PII and a domain column but were missing
// from the registry, so the script never replaced their permissive policies.
const PATIENT_AUDIT_TABLES = [
    'billing',
    'chats',
    'inbound_messages',
    'outbound_messages',
    'patient_analysis',
    'patient_analysis_jobs',
    'patient_billing_jobs',
    'patient_draft_invoices',
    'patient_equipment_sourcer_jobs',
    'patient_equipment_suggestions',
    'patient_report_drafts',
    'patient_report_jobs',
    'patient_reports',
    'patient_transcript_scribe_jobs',
    'patient_transcript_summaries',
    'patient_transcriptions',
    'patients',
]

test('covers every RLS-enabled table reported without policies', () => {
    const expected = [...AUDIT_TABLES, ...PATIENT_AUDIT_TABLES]

    assert.equal(RLS_POLICY_TABLES.length, expected.length)
    assert.deepEqual([...RLS_POLICY_TABLES].sort(), expected.sort())
})

test('assigns each table to exactly one access model', () => {
    const grouped = [
        ...TENANT_SCOPED_TABLES,
        ...PATIENT_RECORD_TABLES,
        ...DIRECTORY_CHILD_TABLES.map((entry) => entry.table),
        ...SHARED_REFERENCE_TABLES,
        ...DIRECTORY_TABLES,
        ...SERVICE_ONLY_TABLES,
        ...USER_SCOPED_TABLES,
        ...PUBLIC_READ_TABLES,
        ...GLOBAL_STATE_TABLES,
        ...ADMIN_IDENTITY_TABLES,
    ]

    assert.equal(grouped.length, new Set(grouped).size)
    assert.deepEqual([...grouped].sort(), [...RLS_POLICY_TABLES].sort())
})

test('creates at least one policy per table', () => {
    const statements = buildPolicyStatements()
    const covered = new Set()

    for (const statement of statements) {
        const match = statement.match(/CREATE POLICY "[^"]+" ON public\."([^"]+)"/)
        if (match) covered.add(match[1])
    }

    assert.deepEqual([...covered].sort(), [...RLS_POLICY_TABLES].sort())
})

test('scopes tenant and patient record tables by domain and superadmin bypass', () => {
    const statements = buildPolicyStatements()

    for (const table of [...TENANT_SCOPED_TABLES, ...PATIENT_RECORD_TABLES]) {
        const policy = statements.find(
            (statement) => statement.startsWith(`CREATE POLICY "${table}_domain_policy"`)
        )
        assert.ok(policy, `missing domain policy for ${table}`)
        assert.match(policy, /current_setting\('app\.current_domain', true\)/)
        assert.match(policy, /current_setting\('app\.current_role', true\) = 'superadmin'/)
        assert.match(policy, /WITH CHECK/)
    }
})

test('keeps directory favourites writable for a record another domain added', () => {
    const statements = buildPolicyStatements()

    for (const entry of DIRECTORY_CHILD_TABLES) {
        assert.ok(statements.includes(
            `CREATE POLICY "${entry.table}_read_policy" ON public."${entry.table}" FOR SELECT TO "practice_manager_app" USING (true)`
        ), `missing unrestricted read policy for ${entry.table}`)

        for (const verb of ['insert', 'update', 'delete']) {
            const policy = statements.find(
                (statement) => statement.startsWith(`CREATE POLICY "${entry.table}_${verb}_policy"`)
            )
            assert.ok(policy, `missing ${verb} policy for ${entry.table}`)
            // The directory is one catalogue, so the parent's domain cannot decide access.
            assert.match(policy, new RegExp(`FROM public\\."${entry.parentTable}"`))
            assert.match(policy, new RegExp(`parent\\.id = "${entry.table}"\\."${entry.foreignKey}"`))
            assert.doesNotMatch(policy, /app\.current_domain/)
        }

        assert.ok(statements.includes(
            `DROP POLICY IF EXISTS "${entry.table}_domain_policy" ON public."${entry.table}"`
        ), `the tenant policy must be replaced, not left to OR in`)
    }
})

test('drops permissive policies that would override the domain policy', () => {
    const statements = buildPolicyStatements()

    for (const table of [...TENANT_SCOPED_TABLES, ...PATIENT_RECORD_TABLES]) {
        for (const stale of [`dev_allow_all_${table}`, `${table}_rls_policy`, `${table}_access_policy`]) {
            assert.ok(
                statements.includes(`DROP POLICY IF EXISTS "${stale}" ON public."${table}"`),
                `missing drop for ${stale}`
            )
        }
    }
})

test('never forces row level security', () => {
    for (const statement of buildPolicyStatements()) {
        assert.doesNotMatch(statement, /FORCE ROW LEVEL SECURITY/)
    }
})

test('keeps public content readable and its writes tenant-scoped', () => {
    const statements = buildPolicyStatements()
    const table = PUBLIC_READ_TABLES[0]

    assert.ok(statements.includes(
        `CREATE POLICY "${table}_public_read_policy" ON public."${table}" FOR SELECT TO "practice_manager_app" USING (true)`
    ))
    for (const verb of ['insert', 'update', 'delete']) {
        const policy = statements.find(
            (statement) => statement.startsWith(`CREATE POLICY "${table}_${verb}_policy"`)
        )
        assert.ok(policy, `missing ${verb} policy for ${table}`)
        assert.match(policy, /current_setting\('app\.current_domain', true\)/)
        assert.match(policy, /domain IS NULL/)
    }
})

test('lets any request read admin identities but only superadmins change them', () => {
    const statements = buildPolicyStatements()
    const table = ADMIN_IDENTITY_TABLES[0]

    assert.ok(statements.includes(
        `CREATE POLICY "${table}_read_policy" ON public."${table}" FOR SELECT TO "practice_manager_app" USING (true)`
    ))
    for (const verb of ['insert', 'update', 'delete']) {
        const policy = statements.find(
            (statement) => statement.startsWith(`CREATE POLICY "${table}_${verb}_policy"`)
        )
        assert.ok(policy, `missing ${verb} policy for ${table}`)
        assert.match(policy, /current_setting\('app\.current_role', true\) = 'superadmin'/)
    }
})

test('gives global state a single permissive policy', () => {
    const statements = buildPolicyStatements()

    for (const table of GLOBAL_STATE_TABLES) {
        const policy = statements.find(
            (statement) => statement.startsWith(`CREATE POLICY "${table}_global_policy"`)
        )
        assert.ok(policy, `missing global policy for ${table}`)
        assert.match(policy, /USING \(true\) WITH CHECK \(true\)/)
    }
})

test('issues every policy to the runtime role, never PUBLIC', () => {
    const statements = buildPolicyStatements()

    for (const statement of statements) {
        if (!statement.startsWith('CREATE POLICY')) continue
        assert.match(statement, / TO "practice_manager_app"/, `policy targets PUBLIC: ${statement}`)
    }

    for (const statement of buildPolicyStatements({ role: 'other_app' })) {
        if (!statement.startsWith('CREATE POLICY')) continue
        assert.match(statement, / TO "other_app"/)
    }

    assert.throws(() => buildPolicyStatements({ role: 'app; DROP TABLE patients' }))
    assert.throws(() => buildPolicyStatements({ role: '' }))
})

test('grants the runtime role access to every covered table and sequence', () => {
    const statements = buildGrantStatements('practice_manager_app', { sequences: ['appointments_id_seq'] })

    assert.ok(statements.includes('GRANT USAGE ON SCHEMA public TO "practice_manager_app"'))
    for (const table of RLS_POLICY_TABLES) {
        assert.ok(
            statements.includes(
                `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${table}" TO "practice_manager_app"`
            ),
            `missing grant for ${table}`
        )
    }
    assert.ok(statements.includes('GRANT USAGE, SELECT ON SEQUENCE public."appointments_id_seq" TO "practice_manager_app"'))
})

test('rejects role names that could escape the identifier', () => {
    assert.throws(() => buildGrantStatements('practice_manager_app; DROP TABLE patients'))
    assert.throws(() => buildGrantStatements(''))
})

test('keeps the shared directories readable and their writes tenant-scoped', () => {
    const statements = buildPolicyStatements()

    for (const table of DIRECTORY_TABLES) {
        assert.ok(statements.includes(
            `CREATE POLICY "${table}_read_policy" ON public."${table}" FOR SELECT TO "practice_manager_app" USING (true)`
        ), `missing unrestricted read policy for ${table}`)

        for (const verb of ['insert', 'update', 'delete']) {
            const policy = statements.find(
                (statement) => statement.startsWith(`CREATE POLICY "${table}_${verb}_policy"`)
            )
            assert.ok(policy, `missing ${verb} policy for ${table}`)
            assert.match(policy, /current_setting\('app\.current_domain', true\)/)
            // Rows imported before the domain column existed stay claimable.
            assert.match(policy, /domain = ''/)
        }

        assert.ok(statements.includes(
            `DROP POLICY IF EXISTS "${table}_domain_policy" ON public."${table}"`
        ), `the tenant policy must be replaced, not left to OR in`)
    }
})

test('never leaves a directory child policy reading the parent domain', () => {
    for (const statement of buildPolicyStatements()) {
        if (!statement.startsWith('CREATE POLICY "') || !statement.includes('parent.id =')) continue
        assert.doesNotMatch(statement, /parent\.domain/)
    }
})

test('scopes user settings to the bound admin inside the bound domain', () => {
    const statements = buildPolicyStatements()

    for (const table of USER_SCOPED_TABLES) {
        const policy = statements.find(
            (statement) => statement.startsWith(`CREATE POLICY "${table}_user_policy"`)
        )
        assert.ok(policy, `missing user policy for ${table}`)
        assert.match(policy, /username = current_setting\('app\.current_username', true\)/)
        assert.match(policy, /"domain" = current_setting\('app\.current_domain', true\)/)
        assert.match(policy, /current_setting\('app\.current_role', true\) = 'superadmin'/)
        assert.match(policy, /WITH CHECK/)
    }
})
