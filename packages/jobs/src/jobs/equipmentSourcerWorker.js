import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensureEquipmentSourcerQueueTable, resolveEquipmentSourcerQueueTableName } from './equipmentSourcerQueue.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_STALE_PROCESSING_MINUTES = 15
const DEFAULT_RESULTS_TABLE = 'patient_equipment_suggestions'
const DEFAULT_REPORTS_TABLE = 'patient_reports'

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveTableName(environmentKey, fallback) {
    const table = String(process.env[environmentKey] || fallback).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error(`${environmentKey} must be a safe SQL identifier (letters, numbers, underscore)`)
    }
    return table
}

function getConfig() {
    return {
        enabled: isTrue(process.env.EQUIPMENT_SOURCER_WORKER_ENABLED || 'false'),
        queueTable: resolveEquipmentSourcerQueueTableName(),
        resultsTable: resolveTableName('EQUIPMENT_SOURCER_RESULTS_TABLE', DEFAULT_RESULTS_TABLE),
        reportsTable: resolveTableName('PATIENT_REPORTS_TABLE', DEFAULT_REPORTS_TABLE),
        batchSize: parsePositiveInt(process.env.EQUIPMENT_SOURCER_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.EQUIPMENT_SOURCER_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        maxAttempts: parsePositiveInt(process.env.EQUIPMENT_SOURCER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        staleProcessingMinutes: parsePositiveInt(process.env.EQUIPMENT_SOURCER_STALE_PROCESSING_MINUTES, DEFAULT_STALE_PROCESSING_MINUTES),
    }
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function equipmentSection(reportMarkdown) {
    const source = String(reportMarkdown || '')
    const lower = source.toLowerCase()
    const startHints = ['assistive technology or equipment', 'assistive technology', 'equipment recommended']
    const start = startHints.map((hint) => lower.indexOf(hint)).find((index) => index >= 0)
    if (start === undefined) return ''

    const tail = source.slice(start)
    const tailLower = tail.toLowerCase()
    const endHints = ['additional ot funding', 'summary of plan', 'further assessment']
    const end = endHints
        .map((hint) => tailLower.indexOf(hint, 20))
        .filter((index) => index > 0)
        .sort((left, right) => left - right)[0]
    return tail.slice(0, end || Math.min(tail.length, 20000))
}

function parseMarkdownTableRow(line) {
    const source = String(line || '').trim()
    if (!source.startsWith('|') || !source.endsWith('|')) return []

    const cells = []
    let current = ''
    let escaped = false
    for (const character of source.slice(1, -1)) {
        if (escaped) {
            current += character
            escaped = false
        } else if (character === '\\') {
            escaped = true
        } else if (character === '|') {
            cells.push(current.trim())
            current = ''
        } else {
            current += character
        }
    }
    cells.push(current.trim())
    return cells.map(decodeHtml)
}

export function extractEquipmentSuggestions(reportMarkdown) {
    const section = equipmentSection(reportMarkdown)
    if (!section) return []

    const suggestions = []
    for (const rowMatch of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
            .map((match) => decodeHtml(match[1]))
        if (cells.length < 4) continue
        if (/^(equipment|equipment type)$/i.test(cells[0])) continue
        if (!cells.some(Boolean)) continue

        suggestions.push({
            equipmentType: cells[0],
            supplier: cells[1],
            trialSummary: cells[2],
            justification: cells[3],
            source: 'Latest TAC OTF10 report',
        })
    }

    for (const line of section.split('\n')) {
        const cells = parseMarkdownTableRow(line)
        if (cells.length < 4) continue
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
        if (/^equipment(?: type)?\b/i.test(cells[0])) continue
        if (!cells.some(Boolean)) continue

        suggestions.push({
            equipmentType: cells[0],
            supplier: cells[1],
            trialSummary: cells[2],
            justification: cells[3],
            source: 'Latest TAC OTF10 report',
        })
    }

    return suggestions.filter((suggestion, index, all) => {
        const key = [suggestion.equipmentType, suggestion.supplier, suggestion.trialSummary, suggestion.justification]
            .map((value) => String(value || '').trim().toLowerCase())
            .join('|')
        return all.findIndex((candidate) => [candidate.equipmentType, candidate.supplier, candidate.trialSummary, candidate.justification]
            .map((value) => String(value || '').trim().toLowerCase())
            .join('|') === key) === index
    })
}

function parseJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function isOtf10Report(row) {
    const metadata = parseJsonObject(row?.source_metadata_json)
    const reportType = `${metadata.reportTypeId || ''} ${metadata.reportType || ''}`.toLowerCase()
    return reportType.includes('otf10') || reportType.includes('home services review')
}

function getResultsSchema(table, dbType) {
    if (dbType === 'postgresql') {
        return `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        source_report_id BIGINT,
        source_report_updated_at TIMESTAMP NULL,
        last_job_id BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ${table}_domain_patient_unique UNIQUE (domain, patient_id)
      )
    `
    }

    return `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        suggestions_json LONGTEXT NOT NULL,
        source_report_id BIGINT NULL,
        source_report_updated_at DATETIME NULL,
        last_job_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY ${table}_domain_patient_unique (domain, patient_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
}

async function ensureResultsTable(connection, dbType, table) {
    await connection.query(getResultsSchema(table, dbType))
    if (dbType === 'postgresql') {
        await ensurePermissiveRowLevelSecurity(connection, table, `${table}_rls_policy`)
    }
}

async function fetchLatestReport(connection, dbType, table, domain, patientId) {
    const sql = `
      SELECT id, patient_name, report_markdown, source_metadata_json, updated_at, created_at
      FROM ${table}
      WHERE domain = ${dbType === 'postgresql' ? '$1' : '?'}
        AND patient_id = ${dbType === 'postgresql' ? '$2' : '?'}
        AND LOWER(COALESCE(status, 'ready')) <> 'pending delete'
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `
    if (dbType === 'postgresql') {
        const result = await connection.query(sql, [domain, patientId])
        return result.rows?.[0] || null
    }
    const [rows] = await connection.execute(sql, [domain, patientId])
    return rows?.[0] || null
}

async function saveSuggestions(connection, dbType, table, row, report, suggestions) {
    const values = [row.domain, row.patient_id, row.patient_name || report.patient_name || null, JSON.stringify(suggestions), report.id, report.updated_at || report.created_at || null, row.id]
    if (dbType === 'postgresql') {
        await connection.query(
            `INSERT INTO ${table} (domain, patient_id, patient_name, status, suggestions_json, source_report_id, source_report_updated_at, last_job_id, created_at, updated_at)
             VALUES ($1, $2, $3, 'ready', $4, $5, $6, $7, NOW(), NOW())
             ON CONFLICT (domain, patient_id) DO UPDATE SET patient_name = EXCLUDED.patient_name, status = 'ready', suggestions_json = EXCLUDED.suggestions_json, source_report_id = EXCLUDED.source_report_id, source_report_updated_at = EXCLUDED.source_report_updated_at, last_job_id = EXCLUDED.last_job_id, updated_at = NOW()`,
            values
        )
        return
    }
    await connection.execute(
        `INSERT INTO ${table} (domain, patient_id, patient_name, status, suggestions_json, source_report_id, source_report_updated_at, last_job_id, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE patient_name = VALUES(patient_name), status = 'ready', suggestions_json = VALUES(suggestions_json), source_report_id = VALUES(source_report_id), source_report_updated_at = VALUES(source_report_updated_at), last_job_id = VALUES(last_job_id), updated_at = UTC_TIMESTAMP()`,
        values
    )
}

async function claimJobs(connection, dbType, table, config, workerId) {
    if (dbType === 'postgresql') {
        const result = await connection.query(
            `WITH candidate AS (
               SELECT id FROM ${table}
               WHERE status = 'queued'
                 AND (next_attempt_at IS NULL OR next_attempt_at <= (NOW() AT TIME ZONE 'UTC'))
                 AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1)
               ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED
             )
             UPDATE ${table} q SET status = 'processing', claimed_at = NOW(), claimed_by = $3, updated_at = NOW()
             FROM candidate WHERE q.id = candidate.id RETURNING q.*`,
            [config.maxAttempts, config.batchSize, workerId]
        )
        return result.rows || []
    }

    await connection.beginTransaction()
    try {
        const [rows] = await connection.execute(
            `SELECT id FROM ${table} WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP()) AND COALESCE(attempts, 0) < COALESCE(max_attempts, ?) ORDER BY created_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
            [config.maxAttempts, config.batchSize]
        )
        const ids = rows.map((row) => row.id)
        if (ids.length === 0) {
            await connection.commit()
            return []
        }
        const placeholders = ids.map(() => '?').join(', ')
        await connection.execute(`UPDATE ${table} SET status = 'processing', claimed_at = UTC_TIMESTAMP(), claimed_by = ?, updated_at = UTC_TIMESTAMP() WHERE id IN (${placeholders})`, [workerId, ...ids])
        const [claimed] = await connection.execute(`SELECT * FROM ${table} WHERE id IN (${placeholders})`, ids)
        await connection.commit()
        return claimed || []
    } catch (error) {
        await connection.rollback()
        throw error
    }
}

