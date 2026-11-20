// Row-level security policies for every table that had RLS enabled without a
// policy. Tables are grouped by access model; see docs/postgres-rls-rollout.md.
//
// Policies are inert while the application connects as a superuser or table
// owner. They only take effect once DATABASE_URL uses a role with
// NOSUPERUSER NOBYPASSRLS and the request sets app.current_domain.

export const TENANT_SCOPED_TABLES = [
    'activities',
    'admin_suppressed_notifications',
    'appointment_reminders',
    'appointments',
    'availability_exceptions',
    'availability_rules',
    'calendar_busy_blocks',
    'calendar_connections',
    'case_usage',
    'contact_patients',
    'contacts',
    'domain_settings',
    'forms',
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
    'task_entries',
    'waitlist_entries',
    'waitlist_offers',
]

// Patient records. These carry PII and a domain column, but were omitted from the
// set above, so the policy script never touched them: locally every one kept a
// permissive `dev_allow_all_*` policy, and on the hosted database they had none.
//
// Membership here means the route reading the table MUST bind the request's domain
// first (see applySessionRlsContext in lib/postgresRlsContext.js). A role without
// BYPASSRLS and no bound domain sees no rows at all — which is the intended
// failure, but it is a failure.
//
// Deliberately still absent:
//   patient_files    carries its own FORCEd policy in lib/patientFilesTable.js
//   billing_old      superseded legacy table
export const PATIENT_RECORD_TABLES = [
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

// Favourites and per-admin soft deletes on the directory tables. These have no
// domain column of their own and belong to the admin who created them, not to the
// domain the parent record happens to carry: the directory is one catalogue shared
// by every domain, so deriving access from `parent.domain` denied every favourite
// on a record another domain added (`new row violates row-level security policy for
// table "allied_health_provider_favorites"`) while leaving the record itself
// visible. `adminKey` in providersStore/equipmentStore is the real owner.
export const DIRECTORY_CHILD_TABLES = [
    { table: 'allied_health_provider_favorites', foreignKey: 'provider_id', parentTable: 'allied_health_providers' },
    { table: 'allied_health_provider_admin_deletions', foreignKey: 'provider_id', parentTable: 'allied_health_providers' },
    { table: 'equipment_supplier_favorites', foreignKey: 'supplier_id', parentTable: 'equipment_suppliers' },
    { table: 'equipment_supplier_admin_deletions', foreignKey: 'supplier_id', parentTable: 'equipment_suppliers' },
]

// Published reference data. Every tenant reads it, only superadmins change it.
export const SHARED_REFERENCE_TABLES = ['funders', 'funder_documents']

// One catalogue shared by every domain. `listProviders` and
// `listEquipmentSuppliers` read every published row and only scope `admin_added`
// records by domain, so a tenant predicate hid the whole directory: preview held
// 119 suppliers, all imported before the domain column existed, and no tenant
// could see any of them. Reads are unrestricted; writes stay superadmin, the
// row's own domain, or a legacy row that never carried one.
export const DIRECTORY_TABLES = ['allied_health_providers', 'equipment_suppliers']

// No tenant data is stored here, and their callers are unauthenticated public
// routes that have no domain context to offer.
// `scheduling_rate_limits` used to sit here. Nothing ever created or read it —
// lib/rateLimits.js backs both booking and intake with `api_rate_limits` — so the
// entry only taught `npm run db:prepare` to skip a table that would never exist.
export const SERVICE_ONLY_TABLES = ['api_rate_limits']

// One row per admin *in a domain*: the Admin dashboard layout and the
// notification preferences. Both predicates are required — the username keeps
// peers from reading each other's rows, and the domain keeps an admin's values
// from leaking across tenants. `app.current_username` is bound by
// `getDomainBoundConnection(domain, { username })`.
//
// This replaced the `admin_notification_settings` per-admin table; that table is
// retired and every reader now goes through `user_settings`.
export const USER_SCOPED_TABLES = ['user_settings']

/**
 * Role every policy is issued to.
 *
 * Policies are deliberately not `TO public`. A Supabase project grants `anon` and
 * `authenticated` full DML on every public table and exposes them through the Data
 * API, so a `USING (true)` policy targeting PUBLIC would publish admin identities or
 * global state to anyone holding the public anon key. Naming the runtime role costs
 * nothing: the owner and any BYPASSRLS login ignore policies regardless.
 */
export const DEFAULT_POLICY_ROLE = 'practice_manager_app'

// Public site content. Anyone may read it (the public routes have no domain context
// to bind), but only a superadmin or the row's own tenant may change it. Rows
// created before the domain column existed are unowned (`domain IS NULL`) and stay
// writable so legacy import paths keep working.
export const PUBLIC_READ_TABLES = ['content']

// Global key/value application state. Neither table has a domain column, and
// unauthenticated routes (intake, booking) read and write it, so row-level security
// cannot isolate them by tenant. The policy exists to make that sharing explicit
// rather than accidental, and to keep the tables reachable for the constrained
// runtime role.
//
export const GLOBAL_STATE_TABLES = ['system_settings']

// Admin identities. Login resolves a username before any token, domain or
// per-admin setting exists, and notification delivery looks up other admins'
// addresses, so reads cannot be scoped to the current user. Writes stay
// superadmin-only, matching the API, which already requires superadmin.
export const ADMIN_IDENTITY_TABLES = ['admin_users']

export const RLS_POLICY_TABLES = [
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

const SUPERADMIN_PREDICATE = `current_setting('app.current_role', true) = 'superadmin'`

export function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`
}

export function assertRoleName(role) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(role || ''))) {
        throw new Error('POSTGRES_RLS_RUNTIME_ROLE must be a valid PostgreSQL role name')
    }
    return role
}

function roleClause(role) {
    return `TO ${quoteIdentifier(assertRoleName(role))}`
}

function tenantPredicate(column = 'domain') {
    return `${SUPERADMIN_PREDICATE}
                OR ${quoteIdentifier(column)} = current_setting('app.current_domain', true)`
}

function childPredicate({ table, foreignKey, parentTable }) {
    return `${SUPERADMIN_PREDICATE}
                OR EXISTS (
                    SELECT 1
                    FROM public.${quoteIdentifier(parentTable)} parent
                    WHERE parent.id = ${quoteIdentifier(table)}.${quoteIdentifier(foreignKey)}
                )`
}

// Permissive policies found in the wild. RLS ORs every applicable policy together,
// so one leftover `USING (true)` row silences the domain policy for that table
// while still looking correct in pg_policies. All of these are dropped before the
// authoritative policy is created.
function stalePolicyNames(table) {
    return [
        `dev_allow_all_${table}`,
        `${table}_rls_policy`,
        `${table}_access_policy`,
    ]
}

/**
 * The domain policy for a tenant table, plus removal of anything that would
 * override it. Exported so a table initialiser can install the same policy when it
 * creates the table, instead of inventing a permissive one.
 */
export function tenantPolicyStatements(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const predicate = tenantPredicate()
    const policyName = quoteIdentifier(`${table}_domain_policy`)
    const target = `public.${quoteIdentifier(table)}`

    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${policyName} ON ${target}`,
        `CREATE POLICY ${policyName} ON ${target} FOR ALL ${roleClause(role)}
            USING (${predicate})
            WITH CHECK (${predicate})`,
    ]
}

