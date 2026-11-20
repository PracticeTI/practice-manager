/**
 * Schema bootstrap for a fresh database.
 *
 * Tables in this app are created lazily by the module that owns them, which keeps each
 * feature self-contained but leaves a brand-new database empty until something touches
 * every feature. A first install needs all of them before the first job can run: the
 * queue tables create themselves on write, but a worker that claims a report job
 * immediately queries `patients`.
 *
 * Each step is idempotent (the helpers use `CREATE TABLE IF NOT EXISTS`), so this is safe
 * to run on every start. Failures are collected rather than thrown so an operator sees
 * every gap in one pass; the CLI decides the exit code.
 *
 * Display order below is dependency order where it matters (patients before the records
 * that reference them). Steps that open their own connection ignore the shared one.
 */

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensurePatientsImportSchema } from '@/lib/patientsTable'
import { ensureAppointmentsTable } from '@/lib/appointmentsTable'
import { ensureNotesTable } from '@/lib/notesTable'
import { ensurePatientCasesTables } from '@/lib/patientCasesTable'
import { ensurePatientFilesTable } from '@/lib/patientFilesTable'
import { ensurePatientTranscriptionsTable } from '@/lib/patientTranscriptionsTable'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { ensureContactsTable } from '@/lib/contactsTable'
import { ensureFundersTables } from '@/lib/fundersTable'
import { ensureFormsTable } from '@/lib/formsTable'
import { ensureActivitiesTable } from '@/lib/activitiesTable'
import { ensureBillingTable } from '@/lib/billingTable'
import { ensureChatsTable } from '@/lib/chats'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { ensureSettingsTables } from '@/lib/appSettings'
import { ensureRateLimitTable } from '@/lib/rateLimits'
import { ensureTaskEntriesTable } from '@/lib/taskEntries'
import { ensureAdminSuppressedNotificationsTable } from '@/lib/adminNotifications'
import { ensureReportSettingsTables } from '@/lib/reportSettingsStore'
import { ensureQuoteWriterTables } from '@/lib/quoteWriter'
import { ensureContactEnquiryReviewColumns, resolveOutboundTableName } from '@/lib/contactEnquiryReview'
import { ensureReportReviewColumns } from '@/lib/patientReportReview'
import { coreSchemaStatements } from '@/lib/coreSchema'
import {
    ensureReportQueueTable,
    ensureAnalysisQueueTable,
    ensureScribeQueueTable,
    ensureBillingQueueTable,
    ensureEmailQueueTable,
    ensureEquipmentSourcerQueueTable,
    ensureInboundEmailTable,
} from '@practice-manager/jobs/queues'

const DEFAULT_EMAIL_QUEUE_TABLE = 'outbound_messages'

function resolveEmailQueueTable() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_EMAIL_QUEUE_TABLE).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

/**
 * Ordered bootstrap steps. `run` receives `{ connection, dbType }`; a step that manages
 * its own connection simply ignores them.
 */
export const SCHEMA_STEPS = [
    { name: 'patients', run: () => ensurePatientsImportSchema() },
    { name: 'appointments', run: () => ensureAppointmentsTable() },
    { name: 'notes', run: () => ensureNotesTable() },
    { name: 'patient-cases', run: () => ensurePatientCasesTables() },
    { name: 'patient-files', run: () => ensurePatientFilesTable() },
    { name: 'transcriptions', run: () => ensurePatientTranscriptionsTable() },
    { name: 'patient-quotes', run: () => ensurePatientQuotesTables() },
    { name: 'service-agreements', run: () => ensurePatientServiceAgreementsTables() },
    { name: 'contacts', run: () => ensureContactsTable() },
    { name: 'funders', run: () => ensureFundersTables() },
    { name: 'forms', run: () => ensureFormsTable() },
    { name: 'activities', run: () => ensureActivitiesTable() },
    { name: 'billing', run: () => ensureBillingTable() },
    { name: 'chats', run: ({ connection, dbType }) => ensureChatsTable(connection, dbType) },
    { name: 'scheduling', run: () => ensureSchedulingTables() },
    { name: 'settings', run: () => ensureSettingsTables() },
    {
        name: 'core-content',
        run: async ({ connection }) => {
            for (const statement of coreSchemaStatements()) await connection.query(statement)
        },
    },
    { name: 'rate-limits', run: ({ connection }) => ensureRateLimitTable(connection) },
    { name: 'task-entries', run: ({ connection }) => ensureTaskEntriesTable(connection) },
    { name: 'notification-suppressions', run: ({ connection }) => ensureAdminSuppressedNotificationsTable(connection) },
    { name: 'report-settings', run: ({ connection, dbType }) => ensureReportSettingsTables(connection, dbType) },
    { name: 'quote-writer', run: ({ connection }) => ensureQuoteWriterTables(connection) },
    { name: 'queue-report', run: ({ connection, dbType }) => ensureReportQueueTable(connection, dbType) },
    { name: 'queue-analysis', run: ({ connection, dbType }) => ensureAnalysisQueueTable(connection, dbType) },
    { name: 'queue-scribe', run: ({ connection, dbType }) => ensureScribeQueueTable(connection, dbType) },
    { name: 'queue-billing', run: ({ connection, dbType }) => ensureBillingQueueTable(connection, dbType) },
    { name: 'queue-email', run: ({ connection, dbType }) => ensureEmailQueueTable(connection, dbType, resolveEmailQueueTable()) },
    { name: 'queue-equipment', run: ({ connection, dbType }) => ensureEquipmentSourcerQueueTable(connection, dbType) },
    { name: 'inbound-email', run: ({ connection, dbType }) => ensureInboundEmailTable(connection, dbType) },
    { name: 'outbound-review-columns', run: ({ connection }) => ensureContactEnquiryReviewColumns(connection, resolveOutboundTableName()) },
    { name: 'report-review-columns', run: ({ connection }) => ensureReportReviewColumns(connection) },
]

/**
 * Apply every step.
 *
 * @param {{ databaseUrl?: string, log?: (message: string) => void }} [options]
 * @returns {Promise<{ dbType: string, applied: string[], failed: Array<{ name: string, error: string }> }>}
 */
export async function bootstrapSchema(options = {}) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error(`Schema bootstrap requires PostgreSQL (detected ${dbType || 'no database'})`)
    }

    const log = typeof options.log === 'function' ? options.log : () => {}
    const applied = []
    const failed = []

    let connection = null
    try {
        connection = await getDatabaseConnection()

        for (const step of SCHEMA_STEPS) {
            try {
                await step.run({ connection, dbType })
                applied.push(step.name)
                log(`ok   ${step.name}`)
            } catch (error) {
                const message = error?.message || String(error)
                failed.push({ name: step.name, error: message })
                log(`FAIL ${step.name}: ${message}`)
            }
        }
    } finally {
        if (connection?.end) await connection.end().catch(() => {})
        else if (connection?.close) await connection.close().catch(() => {})
    }

    return { dbType, applied, failed }
}
