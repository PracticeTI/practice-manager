import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureAppointmentsTable } from '@/lib/appointmentsTable'
import {
    APPOINTMENT_CONFLICT_CONSTRAINT_NAME,
    APPOINTMENT_CONFLICT_CONSTRAINT_SQL,
    SCHEDULING_COLUMN_STATEMENTS,
    SCHEDULING_INDEX_STATEMENTS,
    SCHEDULING_TABLE_STATEMENTS,
} from '@/lib/schedulingSchema'
import { applyAppointmentConflictConstraint } from '@/lib/schedulingConstraint'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Creates the native scheduling tables that sit alongside the appointment
// mirror: practitioners, practice locations, services, the practitioner/service
// assignment table, and practitioner availability.
//
// The tables are domain-scoped and deliberately have no foreign keys, matching
// the rest of the feature tables. A renamed or archived practitioner therefore
// never blocks an appointment from loading.
export async function ensureSchedulingTables() {
    if (!schedulingSchemaPromise) {
        schedulingSchemaPromise = applySchedulingSchema().catch((error) => {
            schedulingSchemaPromise = null
            throw error
        })
    }
    return schedulingSchemaPromise
}

let schedulingSchemaPromise = null

// Everything SCHEDULING_TABLE_STATEMENTS creates.
const SCHEDULING_TABLES = [
    'appointments',
    'practitioners',
    'practice_locations',
    'services',
    'practitioner_services',
    'availability_rules',
    'availability_exceptions',
    'calendar_connections',
    'calendar_busy_blocks',
    'appointment_reminders',
    'waitlist_entries',
    'waitlist_offers',
]

async function applySchedulingSchema() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Scheduling requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        await ensureAppointmentsTable(connection)

        // Creating, altering and indexing all need the schema owner, so a
        // provisioned database must issue none of it. The tables come from
        // `npm run db:prepare`'s owner pass; the columns and indexes are upgrades
        // that a constrained runtime role legitimately cannot apply.
        await whenTablesMissing(connection, SCHEDULING_TABLES, async () => {
            for (const statement of SCHEDULING_TABLE_STATEMENTS) {
                await connection.query(statement)
            }
        })
        for (const statement of SCHEDULING_COLUMN_STATEMENTS) {
            await runOptionalDdl(connection, statement)
        }
        for (const statement of SCHEDULING_INDEX_STATEMENTS) {
            await runOptionalDdl(connection, statement)
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

/**
 * Apply the practitioner overlap protection.
 *
 * Exposed for the migration and for operators. Request handlers should not call
 * this because legacy imports may still contain overlaps.
 */
export async function ensureAppointmentConflictConstraint({ dryRun = false } = {}) {
    let connection = null
    try {
        connection = await getDatabaseConnection()
        return await applyAppointmentConflictConstraint(connection, {
            dryRun,
            constraintName: APPOINTMENT_CONFLICT_CONSTRAINT_NAME,
            constraintSql: APPOINTMENT_CONFLICT_CONSTRAINT_SQL,
        })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