function tenantPolicy(table, options) {
    return tenantPolicyStatements(table, options)
}

/**
 * Directory favourites and admin soft-deletes.
 *
 * Access cannot be derived from the parent record's domain: the directory is one
 * catalogue every domain reads in full, so a record another domain added is
 * visible here and its favourites must be writable here too. Reads stay open for
 * the same reason the directory's own policies keep them open — the listing
 * computes a cross-admin aggregate (`favorite_count`) next to the caller's own
 * `is_favorite`, keyed by `admin_key` in providersStore/equipmentStore.
 *
 * Writes keep the integrity check the tenant predicate also carried: the row must
 * point at an existing directory record.
 */
function directoryChildPolicy(entry, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(entry.table)}`
    const readPolicy = quoteIdentifier(`${entry.table}_read_policy`)
    const predicate = childPredicate(entry)
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(entry.table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${entry.table}_domain_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${readPolicy} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${entry.table}_insert_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${entry.table}_update_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${entry.table}_delete_policy`)} ON ${target}`,
        `CREATE POLICY ${readPolicy} ON ${target} FOR SELECT ${roleClause(role)} USING (true)`,
        `CREATE POLICY ${quoteIdentifier(`${entry.table}_insert_policy`)} ON ${target} FOR INSERT ${roleClause(role)}
            WITH CHECK (${predicate})`,
        `CREATE POLICY ${quoteIdentifier(`${entry.table}_update_policy`)} ON ${target} FOR UPDATE ${roleClause(role)}
            USING (${predicate})
            WITH CHECK (${predicate})`,
        `CREATE POLICY ${quoteIdentifier(`${entry.table}_delete_policy`)} ON ${target} FOR DELETE ${roleClause(role)}
            USING (${predicate})`,
    ]
}

function sharedReferencePolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const readPolicy = quoteIdentifier(`${table}_read_policy`)
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`dev_allow_all_${table}`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${readPolicy} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_insert_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_update_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_delete_policy`)} ON ${target}`,
        `CREATE POLICY ${readPolicy} ON ${target} FOR SELECT ${roleClause(role)} USING (true)`,
        `CREATE POLICY ${quoteIdentifier(`${table}_insert_policy`)} ON ${target} FOR INSERT ${roleClause(role)}
            WITH CHECK (${SUPERADMIN_PREDICATE})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_update_policy`)} ON ${target} FOR UPDATE ${roleClause(role)}
            USING (${SUPERADMIN_PREDICATE})
            WITH CHECK (${SUPERADMIN_PREDICATE})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_delete_policy`)} ON ${target} FOR DELETE ${roleClause(role)}
            USING (${SUPERADMIN_PREDICATE})`,
    ]
}

function directoryPolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const readPolicy = quoteIdentifier(`${table}_read_policy`)
    const writePredicate = `${tenantPredicate()}
                OR domain IS NULL OR domain = ''`
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_domain_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${readPolicy} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_public_read_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_insert_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_update_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_delete_policy`)} ON ${target}`,
        `CREATE POLICY ${readPolicy} ON ${target} FOR SELECT ${roleClause(role)} USING (true)`,
        `CREATE POLICY ${quoteIdentifier(`${table}_insert_policy`)} ON ${target} FOR INSERT ${roleClause(role)}
            WITH CHECK (${writePredicate})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_update_policy`)} ON ${target} FOR UPDATE ${roleClause(role)}
            USING (${writePredicate})
            WITH CHECK (${writePredicate})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_delete_policy`)} ON ${target} FOR DELETE ${roleClause(role)}
            USING (${writePredicate})`,
    ]
}

function serviceOnlyPolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const policyName = quoteIdentifier(`${table}_service_policy`)
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`dev_allow_all_${table}`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${policyName} ON ${target}`,
        `CREATE POLICY ${policyName} ON ${target} FOR ALL ${roleClause(role)} USING (true) WITH CHECK (true)`,
    ]
}

