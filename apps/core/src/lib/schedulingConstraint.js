// Conflict protection for the native appointment table.
//
// The exclusion constraint is applied as a deliberate migration step rather
// than during request-time schema checks: legacy imports may already contain
// overlapping rows, and adding the constraint would fail the whole migration.
// The migration reports the conflicts first and leaves the constraint off until
// they are resolved.

const ACTIVE_STATUSES = "('tentative', 'confirmed', 'arrived')"
// Busy blocks and archived rows are not bookable appointments, so they are
// excluded from overlap detection. The availability engine handles busy blocks.
const ACTIVE_APPOINTMENT_SQL = `
    COALESCE(a.unavailable_block, FALSE) = FALSE
    AND COALESCE(a.archived, FALSE) = FALSE
`

function previewError(error) {
    return error?.message ? String(error.message) : String(error)
}

export function isScheduleConflictError(error) {
    return error?.code === '23P01'
        || /exclusion constraint|conflicting key value/i.test(error?.message || '')
}

export const SCHEDULE_CONFLICT_MESSAGE = 'This practitioner already has an appointment during that time'

export async function countAppointmentConflicts(connection, { sampleLimit = 5 } = {}) {
    const table = await connection.query("SELECT to_regclass('appointments') AS reg")
    if (!table.rows?.[0]?.reg) {
        return { conflicts: 0, samples: [], tableMissing: true }
    }

    const totals = await connection.query(`
        SELECT COUNT(*)::int AS conflicts
        FROM appointments a
        JOIN appointments b
          ON b.id > a.id
         AND b.domain = a.domain
         AND b.practitioner_id = a.practitioner_id
         AND b.starts_at < a.ends_at
         AND b.ends_at > a.starts_at
         AND b.appointment_status IN ${ACTIVE_STATUSES}
        WHERE a.practitioner_id IS NOT NULL
          AND a.starts_at IS NOT NULL
          AND a.ends_at IS NOT NULL
          AND a.appointment_status IN ${ACTIVE_STATUSES}
          AND ${ACTIVE_APPOINTMENT_SQL}
    `)

    const samples = await connection.query(`
        SELECT a.id AS appointment_id,
               b.id AS conflicting_appointment_id,
               a.domain,
               a.practitioner_id,
               a.starts_at,
               a.ends_at
        FROM appointments a
        JOIN appointments b
          ON b.id > a.id
         AND b.domain = a.domain
         AND b.practitioner_id = a.practitioner_id
         AND b.starts_at < a.ends_at
         AND b.ends_at > a.starts_at
         AND b.appointment_status IN ${ACTIVE_STATUSES}
        WHERE a.practitioner_id IS NOT NULL
          AND a.starts_at IS NOT NULL
          AND a.ends_at IS NOT NULL
          AND a.appointment_status IN ${ACTIVE_STATUSES}
          AND ${ACTIVE_APPOINTMENT_SQL}
        ORDER BY a.starts_at
        LIMIT ${Math.max(1, Math.floor(Number(sampleLimit) || 5))}
    `)

    return {
        conflicts: Number(totals.rows?.[0]?.conflicts || 0),
        samples: samples.rows || [],
        tableMissing: false,
    }
}

/**
 * Add the practitioner overlap exclusion constraint when it is safe to do so.
 *
 * Returns `{ applied, reason, conflicts, samples }`. `dryRun` reports the
 * preflight result without altering the table.
 */
export async function applyAppointmentConflictConstraint(connection, {
    dryRun = false,
    constraintName,
    constraintSql,
} = {}) {
    if (!constraintName || !constraintSql) {
        return { applied: false, reason: 'constraint definition missing', conflicts: 0, samples: [] }
    }

    const table = await connection.query("SELECT to_regclass('appointments') AS reg")
    if (!table.rows?.[0]?.reg) {
        return { applied: false, reason: 'appointments table is missing', conflicts: 0, samples: [] }
    }

    const existing = await connection.query(
        'SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass LIMIT 1',
        [constraintName, 'appointments']
    )
    if (existing.rows?.length) {
        return { applied: true, reason: 'already_present', conflicts: 0, samples: [] }
    }

    const extension = await connection.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'btree_gist' LIMIT 1"
    )
    if (!extension.rows?.length) {
        if (dryRun) {
            return {
                applied: false,
                reason: 'dry run: btree_gist would be created',
                conflicts: 0,
                samples: [],
            }
        }
        try {
            await connection.query('CREATE EXTENSION IF NOT EXISTS btree_gist')
        } catch (error) {
            return {
                applied: false,
                reason: `btree_gist is not available: ${previewError(error)}`,
                conflicts: 0,
                samples: [],
            }
        }
    }

    const preflight = await countAppointmentConflicts(connection)
    if (preflight.conflicts > 0) {
        return {
            applied: false,
            reason: 'existing appointments overlap for the same practitioner',
            conflicts: preflight.conflicts,
            samples: preflight.samples,
        }
    }
    if (dryRun) {
        return {
            applied: false,
            reason: 'dry run: constraint not applied',
            conflicts: 0,
            samples: [],
        }
    }

    try {
        await connection.query(constraintSql)
        return { applied: true, reason: 'created', conflicts: 0, samples: [] }
    } catch (error) {
        if (/already exists|duplicate object/i.test(previewError(error))) {
            return { applied: true, reason: 'already_present', conflicts: 0, samples: [] }
        }
        return {
            applied: false,
            reason: `failed to add constraint: ${previewError(error)}`,
            conflicts: preflight.conflicts,
            samples: preflight.samples,
        }
    }
}
