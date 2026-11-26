/**
 * Compare a schema built from `packages/db/supabase/migrations` with the same schema after the
 * legacy per-table initialisers have run.
 *
 * The migrations are the schema of record: a fresh Docker or desktop install, and every Supabase
 * preview branch, is built from those files alone. The initialisers still create tables lazily,
 * so a table added there but not in a migration would exist on a machine that ran `db:init --
 * --bootstrap` and be missing everywhere else — a bug that only appears on branches. This module
 * turns the two catalog snapshots into a diff so `scripts/check-schema-drift.mjs` can refuse it.
 *
 * The bootstrap deliberately adds one thing the migrations do not: a per-user permissive policy on
 * each queue table, named after the connecting role. It is a local convenience for a database
 * whose owner logs in directly and must not be published, because a published `USING (true)`
 * policy is exactly what the RLS rollout removes.
 */

const EXPECTED_QUEUE_POLICY = /(^inbound_messages_access_policy$|_rls_policy$)/

const NORMALIZE = /\s+/g

function normalizeText(value) {
    if (typeof value !== 'string') return value
    return value.replace(NORMALIZE, ' ').trim()
}

function normalizeDefinition(definition) {
    if (Array.isArray(definition)) return definition
    if (definition && typeof definition === 'object') {
        const normalized = {}
        for (const key of Object.keys(definition).sort()) normalized[key] = normalizeDefinition(definition[key])
        return normalized
    }
    return normalizeText(definition)
}

/**
 * `pg` hands back `pg_policies.roles` as the raw `{role1,role2}` text, so compare its members
 * rather than the string PostgreSQL happened to serialise.
 */
export function parseRoles(roles) {
    if (Array.isArray(roles)) return roles
    const text = String(roles ?? '').trim()
    if (!text.startsWith('{') || !text.endsWith('}')) return text ? [text] : []

    const inner = text.slice(1, -1)
    const names = []
    let current = ''
    let quoted = false
    for (let index = 0; index < inner.length; index += 1) {
        const character = inner[index]
        if (quoted) {
            if (character === '"' && inner[index + 1] === '"') {
                current += '"'
                index += 1
            } else if (character === '"') {
                quoted = false
            } else {
                current += character
            }
        } else if (character === '"') {
            quoted = true
        } else if (character === ',') {
            names.push(current)
            current = ''
        } else {
            current += character
        }
    }
    if (current || names.length > 0) names.push(current)

    return names.map((name) => name.trim()).filter(Boolean)
}

/**
 * Read every object a migration or an initialiser can create, as comparable definitions.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<Array<{ kind: string, key: string, definition: unknown }>>}
 */
export async function snapshotSchema(client) {
    const objects = []
    const add = (kind, key, definition = {}) => {
        objects.push({ kind, key, definition: normalizeDefinition(definition) })
    }

    const tables = await client.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`
    )
    for (const row of tables.rows) add('table', row.table_name)

    const columns = await client.query(
        `select table_name, column_name, data_type, is_nullable, column_default
           from information_schema.columns where table_schema = 'public'`
    )
    for (const row of columns.rows) {
        add('column', `${row.table_name}.${row.column_name}`, {
            data_type: row.data_type,
            is_nullable: row.is_nullable,
            column_default: row.column_default,
        })
    }

    const constraints = await client.query(
        `select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
           from pg_constraint con
           join pg_class c on c.oid = con.conrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'`
    )
    for (const row of constraints.rows) {
        add('constraint', `${row.table_name}.${row.conname}`, { definition: row.definition })
    }

    const indexes = await client.query(`select indexname, indexdef from pg_indexes where schemaname = 'public'`)
    for (const row of indexes.rows) add('index', row.indexname, { definition: row.indexdef })

    const sequences = await client.query(
        `select sequence_name, data_type, start_value, increment
           from information_schema.sequences where sequence_schema = 'public'`
    )
    for (const row of sequences.rows) {
        add('sequence', row.sequence_name, {
            data_type: row.data_type,
            start_value: row.start_value,
            increment: row.increment,
        })
    }

    const views = await client.query(
        `select table_name, view_definition from information_schema.views where table_schema = 'public'`
    )
    for (const row of views.rows) add('view', row.table_name, { definition: row.view_definition })

    const functions = await client.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
                pg_get_functiondef(p.oid) as definition
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'`
    )
    for (const row of functions.rows) {
        add('function', `${row.proname}(${row.arguments})`, { definition: row.definition })
    }

    const triggers = await client.query(
        `select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal`
    )
    for (const row of triggers.rows) add('trigger', `${row.table_name}.${row.tgname}`, { definition: row.definition })

    const rls = await client.query(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`
    )
    for (const row of rls.rows) {
        add('rls', row.relname, { enabled: row.relrowsecurity, forced: row.relforcerowsecurity })
    }

    const policies = await client.query(
        `select tablename, policyname, permissive, roles, cmd, qual, with_check
           from pg_policies where schemaname = 'public'`
    )
    for (const row of policies.rows) {
        add('policy', `${row.tablename}.${row.policyname}`, {
            name: row.policyname,
            table: row.tablename,
            permissive: row.permissive,
            roles: parseRoles(row.roles),
            cmd: row.cmd,
            qual: row.qual,
            with_check: row.with_check,
        })
    }

    const tableGrants = await client.query(
        `select table_name, grantee, privilege_type
           from information_schema.role_table_grants
          where table_schema = 'public'
            and grantee in ('practice_manager_app', 'anon', 'authenticated', 'service_role')`
    )
    for (const row of tableGrants.rows) {
        add('table-grant', `${row.table_name}.${row.grantee}.${row.privilege_type}`)
    }

    const sequenceGrants = await client.query(
        `select object_name, grantee, privilege_type
           from information_schema.role_usage_grants
          where object_schema = 'public' and object_type = 'SEQUENCE'
            and grantee in ('practice_manager_app', 'anon', 'authenticated', 'service_role')`
    )
    for (const row of sequenceGrants.rows) {
        add('sequence-grant', `${row.object_name}.${row.grantee}.${row.privilege_type}`)
    }

    return objects.sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`))
}