async function reclaimStaleJobs(connection, dbType, table, minutes) {
    if (dbType === 'postgresql') {
        const result = await connection.query(
            `UPDATE ${table} SET status = 'queued', claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
             WHERE status = 'processing' AND claimed_at <= (NOW() AT TIME ZONE 'UTC') - ($1 || ' minutes')::interval RETURNING id`,
            [minutes]
        )
        return result.rowCount || 0
    }
    const [result] = await connection.execute(
        `UPDATE ${table} SET status = 'queued', claimed_at = NULL, claimed_by = NULL, updated_at = UTC_TIMESTAMP()
         WHERE status = 'processing' AND claimed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
        [minutes]
    )
    return result?.affectedRows || 0
}

async function markCompleted(connection, dbType, table, id) {
    const sql = dbType === 'postgresql'
        ? `UPDATE ${table} SET status = 'completed', completed_at = NOW(), error_message = NULL, updated_at = NOW() WHERE id = $1`
        : `UPDATE ${table} SET status = 'completed', completed_at = UTC_TIMESTAMP(), error_message = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?`
    await (dbType === 'postgresql' ? connection.query(sql, [id]) : connection.execute(sql, [id]))
}

async function markFailed(connection, dbType, table, row, error, maxAttempts) {
    const attempts = Number(row.attempts || 0) + 1
    const failed = attempts >= Number(row.max_attempts || maxAttempts)
    const message = String(error?.message || 'Equipment Sourcer worker failed').slice(0, 2000)
    if (dbType === 'postgresql') {
        // `$3` is used both as an assignment target and in the CASE comparison below, so
        // both uses need an explicit ::text cast. Without them Postgres deduces
        // `character varying` from the assignment and `text` from `$3 = 'queued'` and
        // rejects the whole statement with 42P08 "inconsistent types deduced for
        // parameter $3" - which leaves the job stuck in `processing` (UI: "Working").
        await connection.query(
            `UPDATE ${table} SET attempts = $2::integer, status = $3::text, error_message = $4, next_attempt_at = CASE WHEN $3::text = 'queued' THEN (NOW() AT TIME ZONE 'UTC') + interval '120 seconds' ELSE NULL END, updated_at = NOW() WHERE id = $1::bigint`,
            [row.id, attempts, failed ? 'failed' : 'queued', message]
        )
        return
    }
    await connection.execute(
        `UPDATE ${table} SET attempts = ?, status = ?, error_message = ?, next_attempt_at = CASE WHEN ? = 'queued' THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND) ELSE NULL END, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [attempts, failed ? 'failed' : 'queued', message, failed ? 'failed' : 'queued', row.id]
    )
}