/**
 * Per-user rows inside a tenant: both the username and the domain have to match
 * the bound session. The tenant half is what `GET /api/settings/domains` already
 * relies on; the username half is what stops an admin reading a colleague's row.
 */
function userScopedPolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const policyName = quoteIdentifier(`${table}_user_policy`)
    const predicate = `${SUPERADMIN_PREDICATE}
                OR (${quoteIdentifier('domain')} = current_setting('app.current_domain', true)
                    AND username = current_setting('app.current_username', true))`
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`dev_allow_all_${table}`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_domain_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${policyName} ON ${target}`,
        `CREATE POLICY ${policyName} ON ${target} FOR ALL ${roleClause(role)}
            USING (${predicate})
            WITH CHECK (${predicate})`,
    ]
}

function publicReadPolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const readPolicy = quoteIdentifier(`${table}_public_read_policy`)
    const writePredicate = `${tenantPredicate()}
                OR domain IS NULL`
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${readPolicy} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_insert_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_update_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_delete_policy`)} ON ${target}`,
        `CREATE POLICY ${readPolicy} ON ${target} FOR SELECT ${roleClause(role)} USING (true)`,
        `CREATE POLICY ${quoteIdentifier(`${table}_insert_policy`)} ON ${target} FOR INSERT ${roleClause(role)}
            WITH CHECK (${writePredicate})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_update_policy`)} ON ${target} FOR UPDATE ${roleClause(role)}
            USING (${writePredicate})
            WITH CHECK (${writePredicate})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_delete_policy`)} ON ${target} FOR DELETE ${roleClause(role)}
            USING (${writePredicate})`,
    ]
}

function globalStatePolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const policyName = quoteIdentifier(`${table}_global_policy`)
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${policyName} ON ${target}`,
        `CREATE POLICY ${policyName} ON ${target} FOR ALL ${roleClause(role)} USING (true) WITH CHECK (true)`,
    ]
}

