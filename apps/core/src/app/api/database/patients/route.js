import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { enqueueBillingTask, enqueueReportTask } from '@/lib/serviceClient'
import { enqueueEquipmentSourcerJob, isEquipmentSourcerEnabled } from '@/lib/patientEquipmentQueue'
import { enqueueQuoteWriterJob, isQuoteWriterEnabled } from '@/lib/patientQuoteJobs'
import { buildReportAiUsagePayload } from '@/lib/reportAiUsagePayload'
import { enqueuePatientAnalysisJob } from '@/lib/patientAnalysisJobs'
import { enqueuePatientBillingJobLocalFallback, enqueuePatientReportJobLocalFallback } from '@/lib/patientQueueFallbacks'
import { recordActivity, resolveActivityActor } from '@/lib/activities'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { syncPatientFormContacts } from '@/lib/patientFormContacts'

function parseLimit(rawValue, defaultValue = 100, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

function normalizePatientRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
    }
}

function requireDomain(value) {
    const domain = String(value || '').trim()
    return domain || null
}

function isReportingAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.reporting === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.reporting === true
    }

    return false
}

function isBillingAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.billing === true || patientAgents.invoicing === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.billing === true || legacyAgents.invoicing === true
    }

    return false
}

function isAnalysisAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.analyst === true || patientAgents.analysis === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.analyst === true || legacyAgents.analysis === true
    }

    return false
}

async function enqueuePatientReportJob({ connection, patientId, patientName, domain, metadata }) {
    const aiUsage = await buildReportAiUsagePayload(domain)
    // Reports name the practice, not the domain key the record is stored under.
    const queueMetadata = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        practiceName: await readDomainPracticeName(domain),
    }
    let upstreamResult = null
    try {
        upstreamResult = await enqueueReportTask({
            domain,
            patientId,
            patientName,
            eventType: 'reporting_enabled',
            requestedAction: 'create_or_edit',
            payload: {
                domain,
                patientId,
                patientName,
                metadata: queueMetadata,
                aiUsage,
                source: 'one:patient-created'
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue report job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientReportJobLocalFallback({
        connection,
        patientId,
        patientName,
        domain,
        metadata: queueMetadata,
        aiUsage,
        eventType: 'reporting_enabled',
        source: 'one:patient-created'
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue report job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}

async function enqueuePatientBillingJob({ connection, patientId, patientName, domain, metadata }) {
    let upstreamResult = null
    try {
        upstreamResult = await enqueueBillingTask({
            domain,
            patientId,
            patientName,
            eventType: 'billing_enabled',
            requestedAction: 'generate_draft_invoice',
            payload: {
                domain,
                patientId,
                patientName,
                metadata,
                source: 'one:patient-created'
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue billing job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientBillingJobLocalFallback({
        connection,
        patientId,
        patientName,
        domain,
        metadata,
        eventType: 'billing_enabled',
        source: 'one:patient-created'
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue billing job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const scope = await resolveAdminDomainScope(request, requireDomain(searchParams.get('domain')))
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const limit = parseLimit(searchParams.get('limit'))
        // Optional name filter. The contacts editor uses it to autocomplete a
        // patient as the user types; without it the endpoint keeps its previous
        // "most recent first" behaviour for the other callers.
        const search = String(searchParams.get('search') || '').trim()

        connection = await getDomainBoundConnection(domain)

        const params = [domain]
        let where = 'domain = $1'

        if (search) {
            params.push(`%${search.toLowerCase()}%`)
            where += ` AND LOWER(patient_name) LIKE $${params.length}`
        }

        params.push(limit)
        // Matches are names, so list them alphabetically for the suggestion list.
        const order = search ? 'LOWER(patient_name) ASC, id ASC' : 'id DESC'

        const query = `SELECT id, patient_name, domain, metadata, created_at, updated_at
                         FROM patients
                        WHERE ${where}
                        ORDER BY ${order}
                        LIMIT $${params.length}`
        const result = await connection.query(query, params)
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizePatientRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patients' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const scope = await resolveAdminDomainScope(request, requireDomain(payload?.domain))
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const patientName = String(payload?.patient_name || '').trim()
        const domain = scope.domain
        const metadata = payload?.metadata === undefined ? null : payload?.metadata

        if (!patientName) {
            return NextResponse.json({ success: false, error: 'patient_name is required' }, { status: 400 })
        }
        if (metadata !== null && typeof metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        connection = await getDomainBoundConnection(domain)
        const serializedMetadata = metadata === null ? null : JSON.stringify(metadata)

        const result = await connection.query(
            `INSERT INTO patients (patient_name, domain, metadata)
             VALUES ($1, $2, $3::jsonb)
             RETURNING id, patient_name, domain, metadata, created_at, updated_at`,
            [patientName, domain, serializedMetadata]
        )
        const patient = normalizePatientRow(result.rows?.[0] || null)
        await recordActivity({
            domain,
            action: 'create',
            entityType: 'patient',
            entityId: patient?.id,
            entityLabel: patient?.patient_name,
            patientId: patient?.id,
            patientName: patient?.patient_name,
            actor: await resolveActivityActor(request),
        }, { connection })

        // The people named on the form belong in the Contacts directory too. A
        // failure here must not fail the save, which has already committed.
        try {
            await syncPatientFormContacts(connection, {
                domain,
                patientId: patient?.id,
                metadata: patient?.metadata,
            })
        } catch (error) {
            console.error('Patient form contact sync failed:', error)
        }

        let reportQueue = null
        let billingQueue = null
        let analysisQueue = null
        let equipmentSourcerQueue = null
        let quoteWriterQueue = null
        if (isReportingAgentEnabled(patient?.metadata)) {
            reportQueue = await enqueuePatientReportJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata
            })
        }
        if (isBillingAgentEnabled(patient?.metadata)) {
            billingQueue = await enqueuePatientBillingJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata
            })
        }
        if (isAnalysisAgentEnabled(patient?.metadata)) {
            analysisQueue = await enqueuePatientAnalysisJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
                source: 'one:patient-created'
            })
        }
        if (isEquipmentSourcerEnabled(patient?.metadata)) {
            equipmentSourcerQueue = await enqueueEquipmentSourcerJob({
                connection,
                dbType,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
            })
        }
        if (isQuoteWriterEnabled(patient?.metadata)) {
            quoteWriterQueue = await enqueueQuoteWriterJob({
                connection,
                dbType,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
            })
        }

        return NextResponse.json({ success: true, patient, reportQueue, billingQueue, analysisQueue, equipmentSourcerQueue, quoteWriterQueue })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create patient' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}