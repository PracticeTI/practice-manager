import mammoth from 'mammoth'
import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    findMissingAnchorsInText,
    findMissingPlaceholdersInText,
    normalizeRequiredAnchors,
    normalizeReportTypeTemplateSettings,
    normalizeRequiredPlaceholders,
    TEMPLATE_MODE_DOCX_LOCKED,
} from '@/lib/reportTemplatePolicies'

export const runtime = 'nodejs'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function resolveScopedDomain(adminUser, requestedDomain) {
    const requested = normalizeDomainKey(requestedDomain)

    if (isSuperAdmin(adminUser)) {
        return requested
    }

    const scopedDomain = normalizeDomainKey(adminUser?.domain)
    if (!scopedDomain) return ''

    if (requested && requested !== scopedDomain) {
        return null
    }

    return scopedDomain
}

function decodeTemplateBase64(base64Value) {
    const raw = String(base64Value || '').trim()
    if (!raw) return Buffer.alloc(0)
    return Buffer.from(raw, 'base64')
}

async function extractTemplateText(template) {
    const mimeType = String(template?.mimeType || '').trim().toLowerCase()
    const buffer = decodeTemplateBase64(template?.contentBase64)

    if (buffer.length === 0) {
        return ''
    }

    if (mimeType === DOCX_MIME_TYPE) {
        const result = await mammoth.extractRawText({ buffer })
        return String(result?.value || '')
    }

    return buffer.toString('utf8')
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const domain = resolveScopedDomain(adminUser, payload?.domain)
        if (domain === null) {
            return NextResponse.json({ error: 'Forbidden: cannot validate for requested domain' }, { status: 403 })
        }
        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        const reportType = payload?.reportType && typeof payload.reportType === 'object' ? payload.reportType : {}
        const template = payload?.template && typeof payload.template === 'object' ? payload.template : {}
        const templateSettings = normalizeReportTypeTemplateSettings(reportType)
        const requiredPlaceholders = normalizeRequiredPlaceholders(
            templateSettings.requiredPlaceholders && templateSettings.requiredPlaceholders.length > 0
                ? templateSettings.requiredPlaceholders
                : reportType.requiredPlaceholders
        )
        const requiredAnchors = normalizeRequiredAnchors(
            templateSettings.requiredAnchors && templateSettings.requiredAnchors.length > 0
                ? templateSettings.requiredAnchors
                : reportType.requiredAnchors
        )

        const mimeType = String(template?.mimeType || '').trim().toLowerCase()
        const requiresDocx = templateSettings.templateMode === TEMPLATE_MODE_DOCX_LOCKED
        if (requiresDocx && mimeType !== DOCX_MIME_TYPE) {
            return NextResponse.json({
                success: false,
                valid: false,
                errors: ['Strict DOCX mode requires a .docx template.'],
                missingPlaceholders: requiredPlaceholders,
            }, { status: 400 })
        }

        const sourceText = await extractTemplateText(template)
        const missingPlaceholders = findMissingPlaceholdersInText({
            requiredPlaceholders,
            sourceText,
        })
        const missingAnchors = findMissingAnchorsInText({
            requiredAnchors,
            sourceText,
        })

        const errors = []
        if (missingPlaceholders.length > 0) {
            errors.push(`Template is missing required placeholders: ${missingPlaceholders.join(', ')}`)
        }
        if (missingAnchors.length > 0) {
            errors.push(`Template is missing required anchor text: ${missingAnchors.join(', ')}`)
        }

        return NextResponse.json({
            success: true,
            valid: errors.length === 0,
            errors,
            missingPlaceholders,
            missingAnchors,
            requiredPlaceholders,
            requiredAnchors,
            reportTypeTemplateSettings: templateSettings,
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to validate report template' }, { status: 500 })
    }
}
