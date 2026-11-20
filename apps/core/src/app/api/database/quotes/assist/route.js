import { NextResponse } from 'next/server'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { detectDatabaseType } from '@/lib/database'
import {
    buildQuoteSelect,
    normalizeQuoteRow,
    parseMetadataValue,
    toFinite,
} from '@/lib/patientQuotes'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import {
    normalizeQuoteWriterConfig,
    summarizeQuoteDraft,
} from '@/lib/patientQuoteDrafting'
import { generateQuoteDraftForPatient } from '@/lib/quoteWriter'

// Inline half of the "Quote Writer" worker (the background half is the
// `patient_quote_jobs` queue drained by /api/database/quotes/run-jobs).
//
// Two modes, both deliberate:
//   * `propose` never writes. The practitioner reviews the lines and adds the
//     ones they want through the normal quote-line endpoint, so an existing
//     (possibly hand-tuned) quote is never silently rewritten.
//   * `draft` creates or refreshes the worker's own draft quote for the patient.
//     That draft is identified by `external_source = 'quote-writer'`, so it is
//     the only quote this worker will ever overwrite, and only while it is still
//     a draft.
//
// This route is a static segment under /api/database/quotes, so it takes
// precedence over the /[id] dynamic route.

const MODES = new Set(['propose', 'draft'])

function parsePatientId(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readQuoteWriterConfigFromMetadata(metadata, overrides = {}) {
    const agents = metadata?.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : {}
    const stored = agents.quoteWriterConfig && typeof agents.quoteWriterConfig === 'object' && !Array.isArray(agents.quoteWriterConfig)
        ? agents.quoteWriterConfig
        : {}

    return normalizeQuoteWriterConfig({ ...stored, ...overrides })
}

function applyConfigOverrides(payload = {}) {
    const overrides = {}
    if (payload.pricing_region !== undefined) overrides.pricingRegion = payload.pricing_region
    if (payload.includeTranscripts !== undefined) overrides.includeTranscripts = payload.includeTranscripts
    if (payload.includeReports !== undefined) overrides.includeReports = payload.includeReports
    if (payload.includeEquipment !== undefined) overrides.includeEquipment = payload.includeEquipment
    if (payload.additionalInstructions !== undefined) overrides.additionalInstructions = payload.additionalInstructions
    return overrides
}

export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))

        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const patientId = parsePatientId(payload?.patient_id)
        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const requestedMode = String(payload?.mode || '').trim().toLowerCase()
        if (requestedMode && !MODES.has(requestedMode)) {
            return NextResponse.json({ success: false, error: `mode must be one of: ${[...MODES].join(', ')}` }, { status: 400 })
        }
        // With no explicit mode, an existing quote means "suggest lines for this
        // one"; no quote means "make me a draft".
        const mode = requestedMode || (payload?.quote_id ? 'propose' : 'draft')

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        const patientResult = await connection.query(
            'SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
            [patientId, domain]
        )
        const patient = patientResult.rows?.[0] || null
        if (!patient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const config = readQuoteWriterConfigFromMetadata(parseMetadataValue(patient.metadata), applyConfigOverrides(payload))

        const draft = await generateQuoteDraftForPatient({
            connection,
            domain,
            patientId,
            config,
            persist: mode === 'draft',
            signal: request.signal,
        })

        const totals = summarizeQuoteDraft(draft.lines, { gstApplicable: false })

        let quote = null
        if (mode === 'draft' && draft.quoteId) {
            const quoteResult = await connection.query(
                `${buildQuoteSelect()} WHERE pq.id = $1 AND pq.domain = $2 LIMIT 1`,
                [draft.quoteId, domain]
            )
            quote = normalizeQuoteRow(quoteResult.rows?.[0] || null)
        }

        return NextResponse.json({
            success: true,
            mode,
            patientId,
            patientName: draft.patientName,
            fundingContext: {
                fundingSource: draft.fundingContext?.fundingSource || '',
                referenceNumber: draft.fundingContext?.referenceNumber || '',
                referenceLabel: draft.fundingContext?.referenceLabel || '',
                fundingType: draft.fundingContext?.fundingType || null,
                isNdis: draft.fundingContext?.isNdis === true,
            },
            pricingRegion: config.pricingRegion,
            provider: draft.aiConfig?.provider || 'openai',
            model: draft.aiConfig?.model || '',
            summary: draft.summary,
            dropped: draft.dropped,
            proposedCount: draft.proposedCount,
            producedLineCount: draft.lines.length,
            lines: draft.lines.map((line) => ({ ...line, quantity: toFinite(line.quantity), unit_price: toFinite(line.unit_price) })),
            totals,
            quoteId: draft.quoteId,
            created: draft.created,
            replacedLineCount: draft.replacedLineCount,
            skippedReason: draft.skippedReason,
            quote,
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to draft quote lines' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