export async function runEquipmentSourcerWorkerCycle(options = {}) {
    const config = getConfig()
    if (!config.enabled && options.forceRun !== true) return { skipped: true, reason: 'disabled' }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        await ensureEquipmentSourcerQueueTable(connection, dbType, config.queueTable)
        await ensureResultsTable(connection, dbType, config.resultsTable)
        const reclaimed = await reclaimStaleJobs(connection, dbType, config.queueTable, config.staleProcessingMinutes)
        const jobs = await claimJobs(connection, dbType, config.queueTable, config, `two-equipment-sourcer-${process.pid}`)
        if (jobs.length === 0) return { skipped: true, reason: reclaimed ? 'reclaimed-only' : 'empty', reclaimed }

        let completed = 0
        let failed = 0
        for (const row of jobs) {
            try {
                const report = await fetchLatestReport(connection, dbType, config.reportsTable, row.domain, row.patient_id)
                if (!report || !isOtf10Report(report)) throw new Error('No current TAC OTF10 report is available for equipment sourcing')
                const suggestions = extractEquipmentSuggestions(report.report_markdown)
                await saveSuggestions(connection, dbType, config.resultsTable, row, report, suggestions)
                await markCompleted(connection, dbType, config.queueTable, row.id)
                completed += 1
            } catch (error) {
                await markFailed(connection, dbType, config.queueTable, row, error, config.maxAttempts)
                failed += 1
            }
        }
        return { skipped: false, reclaimed, claimed: jobs.length, completed, failed }
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}

export function startEquipmentSourcerWorker() {
    const config = getConfig()
    if (!config.enabled) {
        console.log('EQUIPMENT_SOURCER_WORKER_ENABLED=false - equipment sourcer worker is disabled')
        return () => { }
    }

    let stopped = false
    let timer = null
    const run = () => runEquipmentSourcerWorkerCycle().catch((error) => console.error(`[${new Date().toISOString()}] Equipment Sourcer worker cycle failed: ${error?.message || error}`))
    run()
    timer = setInterval(() => {
        if (!stopped) run()
    }, config.pollSeconds * 1000)

    return () => {
        stopped = true
        if (timer) clearInterval(timer)
    }
}

export default { startEquipmentSourcerWorker, runEquipmentSourcerWorkerCycle }