function adminIdentityPolicy(table, { role = DEFAULT_POLICY_ROLE } = {}) {
    const target = `public.${quoteIdentifier(table)}`
    const readPolicy = quoteIdentifier(`${table}_read_policy`)
    return [
        `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
        ...stalePolicyNames(table).map(
            (name) => `DROP POLICY IF EXISTS ${quoteIdentifier(name)} ON ${target}`
        ),
        `DROP POLICY IF EXISTS ${readPolicy} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_insert_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_update_policy`)} ON ${target}`,
        `DROP POLICY IF EXISTS ${quoteIdentifier(`${table}_delete_policy`)} ON ${target}`,
        `CREATE POLICY ${readPolicy} ON ${target} FOR SELECT ${roleClause(role)} USING (true)`,
        `CREATE POLICY ${quoteIdentifier(`${table}_insert_policy`)} ON ${target} FOR INSERT ${roleClause(role)}
            WITH CHECK (${SUPERADMIN_PREDICATE})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_update_policy`)} ON ${target} FOR UPDATE ${roleClause(role)}
            USING (${SUPERADMIN_PREDICATE})
            WITH CHECK (${SUPERADMIN_PREDICATE})`,
        `CREATE POLICY ${quoteIdentifier(`${table}_delete_policy`)} ON ${target} FOR DELETE ${roleClause(role)}
            USING (${SUPERADMIN_PREDICATE})`,
    ]
}

/**
 * Idempotent DDL that installs the policy set. RLS is enabled but never forced:
 * forcing it would lock out the owner connection the application still uses.
 *
 * Pass the role the runtime assumes (`POSTGRES_RLS_RUNTIME_ROLE`) so every policy
 * is issued to that role rather than PUBLIC.
 */
export function buildPolicyStatements({ role = DEFAULT_POLICY_ROLE } = {}) {
    return [
        ...TENANT_SCOPED_TABLES.flatMap((table) => tenantPolicy(table, { role })),
        ...PATIENT_RECORD_TABLES.flatMap((table) => tenantPolicy(table, { role })),
        ...DIRECTORY_CHILD_TABLES.flatMap((entry) => directoryChildPolicy(entry, { role })),
        ...SHARED_REFERENCE_TABLES.flatMap((table) => sharedReferencePolicy(table, { role })),
        ...DIRECTORY_TABLES.flatMap((table) => directoryPolicy(table, { role })),
        ...SERVICE_ONLY_TABLES.flatMap((table) => serviceOnlyPolicy(table, { role })),
        ...USER_SCOPED_TABLES.flatMap((table) => userScopedPolicy(table, { role })),
        ...PUBLIC_READ_TABLES.flatMap((table) => publicReadPolicy(table, { role })),
        ...GLOBAL_STATE_TABLES.flatMap((table) => globalStatePolicy(table, { role })),
        ...ADMIN_IDENTITY_TABLES.flatMap((table) => adminIdentityPolicy(table, { role })),
    ]
}

/**
 * Policies do not grant privileges. The runtime role needs table and sequence
 * access before RLS is ever evaluated.
 */
export function buildGrantStatements(role, { tables = RLS_POLICY_TABLES, sequences = [] } = {}) {
    assertRoleName(role)
    const quotedRole = quoteIdentifier(role)
    const statements = [`GRANT USAGE ON SCHEMA public TO ${quotedRole}`]

    for (const table of tables) {
        statements.push(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quoteIdentifier(table)} TO ${quotedRole}`
        )
    }

    for (const sequence of sequences) {
        statements.push(
            `GRANT USAGE, SELECT ON SEQUENCE public.${quoteIdentifier(sequence)} TO ${quotedRole}`
        )
    }

    return statements
}