/**
 * The per-user queue policy the bootstrap installs on purpose. Anything else it adds is drift.
 *
 * @param {{ kind: string, key: string, definition: unknown }} object
 * @param {{ currentUser?: string }} [options]
 */
export function isExpectedBootstrapObject(object, { currentUser } = {}) {
    if (object.kind !== 'policy' || !currentUser) return false
    const definition = object.definition
    if (!definition || typeof definition !== 'object') return false
    const roles = parseRoles(definition.roles)
    return (
        EXPECTED_QUEUE_POLICY.test(definition.name) &&
        definition.permissive === 'PERMISSIVE' &&
        definition.cmd === 'ALL' &&
        roles.length === 1 &&
        roles[0] === currentUser &&
        normalizeText(definition.qual) === 'true' &&
        normalizeText(definition.with_check) === 'true'
    )
}

/**
 * @param {Array<{ kind: string, key: string, definition: unknown }>} before
 * @param {Array<{ kind: string, key: string, definition: unknown }>} after
 * @param {{ currentUser?: string }} [options]
 * @returns {{
 *   added: Array<object>,
 *   allowed: Array<object>,
 *   removed: Array<object>,
 *   changed: Array<{ before: object, after: object }>,
 *   unexpected: Array<object>,
 * }}
 */
export function diffSchemas(before, after, { currentUser } = {}) {
    const beforeMap = new Map(before.map((object) => [`${object.kind}:${object.key}`, object]))
    const afterMap = new Map(after.map((object) => [`${object.kind}:${object.key}`, object]))

    const added = []
    for (const [id, object] of afterMap) {
        if (!beforeMap.has(id)) added.push(object)
    }

    const removed = []
    for (const [id, object] of beforeMap) {
        if (!afterMap.has(id)) removed.push(object)
    }

    const changed = []
    for (const [id, object] of afterMap) {
        const previous = beforeMap.get(id)
        if (previous && JSON.stringify(previous.definition) !== JSON.stringify(object.definition)) {
            changed.push({ before: previous, after: object })
        }
    }

    const allowed = added.filter((object) => isExpectedBootstrapObject(object, { currentUser }))
    const unexpected = [
        ...added.filter((object) => !allowed.includes(object)),
        ...removed,
        ...changed.flatMap(({ before: previous, after: next }) => [previous, next]),
    ]

    return { added, allowed, removed, changed, unexpected }
}

/** Human-readable lines for a drift report. */
export function describeDrift(drift) {
    const allowed = new Set(drift.allowed)
    const lines = []
    for (const object of drift.added) {
        if (!allowed.has(object)) lines.push(`+ ${object.kind} ${object.key}`)
    }
    for (const object of drift.removed) lines.push(`- ${object.kind} ${object.key}`)
    for (const { before: previous, after: next } of drift.changed) {
        lines.push(`~ ${next.kind} ${next.key}`)
        lines.push(`    before: ${JSON.stringify(previous.definition)}`)
        lines.push(`    after : ${JSON.stringify(next.definition)}`)
    }
    return lines
}
