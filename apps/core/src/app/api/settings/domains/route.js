import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureBillingTable } from '@/lib/billingTable'
import { ensureChatsTable, normalizeChatRolesForSettings } from '@/lib/chats'
import { normalizeCustomerCohortKey } from '@/lib/customerCohorts'
import { normalizeDomainSeoSettings } from '@/lib/domainSettings'
import { maskApiKey, normalizeAiBaseUrl, normalizeAiModel, normalizeAiVendor } from '@/lib/domainAiConfig'
import { normalizeDomainAiFeaturePresets } from '@/lib/domainAiFeatures'
import { normalizeUsageValueSettings } from '@/lib/usageValue'
import { getAllDomainSettings, getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { getDomainBoundConnection, getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { LEGACY_WORKER_VISIBILITY_KEY, WORKER_VISIBILITY_KEY, readWorkerVisibility } from '@/lib/aiWorkers'
import { normalizePracticeType } from '@/lib/practiceTypes'
import { DEFAULT_ASSISTANT_LOCATION, normalizeAssistantProvider } from '@/lib/assistantConfig'
import { getDefaultWebsiteFeatureFlag, normalizeDomainFeatureFlags, preserveOmittedPatientCardFlags } from '@/lib/domainFeatureFlags'
import { normalizeAdminDashboardCardOrder } from '@/lib/adminDashboardCardOrder'
import { normalizeFileStorageBackend } from '@/lib/fileStorageConfig'

const KEEP_EXISTING_API_KEY_SENTINEL = '__UNCHANGED__'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function sanitizeDomainForResponse(domainSettings) {
    const source = domainSettings && typeof domainSettings === 'object' ? domainSettings : {}
    const apiKey = String(source.aiApiKey || '').trim()
    const response = {
        ...source,
        [WORKER_VISIBILITY_KEY]: readWorkerVisibility(source),
        hasAiApiKey: apiKey.length > 0,
        aiApiKeyMasked: apiKey ? maskApiKey(apiKey) : '',
        aiApiKey: '',
    }
    delete response[LEGACY_WORKER_VISIBILITY_KEY]
    return response
}

function sanitizeDomainsMapForResponse(domains) {
    const source = domains && typeof domains === 'object' ? domains : {}
    return Object.entries(source).reduce((acc, [domainKey, settings]) => {
        acc[domainKey] = sanitizeDomainForResponse(settings)
        return acc
    }, {})
}

async function ensurePatientsTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patients support requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        const existsResult = await connection.query(
            `SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
             LIMIT 1`,
            ['patients']
        )

        if ((existsResult?.rowCount || 0) === 0) {
            await connection.query(`
                CREATE TABLE patients (
                    id SERIAL PRIMARY KEY,
                    patient_name VARCHAR(255) NOT NULL,
                    domain VARCHAR(100) NOT NULL,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
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

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        if (isSuperAdmin(adminUser)) {
            // Every domain's settings: cross-tenant, so the session runs as superadmin.
            // Without a database the read returns defaults, as it always has.
            const connection = detectDatabaseType() === 'postgresql' ? await getSuperAdminConnection() : null
            try {
                const domains = await getAllDomainSettings('management', { connection })
                return NextResponse.json({
                    success: true,
                    domains: sanitizeDomainsMapForResponse(domains),
                    websiteEnabledDefault: getDefaultWebsiteFeatureFlag(),
                    source: Object.keys(domains).length ? 'domain_settings' : 'default',
                })
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        }

        const scopedDomain = String(adminUser?.domain || '').trim().toLowerCase()
        if (!scopedDomain) {
            return NextResponse.json({ error: 'Unauthorized: admin domain scope required' }, { status: 403 })
        }

        const connection = detectDatabaseType() === 'postgresql' ? await getDomainBoundConnection(scopedDomain) : null
        try {
            // Falls back to the legacy map for a domain that has not migrated yet.
            const scopedSettings = await getDomainSetting(scopedDomain, 'management', { connection })
            return NextResponse.json({
                success: true,
                domains: { [scopedDomain]: sanitizeDomainForResponse(scopedSettings || {}) },
                scopedDomain,
                websiteEnabledDefault: getDefaultWebsiteFeatureFlag(),
                source: scopedSettings ? 'domain_settings' : 'default',
            })
        } finally {
            if (connection?.end) await connection.end().catch(() => { })
        }
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load domain settings' }, { status: 500 })
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { domainKey, settings } = payload
        if (!domainKey || typeof settings !== 'object' || settings === null) {
            return NextResponse.json({ error: 'domainKey and settings object are required' }, { status: 400 })
        }

        const normalizedDomainKey = normalizeDomainKey(domainKey)
        if (!normalizedDomainKey) {
            return NextResponse.json({ error: 'domainKey is required' }, { status: 400 })
        }

        // Full domain settings writes are superadmin-only. `adminDashboardCardOrder`
        // here is the domain *default* layout; an admin's own drag-and-drop order
        // is a user-level override stored by /api/admin/dashboard-layout.
        if (!isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const existingDomainSettings = (await getDomainSetting(normalizedDomainKey, 'management')) || {}
        const hasAiApiKeyField = Object.prototype.hasOwnProperty.call(settings, 'aiApiKey')
        const requestedApiKey = hasAiApiKeyField
            ? String(settings.aiApiKey || '').trim()
            : KEEP_EXISTING_API_KEY_SENTINEL
        const nextAiApiKey = requestedApiKey === KEEP_EXISTING_API_KEY_SENTINEL
            ? String(existingDomainSettings?.aiApiKey || '').trim()
            : requestedApiKey
        const normalizedAiVendor = normalizeAiVendor(settings.aiVendor)

        // A PATCH carries the whole record, but the form only sends the patient card
        // flags the user actually touched. Preserving the stored value for the omitted
        // ones stops a stale or defaulted form value from retiring a card on save.
        const normalizedSettings = preserveOmittedPatientCardFlags({
            ...settings,
            customerCohortKey: normalizeCustomerCohortKey(settings.customerCohortKey),
            // Allied Health directory flags (gate the Suppliers/Providers cards).
            // Normalizing here writes the per-domain default on first save instead
            // of leaving the key undefined for older records.
            ...normalizeDomainFeatureFlags(settings, normalizedDomainKey),
            patientBillingEnabled: settings.patientsEnabled === true && settings.patientBillingEnabled === true,
            reportsCardEnabled: settings.patientsEnabled === true && settings.reportsCardEnabled !== false,
            casesCardEnabled: settings.patientsEnabled === true && settings.casesCardEnabled !== false,
            appointmentsCardEnabled: settings.patientsEnabled === true && settings.appointmentsCardEnabled !== false,
            formsCardEnabled: settings.patientsEnabled === true && settings.formsCardEnabled !== false,
            notesCardEnabled: settings.patientsEnabled === true && settings.notesCardEnabled !== false,
            docsCardEnabled: settings.patientsEnabled === true && settings.docsCardEnabled !== false,
            analysisCardEnabled: settings.patientsEnabled === true && settings.analysisCardEnabled !== false,
            [WORKER_VISIBILITY_KEY]: readWorkerVisibility(settings, existingDomainSettings),
            adminDashboardCardOrder: normalizeAdminDashboardCardOrder(settings.adminDashboardCardOrder),
            // Which backend holds this practice's uploaded files. The bucket and
            // credentials stay in the deployment environment (see docs/file-storage.md).
            fileStorageBackend: normalizeFileStorageBackend(settings.fileStorageBackend),
            practiceType: normalizePracticeType(settings.practiceType, normalizedDomainKey),
            aiUsageEnabled: settings.aiUsageEnabled === true,
            adminFloatingLinkEnabled: settings.adminFloatingLinkEnabled === true,
            aiVendor: normalizedAiVendor,
            aiModel: normalizeAiModel(settings.aiModel, normalizedAiVendor),
            aiFeaturePresets: normalizeDomainAiFeaturePresets(settings.aiFeaturePresets),
            aiBaseUrl: normalizeAiBaseUrl(settings.aiBaseUrl),
            aiApiKey: nextAiApiKey,
            chatEnabled: settings.chatEnabled === true,
            recentUpdatesEnabled: settings.recentUpdatesEnabled !== false,
            assistantEnabled: settings.assistantEnabled === true,
            assistantProvider: normalizeAssistantProvider(settings.assistantProvider),
            assistantModel: String(settings.assistantModel || '').trim(),
            assistantProjectId: String(settings.assistantProjectId || '').trim(),
            assistantLocation: String(settings.assistantLocation || '').trim() || DEFAULT_ASSISTANT_LOCATION,
            billingCurrency: String(settings.billingCurrency || 'AUD').trim().toUpperCase() || 'AUD',
            chatRoles: normalizeChatRolesForSettings(settings.chatRoles),
            usageValue: normalizeUsageValueSettings(settings.usageValue, normalizedDomainKey),
            seo: normalizeDomainSeoSettings(settings.seo),
            templateLibraryPath: String(settings.templateLibraryPath || '').trim(),
            sourcingBccReplyToDefault: settings.sourcingBccReplyToDefault === true,
            sourcingEmailSignature: String(settings.sourcingEmailSignature || '').trim(),
        }, settings, existingDomainSettings)

        if (normalizedSettings.patientsEnabled === true) {
            await ensurePatientsTable()
        }

        if (normalizedSettings.patientBillingEnabled === true) {
            await ensureBillingTable()
        }

        if (normalizedSettings.chatEnabled === true) {
            const dbType = detectDatabaseType()
            if (dbType !== 'postgresql') {
                throw new Error('Chat support requires a configured PostgreSQL database')
            }

            let connection = null
            try {
                connection = await getDatabaseConnection()
                await ensureChatsTable(connection, dbType)
            } finally {
                if (connection?.end) {
                    await connection.end().catch(() => { })
                } else if (connection?.close) {
                    await connection.close().catch(() => { })
                }
            }
        }

        // Merge and save
        const mergedEntry = {
            ...existingDomainSettings,
            ...normalizedSettings,
            domainKey: normalizedDomainKey,
            updatedAt: new Date().toISOString(),
        }
        delete mergedEntry[LEGACY_WORKER_VISIBILITY_KEY]

        const ok = await setDomainSetting(normalizedDomainKey, 'management', mergedEntry)
        if (!ok) {
            return NextResponse.json({ error: 'Failed to persist domain settings' }, { status: 500 })
        }

        return NextResponse.json({ success: true, domain: sanitizeDomainForResponse(mergedEntry) })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to save domain settings' }, { status: 500 })
    }
}
