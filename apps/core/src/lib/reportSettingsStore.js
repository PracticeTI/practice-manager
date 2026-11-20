import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'
import { isTemplateLibraryTemplate } from '@/lib/templateLibrary'
import { mergeLibraryTemplates } from '@/lib/templateLibraryServer'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function parseJsonObject(value, fallback = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    if (typeof value !== 'string') return fallback

    try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed
        }
        return fallback
    } catch {
        return fallback
    }
}

function normalizeTimestamp(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
}

function requireRelationalDbType() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Report settings require a configured PostgreSQL database')
    }
    return dbType
}

export async function ensureReportSettingsTables(connection, dbType) {
    await whenTablesMissing(connection, ['report_domain_settings'], async () => {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS report_domain_settings (
                id BIGSERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                settings_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT report_domain_settings_domain_unique UNIQUE (domain)
            )
        `)
        await connection.query('CREATE INDEX IF NOT EXISTS report_domain_settings_updated_idx ON report_domain_settings (updated_at)')

        await connection.query(`
            CREATE TABLE IF NOT EXISTS report_templates (
                id BIGSERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                template_id VARCHAR(191) NOT NULL,
                name VARCHAR(255) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                mime_type VARCHAR(150) NOT NULL,
                size_bytes BIGINT NOT NULL DEFAULT 0,
                content_base64 TEXT NOT NULL,
                uploaded_at TIMESTAMP NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT report_templates_domain_template_unique UNIQUE (domain, template_id)
            )
        `)
    })
    // Index creation is an owner-only upgrade: a bound request skips it instead of
    // failing, and `npm run db:prepare` is where it actually runs.
    await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS report_templates_domain_updated_idx ON report_templates (domain, updated_at)')
    await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS report_templates_domain_name_idx ON report_templates (domain, name)')
}

async function readDomainSettings(connection, dbType, domain) {
    const result = await connection.query(
        'SELECT settings_json FROM report_domain_settings WHERE domain = $1 LIMIT 1',
        [domain]
    )
    const raw = result.rows?.[0]?.settings_json || '{}'
    return parseJsonObject(raw, {})
}

async function listTemplates(connection, dbType, domain) {
    const result = await connection.query(
        `
        SELECT template_id, name, file_name, mime_type, size_bytes, content_base64, uploaded_at, metadata_json
        FROM report_templates
        WHERE domain = $1
        ORDER BY updated_at DESC, created_at DESC, id DESC
    `,
        [domain]
    )

    return (result.rows || []).map((row) => {
        const metadata = parseJsonObject(row.metadata_json, {})
        return {
            id: String(row.template_id || '').trim(),
            name: String(row.name || '').trim(),
            fileName: String(row.file_name || '').trim(),
            mimeType: String(row.mime_type || '').trim(),
            size: Number.parseInt(String(row.size_bytes || '0'), 10) || 0,
            contentBase64: String(row.content_base64 || '').trim(),
            uploadedAt: normalizeTimestamp(row.uploaded_at) || new Date().toISOString(),
            source: String(metadata.source || '').trim(),
            sourceDocId: String(metadata.sourceDocId || '').trim(),
            sourceUrl: String(metadata.sourceUrl || '').trim(),
        }
    })
}

async function upsertDomainSettings(connection, dbType, domain, settingsObject) {
    const serialized = JSON.stringify(settingsObject || {})

    await connection.query(
        `
        INSERT INTO report_domain_settings (domain, settings_json, created_at, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (domain)
        DO UPDATE SET
            settings_json = EXCLUDED.settings_json,
            updated_at = CURRENT_TIMESTAMP
    `,
        [domain, serialized]
    )
}

async function deleteTemplatesByDomain(connection, dbType, domain) {
    await connection.query('DELETE FROM report_templates WHERE domain = $1', [domain])
}

async function insertTemplate(connection, dbType, domain, template) {
    const templateId = String(template?.id || '').trim()
    if (!templateId) return

    const name = String(template?.name || '').trim() || 'Template'
    const fileName = String(template?.fileName || '').trim() || 'template.txt'
    const mimeType = String(template?.mimeType || '').trim() || 'application/octet-stream'
    const size = Number.parseInt(String(template?.size || '0'), 10)
    const sizeBytes = Number.isFinite(size) && size >= 0 ? size : 0
    const contentBase64 = String(template?.contentBase64 || '').trim()
    const uploadedAt = normalizeTimestamp(template?.uploadedAt)
    const metadataJson = JSON.stringify({
        source: String(template?.source || '').trim(),
        sourceDocId: String(template?.sourceDocId || '').trim(),
        sourceUrl: String(template?.sourceUrl || '').trim(),
    })

    await connection.query(
        `
        INSERT INTO report_templates (
            domain,
            template_id,
            name,
            file_name,
            mime_type,
            size_bytes,
            content_base64,
            uploaded_at,
            metadata_json,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
        [domain, templateId, name, fileName, mimeType, sizeBytes, contentBase64, uploadedAt, metadataJson]
    )
}

async function beginTransaction(connection, dbType) {
    await connection.query('BEGIN')
}

async function commitTransaction(connection, dbType) {
    await connection.query('COMMIT')
}

async function rollbackTransaction(connection, dbType) {
    await connection.query('ROLLBACK')
}

/**
 * Read a domain's report settings and templates.
 *
 * Both tables carry a `domain` column and sit in the tenant policy set, so the
 * read must run on a session with `app.current_domain` bound. A caller that
 * already holds one — `options.connection` — passes it in and keeps ownership;
 * otherwise this opens its own connection as before.
 */
export async function readReportSettingsForDomain(rawDomain, options = {}) {
    const domain = normalizeDomainKey(rawDomain)
    if (!domain) {
        throw new Error('domain is required')
    }

    const dbType = requireRelationalDbType()
    const inherited = options?.connection || null
    let connection = null
    try {
        connection = inherited || await getDomainBoundConnection(domain)
        await ensureReportSettingsTables(connection, dbType)

        const settings = await readDomainSettings(connection, dbType, domain)
        const storedTemplates = await listTemplates(connection, dbType, domain)
        // Template Library entries (private .md files under content/) are derived on
        // read, so library edits show up without re-importing them per domain.
        const templates = await mergeLibraryTemplates(domain, storedTemplates)

        return {
            settings,
            templates,
        }
    } finally {
        if (!inherited && connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function writeReportSettingsForDomain(rawDomain, nextSettings) {
    const domain = normalizeDomainKey(rawDomain)
    if (!domain) {
        throw new Error('domain is required')
    }

    const dbType = requireRelationalDbType()
    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)
        await ensureReportSettingsTables(connection, dbType)

        const settingsToPersist = {
            reportTypes: Array.isArray(nextSettings?.reportTypes) ? nextSettings.reportTypes : [],
            config: nextSettings?.config && typeof nextSettings.config === 'object' ? nextSettings.config : {},
            updatedAt: new Date().toISOString(),
        }
        // Library templates are derived on read, never persisted — keep them out of
        // report_templates so the on-disk library stays the single source of truth.
        const templates = (Array.isArray(nextSettings?.templates) ? nextSettings.templates : [])
            .filter((template) => !isTemplateLibraryTemplate(template))

        await beginTransaction(connection, dbType)
        try {
            await upsertDomainSettings(connection, dbType, domain, settingsToPersist)
            await deleteTemplatesByDomain(connection, dbType, domain)
            for (const template of templates) {
                await insertTemplate(connection, dbType, domain, template)
            }
            await commitTransaction(connection, dbType)
        } catch (error) {
            await rollbackTransaction(connection, dbType)
            throw error
        }

        const settings = await readDomainSettings(connection, dbType, domain)
        const persistedTemplates = await listTemplates(connection, dbType, domain)

        return {
            settings,
            templates: persistedTemplates,
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function readReportConfigForDomain(rawDomain) {
    const domain = normalizeDomainKey(rawDomain)
    if (!domain) return {}

    const dbType = requireRelationalDbType()
    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)
        await ensureReportSettingsTables(connection, dbType)
        const settings = await readDomainSettings(connection, dbType, domain)
        return settings?.config && typeof settings.config === 'object' ? settings.config : {}
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}