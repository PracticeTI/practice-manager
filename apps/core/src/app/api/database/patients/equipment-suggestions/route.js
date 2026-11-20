import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getSupplierDomain } from '@/lib/equipmentDirectory'
import { resolveEquipmentSourcerQueueTableName } from '@/lib/patientEquipmentQueue'
import { resolveDomainSourcing } from '@/lib/equipmentSourcing'
import { enqueueOutboundEmail } from '@/lib/serviceClient'
import { getDomainSetting } from '@/lib/appSettings'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import {
    applySourcingTemplateTokens,
    EQUIPMENT_QUOTE_REQUEST_CATEGORY,
    resolveDomainLogoUrl,
    resolveSourcingReplyTo,
    resolveSourcingSender,
    resolveSourcingSenderEmail,
} from '@/lib/equipmentQuoteRequest'

const DEFAULT_RESULTS_TABLE = 'patient_equipment_suggestions'
const DEFAULT_EMAIL_QUEUE_TABLE = 'outbound_messages'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveResultsTable() {
    const table = String(process.env.EQUIPMENT_SOURCER_RESULTS_TABLE || DEFAULT_RESULTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EQUIPMENT_SOURCER_RESULTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function normalizePatientId(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(String(value || '[]'))
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function normalizeSuggestions(value) {
    return parseJsonArray(value).map((suggestion) => ({
        ...suggestion,
        description: String(suggestion?.description || suggestion?.justification || '').trim(),
        sourcingStatus: String(suggestion?.sourcingStatus || 'unsourced').trim().toLowerCase(),
    }))
}

function statusLabel(status) {
    if (status === 'processing') return 'Working'
    if (status === 'completed') return 'Ready'
    if (status === 'failed') return 'Failed'
    return 'Waiting'
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
}

function isMissingColumnError(error, columnName) {
    const message = String(error?.message || '').toLowerCase()
    const normalizedColumn = String(columnName || '').trim().toLowerCase()
    if (!normalizedColumn) return false
    return (message.includes('unknown column') || message.includes('does not exist')) && message.includes(normalizedColumn)
}

async function readSuggestions(connection, resultsTable, domain, patientId) {
    const sql = `SELECT suggestions_json FROM ${resultsTable} WHERE domain = $1 AND patient_id = $2 LIMIT 1`
    const result = await connection.query(sql, [domain, patientId])
    const row = result.rows?.[0]
    return normalizeSuggestions(row?.suggestions_json)
}

async function writeSuggestions(connection, resultsTable, domain, patientId, suggestions) {
    const sql = `UPDATE ${resultsTable} SET suggestions_json = $1, updated_at = NOW() WHERE domain = $2 AND patient_id = $3`
    const values = [JSON.stringify(suggestions), domain, patientId]
    await connection.query(sql, values)
}

export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const scope = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain
    const patientId = normalizePatientId(searchParams.get('patient_id'))
    if (!patientId) {
        return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const queueTable = resolveEquipmentSourcerQueueTableName()
        const resultsTable = resolveResultsTable()

        // Supplier replies arrive by email: fold any matched inbound response
        // into the stored sourcing status before the suggestions are rendered.
        try {
            await resolveDomainSourcing(connection, domain, { persist: true, patientId })
        } catch (error) {
            console.warn('Failed to reconcile equipment sourcing status:', error?.message || error)
        }

        let latestJob = null
        try {
            const sql = `SELECT * FROM ${queueTable} WHERE domain = $1 AND patient_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`
            const result = await connection.query(sql, [domain, patientId])
            latestJob = result.rows?.[0] || null
        } catch (error) {
            if (!isMissingTableError(error)) throw error
        }

        let resultRow = null
        try {
            const sql = `SELECT * FROM ${resultsTable} WHERE domain = $1 AND patient_id = $2 LIMIT 1`
            const result = await connection.query(sql, [domain, patientId])
            resultRow = result.rows?.[0] || null
        } catch (error) {
            if (!isMissingTableError(error)) throw error
        }

        const status = String(latestJob?.status || 'none').trim().toLowerCase()
        const resultMatchesLatestJob = status === 'completed'
            && String(resultRow?.last_job_id || '') === String(latestJob?.id || '')

        return NextResponse.json({
            success: true,
            status,
            statusLabel: statusLabel(status),
            latest: latestJob ? {
                id: latestJob.id,
                status,
                attempts: Number(latestJob.attempts || 0),
                errorMessage: latestJob.error_message || null,
                createdAt: latestJob.created_at || null,
                updatedAt: latestJob.updated_at || null,
                completedAt: latestJob.completed_at || null,
            } : null,
            result: resultMatchesLatestJob ? {
                id: resultRow.id,
                suggestions: normalizeSuggestions(resultRow.suggestions_json),
                sourceReportId: resultRow.source_report_id || null,
                sourceReportUpdatedAt: resultRow.source_report_updated_at || null,
                updatedAt: resultRow.updated_at || null,
            } : null,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load equipment suggestions' }, { status: 500 })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}

export async function PATCH(request) {
    const body = await request.json().catch(() => ({}))
    const scope = await resolveAdminDomainScope(request, body?.domain)
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain
    const patientId = normalizePatientId(body?.patient_id)
    const itemIndex = Number.parseInt(String(body?.item_index ?? ''), 10)
    const resetStatus = body?.action === 'reset_status'
    const name = String(body?.name || '').trim()
    const description = String(body?.description || '').trim()
    if (!patientId || !Number.isInteger(itemIndex) || itemIndex < 0 || (!resetStatus && !name)) {
        return NextResponse.json({ success: false, error: 'domain, patient_id, item_index, and name are required' }, { status: 400 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const resultsTable = resolveResultsTable()
        const suggestions = await readSuggestions(connection, resultsTable, domain, patientId)
        if (!suggestions[itemIndex]) {
            return NextResponse.json({ success: false, error: 'Equipment item not found' }, { status: 404 })
        }

        if (resetStatus) {
            const { quoteRequest, ...suggestionWithoutQuoteRequest } = suggestions[itemIndex]
            suggestions[itemIndex] = {
                ...suggestionWithoutQuoteRequest,
                sourcingStatus: 'unsourced',
            }
        } else {
            suggestions[itemIndex] = {
                ...suggestions[itemIndex],
                equipmentType: name,
                description,
                sourcingStatus: suggestions[itemIndex].sourcingStatus || 'unsourced',
            }
        }
        await writeSuggestions(connection, resultsTable, domain, patientId, suggestions)

        return NextResponse.json({ success: true, suggestion: suggestions[itemIndex] })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update equipment item' }, { status: 500 })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}

function normalizeEmail(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

function resolveEmailQueueTableName() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_EMAIL_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

async function insertLocalEmailQueue(connection, message) {
    const table = resolveEmailQueueTableName()
    const values = [
        message.toEmail,
        message.category,
        message.payload?.domain || null,
        message.subject || null,
        message.text || null,
        message.html || null,
        JSON.stringify(message.payload || {}),
    ]

    try {
        const result = await connection.query(
            `INSERT INTO ${table} (status, to_email, category, domain, subject, text_body, html_body, payload_json, attempts, created_at, updated_at)
             VALUES ('queued', $1, $2, $3, $4, $5, $6, $7, 0, NOW(), NOW()) RETURNING id`,
            values
        )
        return result?.rows?.[0]?.id || null
    } catch (error) {
        if (!isMissingColumnError(error, 'html_body')) throw error
        const fallbackResult = await connection.query(
            `INSERT INTO ${table} (status, to_email, category, domain, subject, text_body, payload_json, attempts, created_at, updated_at)
             VALUES ('queued', $1, $2, $3, $4, $5, $6, 0, NOW(), NOW()) RETURNING id`,
            [
                message.toEmail,
                message.category,
                message.payload?.domain || null,
                message.subject || null,
                message.text || null,
                JSON.stringify(message.payload || {}),
            ]
        )
        return fallbackResult?.rows?.[0]?.id || null
    }
}

export async function POST(request) {
    const body = await request.json().catch(() => ({}))
    const scope = await resolveAdminDomainScope(request, body?.domain)
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain
    const patientId = normalizePatientId(body?.patient_id)
    const itemIndex = Number.parseInt(String(body?.item_index ?? ''), 10)
    const toEmail = normalizeEmail(body?.to_email)
    const supplierDomain = getSupplierDomain(body?.supplier_website)
    const subject = String(body?.subject || '').trim()
    const messageBody = String(body?.body || '').trim()
    const htmlBody = String(body?.html || '').trim()
    const bccReplyToRequested = body?.bcc_reply_to

    if (!patientId || !Number.isInteger(itemIndex) || itemIndex < 0) {
        return NextResponse.json({ success: false, error: 'domain, patient_id, and item_index are required' }, { status: 400 })
    }
    if (!toEmail) {
        return NextResponse.json({ success: false, error: 'A valid supplier email address is required' }, { status: 400 })
    }
    if (!subject || !messageBody) {
        return NextResponse.json({ success: false, error: 'subject and body are required' }, { status: 400 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
    }

    const domainSetting = (await getDomainSetting(domain, 'management')) || {}
    const bccReplyTo = typeof bccReplyToRequested === 'boolean'
        ? bccReplyToRequested
        : domainSetting?.sourcingBccReplyToDefault === true
    const displayName = String(domainSetting?.displayName || '').trim() || domain
    const senderEmail = resolveSourcingSenderEmail(displayName)
    const replyToAddress = normalizeEmail(domainSetting?.sourcingReplyToEmail) || senderEmail
    const replyToEmail = resolveSourcingReplyTo(domainSetting?.sourcingReplyToName, replyToAddress)
    const requestOrigin = (() => {
        try {
            return new URL(request.url).origin
        } catch {
            return ''
        }
    })()
    const domainLogoUrl = resolveDomainLogoUrl({
        domainKey: String(domainSetting?.domainKey || domain || '').trim().toLowerCase(),
        publicBaseUrl: domainSetting?.publicBaseUrl,
        primaryHostname: domainSetting?.primaryHostname,
        fallbackOrigin: requestOrigin,
    })
    const renderedSubject = applySourcingTemplateTokens(subject, { domainLogoUrl }).trim()
    const renderedMessageBody = applySourcingTemplateTokens(messageBody, { domainLogoUrl }).trim()
    const renderedHtmlBody = applySourcingTemplateTokens(htmlBody, { domainLogoUrl }).trim()
    const requestedAt = new Date().toISOString()

    // The BCC is the practice's own copy of a quote request, kept whether or not
    // admin notifications are on: the request going out is not the alert, the
    // supplier's reply is (see `notifyEquipmentQuoteReplies`).
    const bccRecipient = bccReplyTo && replyToAddress ? replyToAddress : ''

    const outboundMessage = {
        toEmail,
        category: EQUIPMENT_QUOTE_REQUEST_CATEGORY,
        subject: renderedSubject,
        text: renderedMessageBody,
        html: renderedHtmlBody || undefined,
        payload: {
            domain,
            subject: renderedSubject,
            text: renderedMessageBody,
            html: renderedHtmlBody || undefined,
            senderEmail: resolveSourcingSender(displayName) || undefined,
            replyToEmail: replyToEmail || undefined,
            bccEmail: bccRecipient || undefined,
            domainLogoUrl: domainLogoUrl || undefined,
            source: 'one:equipment-sourcing-wizard',
            supplier: String(body?.supplier_name || '').trim() || null,
            supplierId: body?.supplier_id ?? null,
            requestedAt,
        },
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const resultsTable = resolveResultsTable()
        const suggestions = await readSuggestions(connection, resultsTable, domain, patientId)
        if (!suggestions[itemIndex]) {
            return NextResponse.json({ success: false, error: 'Equipment item not found' }, { status: 404 })
        }

        const upstream = await enqueueOutboundEmail(outboundMessage)
        const queueId = upstream?.success
            ? (upstream?.id ?? null)
            : await insertLocalEmailQueue(connection, outboundMessage)

        suggestions[itemIndex] = {
            ...suggestions[itemIndex],
            sourcingStatus: 'quote_requested',
            quoteRequest: {
                supplierId: body?.supplier_id ?? null,
                supplierName: String(body?.supplier_name || '').trim() || null,
                // Captured when the request is sent so the Sourcing card can
                // show the supplier's favicon later.
                supplierDomain: supplierDomain || null,
                toEmail,
                subject: renderedSubject,
                queueId,
                requestedAt,
            },
        }
        await writeSuggestions(connection, resultsTable, domain, patientId, suggestions)

        return NextResponse.json({
            success: true,
            queued: true,
            queueId,
            localFallback: !upstream?.success,
            suggestion: suggestions[itemIndex],
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to queue quote request' }, { status: 500 })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}
