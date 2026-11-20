import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { readReportSettingsForDomain, writeReportSettingsForDomain } from '@/lib/reportSettingsStore'
import {
    DEFAULT_STRICT_TEMPLATE_POLICY,
    DEFAULT_TEMPLATE_MODE,
    normalizeReportTypeTemplateSettings,
    validateReportTypeTemplateBindings,
} from '@/lib/reportTemplatePolicies'

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

function toObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toArray(value) {
    return Array.isArray(value) ? value : []
}

function parseIsoDate(value) {
    const raw = String(value || '').trim()
    if (!raw) return new Date().toISOString()

    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) {
        return new Date().toISOString()
    }

    return date.toISOString()
}

function normalizeTemplateRecord(input, index = 0) {
    const template = toObject(input)
    const fallbackId = `template-${index + 1}`
    const id = String(template.id || '').trim() || fallbackId
    const fileName = String(template.fileName || '').trim() || `${id}.bin`
    const name = String(template.name || '').trim() || fileName
    const mimeType = String(template.mimeType || '').trim() || 'application/octet-stream'
    const parsedSize = Number.parseInt(String(template.size || '0'), 10)

    return {
        id,
        name,
        fileName,
        mimeType,
        size: Number.isFinite(parsedSize) && parsedSize >= 0 ? parsedSize : 0,
        uploadedAt: parseIsoDate(template.uploadedAt),
        source: String(template.source || '').trim(),
        sourceDocId: String(template.sourceDocId || '').trim(),
        sourceUrl: String(template.sourceUrl || '').trim(),
    }
}

function normalizeReportTypeRecord(input, index = 0) {
    const reportType = toObject(input)
    const fallbackId = index === 0 ? 'general-progress' : `report-type-${index + 1}`
    const id = String(reportType.id || '').trim() || fallbackId
    const templateSettings = normalizeReportTypeTemplateSettings(reportType)

    return {
        id,
        name: String(reportType.name || '').trim() || 'Untitled Report Type',
        description: String(reportType.description || '').trim(),
        templateId: String(reportType.templateId || '').trim() || null,
        templateMode: templateSettings.templateMode || DEFAULT_TEMPLATE_MODE,
        strictTemplatePolicy: templateSettings.strictTemplatePolicy || DEFAULT_STRICT_TEMPLATE_POLICY,
        requiredPlaceholders: templateSettings.requiredPlaceholders,
        requiredAnchors: templateSettings.requiredAnchors,
        isActive: reportType.isActive !== false,
    }
}

async function readZipBufferFromRequest(request, payload) {
    const contentType = String(request.headers.get('content-type') || '').toLowerCase()

    if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        const file = formData.get('file')
        if (!file || typeof file.arrayBuffer !== 'function') {
            throw new Error('A ZIP file is required in form field "file"')
        }
        const arrayBuffer = await file.arrayBuffer()
        return Buffer.from(arrayBuffer)
    }

    const packageBase64 = String(payload?.packageBase64 || '').trim()
    if (!packageBase64) {
        throw new Error('packageBase64 is required when not using multipart upload')
    }

    try {
        return Buffer.from(packageBase64, 'base64')
    } catch {
        throw new Error('packageBase64 is not valid base64')
    }
}

function readManifestGuardDomainAgnostic(manifest) {
    const sourceDomain = String(manifest?.sourceDomain || '').trim()
    const explicitDomain = String(manifest?.domain || '').trim()
    const targetDomain = String(manifest?.targetDomain || '').trim()

    if (sourceDomain || explicitDomain || targetDomain) {
        throw new Error('Import rejected: package contains domain-bound metadata. Export a domain-agnostic package.')
    }

    if (manifest?.domainAgnostic !== true) {
        throw new Error('Import rejected: package must declare domainAgnostic=true.')
    }

    const importDomainPolicy = String(manifest?.importDomainPolicy || '').trim().toLowerCase()
    if (importDomainPolicy && importDomainPolicy !== 'use-active-domain') {
        throw new Error('Import rejected: unsupported importDomainPolicy. Expected use-active-domain.')
    }
}

function mergeById(existingList, importedList) {
    const merged = []
    const seen = new Set()

    for (const item of toArray(existingList)) {
        const id = String(item?.id || '').trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        merged.push(item)
    }

    for (const item of toArray(importedList)) {
        const id = String(item?.id || '').trim()
        if (!id) continue

        const existingIndex = merged.findIndex((entry) => String(entry?.id || '').trim() === id)
        if (existingIndex >= 0) {
            merged[existingIndex] = item
            continue
        }

        merged.push(item)
    }

    return merged
}

