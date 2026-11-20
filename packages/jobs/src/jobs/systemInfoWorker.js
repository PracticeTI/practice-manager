/**
 * Writes a small worker health record to system_settings.
 */

import { detectDatabaseType, getDatabaseConnection } from '../database.js'

const DEFAULT_INTERVAL_SECONDS = 3600

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function getConfig() {
    const configuredName = String(process.env.ENV_HEALTH_NAME || '').trim()
    return {
        enabled: String(process.env.ENV_HEALTH_WORKER_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
        name: configuredName || String(process.env.NODE_ENV || 'default').trim(),
        intervalSeconds: parsePositiveInt(
            process.env.ENV_HEALTH_INTERVAL_SECONDS,
            DEFAULT_INTERVAL_SECONDS
        ),
    }
}

async function writeHealthRecord(connection, dbType, key, value, intervalSeconds, forceRun) {
    const serialized = JSON.stringify(value)

    if (dbType === 'postgresql') {
        const intervalGate = forceRun
            ? ''
            : `WHERE system_settings.updated_at <= NOW() - ($3 * INTERVAL '1 second')`
        const result = await connection.query(
            `INSERT INTO system_settings (key, value, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
             ${intervalGate}
             RETURNING key`,
            [key, serialized, intervalSeconds]
        )
        return (result.rows || []).length > 0
    }

    if (dbType === 'mysql') {
        const intervalGate = forceRun
            ? `\`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`
            : `\`value\` = IF(updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND), VALUES(\`value\`), \`value\`),
               updated_at = IF(updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND), CURRENT_TIMESTAMP, updated_at)`
        const values = forceRun
            ? [key, serialized]
            : [key, serialized, intervalSeconds, intervalSeconds]
        const [result] = await connection.query(
            `INSERT INTO system_settings (\`key\`, \`value\`, created_at, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE ${intervalGate}`,
            values
        )
        return result?.affectedRows !== 0
    }

    throw new Error(`Unsupported database type for environment health writes: ${dbType || 'none'}`)
}

/**
 * One database write cycle. Errors are returned for the caller to log/report.
 */
export async function runSystemInfoWorkerCycle(options = {}) {
    const config = getConfig()

    if (!config.enabled && options.forceRun !== true) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = options.dbType || detectDatabaseType()
    const name = String(options.name || config.name).trim()
    if (!name) {
        return { skipped: false, ok: false, error: 'ENV_HEALTH_NAME must not be empty' }
    }

    const key = `env_health_${name}`
    const timestamp = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString()
    const intervalSeconds = parsePositiveInt(options.intervalSeconds, config.intervalSeconds)
    const health = {
        timestamp,
        workersRan: options.workersRan === true,
    }
    let connection = options.connection || null

    try {
        if (!connection) connection = await getDatabaseConnection()
        const written = await writeHealthRecord(
            connection,
            dbType,
            key,
            health,
            intervalSeconds,
            options.forceRun === true
        )
        if (!written) return { skipped: true, reason: 'fresh', key, intervalSeconds }
        return { skipped: false, ok: true, key, health }
    } catch (error) {
        return { skipped: false, ok: false, key, error: error?.message || 'Failed to write environment health' }
    } finally {
        if (!options.connection) {
            if (connection?.end) await connection.end().catch(() => { })
            else if (connection?.close) await connection.close().catch(() => { })
        }
    }
}

export function startSystemInfoWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('ENV_HEALTH_WORKER_ENABLED=false - environment health worker is disabled')
        return () => { }
    }

    let stopped = false
    let timer = null

    const run = () => {
        if (stopped) return
        runSystemInfoWorkerCycle({ workersRan: true })
            .then((result) => {
                if (result?.skipped) return
                if (result?.ok === false) {
                    console.error(`[${new Date().toISOString()}] Environment health write failed: ${result.error}`)
                    return
                }
                console.log(
                    `[${new Date().toISOString()}] Environment health updated: ${result.key}`
                )
            })
            .catch((error) => console.error(`[${new Date().toISOString()}] Environment health worker error: ${error?.message || error}`))
    }

    run()
    timer = setInterval(run, config.intervalSeconds * 1000)

    return () => {
        stopped = true
        if (timer) clearInterval(timer)
    }
}

export default { runSystemInfoWorkerCycle, startSystemInfoWorker }
