import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { readReportSettingsForDomain } from '@/lib/reportSettingsStore'

export const runtime = 'nodejs'

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

function normalizeTemplateIdList(value) {
    if (!Array.isArray(value)) return []

    const ids = []
    for (const item of value) {
        const id = String(item || '').trim()
        if (!id) continue
        ids.push(id)
    }

    return Array.from(new Set(ids))
}

function safeFileSegment(value, fallback = 'file') {
    const safe = String(value || '')
        .replace(/[^A-Za-z0-9._ -]+/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '')

    return safe || fallback
}

function decodeTemplateBuffer(base64Value) {
    const raw = String(base64Value || '').trim()
    if (!raw) return Buffer.alloc(0)

    try {
        return Buffer.from(raw, 'base64')
    } catch {
        return Buffer.alloc(0)
    }
}

function toIsoTimestampFragment(date = new Date()) {
    const year = String(date.getUTCFullYear())
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    const hour = String(date.getUTCHours()).padStart(2, '0')
    const minute = String(date.getUTCMinutes()).padStart(2, '0')
    const second = String(date.getUTCSeconds()).padStart(2, '0')
    return `${year}${month}${day}-${hour}${minute}${second}`
}

function pickReportTypeBindings(reportTypes, selectedTemplateIds) {
    const source = Array.isArray(reportTypes) ? reportTypes : []
    if (selectedTemplateIds.size === 0) {
        return source
    }

    return source.filter((item) => {
        const templateId = String(item?.templateId || '').trim()
        return templateId && selectedTemplateIds.has(templateId)
    })
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        if (!isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Forbidden: superadmin access required' }, { status: 403 })
        }

        const sourceDomain = normalizeDomainKey(payload?.sourceDomain || payload?.domain)
        if (!sourceDomain) {
            return NextResponse.json({ error: 'sourceDomain is required' }, { status: 400 })
        }

        const requestedTemplateIds = normalizeTemplateIdList(payload?.templateIds)
        const selectedTemplateIdSet = new Set(requestedTemplateIds)
        const includeReportTypeBindings = payload?.includeReportTypeBindings !== false

        const stored = await readReportSettingsForDomain(sourceDomain)
        const allTemplates = Array.isArray(stored?.templates) ? stored.templates : []
        const selectedTemplates = requestedTemplateIds.length > 0
            ? allTemplates.filter((template) => selectedTemplateIdSet.has(String(template?.id || '').trim()))
            : allTemplates

        const reportTypes = includeReportTypeBindings
            ? pickReportTypeBindings(stored?.settings?.reportTypes, new Set(selectedTemplates.map((item) => String(item?.id || '').trim())))
            : []

        const zip = new JSZip()
        const templatesFolder = zip.folder('templates')
        const usedPaths = new Set()

        const manifestTemplates = selectedTemplates.map((template, index) => {
            const id = String(template?.id || '').trim() || `template-${index + 1}`
            const sourceName = String(template?.fileName || '').trim() || `${id}.bin`
            const fileName = safeFileSegment(sourceName, `${id}.bin`)
            const basePrefix = String(index + 1).padStart(2, '0')

            let outputPath = `templates/${basePrefix}-${fileName}`
            let duplicateCounter = 1
            while (usedPaths.has(outputPath)) {
                duplicateCounter += 1
                outputPath = `templates/${basePrefix}-${duplicateCounter}-${fileName}`
            }
            usedPaths.add(outputPath)

            const buffer = decodeTemplateBuffer(template?.contentBase64)
            templatesFolder.file(outputPath.replace('templates/', ''), buffer)

            return {
                id,
                name: String(template?.name || '').trim() || sourceName,
                fileName: sourceName,
                mimeType: String(template?.mimeType || '').trim() || 'application/octet-stream',
                size: Number.parseInt(String(template?.size || '0'), 10) || buffer.length,
                uploadedAt: String(template?.uploadedAt || '').trim() || null,
                source: String(template?.source || '').trim() || null,
                sourceDocId: String(template?.sourceDocId || '').trim() || null,
                sourceUrl: String(template?.sourceUrl || '').trim() || null,
                filePath: outputPath,
            }
        })

        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            exportedBy: {
                username: String(adminUser?.username || '').trim() || null,
                role: String(adminUser?.role || '').trim() || null,
            },
            domainAgnostic: true,
            importDomainPolicy: 'use-active-domain',
            includeReportTypeBindings,
            taxonomy: {
                discipline: 'occupational-therapy',
                category: 'allied-health',
            },
            reportTypes,
            templates: manifestTemplates,
        }

        zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        })

        const fileName = `report-templates-${toIsoTimestampFragment()}.zip`

        return new NextResponse(zipBuffer, {
            headers: {
                'content-type': 'application/zip',
                'content-disposition': `attachment; filename="${fileName}"`,
                'cache-control': 'no-store',
                'content-length': String(zipBuffer.length),
            },
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to export report templates' }, { status: 500 })
    }
}