export async function POST(request) {
    try {
        const contentType = String(request.headers.get('content-type') || '').toLowerCase()
        const payload = contentType.includes('multipart/form-data')
            ? {}
            : await request.json().catch(() => ({}))

        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        if (!isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Forbidden: superadmin access required' }, { status: 403 })
        }

        const domainFromPayload = normalizeDomainKey(payload?.domain || payload?.targetDomain)
        const domainFromQuery = normalizeDomainKey(new URL(request.url).searchParams.get('domain'))
        const activeDomain = domainFromPayload || domainFromQuery
        if (!activeDomain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        const zipBuffer = await readZipBufferFromRequest(request, payload)
        if (!zipBuffer || zipBuffer.length === 0) {
            return NextResponse.json({ error: 'Imported package is empty' }, { status: 400 })
        }

        const zip = await JSZip.loadAsync(zipBuffer)
        const manifestFile = zip.file('manifest.json')
        if (!manifestFile) {
            return NextResponse.json({ error: 'Invalid package: manifest.json not found' }, { status: 400 })
        }

        const manifestRaw = await manifestFile.async('string')
        const manifest = JSON.parse(manifestRaw)
        readManifestGuardDomainAgnostic(manifest)

        const manifestTemplates = toArray(manifest?.templates)
        if (manifestTemplates.length === 0) {
            return NextResponse.json({ error: 'Invalid package: no templates in manifest' }, { status: 400 })
        }

        const importedTemplates = []
        for (let index = 0; index < manifestTemplates.length; index += 1) {
            const item = normalizeTemplateRecord(manifestTemplates[index], index)
            const filePath = String(manifestTemplates[index]?.filePath || '').trim()
            if (!filePath) {
                return NextResponse.json({ error: `Invalid package: template ${item.id} is missing filePath` }, { status: 400 })
            }

            const fileEntry = zip.file(filePath)
            if (!fileEntry) {
                return NextResponse.json({ error: `Invalid package: missing template file ${filePath}` }, { status: 400 })
            }

            const fileBuffer = await fileEntry.async('nodebuffer')
            if (!fileBuffer || fileBuffer.length === 0) {
                return NextResponse.json({ error: `Invalid package: template file ${filePath} is empty` }, { status: 400 })
            }

            importedTemplates.push({
                ...item,
                size: item.size > 0 ? item.size : fileBuffer.length,
                contentBase64: fileBuffer.toString('base64'),
            })
        }

        const applyReportTypes = payload?.applyReportTypes !== false
        const replaceReportTypes = payload?.replaceReportTypes === true

        const stored = await readReportSettingsForDomain(activeDomain)
        const existingSettings = toObject(stored?.settings)
        const existingReportTypes = toArray(existingSettings?.reportTypes)
        const existingTemplates = toArray(stored?.templates)

        const nextTemplates = mergeById(existingTemplates, importedTemplates)

        const normalizedImportedReportTypes = applyReportTypes
            ? toArray(manifest?.reportTypes).map((item, index) => normalizeReportTypeRecord(item, index))
            : []

        const nextReportTypes = applyReportTypes
            ? (replaceReportTypes
                ? normalizedImportedReportTypes
                : mergeById(existingReportTypes, normalizedImportedReportTypes))
            : existingReportTypes

        const validation = validateReportTypeTemplateBindings({
            reportTypes: nextReportTypes,
            templates: nextTemplates,
        })
        if (!validation.valid) {
            return NextResponse.json(
                {
                    error: `Template validation failed: ${validation.failures.join(' ')}`,
                    failures: validation.failures,
                },
                { status: 400 }
            )
        }

        const persisted = await writeReportSettingsForDomain(activeDomain, {
            reportTypes: nextReportTypes,
            templates: nextTemplates,
            config: toObject(existingSettings?.config),
        })

        return NextResponse.json({
            success: true,
            domain: activeDomain,
            summary: {
                importedTemplates: importedTemplates.length,
                importedReportTypes: normalizedImportedReportTypes.length,
                applyReportTypes,
                replaceReportTypes,
                totalTemplates: toArray(persisted?.templates).length,
                totalReportTypes: toArray(persisted?.settings?.reportTypes).length,
            },
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to import template package' }, { status: 500 })
    }
}
