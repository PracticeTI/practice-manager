import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'
import {
    APPOINTMENTS_BASE_INDEX_STATEMENTS,
    APPOINTMENTS_TABLE_SQL,
    APPOINTMENT_NATIVE_COLUMN_STATEMENTS,
    APPOINTMENT_NATIVE_INDEX_STATEMENTS,
} from '@/lib/schedulingSchema'

// Ensures the domain-scoped table that backs the Appointments entity.
//
// Appointments are imported from an external practice-management system (a
// Splose CSV export is the reference format) and can also be created/edited by
// hand in the admin UI. The external system's primary key is stored in
// `external_id`, so a repeat import updates the existing row instead of
// duplicating it. Following the conventions used by other feature tables in
// this platform, rows are scoped by `domain` and carry a free-form `metadata`
// JSON column for source-specific extra fields. There are no foreign keys, so a
// missing/renamed patient never blocks an import.
//
// The legacy text columns (practitioner/service/location) remain as import
// provenance. The native scheduling columns (practitioner_id, service_id,
// location_id, appointment_status, ...) are added here so every consumer of the
// appointment table sees the same shape, including the calendar and booking
// engine added in later phases.
export async function ensureAppointmentsTable(existingConnection = null) {
    if (existingConnection) {
        return applyAppointmentsSchema(existingConnection)
    }

    // Schema DDL is expensive and takes locks. Run it once per process; a
    // failed attempt clears the cache so the next request retries.
    if (!appointmentsSchemaPromise) {
        appointmentsSchemaPromise = applyAppointmentsSchemaWithOwnConnection()
            .catch((error) => {
                appointmentsSchemaPromise = null
                throw error
            })
    }
    return appointmentsSchemaPromise
}

let appointmentsSchemaPromise = null

async function applyAppointmentsSchemaWithOwnConnection() {
    let connection = null
    try {
        connection = await getDatabaseConnection()
        await applyAppointmentsSchema(connection)
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

async function applyAppointmentsSchema(connection) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Appointments require a configured PostgreSQL database')
    }

    // Every statement here needs the schema owner. A provisioned database must issue
    // none of them, so the runtime role stops failing on DDL whose change is already
    // in place. Columns and indexes are upgrades, which the owner applies.
    await whenTablesMissing(connection, ['appointments'], async () => {
        await connection.query(APPOINTMENTS_TABLE_SQL)
        for (const statement of APPOINTMENTS_BASE_INDEX_STATEMENTS) {
            await connection.query(statement)
        }
    })
    for (const statement of APPOINTMENT_NATIVE_COLUMN_STATEMENTS) {
        await runOptionalDdl(connection, statement)
    }
    for (const statement of APPOINTMENT_NATIVE_INDEX_STATEMENTS) {
        await runOptionalDdl(connection, statement)
    }
}
