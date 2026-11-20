'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import AdminBackgroundColorModal from '@/admin-ui/components/AdminBackgroundColorModal'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    DEFAULT_ADMIN_DASHBOARD_CARD_ORDER,
    normalizeAdminDashboardCardOrder,
} from '@/lib/adminDashboardCardOrder'
import {
    getCustomerCohortByKey,
    normalizeCustomerCohortKey,
} from '@/lib/customerCohorts'
import {
    DEFAULT_ASANA_CONTACT_SETTINGS,
    normalizeAsanaContactSettings,
} from '@/lib/asanaContactConfig'
import { DEFAULT_DOMAIN_DEFINITIONS, getDefaultDomainSeoSettings, normalizeDomainSeoSettings } from '@/lib/domainSettings'
import {
    PATIENT_CARD_FLAG_KEYS,
    getDefaultDomainFeatureSettings,
    normalizeDomainFeatureFlags,
} from '@/lib/domainFeatureFlags'
import {
    FILE_STORAGE_BACKENDS,
    FILE_STORAGE_BACKEND_LABELS,
    normalizeFileStorageBackend,
} from '@/lib/fileStorageConfig'
import { resolveFormAlertSender } from '@/lib/formAlertSender'
import {
    buildSourcingSignaturePreviewHtml,
    resolveDomainLogoUrl,
    resolveSourcingSenderEmail,
    SOURCING_DOMAIN_LOGO_URL_TOKEN,
} from '@/lib/equipmentQuoteRequest'
import { getDefaultUsageValueSettings, normalizeUsageValueSettings, summarizeUsageValue } from '@/lib/usageValue'
import {
    ADMIN_QUICK_ACTION_DEFINITIONS,
    ADMIN_CUSTOM_QUICK_ACTION_ICON_OPTIONS,
    getDefaultAdminQuickActionsConfig,
    normalizeAdminQuickActionsConfig,
} from '@/lib/adminQuickActions'
import {
    WORKER_DEFINITIONS,
    readWorkerVisibility,
} from '@/lib/aiWorkers'
import { PRACTICE_TYPE_OPTIONS, normalizePracticeType } from '@/lib/practiceTypes'
import {
    AI_PROVIDER_OPTIONS,
    getAiProviderDefaultModel,
    normalizeAiProvider,
} from '@/lib/ai/providers'
import {
    DEFAULT_REPORT_AI_PROVIDER_MODELS,
    normalizeReportAiProviderModels,
} from '@/lib/reportAiProviders'
import {
    DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
    DOMAIN_AI_FEATURE_KEYS,
    DOMAIN_AI_FEATURE_META,
    DEFAULT_DOMAIN_AI_FEATURE_PRESETS,
    assistantProviderToAiProvider,
    buildDomainAiPresetOptions,
    findDomainAiPresetValue,
    getDomainAiPresetValue,
    normalizeDomainAiFeaturePresets,
    parseDomainAiPresetValue,
    resolveDomainAiFeatureSelection,
} from '@/lib/domainAiFeatures'
import {
    ASSISTANT_PROVIDER_OPTIONS,
    DEFAULT_ASSISTANT_LOCATION,
    DEFAULT_ASSISTANT_PROVIDER,
    getDefaultAssistantModel,
    getDomainDisplayLabel,
    normalizeAssistantProvider,
    normalizeAssistantSettings,
} from '@/lib/assistantConfig'
import { DEFAULT_DOMAIN_KEY, DEFAULT_DOMAIN_MODE, VALID_DOMAIN_MODES, getDomainLabel } from '@/lib/domainMode'
import { hasPrivateDomainTrait } from '@/lib/domainExtension'

const KEEP_EXISTING_API_KEY_SENTINEL = '__UNCHANGED__'

const POST_MODAL_DOMAIN_OPTIONS = VALID_DOMAIN_MODES.map((mode) => ({
    id: mode,
    label: getDomainLabel(mode),
}))

const ADMIN_DASHBOARD_CARD_OPTIONS = [
    { key: 'equipment', label: 'Suppliers', description: 'Manage Allied Health equipment suppliers and favourites.' },
    { key: 'providers', label: 'Providers', description: 'Manage the Allied Health provider directory and favourites.' },
    { key: 'contacts', label: 'Contacts', description: 'Manage the people and organisations you work with.' },
    { key: 'sourcing', label: 'Sourcing', description: 'Track the equipment quotes requested from suppliers.' },
    { key: 'patients', label: 'Patients', description: 'Manage patient intake data and notes.' },
    { key: 'tasks', label: 'Tasks', description: 'Work through the suggested actions waiting on review across every patient.' },
    { key: 'reports', label: 'Reports', description: 'Review formal patient reports and drafts.' },
    { key: 'cases', label: 'Cases', description: 'Review funding allocations, usage and expiry.' },
    { key: 'appointments', label: 'Appointments', description: 'Review and import appointments from the practice management system.' },
    { key: 'forms', label: 'Forms', description: 'Review submitted intake forms and import them from the practice management system.' },
    { key: 'notes', label: 'Notes', description: 'Write patient notes and import them from the practice management system.' },
    { key: 'docs', label: 'Docs', description: 'Index every patient quote, case, agreement, analysis and summary.' },
    { key: 'analysis', label: 'Analysis', description: 'Review FCA Analyst suggestions.' },
    { key: 'billing', label: 'Billing', description: 'View and create billing records.' },
    { key: 'chat', label: 'Chat', description: 'View recent chat sessions.' },
    { key: 'assistant', label: 'Assistant', description: 'General AI assistant chat.' },
    { key: 'messages', label: 'Messages', description: 'View contact email messages.' },
    { key: 'ai-usage', label: 'Usage', description: 'Review platform costs and savings.' },
    // The Tools card links to the Tools page, which holds the Content, Funders,
    // Recycling and Activities cards. Those no longer render on this dashboard.
    { key: 'tools', label: 'Tools', description: 'Open the Tools page with Content, Funders, Recycling and Activities.' },
]

// Card flags that can only be enabled once the Patients entity is on.
const PATIENT_DEPENDENT_CARD_FIELDS = new Set(PATIENT_CARD_FLAG_KEYS)

// Features panel groups: general domain toggles, admin dashboard card toggles, and
// the subset of cards whose records the Docs page (/admin/docs) also indexes.
const GENERAL_FEATURE_FIELDS = [
    ['websiteEnabled', 'Website'],
    ['homePageBlockEditorEnabled', 'Homepage block editor'],
    ['recentUpdatesEnabled', 'Recent Updates'],
    ['quickActionsEnabled', 'Quick Actions'],
    ['maintenanceModeEnabled', 'Maintenance mode'],
    ['toolsEnabled', 'Tools dashboard'],
    ['tasksEnabled', 'Tasks dashboard'],
    ['filesEnabled', 'Files dashboard'],
    ['patientsEnabled', 'Patients entity'],
    ['practiceSearchEnabled', 'Practice search box (admin header)'],
    ['adminFloatingLinkEnabled', 'Admin floating link (bottom right)'],
    ['assistantEnabled', 'AI Assistant'],
    ['allowPublicFrontend', 'Public frontend'],
    ['requireAdminDomainMatch', 'Require admin domain/hostname match'],
    ['enableLocalCaching', 'Enable local caching (24h TTL)'],
]

const ADMIN_CARD_FEATURE_FIELDS = [
    ['suppliersEnabled', 'Suppliers (Allied Health directory)'],
    ['providersEnabled', 'Providers (Allied Health directory)'],
    ['reportsCardEnabled', 'Reports'],
    ['appointmentsCardEnabled', 'Appointments'],
    ['notesCardEnabled', 'Notes'],
    ['docsCardEnabled', 'Docs'],
    ['patientBillingEnabled', 'Patient billing'],
    ['aiUsageEnabled', 'Usage'],
    ['recyclingEnabled', 'Recycling'],
]

// Cards whose records the Docs page indexes, so they are grouped separately from the
// other dashboard cards.
const DOCS_CARD_FEATURE_FIELDS = [
    ['casesCardEnabled', 'Cases'],
    ['formsCardEnabled', 'Forms'],
    ['analysisCardEnabled', 'Analysis'],
]

const DEFAULT_POST_MODAL_FIELD_VISIBILITY = POST_MODAL_DOMAIN_OPTIONS.reduce((acc, domain) => {
    acc[domain.id] = { description: true, body: true }
    return acc
}, {})

function getDefaultPostModalFieldVisibility() {
    return JSON.parse(JSON.stringify(DEFAULT_POST_MODAL_FIELD_VISIBILITY))
}

function normalizePostModalDomain(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized || normalized === 'core') return DEFAULT_DOMAIN_KEY
    return POST_MODAL_DOMAIN_OPTIONS.some((domain) => domain.id === normalized) ? normalized : DEFAULT_DOMAIN_KEY
}

function normalizePostModalFieldVisibility(rawValue) {
    const normalized = getDefaultPostModalFieldVisibility()
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {}

    for (const domain of POST_MODAL_DOMAIN_OPTIONS) {
        const domainValue = source[domain.id]
        if (!domainValue || typeof domainValue !== 'object') continue

        normalized[domain.id] = {
            description: domainValue.description !== false,
            body: domainValue.body !== false,
        }
    }

    return normalized
}

function makeDefaultSettings(domainKey, overrides = {}) {
    return {
        ...getDefaultDomainFeatureSettings(),
        ...overrides,
        displayName: domainKey,
        domainKey,
        practiceType: normalizePracticeType('', domainKey),
        primaryHostname: '',
        allowedHostnames: '',
        defaultRoute: '/admin',
        templateLibraryPath: '',
        publicBaseUrl: '',
        backendBaseUrl: '',
        pluginBaseUrl: '',
        witBaseUrl: '',
        emailContact: '',
        sourcingReplyToEmail: '',
        sourcingReplyToName: '',
        sourcingBccReplyToDefault: false,
        sourcingEmailSignature: '',
        contactEmailDelivery: {
            enabled: true,
            recipient: '',
        },
        chatEnabled: hasPrivateDomainTrait(domainKey, 'contactChatEnabled'),
        chatRoles: hasPrivateDomainTrait(domainKey, 'contactChatEnabled') ? ['Contact'] : [],
        timezone: 'Australia/Sydney',
        locale: 'en-AU',
        billingCurrency: 'AUD',
        searchProvider: 'brave',
        aiVendor: 'openai',
        aiModel: 'gpt-4.1-mini',
        aiFeaturePresets: normalizeDomainAiFeaturePresets(DEFAULT_DOMAIN_AI_FEATURE_PRESETS),
        aiApiKey: '',
        aiApiKeyMasked: '',
        hasAiApiKey: false,
        aiBaseUrl: '',
        imageServingPriority: 'local-then-curated-then-api',
        customerCohortKey: '',
        autoEnrichment: false,
        assistantProvider: DEFAULT_ASSISTANT_PROVIDER,
        assistantModel: '',
        assistantProjectId: '',
        assistantLocation: DEFAULT_ASSISTANT_LOCATION,
        notes: '',
        updatedAt: null,
        asanaContact: { ...DEFAULT_ASANA_CONTACT_SETTINGS },
        seo: getDefaultDomainSeoSettings(domainKey),
        usageValue: getDefaultUsageValueSettings(domainKey),
        adminQuickActions: getDefaultAdminQuickActionsConfig(),
        adminDashboardCardOrder: [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER],
    }
}

function normalizeHomepagePaletteSettings(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
        enabled: source.enabled === true,
        editMode: source.editMode === true,
    }
}

function getInitialDomainMap() {
    return DEFAULT_DOMAIN_DEFINITIONS.reduce((acc, domain) => {
        acc[domain.key] = makeDefaultSettings(domain.key)
        return acc
    }, {})
}

function getSortedDomainKeys(domainMap) {
    return Object.keys(domainMap).sort((leftKey, rightKey) => {
        const leftUpdatedAt = Date.parse(domainMap[leftKey]?.updatedAt || '')
        const rightUpdatedAt = Date.parse(domainMap[rightKey]?.updatedAt || '')
        const leftHasTimestamp = Number.isFinite(leftUpdatedAt)
        const rightHasTimestamp = Number.isFinite(rightUpdatedAt)

        if (leftHasTimestamp && rightHasTimestamp && leftUpdatedAt !== rightUpdatedAt) {
            return rightUpdatedAt - leftUpdatedAt
        }

        if (leftHasTimestamp !== rightHasTimestamp) {
            return leftHasTimestamp ? -1 : 1
        }

        return leftKey.localeCompare(rightKey)
    })
}

export default function DomainSettingsPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [scopedAdminDomain, setScopedAdminDomain] = useState('')
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_DEFINITIONS[0]?.key || DEFAULT_DOMAIN_MODE)
    const [domainMap, setDomainMap] = useState(getInitialDomainMap)
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')
    const [asanaTokenConfigured, setAsanaTokenConfigured] = useState(false)
    const [asanaAccessToken, setAsanaAccessToken] = useState('')
    const [showAsanaAccessToken, setShowAsanaAccessToken] = useState(false)
    const [loadingAsanaAccessToken, setLoadingAsanaAccessToken] = useState(false)
    const [emailDeliveryStatus, setEmailDeliveryStatus] = useState(null)
    const [loadingEmailDeliveryStatus, setLoadingEmailDeliveryStatus] = useState(false)
    const [sendingTestEmail, setSendingTestEmail] = useState(false)
    const [testMessageText, setTestMessageText] = useState('This is a test message queued from Domain Settings.')
    const [newQuickActionLabel, setNewQuickActionLabel] = useState('')
    const [newQuickActionUrl, setNewQuickActionUrl] = useState('')
    const [newQuickActionIcon, setNewQuickActionIcon] = useState('🔗')
    const [newQuickActionColor, setNewQuickActionColor] = useState('#94a3b8')
    const [newQuickActionOpenInNewTab, setNewQuickActionOpenInNewTab] = useState(true)
    const [newChatRole, setNewChatRole] = useState('')
    const [isCacheExpanded, setIsCacheExpanded] = useState(false)
    const [cacheInfo, setCacheInfo] = useState(null)
    const [loadingCacheInfo, setLoadingCacheInfo] = useState(false)
    const [clearingCache, setClearingCache] = useState(false)
    const [replaceAiApiKey, setReplaceAiApiKey] = useState(false)
    const [aiDefaultCustomMode, setAiDefaultCustomMode] = useState(false)
    const [aiProviderModels, setAiProviderModels] = useState(() => normalizeReportAiProviderModels(DEFAULT_REPORT_AI_PROVIDER_MODELS))
    const [aiProviderKeyAvailability, setAiProviderKeyAvailability] = useState({})
    const [customerCohorts, setCustomerCohorts] = useState([])
    const [postModalFieldVisibility, setPostModalFieldVisibility] = useState(getDefaultPostModalFieldVisibility)
    const [activeSettingsSection, setActiveSettingsSection] = useState('features')
    // Edition-aware default for the Website flag, reported by the API. Solo installs
    // default it off and hosted deployments on; `null` means the API has not answered yet.
    const [websiteEnabledDefault, setWebsiteEnabledDefault] = useState(null)
    const [showAdminBackgroundColorModal, setShowAdminBackgroundColorModal] = useState(false)
    // Patient card flags the user actually changed in this visit. Only those are sent on
    // save, so a flag the form defaulted or never loaded cannot be written back as off.
    const touchedPatientCardFlags = useRef(new Set())

    const mergeDomainSettingsResponse = useCallback((payload) => {
        const domainPayload = payload?.domains
        const reportedWebsiteEnabledDefault = payload?.websiteEnabledDefault
        const base = getInitialDomainMap()
        const merged = { ...base }

        Object.entries(domainPayload || {}).forEach(([key, value]) => {
            if (!merged[key]) {
                merged[key] = { ...makeDefaultSettings(key), ...(value || {}) }
            } else {
                merged[key] = { ...merged[key], ...(value || {}) }
            }

            const savedEmailDelivery = value?.contactEmailDelivery || {}
            merged[key].contactEmailDelivery = {
                enabled: savedEmailDelivery.enabled !== false,
                recipient: String(savedEmailDelivery.recipient || merged[key].emailContact || '').trim(),
            }
            merged[key].homepagePalette = normalizeHomepagePaletteSettings(merged[key].homepagePalette)
            if (merged[key].asanaContact) {
                merged[key].asanaContact = normalizeAsanaContactSettings(merged[key].asanaContact)
            }
            const normalizedBillingCurrency = String(merged[key].billingCurrency || 'AUD').trim().toUpperCase()
            merged[key].billingCurrency = normalizedBillingCurrency || 'AUD'
            merged[key].customerCohortKey = normalizeCustomerCohortKey(merged[key].customerCohortKey)
            merged[key].workerVisibility = readWorkerVisibility(merged[key])
            Object.assign(merged[key], normalizeDomainFeatureFlags(merged[key], key))
            merged[key].adminFloatingLinkEnabled = merged[key].adminFloatingLinkEnabled === true
            merged[key].seo = normalizeDomainSeoSettings(merged[key].seo)
            merged[key].adminQuickActions = normalizeAdminQuickActionsConfig(merged[key].adminQuickActions)
            merged[key].adminDashboardCardOrder = normalizeAdminDashboardCardOrder(merged[key].adminDashboardCardOrder)
            merged[key].practiceType = normalizePracticeType(merged[key].practiceType, key)
            merged[key].aiVendor = normalizeAiProvider(merged[key].aiVendor)
            merged[key].aiModel = String(merged[key].aiModel || '').trim() || getAiProviderDefaultModel(merged[key].aiVendor)
            merged[key].aiFeaturePresets = normalizeDomainAiFeaturePresets(merged[key].aiFeaturePresets)
            merged[key].aiApiKey = ''
            merged[key].aiApiKeyMasked = String(merged[key].aiApiKeyMasked || '').trim()
            merged[key].hasAiApiKey = merged[key].hasAiApiKey === true
            merged[key].templateLibraryPath = String(merged[key].templateLibraryPath || '').trim()
            merged[key].aiBaseUrl = String(merged[key].aiBaseUrl || '').trim()
            merged[key].sourcingBccReplyToDefault = merged[key].sourcingBccReplyToDefault === true
            merged[key].sourcingEmailSignature = String(merged[key].sourcingEmailSignature || '').trim()

            const normalizedAssistant = normalizeAssistantSettings(merged[key])
            merged[key].assistantEnabled = normalizedAssistant.assistantEnabled
            merged[key].assistantProvider = normalizedAssistant.assistantProvider
            merged[key].assistantModel = normalizedAssistant.assistantModel
            merged[key].assistantProjectId = normalizedAssistant.assistantProjectId
            merged[key].assistantLocation = normalizedAssistant.assistantLocation
        })

        // The Website flag defaults differently per edition, and only the server knows
        // the edition (solo installs set it at runtime, not build time). Apply the
        // default the API reported wherever the domain has no stored value.
        if (typeof reportedWebsiteEnabledDefault === 'boolean') {
            setWebsiteEnabledDefault(reportedWebsiteEnabledDefault)
            for (const key of Object.keys(merged)) {
                if (typeof domainPayload?.[key]?.websiteEnabled !== 'boolean') {
                    merged[key].websiteEnabled = reportedWebsiteEnabledDefault
                }
            }
        }

        const sortedDomainKeys = getSortedDomainKeys(merged)
        if (sortedDomainKeys.length > 0) {
            setActiveDomain(sortedDomainKeys[0])
        }

        setDomainMap(merged)
    }, [])

    const fetchCacheInfo = useCallback(async (domainKey) => {
        if (typeof window === 'undefined') return
        setLoadingCacheInfo(true)
        try {
            const prefix = `practice_cache_v1:${domainKey}:`
            const metaPrefix = `practice_cache_v1_meta:${domainKey}:`
            const items = []
            let totalSize = 0

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && (key.startsWith(prefix) || key.startsWith(metaPrefix))) {
                    if (key.startsWith(prefix) && !key.startsWith(metaPrefix)) {
                        const dataSize = (localStorage.getItem(key) || '').length
                        totalSize += dataSize
                        const displayKey = key.replace(prefix, '')
                        const metaKey = `practice_cache_v1_meta:${domainKey}:${displayKey}`
                        const meta = JSON.parse(localStorage.getItem(metaKey) || '{}')
                        items.push({
                            key: displayKey,
                            size: dataSize,
                            expiresAt: meta.expiresAt,
                            isExpired: Boolean(meta.expiresAt && Date.parse(String(meta.expiresAt)) < Date.parse(new Date().toISOString())),
                        })
                    }
                }
            }

            setCacheInfo({ items, totalSize })
        } catch (err) {
            console.warn('Error fetching cache info:', err)
        } finally {
            setLoadingCacheInfo(false)
        }
    }, [])

    const clearDomainCache = useCallback(async (domainKey) => {
        if (typeof window === 'undefined') return
        setClearingCache(true)
        try {
            const pattern = `practice_cache_v1:${domainKey}:`
            const keysToRemove = []

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && (key.startsWith(pattern) || key.startsWith(`practice_cache_v1_meta:${domainKey}:`))) {
                    keysToRemove.push(key)
                }
            }

            keysToRemove.forEach((key) => localStorage.removeItem(key))
            setStatusMessage(`Cache cleared for ${domainKey}`)
            setStatusTone('success')
            setTimeout(() => {
                setStatusMessage('')
                fetchCacheInfo(domainKey)
            }, 2000)
        } catch (err) {
            console.error('Error clearing cache:', err)
            setStatusMessage('Error clearing cache')
            setStatusTone('error')
        } finally {
            setClearingCache(false)
        }
    }, [fetchCacheInfo])

    const fetchSettings = useCallback(async (token, source = 'live') => {
        try {
            const endpoint = source === 'bootstrap'
                ? '/api/settings/domains/bootstrap'
                : '/api/settings/domains'

            const res = await fetch(endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!res.ok) return

            const data = await res.json()
            if (!data.success || !data.domains) return

            mergeDomainSettingsResponse(data)
        } catch {
            // Silently fall through to defaults
        }
    }, [mergeDomainSettingsResponse])

    const fetchAsanaStatus = useCallback(async (token) => {
        try {
            const res = await fetch('/api/settings/asana-contact', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!res.ok) return
            const data = await res.json()
            setAsanaTokenConfigured(data.status?.accessTokenConfigured === true)
        } catch {
            // Ignore
        }
    }, [])

    const fetchCustomerCohorts = useCallback(async (token) => {
        try {
            const response = await fetch('/api/settings/customer-cohorts', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!response.ok) return

            const data = await response.json().catch(() => ({}))
            setCustomerCohorts(Array.isArray(data?.cohorts) ? data.cohorts : [])
        } catch {
            setCustomerCohorts([])
        }
    }, [])

    const fetchAiProviderModels = useCallback(async (token) => {
        if (!token) return
        try {
            const response = await fetch('/api/settings/ai-provider-models', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!response.ok) return

            const data = await response.json().catch(() => ({}))
            setAiProviderModels(normalizeReportAiProviderModels(data?.models || {}))
            setAiProviderKeyAvailability(data?.keyAvailability && typeof data.keyAvailability === 'object'
                ? data.keyAvailability
                : {})
        } catch {
            // Keep the built-in matrix; the page still works offline.
        }
    }, [])

    const toggleAsanaAccessTokenVisibility = useCallback(async () => {
        if (showAsanaAccessToken) {
            setShowAsanaAccessToken(false)
            setAsanaAccessToken('')
            return
        }

        if (!asanaTokenConfigured) {
            return
        }

        try {
            setLoadingAsanaAccessToken(true)
            const token = window.localStorage.getItem('adminToken')
            const response = await fetch('/api/settings/asana-contact?revealToken=1', {
                cache: 'no-store',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load Asana access token')
            }

            setAsanaAccessToken(String(data?.accessTokenValue || '').trim())
            setShowAsanaAccessToken(true)
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to load Asana access token')
            setStatusTone('error')
        } finally {
            setLoadingAsanaAccessToken(false)
        }
    }, [asanaTokenConfigured, showAsanaAccessToken])

    const fetchEmailDeliveryStatus = useCallback(async (token, domainKey) => {
        if (!token || !domainKey) return

        setLoadingEmailDeliveryStatus(true)
        try {
            const response = await fetch(`/api/settings/domains/email-delivery?domainKey=${encodeURIComponent(domainKey)}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store'
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load email delivery status')
            }

            setEmailDeliveryStatus(data)
        } catch (error) {
            setEmailDeliveryStatus({
                success: false,
                configured: false,
                domainKey,
                recipient: '',
                queue: {
                    reachable: false,
                    authorized: false,
                    message: error?.message || 'Failed to load email delivery status'
                }
            })
        } finally {
            setLoadingEmailDeliveryStatus(false)
        }
    }, [])

    const getAdminAuthHeaders = useCallback(() => {
        if (typeof window === 'undefined') return {}
        const token = window.localStorage.getItem('adminToken')
        return token ? { Authorization: `Bearer ${token}` } : {}
    }, [])

    const saveAdminBackgroundColor = useCallback(async ({ domain, settings, adminToken }) => {
        if (!domain) {
            throw new Error('Domain is required')
        }

        const resolvedToken = adminToken || (typeof window !== 'undefined' ? window.localStorage.getItem('adminToken') : null)
        const response = await fetch('/api/settings/admin-background-color', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
            },
            body: JSON.stringify({ domain, settings, adminToken: resolvedToken })
        })

        if (!response.ok) {
            const data = await response.json().catch(() => ({}))
            throw new Error(data?.error || `Failed to save admin background color: ${response.status}`)
        }

        return response.json()
    }, [])

    const normalizeVisibilityPayload = useCallback((value) => ({
        description: value?.description !== false,
        body: value?.body !== false,
    }), [])

    const loadPostModalFieldVisibilitySettings = useCallback(async () => {
        try {
            const response = await fetch('/api/settings/domains/post-modal-fields', {
                headers: getAdminAuthHeaders(),
                cache: 'no-store',
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to load post modal field settings')
            }

            setPostModalFieldVisibility(normalizePostModalFieldVisibility(data?.postModalFieldVisibility))
            if (data?.scopedDomain) {
                setScopedAdminDomain(String(data.scopedDomain).trim().toLowerCase())
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to load post modal field settings')
            setStatusTone('error')
        }
    }, [getAdminAuthHeaders])

    const savePostModalFieldVisibility = useCallback(async (domainKey, visibility) => {
        const response = await fetch('/api/settings/domains/post-modal-fields', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...getAdminAuthHeaders(),
            },
            body: JSON.stringify({ domainKey, visibility }),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'Failed to save post modal field settings')
        }

        return normalizeVisibilityPayload(data?.visibility)
    }, [getAdminAuthHeaders, normalizeVisibilityPayload])

    const allowedPostModalDomainIds = useMemo(() => {
        if (isSuperAdmin) {
            return POST_MODAL_DOMAIN_OPTIONS.map((domain) => domain.id)
        }

        if (scopedAdminDomain) {
            return [normalizePostModalDomain(scopedAdminDomain)]
        }

        return []
    }, [isSuperAdmin, scopedAdminDomain])

    const visiblePostModalDomainOptions = useMemo(() => (
        POST_MODAL_DOMAIN_OPTIONS.filter((domain) => allowedPostModalDomainIds.includes(domain.id))
    ), [allowedPostModalDomainIds])

    const canEditPostModalDomain = useCallback((domainId) => {
        const normalizedDomain = normalizePostModalDomain(domainId)
        return isSuperAdmin || (scopedAdminDomain ? normalizedDomain === normalizePostModalDomain(scopedAdminDomain) : false)
    }, [isSuperAdmin, scopedAdminDomain])

    const togglePostModalFieldVisibility = useCallback((domainId, fieldId) => {
        const normalizedDomain = normalizePostModalDomain(domainId)
        if (!canEditPostModalDomain(normalizedDomain)) {
            setStatusMessage('You can only edit Post Modal fields for your scoped domain.')
            setStatusTone('error')
            return
        }

        const previousDomainVisibility = normalizeVisibilityPayload(postModalFieldVisibility[normalizedDomain])
        const nextDomainVisibility = {
            ...previousDomainVisibility,
            [fieldId]: previousDomainVisibility[fieldId] === false,
        }

        setPostModalFieldVisibility((prev) => ({
            ...prev,
            [normalizedDomain]: nextDomainVisibility,
        }))

        savePostModalFieldVisibility(normalizedDomain, nextDomainVisibility)
            .then(() => {
                setStatusMessage('Post modal field settings updated.')
                setStatusTone('success')
            })
            .catch((error) => {
                setPostModalFieldVisibility((prev) => ({
                    ...prev,
                    [normalizedDomain]: previousDomainVisibility,
                }))
                setStatusMessage(error?.message || 'Failed to save post modal field settings')
                setStatusTone('error')
            })
    }, [canEditPostModalDomain, normalizeVisibilityPayload, postModalFieldVisibility, savePostModalFieldVisibility])

    const resetPostModalFieldVisibility = useCallback(() => {
        const domainsToReset = visiblePostModalDomainOptions.map((domain) => domain.id)
        if (domainsToReset.length === 0) return

        const previousValues = domainsToReset.reduce((acc, domainId) => {
            acc[domainId] = normalizeVisibilityPayload(postModalFieldVisibility[domainId])
            return acc
        }, {})

        setPostModalFieldVisibility((prev) => {
            const next = { ...prev }
            for (const domainId of domainsToReset) {
                next[domainId] = { description: true, body: true }
            }
            return next
        })

        Promise.all(domainsToReset.map((domainId) => savePostModalFieldVisibility(domainId, { description: true, body: true })))
            .then(() => {
                setStatusMessage('Post modal field settings reset.')
                setStatusTone('success')
            })
            .catch((error) => {
                setPostModalFieldVisibility((prev) => {
                    const next = { ...prev }
                    for (const domainId of domainsToReset) {
                        next[domainId] = previousValues[domainId]
                    }
                    return next
                })
                setStatusMessage(error?.message || 'Failed to reset post modal field settings')
                setStatusTone('error')
            })
    }, [normalizeVisibilityPayload, postModalFieldVisibility, savePostModalFieldVisibility, visiblePostModalDomainOptions])

    const domainKeys = useMemo(() => getSortedDomainKeys(domainMap), [domainMap])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token) {
                router.push('/login')
                return
            }

            const user = getCurrentUser()
            if (!user) {
                setLoading(false)
                router.replace('/login')
                return
            }

            const userIsSuperAdmin = user.role === 'superadmin'
            const userScopedDomain = String(user?.domain || '').trim().toLowerCase()

            setIsSuperAdmin(userIsSuperAdmin)
            setScopedAdminDomain(userIsSuperAdmin ? '' : userScopedDomain)

            await loadPostModalFieldVisibilitySettings()

            if (!userIsSuperAdmin) {
                if (!cancelled) setLoading(false)
                return
            }

            await fetchSettings(token, 'bootstrap')
            if (!cancelled) setLoading(false)

            void Promise.allSettled([
                fetchSettings(token, 'live'),
                fetchAsanaStatus(token),
                fetchCustomerCohorts(token),
                fetchAiProviderModels(token),
            ])
        }

        bootstrap()
        return () => { cancelled = true }
    }, [router, fetchSettings, fetchAsanaStatus, fetchCustomerCohorts, fetchAiProviderModels, loadPostModalFieldVisibilitySettings])

    useEffect(() => {
        if (loading || !isSuperAdmin) return

        const token = window.localStorage.getItem('adminToken')
        if (!token) return

        const timeoutId = window.setTimeout(() => {
            fetchEmailDeliveryStatus(token, activeDomain)
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [activeDomain, loading, isSuperAdmin, fetchEmailDeliveryStatus])

    useEffect(() => {
        // Reset cache panel when domain changes
        const timeoutId = window.setTimeout(() => {
            setIsCacheExpanded(false)
            setCacheInfo(null)
            setReplaceAiApiKey(false)
            setAiDefaultCustomMode(false)
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [activeDomain])

    const activeSettings = useMemo(() => {
        return domainMap[activeDomain] || makeDefaultSettings(activeDomain)
    }, [activeDomain, domainMap])

    const aiPresetOptions = useMemo(() => buildDomainAiPresetOptions(aiProviderModels), [aiProviderModels])
    const activeAiFeaturePresets = useMemo(
        () => normalizeDomainAiFeaturePresets(activeSettings.aiFeaturePresets),
        [activeSettings.aiFeaturePresets]
    )
    const defaultAiPresetValue = useMemo(
        () => findDomainAiPresetValue(aiProviderModels, activeSettings.aiVendor, activeSettings.aiModel),
        [aiProviderModels, activeSettings.aiVendor, activeSettings.aiModel]
    )
    const selectedDefaultAiPreset = useMemo(
        () => aiPresetOptions.find((option) => option.value === defaultAiPresetValue) || null,
        [aiPresetOptions, defaultAiPresetValue]
    )
    const showCustomAiFields = aiDefaultCustomMode || !selectedDefaultAiPreset
    const assistantFeaturePreset = activeAiFeaturePresets[DOMAIN_AI_FEATURE_ADMIN_ASSISTANT]
    const useAssistantCustomSettings = !assistantFeaturePreset.provider
    const domainDefaultAiSelection = useMemo(
        () => resolveDomainAiFeatureSelection(DOMAIN_AI_FEATURE_KEYS[0], {}, {
            providerModels: aiProviderModels,
            fallbackProvider: activeSettings.aiVendor,
            fallbackModel: activeSettings.aiModel,
        }),
        [aiProviderModels, activeSettings.aiVendor, activeSettings.aiModel]
    )

    const quickActionsConfig = useMemo(() => {
        return normalizeAdminQuickActionsConfig(activeSettings.adminQuickActions)
    }, [activeSettings.adminQuickActions])

    const adminDashboardCardOrder = useMemo(() => {
        return normalizeAdminDashboardCardOrder(activeSettings.adminDashboardCardOrder)
    }, [activeSettings.adminDashboardCardOrder])

    const selectedCustomerCohort = useMemo(() => {
        return getCustomerCohortByKey(customerCohorts, activeSettings.customerCohortKey)
    }, [customerCohorts, activeSettings.customerCohortKey])

    const builtinQuickActionsByKey = useMemo(() => {
        return ADMIN_QUICK_ACTION_DEFINITIONS.reduce((acc, action) => {
            acc[action.key] = action
            return acc
        }, {})
    }, [])

    function updateField(field, value) {
        if (PATIENT_DEPENDENT_CARD_FIELDS.has(field)) {
            touchedPatientCardFlags.current.add(field)
        }

        setDomainMap(prev => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const nextValue = PATIENT_DEPENDENT_CARD_FIELDS.has(field) && current.patientsEnabled !== true
                ? false
                : value

            if (field === 'emailContact') {
                const currentDelivery = current.contactEmailDelivery || { enabled: true, recipient: '' }
                return {
                    ...prev,
                    [activeDomain]: {
                        ...current,
                        [field]: nextValue,
                        contactEmailDelivery: {
                            ...currentDelivery,
                            recipient: String(nextValue || ''),
                        },
                    },
                }
            }

            if (field === 'patientsEnabled' && nextValue !== true) {
                // Turning Patients off clears the dependent cards, so those clears are
                // changes the user made and must be saved.
                PATIENT_CARD_FLAG_KEYS.forEach((flagKey) => touchedPatientCardFlags.current.add(flagKey))

                return {
                    ...prev,
                    [activeDomain]: {
                        ...current,
                        patientsEnabled: false,
                        patientBillingEnabled: false,
                        reportsCardEnabled: false,
                        casesCardEnabled: false,
                        appointmentsCardEnabled: false,
                        formsCardEnabled: false,
                        notesCardEnabled: false,
                        docsCardEnabled: false,
                        analysisCardEnabled: false,
                    },
                }
            }

            return { ...prev, [activeDomain]: { ...current, [field]: nextValue } }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateAsanaField(field, value) {
        setDomainMap(prev => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const prevAsana = current.asanaContact || { ...DEFAULT_ASANA_CONTACT_SETTINGS }
            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    asanaContact: { ...prevAsana, [field]: value },
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateWorkerVisibility(workerKey, visible) {
        setDomainMap((prev) => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    workerVisibility: {
                        ...readWorkerVisibility(current),
                        [workerKey]: visible,
                    },
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateSeoField(field, value) {
        setDomainMap(prev => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const prevSeo = normalizeDomainSeoSettings(current.seo)
            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    seo: { ...prevSeo, [field]: value },
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateUsageValue(updater) {
        setDomainMap(prev => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const currentUsageValue = current.usageValue && typeof current.usageValue === 'object'
                ? current.usageValue
                : getDefaultUsageValueSettings(activeDomain)
            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    usageValue: updater(currentUsageValue),
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateWebsiteMonthlyCost(value) {
        updateUsageValue((usageValue) => ({ ...usageValue, websiteMonthlyCost: value }))
    }

    function updateReplacedTool(index, field, value) {
        updateUsageValue((usageValue) => {
            const tools = Array.isArray(usageValue.replacedTools) ? [...usageValue.replacedTools] : []
            if (!tools[index]) return usageValue
            tools[index] = { ...tools[index], [field]: value }
            return { ...usageValue, replacedTools: tools }
        })
    }

    function addReplacedTool() {
        updateUsageValue((usageValue) => {
            const tools = Array.isArray(usageValue.replacedTools) ? [...usageValue.replacedTools] : []
            return { ...usageValue, replacedTools: [...tools, { name: '', monthlyCost: '' }] }
        })
    }

    function removeReplacedTool(index) {
        updateUsageValue((usageValue) => {
            const tools = Array.isArray(usageValue.replacedTools) ? [...usageValue.replacedTools] : []
            return { ...usageValue, replacedTools: tools.filter((_, toolIndex) => toolIndex !== index) }
        })
    }

    function updateContactEmailDeliveryField(field, value) {
        setDomainMap(prev => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const currentDelivery = current.contactEmailDelivery || { enabled: true, recipient: '' }
            const nextDelivery = {
                ...currentDelivery,
                [field]: value,
            }
            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    contactEmailDelivery: nextDelivery,
                    emailContact: field === 'recipient' ? String(value || '') : current.emailContact,
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function insertSourcingDomainLogoToken() {
        const existing = String(activeSettings.sourcingEmailSignature || '')
        if (existing.includes(SOURCING_DOMAIN_LOGO_URL_TOKEN)) {
            setStatusMessage('Domain logo token is already present in the signature.')
            setStatusTone('neutral')
            return
        }

        const trimmedExisting = existing.trimEnd()
        const nextValue = trimmedExisting
            ? `${trimmedExisting}\n${SOURCING_DOMAIN_LOGO_URL_TOKEN}`
            : SOURCING_DOMAIN_LOGO_URL_TOKEN
        updateField('sourcingEmailSignature', nextValue)
    }

    function addChatRole() {
        const role = String(newChatRole || '').trim()
        if (!role) {
            return
        }

        setDomainMap((prev) => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const existingRoles = Array.isArray(current.chatRoles) ? current.chatRoles : []
            if (existingRoles.includes(role)) {
                return prev
            }

            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    chatRoles: [...existingRoles, role],
                },
            }
        })

        setNewChatRole('')
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function removeChatRole(roleToRemove) {
        setDomainMap((prev) => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const existingRoles = Array.isArray(current.chatRoles) ? current.chatRoles : []

            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    chatRoles: existingRoles.filter((role) => role !== roleToRemove),
                },
            }
        })

        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function updateQuickActionField(actionKey, enabled) {
        updateQuickActionsConfig((current) => ({
            ...current,
            enabled: {
                ...current.enabled,
                [actionKey]: !!enabled,
            },
        }))
    }

    function moveAdminDashboardCard(cardKey, direction) {
        const currentOrder = normalizeAdminDashboardCardOrder(activeSettings.adminDashboardCardOrder)
        const index = currentOrder.indexOf(cardKey)
        if (index < 0) return

        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= currentOrder.length) return

        const nextOrder = [...currentOrder]
        const [movedCard] = nextOrder.splice(index, 1)
        nextOrder.splice(targetIndex, 0, movedCard)
        updateField('adminDashboardCardOrder', nextOrder)
    }

    function resetAdminDashboardCardOrder() {
        updateField('adminDashboardCardOrder', [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
    }

    function updateQuickActionsConfig(updater) {
        setDomainMap((prev) => {
            const current = prev[activeDomain] || makeDefaultSettings(activeDomain)
            const currentQuickActions = normalizeAdminQuickActionsConfig(current.adminQuickActions)
            const nextQuickActions = typeof updater === 'function'
                ? updater(currentQuickActions)
                : updater

            return {
                ...prev,
                [activeDomain]: {
                    ...current,
                    adminQuickActions: normalizeAdminQuickActionsConfig(nextQuickActions),
                },
            }
        })
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function moveBuiltinQuickAction(actionKey, direction) {
        updateQuickActionsConfig((current) => {
            const order = [...current.order]
            const index = order.indexOf(actionKey)
            if (index === -1) return current

            const targetIndex = direction === 'up' ? index - 1 : index + 1
            if (targetIndex < 0 || targetIndex >= order.length) return current

            const [item] = order.splice(index, 1)
            order.splice(targetIndex, 0, item)
            return { ...current, order }
        })
    }

    function moveCustomQuickAction(actionId, direction) {
        updateQuickActionsConfig((current) => {
            const links = [...current.customLinks]
            const index = links.findIndex((item) => item.id === actionId)
            if (index === -1) return current

            const targetIndex = direction === 'up' ? index - 1 : index + 1
            if (targetIndex < 0 || targetIndex >= links.length) return current

            const [item] = links.splice(index, 1)
            links.splice(targetIndex, 0, item)
            return { ...current, customLinks: links }
        })
    }

    function updateCustomQuickAction(actionId, field, value) {
        updateQuickActionsConfig((current) => ({
            ...current,
            customLinks: current.customLinks.map((item) => {
                if (item.id !== actionId) return item
                return { ...item, [field]: value }
            }),
        }))
    }

    function removeCustomQuickAction(actionId) {
        updateQuickActionsConfig((current) => ({
            ...current,
            customLinks: current.customLinks.filter((item) => item.id !== actionId),
        }))
    }

    function addCustomQuickAction() {
        const label = String(newQuickActionLabel || '').trim()
        const url = String(newQuickActionUrl || '').trim()

        if (!label || !url) {
            setStatusMessage('Custom action label and URL are required.')
            setStatusTone('error')
            return
        }

        updateQuickActionsConfig((current) => ({
            ...current,
            customLinks: [
                ...current.customLinks,
                {
                    id: `custom-link-${current.customLinks.length + 1}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'}`,
                    label,
                    url,
                    icon: newQuickActionIcon || '🔗',
                    color: newQuickActionColor || '#94a3b8',
                    openInNewTab: !!newQuickActionOpenInNewTab,
                    enabled: true,
                },
            ],
        }))

        setNewQuickActionLabel('')
        setNewQuickActionUrl('')
        setNewQuickActionIcon('🔗')
        setNewQuickActionColor('#94a3b8')
        setNewQuickActionOpenInNewTab(true)
    }

    async function saveSettings() {
        const token = window.localStorage.getItem('adminToken')
        if (!token) return

        setSaving(true)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const settingsToSave = { ...activeSettings }
            const activeContactDelivery = activeSettings.contactEmailDelivery || { enabled: true, recipient: '' }
            settingsToSave.contactEmailDelivery = {
                enabled: activeContactDelivery.enabled !== false,
                recipient: String(activeContactDelivery.recipient || '').trim(),
            }
            settingsToSave.patientBillingEnabled = settingsToSave.patientsEnabled === true && settingsToSave.patientBillingEnabled === true
            settingsToSave.reportsCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.reportsCardEnabled !== false
            settingsToSave.casesCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.casesCardEnabled !== false
            settingsToSave.appointmentsCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.appointmentsCardEnabled !== false
            settingsToSave.formsCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.formsCardEnabled !== false
            settingsToSave.notesCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.notesCardEnabled !== false
            settingsToSave.docsCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.docsCardEnabled !== false
            settingsToSave.analysisCardEnabled = settingsToSave.patientsEnabled === true && settingsToSave.analysisCardEnabled !== false
            // Send only the patient card flags the user changed. The API keeps the stored
            // value for an omitted flag, so a save can never turn off a card nobody touched.
            for (const flagKey of PATIENT_CARD_FLAG_KEYS) {
                if (!touchedPatientCardFlags.current.has(flagKey)) delete settingsToSave[flagKey]
            }
            settingsToSave.workerVisibility = readWorkerVisibility(settingsToSave)
            settingsToSave.chatEnabled = settingsToSave.chatEnabled === true
            settingsToSave.chatRoles = Array.from(new Set((Array.isArray(settingsToSave.chatRoles) ? settingsToSave.chatRoles : [])
                .map((role) => String(role || '').trim())
                .filter(Boolean)))
            settingsToSave.billingCurrency = String(settingsToSave.billingCurrency || 'AUD').trim().toUpperCase() || 'AUD'
            settingsToSave.customerCohortKey = normalizeCustomerCohortKey(settingsToSave.customerCohortKey)
            // Keep legacy field in sync for older routes that still read emailContact directly.
            settingsToSave.emailContact = settingsToSave.contactEmailDelivery.recipient
            if (settingsToSave.asanaContact) {
                settingsToSave.asanaContact = normalizeAsanaContactSettings(settingsToSave.asanaContact)
            }
            settingsToSave.homepagePalette = normalizeHomepagePaletteSettings(settingsToSave.homepagePalette)
            settingsToSave.usageValue = normalizeUsageValueSettings(settingsToSave.usageValue, activeDomain)
            settingsToSave.seo = normalizeDomainSeoSettings(settingsToSave.seo)
            settingsToSave.adminQuickActions = normalizeAdminQuickActionsConfig(settingsToSave.adminQuickActions)
            settingsToSave.adminDashboardCardOrder = normalizeAdminDashboardCardOrder(settingsToSave.adminDashboardCardOrder)
            settingsToSave.adminFloatingLinkEnabled = settingsToSave.adminFloatingLinkEnabled === true
            Object.assign(settingsToSave, normalizeDomainFeatureFlags(settingsToSave, activeDomain))
            settingsToSave.practiceType = normalizePracticeType(settingsToSave.practiceType, activeDomain)
            settingsToSave.templateLibraryPath = String(settingsToSave.templateLibraryPath || '').trim()
            settingsToSave.sourcingBccReplyToDefault = settingsToSave.sourcingBccReplyToDefault === true
            settingsToSave.sourcingEmailSignature = String(settingsToSave.sourcingEmailSignature || '').trim()
            settingsToSave.aiVendor = normalizeAiProvider(settingsToSave.aiVendor)
            settingsToSave.aiModel = String(settingsToSave.aiModel || '').trim() || getAiProviderDefaultModel(settingsToSave.aiVendor)
            settingsToSave.aiFeaturePresets = normalizeDomainAiFeaturePresets(settingsToSave.aiFeaturePresets)
            settingsToSave.aiBaseUrl = String(settingsToSave.aiBaseUrl || '').trim()
            settingsToSave.aiApiKey = replaceAiApiKey
                ? String(settingsToSave.aiApiKey || '').trim()
                : KEEP_EXISTING_API_KEY_SENTINEL

            const normalizedAssistantForSave = normalizeAssistantSettings(settingsToSave)
            settingsToSave.assistantEnabled = normalizedAssistantForSave.assistantEnabled
            settingsToSave.assistantProvider = normalizedAssistantForSave.assistantProvider
            settingsToSave.assistantModel = normalizedAssistantForSave.assistantModel
            settingsToSave.assistantProjectId = normalizedAssistantForSave.assistantProjectId
            settingsToSave.assistantLocation = normalizedAssistantForSave.assistantLocation

            const res = await fetch('/api/settings/domains', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ domainKey: activeDomain, settings: settingsToSave }),
            })

            const data = await res.json()

            if (!res.ok || !data.success) {
                setStatusMessage(data.error || 'Failed to save domain settings.')
                setStatusTone('error')
                return
            }

            setDomainMap(prev => ({
                ...prev,
                [activeDomain]: { ...(prev[activeDomain] || {}), ...data.domain },
            }))
            setReplaceAiApiKey(false)
            setHasUnsavedChanges(false)
            touchedPatientCardFlags.current.clear()
            setStatusMessage('Domain settings saved.')
            setStatusTone('success')
        } catch (err) {
            setStatusMessage(err.message || 'Unexpected error saving settings.')
            setStatusTone('error')
        } finally {
            setSaving(false)
        }
    }

    function resetActiveDomain() {
        // Resetting rewrites every card flag, so treat them all as touched.
        PATIENT_CARD_FLAG_KEYS.forEach((flagKey) => touchedPatientCardFlags.current.add(flagKey))
        const overrides = websiteEnabledDefault === null ? undefined : { websiteEnabled: websiteEnabledDefault }
        setDomainMap(prev => ({ ...prev, [activeDomain]: makeDefaultSettings(activeDomain, overrides) }))
        setHasUnsavedChanges(true)
        setStatusMessage('Domain values reset to defaults. Save to persist.')
        setStatusTone('neutral')
    }

    function addDomain() {
        const raw = window.prompt('New domain key (example: acme)')
        const key = (raw || '').trim().toLowerCase()
        if (!key) return

        if (!/^[a-z0-9-]+$/.test(key)) {
            setStatusMessage('Domain key must use lowercase letters, numbers, or hyphens.')
            setStatusTone('error')
            return
        }

        if (domainMap[key]) {
            setActiveDomain(key)
            setStatusMessage('Domain already exists. Switched to existing settings.')
            setStatusTone('neutral')
            return
        }

        PATIENT_CARD_FLAG_KEYS.forEach((flagKey) => touchedPatientCardFlags.current.add(flagKey))
        const overrides = websiteEnabledDefault === null ? undefined : { websiteEnabled: websiteEnabledDefault }
        setDomainMap(prev => ({ ...prev, [key]: makeDefaultSettings(key, overrides) }))
        setActiveDomain(key)
        setHasUnsavedChanges(true)
        setStatusMessage('Domain added. Configure fields and save.')
        setStatusTone('success')
    }

    async function sendTestEmail() {
        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setStatusMessage('Missing admin token. Please log in again.')
            setStatusTone('error')
            return
        }

        setSendingTestEmail(true)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const response = await fetch('/api/settings/domains/email-delivery', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    domainKey: activeDomain,
                    testMessage: testMessageText
                })
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to queue test email')
            }

            const queueIdText = data?.queueId ? ` Queue ID: ${data.queueId}.` : ''
            setStatusMessage(`Test message queued in database for ${data.recipient}.${queueIdText}`)
            setStatusTone('success')
            await fetchEmailDeliveryStatus(token, activeDomain)
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to queue test email')
            setStatusTone('error')
        } finally {
            setSendingTestEmail(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-gray-500 text-sm">Loading…</div>
            </div>
        )
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    const asana = activeSettings.asanaContact || { ...DEFAULT_ASANA_CONTACT_SETTINGS }
    const seo = normalizeDomainSeoSettings(activeSettings.seo)
    const contactEmailDelivery = activeSettings.contactEmailDelivery || { enabled: true, recipient: activeSettings.emailContact || '' }
    const homepagePalette = normalizeHomepagePaletteSettings(activeSettings.homepagePalette)
    const resolvedContactRecipient = String(contactEmailDelivery.recipient || activeSettings.emailContact || '').trim()
    const patientBillingEnabled = activeSettings.patientsEnabled === true && activeSettings.patientBillingEnabled === true
    const reportsCardEnabled = activeSettings.patientsEnabled === true && activeSettings.reportsCardEnabled !== false
    const casesCardEnabled = activeSettings.patientsEnabled === true && activeSettings.casesCardEnabled !== false
    const appointmentsCardEnabled = activeSettings.patientsEnabled === true && activeSettings.appointmentsCardEnabled !== false
    const formsCardEnabled = activeSettings.patientsEnabled === true && activeSettings.formsCardEnabled !== false
    const notesCardEnabled = activeSettings.patientsEnabled === true && activeSettings.notesCardEnabled !== false
    const docsCardEnabled = activeSettings.patientsEnabled === true && activeSettings.docsCardEnabled !== false
    const analysisCardEnabled = activeSettings.patientsEnabled === true && activeSettings.analysisCardEnabled !== false
    const getFeatureCheckboxValue = (field) => {
        if (field === 'patientBillingEnabled') return patientBillingEnabled
        if (field === 'reportsCardEnabled') return reportsCardEnabled
        if (field === 'casesCardEnabled') return casesCardEnabled
        if (field === 'appointmentsCardEnabled') return appointmentsCardEnabled
        if (field === 'formsCardEnabled') return formsCardEnabled
        if (field === 'notesCardEnabled') return notesCardEnabled
        if (field === 'docsCardEnabled') return docsCardEnabled
        if (field === 'analysisCardEnabled') return analysisCardEnabled
        return !!activeSettings[field]
    }
    const generalFeatureFields = GENERAL_FEATURE_FIELDS
    const renderFeatureCheckbox = ([field, label]) => {
        const disabled = PATIENT_DEPENDENT_CARD_FIELDS.has(field) && !activeSettings.patientsEnabled
        return (
            <label key={field} className={`flex items-start gap-2 text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
                <input
                    type="checkbox"
                    checked={getFeatureCheckboxValue(field)}
                    disabled={disabled}
                    onChange={(e) => updateField(field, e.target.checked)}
                    className="h-4 w-4 mt-0.5"
                />
                <span>
                    {label}
                    {disabled && (
                        <span className="block text-xs text-gray-400 mt-0.5">Enable Patients first.</span>
                    )}
                </span>
            </label>
        )
    }
    const workerVisibility = readWorkerVisibility(activeSettings)
    const fileStorageBackend = normalizeFileStorageBackend(activeSettings.fileStorageBackend)
    const resolvedSourcingDomainLogoUrl = resolveDomainLogoUrl({
        domainKey: activeDomain,
        publicBaseUrl: activeSettings.publicBaseUrl,
        primaryHostname: activeSettings.primaryHostname,
        fallbackOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    })
    const sourcingSignaturePreviewHtml = buildSourcingSignaturePreviewHtml({
        signatureTemplate: activeSettings.sourcingEmailSignature || '',
        domainLogoUrl: resolvedSourcingDomainLogoUrl,
        practiceName: activeSettings.displayName || activeDomain,
        senderName: 'Equipment Sourcing',
    })
    const usageValue = activeSettings.usageValue && typeof activeSettings.usageValue === 'object'
        ? activeSettings.usageValue
        : getDefaultUsageValueSettings(activeDomain)
    const usageValueReplacedTools = Array.isArray(usageValue.replacedTools) ? usageValue.replacedTools : []
    const usageValuePreview = summarizeUsageValue(normalizeUsageValueSettings(usageValue, activeDomain), 0, activeDomain)
    const settingsSections = [
        { id: 'features', label: 'Features', description: 'Domain toggles and homepage options' },
        { id: 'routing', label: 'Routing & URLs', description: 'Identity, hostnames, and service endpoints' },
        { id: 'email', label: 'Email', description: 'Contact delivery and queue test tools' },
        { id: 'chat', label: 'Chat', description: 'Chat availability and roles' },
        { id: 'ai', label: 'AI & Defaults', description: 'Locale, search, billing, and AI settings' },
        { id: 'usage', label: 'Usage & Value', description: 'Cohort markup, platform costs, and replaced tools' },
        { id: 'seo', label: 'SEO', description: 'Metadata and sharing defaults' },
        { id: 'actions', label: 'Admin Actions', description: 'Dashboard quick actions' },
        ...(hasPrivateDomainTrait(activeDomain, 'asanaContactSettings')
            ? [{ id: 'asana', label: 'Asana', description: 'Contact form to Asana' }]
            : []),
        { id: 'operations', label: 'Operations', description: 'Cache, audit notes, and reset tools' },
        { id: 'global', label: 'Global Fields', description: 'Post modal fields across domains' },
    ]
    const selectedSettingsSection = settingsSections.some((section) => section.id === activeSettingsSection)
        ? activeSettingsSection
        : 'features'
    const selectedSettingsSectionLabel = settingsSections.find((section) => section.id === selectedSettingsSection)?.label || 'Settings'

    const postModalSettingsPanel = (
        <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Post Modal Fields by Domain</h2>
                <button
                    type="button"
                    onClick={resetPostModalFieldVisibility}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                >
                    Reset Fields
                </button>
            </div>

            {!isSuperAdmin && (
                <p className="mb-3 text-xs text-gray-500">
                    Scoped admin access: you can only view and update your assigned domain.
                </p>
            )}

            <div className="border border-gray-200 rounded overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <div className="col-span-6">Domain</div>
                    <div className="col-span-3 text-center">Description</div>
                    <div className="col-span-3 text-center">Body</div>
                </div>

                <div className="max-h-56 overflow-auto">
                    {visiblePostModalDomainOptions.map((domainOption) => {
                        const domainVisibility = postModalFieldVisibility[domainOption.id] || { description: true, body: true }
                        const canEditDomain = canEditPostModalDomain(domainOption.id)

                        return (
                            <div key={domainOption.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 items-center">
                                <div className="col-span-6 text-sm text-gray-700 font-medium">{domainOption.label}</div>

                                <div className="col-span-3 flex justify-center">
                                    <button
                                        type="button"
                                        onClick={() => togglePostModalFieldVisibility(domainOption.id, 'description')}
                                        role="switch"
                                        aria-checked={domainVisibility.description !== false}
                                        disabled={!canEditDomain}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${domainVisibility.description !== false ? 'bg-slate-500' : 'bg-slate-300'} ${canEditDomain ? '' : 'opacity-50 cursor-not-allowed'}`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${domainVisibility.description !== false ? 'translate-x-6' : 'translate-x-1'}`}
                                        />
                                    </button>
                                </div>

                                <div className="col-span-3 flex justify-center">
                                    <button
                                        type="button"
                                        onClick={() => togglePostModalFieldVisibility(domainOption.id, 'body')}
                                        role="switch"
                                        aria-checked={domainVisibility.body !== false}
                                        disabled={!canEditDomain}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${domainVisibility.body !== false ? 'bg-slate-500' : 'bg-slate-300'} ${canEditDomain ? '' : 'opacity-50 cursor-not-allowed'}`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${domainVisibility.body !== false ? 'translate-x-6' : 'translate-x-1'}`}
                                        />
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )

    if (!isSuperAdmin) {
        return (
            <div className="min-h-screen bg-gray-50">
                <AdminHeader title="Domain Settings" brandingDomainKey={scopedAdminDomain || DEFAULT_DOMAIN_MODE} />

                <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
                    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">Domain Settings</h1>
                                <p className="text-sm text-gray-600 mt-1">
                                    Scoped configuration for your assigned domain.
                                </p>
                            </div>
                            <button
                                onClick={() => router.push('/admin/settings')}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                            >
                                Back to Settings
                            </button>
                        </div>

                        {statusMessage && (
                            <p className={`mt-4 text-sm border rounded-md px-3 py-2 ${statusClasses}`}>
                                {statusMessage}
                            </p>
                        )}
                    </section>

                    {postModalSettingsPanel}
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Domain Settings" brandingDomainKey={activeDomain} />

            <main className="max-w-[96rem] mx-auto px-4 py-8 space-y-6">
                {/* Header */}
                <section className="sticky top-0 z-20 bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-sm p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Domain Management</h1>
                            <p className="text-sm text-gray-600 mt-1">
                                Configure routing, integrations, and feature behavior for each domain. Settings are persisted to the database.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => router.push('/admin/settings')}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                            >
                                Back to Settings
                            </button>
                            <button
                                onClick={addDomain}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                            >
                                Add Domain
                            </button>
                            <button
                                onClick={saveSettings}
                                disabled={saving}
                                className="px-3 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>

                    {statusMessage && (
                        <p className={`mt-4 text-sm border rounded-md px-3 py-2 ${statusClasses}`}>
                            {statusMessage}
                        </p>
                    )}
                    {hasUnsavedChanges && (
                        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            You have unsaved changes.
                        </p>
                    )}
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    {/* Sidebar */}
                    <aside className="xl:col-span-2 xl:sticky xl:top-32 bg-white border border-gray-200 rounded-lg shadow-sm p-3 h-fit max-h-[calc(100vh-10rem)] overflow-auto">
                        <div className="flex items-center justify-between mb-2 px-2">
                            <h2 className="text-sm font-semibold text-gray-800">Domains</h2>
                            <span className="text-xs text-gray-500">{domainKeys.length}</span>
                        </div>
                        <div className="space-y-1">
                            {domainKeys.map((key) => {
                                const selected = key === activeDomain
                                const item = domainMap[key]
                                return (
                                    <button
                                        key={key}
                                        onClick={() => { setActiveDomain(key); setStatusMessage(''); setStatusTone('neutral') }}
                                        className={`w-full text-left rounded-md px-3 py-2 border transition-colors ${selected
                                            ? 'bg-gray-900 text-white border-gray-900'
                                            : 'bg-white text-gray-800 border-transparent hover:bg-gray-50 hover:border-gray-200'
                                            }`}
                                    >
                                        <p className="text-sm font-medium truncate">{item.displayName || key}</p>
                                        <p className={`text-xs truncate ${selected ? 'text-gray-200' : 'text-gray-500'}`}>{key}</p>
                                    </button>
                                )
                            })}
                        </div>
                    </aside>

                    <aside className="xl:col-span-2 xl:sticky xl:top-32 bg-white border border-gray-200 rounded-lg shadow-sm p-3 h-fit">
                        <div className="mb-2 px-2">
                            <h2 className="text-sm font-semibold text-gray-800">Sections</h2>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{activeSettings.displayName || activeDomain}</p>
                        </div>
                        <div className="space-y-1">
                            {settingsSections.map((section) => {
                                const selected = section.id === selectedSettingsSection
                                return (
                                    <button
                                        key={section.id}
                                        type="button"
                                        onClick={() => setActiveSettingsSection(section.id)}
                                        className={`w-full text-left rounded-md px-3 py-2 border transition-colors ${selected
                                            ? 'bg-gray-900 text-white border-gray-900'
                                            : 'bg-white text-gray-800 border-transparent hover:bg-gray-50 hover:border-gray-200'
                                            }`}
                                    >
                                        <span className="block text-sm font-medium">{section.label}</span>
                                        <span className={`block text-xs mt-0.5 ${selected ? 'text-gray-200' : 'text-gray-500'}`}>{section.description}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </aside>

                    {/* Main panels */}
                    <div className="xl:col-span-8 space-y-6">
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-5 py-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Editing</p>
                            <h2 className="mt-1 text-lg font-semibold text-gray-900">{selectedSettingsSectionLabel}</h2>
                        </div>

                        {selectedSettingsSection === 'global' && postModalSettingsPanel}

                        {/* Features */}
                        {selectedSettingsSection === 'features' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-4">Features</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="md:col-span-2">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">General</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {generalFeatureFields.map(renderFeatureCheckbox)}
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">File storage</p>
                                        <label className="block text-sm text-gray-700" htmlFor="file-storage-backend">
                                            Uploaded files
                                            <select
                                                id="file-storage-backend"
                                                value={fileStorageBackend}
                                                onChange={(e) => updateField('fileStorageBackend', e.target.value)}
                                                className="mt-1 block w-full md:w-1/2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
                                            >
                                                {FILE_STORAGE_BACKENDS.map((backend) => (
                                                    <option key={backend} value={backend}>{FILE_STORAGE_BACKEND_LABELS[backend]}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Local files, S3 and GCS are configured by the deployment with the FILE_STORAGE_* environment
                                            variables (see docs/file-storage.md). Files keep the backend they were uploaded to, so a change
                                            only affects new uploads.
                                        </p>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Admin Cards</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {ADMIN_CARD_FEATURE_FIELDS.map(renderFeatureCheckbox)}
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Docs Cards</p>
                                        <p className="mb-2 text-xs text-gray-500">
                                            Turning one off only hides its dashboard card; the page stays reachable from the Docs card.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {DOCS_CARD_FEATURE_FIELDS.map(renderFeatureCheckbox)}
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">AI Worker Cards</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {WORKER_DEFINITIONS.map((worker) => (
                                                <label key={worker.key} className={`flex items-start gap-2 text-sm ${activeSettings.patientsEnabled ? 'text-gray-700' : 'text-gray-400'}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={workerVisibility[worker.key]}
                                                        disabled={!activeSettings.patientsEnabled}
                                                        onChange={(event) => updateWorkerVisibility(worker.key, event.target.checked)}
                                                        className="h-4 w-4 mt-0.5"
                                                    />
                                                    <span>
                                                        {worker.label}
                                                        {!activeSettings.patientsEnabled && (
                                                            <span className="block text-xs text-gray-400 mt-0.5">Enable Patients first.</span>
                                                        )}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Homepage Palette Tray</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <label className="flex items-start gap-2 text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={homepagePalette.enabled}
                                                    onChange={(e) => updateField('homepagePalette', { ...homepagePalette, enabled: e.target.checked })}
                                                    className="h-4 w-4 mt-0.5"
                                                />
                                                <span>Enabled</span>
                                            </label>
                                            <label className="flex items-start gap-2 text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={homepagePalette.editMode}
                                                    onChange={(e) => updateField('homepagePalette', { ...homepagePalette, editMode: e.target.checked })}
                                                    className="h-4 w-4 mt-0.5"
                                                />
                                                <span>Edit Mode</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <div className="flex items-center gap-3">
                                            <p className="text-sm text-gray-700">
                                                Admin Background Color:{' '}
                                                <span className="font-medium text-gray-900">Customize per domain</span>
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setShowAdminBackgroundColorModal(true)}
                                                className="h-7 w-7 inline-flex items-center justify-center admin-btn"
                                                title="Edit admin background color"
                                                aria-label="Edit admin background color"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                </svg>
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Applies to the selected domain: <span className="font-medium text-gray-700">{activeDomain}</span>
                                        </p>
                                    </div>

                                </div>
                            </section>
                        )}

                        {/* Cache Management */}
                        {selectedSettingsSection === 'operations' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <button
                                    onClick={() => {
                                        setIsCacheExpanded(!isCacheExpanded)
                                        if (!isCacheExpanded && !cacheInfo) {
                                            fetchCacheInfo(activeDomain)
                                        }
                                    }}
                                    className="w-full flex items-center justify-between text-left hover:bg-gray-50 p-2 -m-2 rounded"
                                >
                                    <h2 className="text-base font-semibold text-gray-900">Cache Management</h2>
                                    <span className={`transform transition-transform ${isCacheExpanded ? 'rotate-180' : ''}`}>
                                        ▼
                                    </span>
                                </button>

                                {isCacheExpanded && (
                                    <div className="mt-4 space-y-4">
                                        {!activeSettings.enableLocalCaching ? (
                                            <p className="text-sm text-gray-500">Local caching is disabled. Enable it in Features to manage cache.</p>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => fetchCacheInfo(activeDomain)}
                                                    disabled={loadingCacheInfo}
                                                    className="px-3 py-2 text-sm bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    {loadingCacheInfo ? 'Loading…' : 'Refresh Info'}
                                                </button>

                                                {cacheInfo && (
                                                    <div className="space-y-3 bg-gray-50 p-4 rounded-md">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-gray-700">Cached items:</span>
                                                            <span className="font-medium text-gray-900">{cacheInfo.items.length}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-gray-700">Total size:</span>
                                                            <span className="font-medium text-gray-900">{(cacheInfo.totalSize / 1024).toFixed(2)} KB</span>
                                                        </div>

                                                        {cacheInfo.items.length > 0 && (
                                                            <div className="mt-3 pt-3 border-t border-gray-200">
                                                                <p className="text-xs font-medium text-gray-700 mb-2">Items:</p>
                                                                <div className="space-y-1 text-xs max-h-32 overflow-y-auto">
                                                                    {cacheInfo.items.map((item) => (
                                                                        <div key={item.key} className={`flex justify-between ${item.isExpired ? 'text-red-600' : 'text-gray-600'}`}>
                                                                            <span>
                                                                                {item.key}
                                                                                {item.isExpired && <span className="ml-1">(expired)</span>}
                                                                            </span>
                                                                            <span>{(item.size / 1024).toFixed(1)} KB</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => clearDomainCache(activeDomain)}
                                                    disabled={clearingCache}
                                                    className="px-3 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {clearingCache ? 'Clearing…' : 'Clear Cache'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Identity and Routing */}
                        {selectedSettingsSection === 'routing' && (
                            <>
                                <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Identity and Routing</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Display Name</span>
                                            <input type="text" value={activeSettings.displayName} onChange={(e) => updateField('displayName', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Example Domain" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Domain Key</span>
                                            <input type="text" value={activeSettings.domainKey} onChange={(e) => updateField('domainKey', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="example" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Practice Type</span>
                                            <select
                                                value={normalizePracticeType(activeSettings.practiceType, activeDomain)}
                                                onChange={(e) => updateField('practiceType', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            >
                                                {PRACTICE_TYPE_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Primary Hostname</span>
                                            <input type="text" value={activeSettings.primaryHostname} onChange={(e) => updateField('primaryHostname', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="example.com.au" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Allowed Hostnames (comma-separated)</span>
                                            <input type="text" value={activeSettings.allowedHostnames} onChange={(e) => updateField('allowedHostnames', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="example.com.au, www.example.com.au" />
                                        </label>
                                        <label className="block md:col-span-2">
                                            <span className="text-xs font-medium text-gray-700">Default Route</span>
                                            <input type="text" value={activeSettings.defaultRoute} onChange={(e) => updateField('defaultRoute', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="/admin" />
                                        </label>
                                        <label className="block md:col-span-2">
                                            <span className="text-xs font-medium text-gray-700">Template Library</span>
                                            <input
                                                type="text"
                                                value={activeSettings.templateLibraryPath || ''}
                                                onChange={(e) => updateField('templateLibraryPath', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="(auto — leave blank)"
                                            />
                                            <span className="block mt-1 text-xs text-gray-500">
                                                Optional override, relative to the content/ directory (never served publicly).
                                                Leave blank to auto-resolve: <span className="font-mono">content/templates/allied-health/domains/&lt;domain&gt;</span> when
                                                that folder exists, otherwise the folder for the practice type
                                                (<span className="font-mono">OT</span>, <span className="font-mono">physio</span> or <span className="font-mono">speech</span>).
                                            </span>
                                        </label>
                                    </div>
                                </section>

                                {/* Endpoints */}
                                <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Endpoints and Integrations</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Public Base URL</span>
                                            <input type="url" value={activeSettings.publicBaseUrl} onChange={(e) => updateField('publicBaseUrl', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="https://example.com.au" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Backend Base URL</span>
                                            <input type="url" value={activeSettings.backendBaseUrl} onChange={(e) => updateField('backendBaseUrl', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="https://core.example.com" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Plugin Base URL</span>
                                            <input type="url" value={activeSettings.pluginBaseUrl} onChange={(e) => updateField('pluginBaseUrl', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="https://plugin.example.com" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">WIT App URL</span>
                                            <input type="url" value={activeSettings.witBaseUrl} onChange={(e) => updateField('witBaseUrl', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="https://wit.example.com.au/" />
                                        </label>
                                    </div>
                                </section>
                            </>
                        )}

                        {/* Email Delivery */}
                        {selectedSettingsSection === 'email' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-base font-semibold text-gray-900">Contact Email Delivery</h2>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Configure a per-domain recipient and queue a test message into the outbound_messages table.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={async () => {
                                                const token = window.localStorage.getItem('adminToken')
                                                if (!token) return
                                                await fetchEmailDeliveryStatus(token, activeDomain)
                                            }}
                                            disabled={loadingEmailDeliveryStatus}
                                            className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loadingEmailDeliveryStatus ? 'Checking…' : 'Check Queue Status'}
                                        </button>
                                        <button
                                            onClick={sendTestEmail}
                                            disabled={sendingTestEmail || !resolvedContactRecipient || !contactEmailDelivery.enabled}
                                            className="px-3 py-2 text-xs text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {sendingTestEmail ? 'Queueing…' : 'Queue Test Message'}
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                                        <input
                                            type="checkbox"
                                            checked={!!contactEmailDelivery.enabled}
                                            onChange={(e) => updateContactEmailDeliveryField('enabled', e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        Enable contact email delivery
                                    </label>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Recipient Email</span>
                                        <input
                                            type="email"
                                            value={contactEmailDelivery.recipient || ''}
                                            onChange={(e) => updateContactEmailDeliveryField('recipient', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="you@example.com"
                                        />
                                    </label>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Test Message</span>
                                        <textarea
                                            value={testMessageText}
                                            onChange={(e) => setTestMessageText(e.target.value)}
                                            className="mt-1 w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="Message text saved in payload_json for this test queue item"
                                        />
                                    </label>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                    <div className="border border-gray-200 rounded-md px-3 py-2">
                                        <p className="text-xs font-medium text-gray-500">Recipient</p>
                                        <p className="mt-1 text-gray-900 break-all">{emailDeliveryStatus?.recipient || resolvedContactRecipient || 'Not configured'}</p>
                                    </div>
                                    <div className="border border-gray-200 rounded-md px-3 py-2">
                                        <p className="text-xs font-medium text-gray-500">Queue Status</p>
                                        <p className={`mt-1 ${emailDeliveryStatus?.queue?.reachable ? 'text-green-700' : 'text-amber-700'}`}>
                                            {emailDeliveryStatus?.queue?.reachable ? 'Reachable and authorized' : 'Unavailable or unauthorized'}
                                        </p>
                                    </div>
                                    <div className="border border-gray-200 rounded-md px-3 py-2 md:col-span-2">
                                        <p className="text-xs font-medium text-gray-500">Alert Sender (derived)</p>
                                        <p className="mt-1 text-gray-900 break-all">
                                            {resolveFormAlertSender(activeDomain, activeSettings.displayName) || 'Not available'}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Form submissions are sent from this address so recipients can tell which site the enquiry came from.
                                        </p>
                                    </div>
                                </div>

                                <p className="mt-3 text-xs text-gray-500">
                                    {emailDeliveryStatus?.queue?.message || 'Save Contact Email Delivery settings first, then run Check Queue Status.'}
                                </p>

                                <div className="mt-6 pt-4 border-t border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-900">Equipment Sourcing</h3>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Supplier quote requests are sent from a mailbox derived from the Display Name. Set a reply-to address if supplier responses should go elsewhere. Supplier replies are matched back to the request and emailed to each admin of this domain at their own contact address.
                                    </p>
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="border border-gray-200 rounded-md px-3 py-2">
                                            <p className="text-xs font-medium text-gray-500">Sender (derived)</p>
                                            <p className="mt-1 text-sm text-gray-900 break-all">
                                                {resolveSourcingSenderEmail(activeSettings.displayName || activeDomain) || 'Not available'}
                                            </p>
                                        </div>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Sourcing Reply-To Email</span>
                                            <input
                                                type="email"
                                                value={activeSettings.sourcingReplyToEmail || ''}
                                                onChange={(e) => updateField('sourcingReplyToEmail', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Defaults to the sender address"
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Sourcing Reply-To Name</span>
                                            <input
                                                type="text"
                                                value={activeSettings.sourcingReplyToName || ''}
                                                onChange={(e) => updateField('sourcingReplyToName', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Example: Kate"
                                            />
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                                            <input
                                                type="checkbox"
                                                checked={activeSettings.sourcingBccReplyToDefault === true}
                                                onChange={(e) => updateField('sourcingBccReplyToDefault', e.target.checked)}
                                                className="h-4 w-4"
                                            />
                                            Default Bcc reply-to for supplier emails
                                        </label>
                                        <div className="md:col-span-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div>
                                                    <p className="text-xs font-medium text-gray-700">Email Signature</p>
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        Add an optional signature appended to new quote emails. The first text row is automatically bold in the HTML email as the identity line. Use the domain logo token to insert the resolved logo URL.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={insertSourcingDomainLogoToken}
                                                    className="px-2.5 py-1.5 text-xs font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                                                >
                                                    Insert Domain Logo
                                                </button>
                                            </div>
                                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs font-medium text-gray-700">Signature Template</p>
                                                    <textarea
                                                        value={activeSettings.sourcingEmailSignature || ''}
                                                        onChange={(e) => updateField('sourcingEmailSignature', e.target.value)}
                                                        className="mt-1 w-full min-h-[170px] px-3 py-2 text-sm border border-gray-300 rounded-md font-mono"
                                                        placeholder={`Example:\nAcme OT\n${SOURCING_DOMAIN_LOGO_URL_TOKEN}`}
                                                    />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-gray-700">HTML Preview</p>
                                                    <div
                                                        className="mt-1 min-h-[170px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
                                                        dangerouslySetInnerHTML={{ __html: sourcingSignaturePreviewHtml }}
                                                    />
                                                </div>
                                            </div>
                                            <p className="mt-2 text-xs text-gray-500 break-all">
                                                Token: {SOURCING_DOMAIN_LOGO_URL_TOKEN} -&gt; {resolvedSourcingDomainLogoUrl || '(logo URL unavailable)'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Chat */}
                        {selectedSettingsSection === 'chat' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-4">Chat Configuration</h2>
                                <div className="space-y-4">
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={!!activeSettings.chatEnabled}
                                            onChange={(e) => updateField('chatEnabled', e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        Enable chat
                                    </label>

                                    <div>
                                        <p className="text-xs font-medium text-gray-700 mb-2">Chat Roles</p>
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {(Array.isArray(activeSettings.chatRoles) ? activeSettings.chatRoles : []).map((role) => (
                                                <span key={role} className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                                                    {role}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeChatRole(role)}
                                                        className="text-gray-500 hover:text-gray-800"
                                                        aria-label={`Remove ${role} role`}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                            {(Array.isArray(activeSettings.chatRoles) ? activeSettings.chatRoles : []).length === 0 && (
                                                <p className="text-xs text-gray-500">No chat roles configured.</p>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={newChatRole}
                                                onChange={(e) => setNewChatRole(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        addChatRole()
                                                    }
                                                }}
                                                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Add role (e.g. Support, Contact)"
                                            />
                                            <button
                                                type="button"
                                                onClick={addChatRole}
                                                className="px-3 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700"
                                            >
                                                Add Role
                                            </button>
                                        </div>
                                    </div>

                                    <p className="text-xs text-gray-500">
                                        When enabled, chat sessions are logged to the chats table and may also enqueue outgoing messages depending on the selected role.
                                    </p>
                                </div>
                            </section>
                        )}

                        {/* Behavior */}
                        {selectedSettingsSection === 'ai' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-4">Behavior and Policies</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Timezone</span>
                                        <input type="text" value={activeSettings.timezone} onChange={(e) => updateField('timezone', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Australia/Sydney" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Locale</span>
                                        <input type="text" value={activeSettings.locale} onChange={(e) => updateField('locale', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="en-AU" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Search Provider</span>
                                        <select value={activeSettings.searchProvider} onChange={(e) => updateField('searchProvider', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md">
                                            <option value="brave">Brave</option>
                                            <option value="google">Google</option>
                                            <option value="none">None</option>
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Billing Currency</span>
                                        <input
                                            type="text"
                                            value={activeSettings.billingCurrency || 'AUD'}
                                            onChange={(e) => updateField('billingCurrency', e.target.value.toUpperCase())}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="AUD"
                                            maxLength={8}
                                        />
                                    </label>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Domain AI Provider</p>
                                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                            The AI API key and base URL are domain-wide. Choose the default model preset, then optionally
                                            give a feature its own preset from the same Flagship / Balanced / Value matrix used in Reporting
                                            Settings. A feature with no preset inherits the domain default. The Admin AI Assistant defaults
                                            to its own assistant settings; report analysis sets its provider and model in Reporting Settings.
                                        </p>
                                    </div>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Default model preset</span>
                                        <span className="block text-xs text-gray-500">
                                            Flagship / Balanced / Value preset from Reporting Settings. Choose Custom to enter a vendor and model yourself.
                                        </span>
                                        <select
                                            value={showCustomAiFields ? '' : defaultAiPresetValue}
                                            onChange={(e) => {
                                                const next = parseDomainAiPresetValue(e.target.value)
                                                if (!next.provider) {
                                                    setAiDefaultCustomMode(true)
                                                    return
                                                }
                                                setAiDefaultCustomMode(false)
                                                const option = aiPresetOptions.find((item) => item.value === e.target.value)
                                                updateField('aiVendor', next.provider)
                                                updateField('aiModel', option?.model || getAiProviderDefaultModel(next.provider))
                                            }}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white"
                                        >
                                            <option value="">Custom (enter vendor and model)</option>
                                            {aiPresetOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    {selectedDefaultAiPreset && !showCustomAiFields && (
                                        <div className="md:col-span-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                            Default: {selectedDefaultAiPreset.providerLabel}
                                            {' · '}
                                            {selectedDefaultAiPreset.tierLabel}
                                            {' · '}
                                            <span className="font-mono">{selectedDefaultAiPreset.model}</span>
                                            {' '}— choose <span className="font-medium">Custom</span> to enter a different vendor or model.
                                        </div>
                                    )}
                                    {showCustomAiFields && (
                                        <>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">AI Vendor</span>
                                                <span className="block text-xs text-gray-500">Custom provider for every AI feature</span>
                                                <select value={activeSettings.aiVendor || 'openai'} onChange={(e) => {
                                                    const nextVendor = e.target.value
                                                    updateField('aiVendor', nextVendor)
                                                    updateField('aiModel', getAiProviderDefaultModel(nextVendor))
                                                }}
                                                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md">
                                                    {AI_PROVIDER_OPTIONS.map((provider) => (
                                                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">AI Model</span>
                                                <span className="block text-xs text-gray-500">Custom model for every AI feature</span>
                                                <input type="text" value={activeSettings.aiModel} onChange={(e) => updateField('aiModel', e.target.value)}
                                                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="gpt-4.1-mini" />
                                            </label>
                                        </>
                                    )}
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">AI API Key (Domain-level override)</span>
                                        {activeSettings.hasAiApiKey && !replaceAiApiKey && (
                                            <p className="mt-1 text-xs text-gray-500">
                                                Stored key detected ({activeSettings.aiApiKeyMasked || 'masked'}). Leave as-is or enable replacement.
                                            </p>
                                        )}
                                        <div className="mt-1 flex flex-wrap items-center gap-3">
                                            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={replaceAiApiKey}
                                                    onChange={(e) => setReplaceAiApiKey(e.target.checked)}
                                                    className="h-4 w-4"
                                                />
                                                Replace saved API key
                                            </label>
                                            <input
                                                type="password"
                                                value={activeSettings.aiApiKey || ''}
                                                onChange={(e) => updateField('aiApiKey', e.target.value)}
                                                disabled={!replaceAiApiKey}
                                                className="flex-1 min-w-[260px] px-3 py-2 text-sm border border-gray-300 rounded-md disabled:bg-gray-100 disabled:text-gray-500"
                                                placeholder={replaceAiApiKey ? 'Paste API key' : 'Stored key is hidden'}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </label>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">AI Base URL (optional override)</span>
                                        <input type="text" value={activeSettings.aiBaseUrl || ''} onChange={(e) => updateField('aiBaseUrl', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="https://api.deepseek.com/v1" />
                                    </label>
                                    <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Per-feature models</p>
                                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                            Pin a provider and model preset per feature. Leave a feature on its default to keep following the
                                            domain AI vendor and model (or, for the Assistant, its own settings below). A domain API key is only
                                            sent to the vendor it was saved for; other providers use their server environment key.
                                        </p>
                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                            {DOMAIN_AI_FEATURE_KEYS.map((featureKey) => {
                                                const meta = DOMAIN_AI_FEATURE_META[featureKey]
                                                const preset = activeAiFeaturePresets[featureKey]
                                                const isAssistantFeature = featureKey === DOMAIN_AI_FEATURE_ADMIN_ASSISTANT
                                                const fallbackProvider = isAssistantFeature
                                                    ? assistantProviderToAiProvider(activeSettings.assistantProvider)
                                                    : activeSettings.aiVendor
                                                const fallbackModel = isAssistantFeature
                                                    ? getDefaultAssistantModel(
                                                        activeSettings.assistantProvider,
                                                        activeSettings.assistantModel || activeSettings.aiModel
                                                    )
                                                    : activeSettings.aiModel
                                                const selection = resolveDomainAiFeatureSelection(featureKey, activeAiFeaturePresets, {
                                                    providerModels: aiProviderModels,
                                                    fallbackProvider,
                                                    fallbackModel,
                                                })
                                                const presetValue = preset.provider
                                                    ? getDomainAiPresetValue(preset.provider, preset.tier)
                                                    : ''
                                                const assistantSettingsLabel = ASSISTANT_PROVIDER_OPTIONS.find(
                                                    (option) => option.id === normalizeAssistantProvider(activeSettings.assistantProvider)
                                                )?.label || 'Assistant settings'
                                                const usesVertex = isAssistantFeature
                                                    && !preset.provider
                                                    && normalizeAssistantProvider(activeSettings.assistantProvider) === 'google-vertex'
                                                const domainKeyApplies = activeSettings.hasAiApiKey === true
                                                    && (selection.provider === normalizeAiProvider(activeSettings.aiVendor)
                                                        || (isAssistantFeature && selection.provider === 'openai'))

                                                let keyConfigured
                                                if (usesVertex) {
                                                    // Vertex uses service-account credentials, not an API key.
                                                    keyConfigured = undefined
                                                } else if (domainKeyApplies) {
                                                    keyConfigured = true
                                                } else {
                                                    keyConfigured = aiProviderKeyAvailability?.[selection.provider]
                                                }

                                                return (
                                                    <div key={featureKey} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">{meta.label}</span>
                                                            <span className="block text-xs text-gray-500">{meta.description}</span>
                                                            <select
                                                                value={presetValue}
                                                                onChange={(e) => {
                                                                    const nextPreset = parseDomainAiPresetValue(e.target.value)
                                                                    updateField('aiFeaturePresets', {
                                                                        ...activeAiFeaturePresets,
                                                                        [featureKey]: nextPreset,
                                                                    })
                                                                }}
                                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white"
                                                            >
                                                                <option value="">
                                                                    {isAssistantFeature
                                                                        ? `Use assistant settings (${assistantSettingsLabel} · ${fallbackModel})`
                                                                        : `Use domain default (${domainDefaultAiSelection.providerLabel} · ${domainDefaultAiSelection.model})`}
                                                                </option>
                                                                {aiPresetOptions.map((option) => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <p className="mt-1 text-xs text-gray-600">
                                                            {selection.providerLabel}
                                                            {' · '}
                                                            {selection.tierLabel || (isAssistantFeature ? 'Assistant settings' : 'Domain default')}
                                                            {' · '}
                                                            <span className="font-mono">{selection.model}</span>
                                                            {keyConfigured === false && (
                                                                <span className="text-amber-700"> · API key not configured</span>
                                                            )}
                                                        </p>
                                                        {isAssistantFeature && !activeSettings.assistantEnabled && (
                                                            <p className="mt-1 text-xs text-amber-700">
                                                                Enable AI Assistant in Features to use this preset.
                                                            </p>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                    {useAssistantCustomSettings ? (
                                        <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">AI Assistant settings</p>
                                                {activeSettings.assistantEnabled && (
                                                    <a
                                                        href="/admin/assistant"
                                                        className="text-xs text-blue-600 hover:text-blue-800"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open assistant ↗
                                                    </a>
                                                )}
                                            </div>
                                            {activeSettings.assistantEnabled ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                                    <label className="block text-sm">
                                                        <span className="text-gray-600">Provider</span>
                                                        <select
                                                            value={activeSettings.assistantProvider}
                                                            onChange={(e) => updateField('assistantProvider', e.target.value)}
                                                            className="mt-1 block w-full"
                                                        >
                                                            {ASSISTANT_PROVIDER_OPTIONS.map((option) => (
                                                                <option key={option.id} value={option.id}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="block text-sm">
                                                        <span className="text-gray-600">Model</span>
                                                        <input
                                                            type="text"
                                                            value={activeSettings.assistantModel || ''}
                                                            placeholder={getDefaultAssistantModel(activeSettings.assistantProvider, activeSettings.aiModel)}
                                                            onChange={(e) => updateField('assistantModel', e.target.value)}
                                                            className="mt-1 block w-full"
                                                        />
                                                        <span className="text-xs text-gray-400 mt-0.5 block">
                                                            Leave blank for provider default.
                                                        </span>
                                                    </label>
                                                    {activeSettings.assistantProvider === 'google-vertex' && (
                                                        <>
                                                            <label className="block text-sm">
                                                                <span className="text-gray-600">Vertex project ID</span>
                                                                <input
                                                                    type="text"
                                                                    value={activeSettings.assistantProjectId || ''}
                                                                    placeholder="my-gcp-project"
                                                                    onChange={(e) => updateField('assistantProjectId', e.target.value)}
                                                                    className="mt-1 block w-full"
                                                                />
                                                            </label>
                                                            <label className="block text-sm">
                                                                <span className="text-gray-600">Location</span>
                                                                <input
                                                                    type="text"
                                                                    value={activeSettings.assistantLocation || ''}
                                                                    placeholder={DEFAULT_ASSISTANT_LOCATION}
                                                                    onChange={(e) => updateField('assistantLocation', e.target.value)}
                                                                    className="mt-1 block w-full"
                                                                />
                                                            </label>
                                                        </>
                                                    )}
                                                    <p className="md:col-span-2 text-xs text-gray-500 mt-1 leading-relaxed">
                                                        Uses the provider, model and credentials configured here{activeSettings.assistantProvider === 'google'
                                                            ? ' (Gemini API key).'
                                                            : activeSettings.assistantProvider === 'openai'
                                                                ? ' (domain API key or OPENAI_API_KEY).'
                                                                : '.'}
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Enable <span className="font-medium text-gray-700">AI Assistant</span> in Features to configure its model provider. The assistant appears in {getDomainDisplayLabel(activeDomain, activeSettings.displayName)}’s admin at <span className="font-mono text-gray-700">/admin/assistant</span>.
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="md:col-span-2 pt-2 border-t border-gray-100">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">AI Assistant settings</p>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Uses the Admin AI Assistant preset above. Choose <span className="font-medium">Use assistant settings</span> to configure Google Vertex AI or a custom model.
                                            </p>
                                        </div>
                                    )}
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Image Serving Priority</span>
                                        <select value={activeSettings.imageServingPriority} onChange={(e) => updateField('imageServingPriority', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md">
                                            <option value="local-then-curated-then-api">Local files → curated images → API</option>
                                            <option value="curated-then-local-then-api">Curated images → local files → API</option>
                                            <option value="api-first">API first fallback</option>
                                        </select>
                                    </label>
                                </div>
                            </section>
                        )}

                        {selectedSettingsSection === 'usage' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                                    <div>
                                        <h2 className="text-base font-semibold text-gray-900">Customer Cohort and Usage Markup</h2>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Assign to a reusable cohort defined in Settings. The cohort markup is applied to AI usage cost reporting.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => router.push('/admin/settings')}
                                        className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                                    >
                                        Edit Cohorts in Settings
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Assigned Cohort</span>
                                        <select
                                            value={activeSettings.customerCohortKey || ''}
                                            onChange={(e) => updateField('customerCohortKey', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        >
                                            <option value="">No cohort</option>
                                            {customerCohorts.map((cohort) => (
                                                <option key={cohort.key} value={cohort.key}>
                                                    {cohort.label} ({Number(cohort.usageMarkupPercent || 0)}%)
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                                        <p className="text-xs font-medium text-gray-500">Effective Usage Markup</p>
                                        <p className="mt-1 text-lg font-semibold text-gray-900">
                                            {Number(selectedCustomerCohort?.usageMarkupPercent || 0)}%
                                        </p>
                                        <p className="mt-1 text-xs text-gray-600">
                                            {selectedCustomerCohort
                                                ? `${selectedCustomerCohort.label} is currently assigned.`
                                                : 'No cohort assigned. Usage reports will show the base estimated cost.'}
                                        </p>
                                    </div>

                                    {selectedCustomerCohort?.notes && (
                                        <div className="md:col-span-2 rounded-md border border-gray-200 px-4 py-3 text-sm text-gray-700">
                                            <p className="text-xs font-medium text-gray-500 mb-1">Cohort Notes</p>
                                            <p>{selectedCustomerCohort.notes}</p>
                                        </div>
                                    )}

                                    {customerCohorts.length === 0 && (
                                        <p className="md:col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                            No reusable cohorts are configured yet. Add them in Settings before assigning one.
                                        </p>
                                    )}
                                </div>

                                <div className="mt-8 border-t border-gray-200 pt-6">
                                    <h2 className="text-base font-semibold text-gray-900">Platform Costs</h2>
                                    <p className="text-xs text-gray-500 mt-1 mb-4">
                                        Fixed monthly platform charges shown alongside AI usage on the admin Usage card.
                                    </p>
                                    <label className="block max-w-xs">
                                        <span className="text-xs font-medium text-gray-700">Website Monthly Cost ({activeSettings.billingCurrency || 'AUD'})</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={usageValue.websiteMonthlyCost ?? ''}
                                            onChange={(e) => updateWebsiteMonthlyCost(e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="19"
                                        />
                                    </label>
                                </div>

                                <div className="mt-8 border-t border-gray-200 pt-6">
                                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                                        <div>
                                            <h2 className="text-base font-semibold text-gray-900">Replaced SaaS Tools</h2>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Tools this practice no longer needs while using the platform. Used for value comparison reporting.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={addReplacedTool}
                                            className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                                        >
                                            Add Tool
                                        </button>
                                    </div>

                                    {usageValueReplacedTools.length === 0 ? (
                                        <p className="text-xs text-gray-500">
                                            No replaced tools configured yet. Add the SaaS subscriptions you can forgo.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {usageValueReplacedTools.map((tool, index) => (
                                                <div key={`replaced-tool-${index}`} className="flex flex-wrap items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={tool?.name || ''}
                                                        onChange={(e) => updateReplacedTool(index, 'name', e.target.value)}
                                                        className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                        placeholder="Tool name (e.g. Xero)"
                                                    />
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={tool?.monthlyCost ?? ''}
                                                        onChange={(e) => updateReplacedTool(index, 'monthlyCost', e.target.value)}
                                                        className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                        placeholder="Monthly"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeReplacedTool(index)}
                                                        className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white hover:bg-red-50 hover:text-red-700"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                                        <p className="text-xs font-medium text-gray-500">Total Replaced Tool Cost</p>
                                        <p className="mt-1 text-lg font-semibold text-gray-900">
                                            {usageValuePreview.replacedToolsMonthlyCost.toLocaleString(undefined, { style: 'currency', currency: activeSettings.billingCurrency || 'AUD' })} / month
                                        </p>
                                        <p className="mt-1 text-xs text-gray-600">
                                            Compared against the website cost plus measured AI usage on the admin dashboard.
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* SEO and Sharing */}
                        {selectedSettingsSection === 'seo' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-2">SEO and Sharing</h2>
                                <p className="text-xs text-gray-500 mb-4">
                                    Configure reusable metadata defaults: canonical previews, Open Graph, Twitter cards, and robots directives.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Site Name</span>
                                        <input type="text" value={seo.siteName} onChange={(e) => updateSeoField('siteName', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Example Domain" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Meta Title</span>
                                        <input type="text" value={seo.metaTitle} onChange={(e) => updateSeoField('metaTitle', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Example Domain | Services" />
                                    </label>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Meta Description</span>
                                        <textarea value={seo.metaDescription} onChange={(e) => updateSeoField('metaDescription', e.target.value)}
                                            className="mt-1 w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="Domain-wide default description used when page-level content is not provided." />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Open Graph Title</span>
                                        <input type="text" value={seo.ogTitle} onChange={(e) => updateSeoField('ogTitle', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Defaults to Meta Title" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Open Graph Image URL</span>
                                        <input type="text" value={seo.ogImageUrl} onChange={(e) => updateSeoField('ogImageUrl', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="/example/og-preview.png or https://example.com.au/..." />
                                    </label>
                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Open Graph Description</span>
                                        <textarea value={seo.ogDescription} onChange={(e) => updateSeoField('ogDescription', e.target.value)}
                                            className="mt-1 w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-md"
                                            placeholder="Optional override for social preview description." />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Twitter Card</span>
                                        <select value={seo.twitterCard} onChange={(e) => updateSeoField('twitterCard', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md">
                                            <option value="summary_large_image">summary_large_image</option>
                                            <option value="summary">summary</option>
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Twitter Image URL</span>
                                        <input type="text" value={seo.twitterImageUrl} onChange={(e) => updateSeoField('twitterImageUrl', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Defaults to OG image" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Twitter Title</span>
                                        <input type="text" value={seo.twitterTitle} onChange={(e) => updateSeoField('twitterTitle', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Optional" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Twitter Description</span>
                                        <input type="text" value={seo.twitterDescription} onChange={(e) => updateSeoField('twitterDescription', e.target.value)}
                                            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md" placeholder="Optional" />
                                    </label>

                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={seo.robotsIndex === true}
                                            onChange={(e) => updateSeoField('robotsIndex', e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        Allow indexing (robots index)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={seo.robotsFollow === true}
                                            onChange={(e) => updateSeoField('robotsFollow', e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        Allow following links (robots follow)
                                    </label>
                                </div>
                            </section>
                        )}

                        {/* Admin Quick Actions */}
                        {selectedSettingsSection === 'actions' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-2">Admin Quick Actions</h2>
                                <p className="text-xs text-gray-500 mb-4">
                                    Configure which actions are shown, their order, and optional custom links.
                                </p>
                                <div className="space-y-3">
                                    {quickActionsConfig.order.map((actionKey, index) => {
                                        const action = builtinQuickActionsByKey[actionKey]
                                        if (!action) return null
                                        const isDomainRestricted = action.requiresDomainMode && action.requiresDomainMode !== activeDomain
                                        const enabled = quickActionsConfig.enabled[action.key] !== false
                                        return (
                                            <div
                                                key={action.key}
                                                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${isDomainRestricted ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-200 text-gray-700'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={enabled}
                                                    disabled={isDomainRestricted}
                                                    onChange={(e) => updateQuickActionField(action.key, e.target.checked)}
                                                    className="h-4 w-4 mt-0.5"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-medium">{action.label}</span>
                                                    <span className="block text-xs text-gray-500 mt-0.5">{action.description}</span>
                                                    {isDomainRestricted && (
                                                        <span className="block text-xs text-gray-400 mt-0.5">Only available in {action.requiresDomainMode} mode.</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveBuiltinQuickAction(action.key, 'up')}
                                                        disabled={index === 0}
                                                        className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Up
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveBuiltinQuickAction(action.key, 'down')}
                                                        disabled={index === quickActionsConfig.order.length - 1}
                                                        className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Down
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>

                                <div className="mt-6 border-t border-gray-100 pt-4">
                                    <h3 className="text-sm font-semibold text-gray-900">Custom Link Actions</h3>
                                    <p className="text-xs text-gray-500 mt-1 mb-3">
                                        Add dashboard actions that open a route or URL.
                                    </p>

                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                                        <input
                                            type="text"
                                            value={newQuickActionLabel}
                                            onChange={(e) => setNewQuickActionLabel(e.target.value)}
                                            placeholder="Action label"
                                            className="md:col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        />
                                        <input
                                            type="text"
                                            value={newQuickActionUrl}
                                            onChange={(e) => setNewQuickActionUrl(e.target.value)}
                                            placeholder="/admin/content or https://example.com"
                                            className="md:col-span-4 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        />
                                        <select
                                            value={newQuickActionIcon}
                                            onChange={(e) => setNewQuickActionIcon(e.target.value)}
                                            className="md:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        >
                                            {ADMIN_CUSTOM_QUICK_ACTION_ICON_OPTIONS.map((iconOption) => (
                                                <option key={iconOption} value={iconOption}>{iconOption}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="color"
                                            value={newQuickActionColor}
                                            onChange={(e) => setNewQuickActionColor(e.target.value)}
                                            className="md:col-span-1 h-10 w-full rounded-md border border-gray-300 p-1"
                                        />
                                        <button
                                            type="button"
                                            onClick={addCustomQuickAction}
                                            className="md:col-span-2 px-3 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700"
                                        >
                                            Add Link
                                        </button>
                                    </div>

                                    <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={newQuickActionOpenInNewTab}
                                            onChange={(e) => setNewQuickActionOpenInNewTab(e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        Open new custom links in a new tab
                                    </label>

                                    <div className="mt-3 space-y-2">
                                        {quickActionsConfig.customLinks.length === 0 && (
                                            <p className="text-xs text-gray-500">No custom link actions yet.</p>
                                        )}

                                        {quickActionsConfig.customLinks.map((customAction, index) => (
                                            <div key={customAction.id} className="rounded-md border border-gray-200 px-3 py-2">
                                                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                                                    <label className="md:col-span-1 inline-flex items-center gap-2 text-xs text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={customAction.enabled !== false}
                                                            onChange={(e) => updateCustomQuickAction(customAction.id, 'enabled', e.target.checked)}
                                                            className="h-4 w-4"
                                                        />
                                                        Show
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={customAction.label}
                                                        onChange={(e) => updateCustomQuickAction(customAction.id, 'label', e.target.value)}
                                                        className="md:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={customAction.url}
                                                        onChange={(e) => updateCustomQuickAction(customAction.id, 'url', e.target.value)}
                                                        className="md:col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                    />
                                                    <select
                                                        value={customAction.icon || '🔗'}
                                                        onChange={(e) => updateCustomQuickAction(customAction.id, 'icon', e.target.value)}
                                                        className="md:col-span-1 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                    >
                                                        {ADMIN_CUSTOM_QUICK_ACTION_ICON_OPTIONS.map((iconOption) => (
                                                            <option key={iconOption} value={iconOption}>{iconOption}</option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="color"
                                                        value={customAction.color || '#94a3b8'}
                                                        onChange={(e) => updateCustomQuickAction(customAction.id, 'color', e.target.value)}
                                                        className="md:col-span-1 h-10 w-full rounded-md border border-gray-300 p-1"
                                                    />
                                                    <label className="md:col-span-1 inline-flex items-center gap-2 text-xs text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={customAction.openInNewTab !== false}
                                                            onChange={(e) => updateCustomQuickAction(customAction.id, 'openInNewTab', e.target.checked)}
                                                            className="h-4 w-4"
                                                        />
                                                        New tab
                                                    </label>
                                                    <div className="md:col-span-3 flex items-center gap-1 justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => moveCustomQuickAction(customAction.id, 'up')}
                                                            disabled={index === 0}
                                                            className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Up
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => moveCustomQuickAction(customAction.id, 'down')}
                                                            disabled={index === quickActionsConfig.customLinks.length - 1}
                                                            className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Down
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeCustomQuickAction(customAction.id)}
                                                            className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded-md bg-red-50 hover:bg-red-100"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-6 border-t border-gray-100 pt-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-900">Default Dashboard Card Order</h3>
                                            <p className="text-xs text-gray-500 mt-1">
                                                The layout every admin on this domain starts from. Admins can personalise
                                                their own order from the Admin dashboard without changing this default.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={resetAdminDashboardCardOrder}
                                            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                                        >
                                            Reset Order
                                        </button>
                                    </div>

                                    <div className="mt-3 space-y-2">
                                        {adminDashboardCardOrder.map((cardKey, index) => {
                                            const card = ADMIN_DASHBOARD_CARD_OPTIONS.find((item) => item.key === cardKey)
                                            if (!card) return null

                                            return (
                                                <div key={card.key} className="rounded-md border border-gray-200 px-3 py-2 flex items-start gap-3">
                                                    <div className="min-w-6 text-xs font-semibold text-gray-400 pt-0.5">{index + 1}</div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-800">{card.label}</p>
                                                        <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => moveAdminDashboardCard(card.key, 'up')}
                                                            disabled={index === 0}
                                                            className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Up
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => moveAdminDashboardCard(card.key, 'down')}
                                                            disabled={index === adminDashboardCardOrder.length - 1}
                                                            className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Down
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Asana Contact — shown for domains that declare the asanaContactSettings trait */}
                        {hasPrivateDomainTrait(activeDomain, 'asanaContactSettings') && selectedSettingsSection === 'asana' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h2 className="text-base font-semibold text-gray-900">Website Contact to Asana</h2>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Routes public /contact form submissions for this domain to an Asana project task.
                                        </p>
                                    </div>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${asanaTokenConfigured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                                        {asanaTokenConfigured ? '✅ Token configured' : '⚠️ ASANA_ACCESS_TOKEN missing'}
                                    </span>
                                </div>

                                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Access token</p>
                                            <p className="mt-1 text-sm text-gray-700 font-mono break-all">
                                                {asanaTokenConfigured
                                                    ? (showAsanaAccessToken ? asanaAccessToken || 'Loading token...' : 'Configured (hidden)')
                                                    : 'Missing ASANA_ACCESS_TOKEN'}
                                            </p>
                                        </div>
                                        {asanaTokenConfigured && (
                                            <button
                                                type="button"
                                                onClick={toggleAsanaAccessTokenVisibility}
                                                disabled={loadingAsanaAccessToken}
                                                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white transition disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {showAsanaAccessToken ? 'Hide' : (loadingAsanaAccessToken ? 'Loading...' : 'Show')}
                                            </button>
                                        )}
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500">
                                        The token is only revealed to authenticated admins in this browser after an explicit click.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" checked={!!asana.enabled}
                                            onChange={(e) => updateAsanaField('enabled', e.target.checked)} className="h-4 w-4" />
                                        Enable public contact routing for this domain
                                    </label>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Task Name Prefix</span>
                                            <input type="text" value={asana.taskNamePrefix}
                                                onChange={(e) => updateAsanaField('taskNamePrefix', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Website Contact" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Project GID</span>
                                            <input type="text" inputMode="numeric" value={asana.projectGid}
                                                onChange={(e) => updateAsanaField('projectGid', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="1200000000000000" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Section GID <span className="text-gray-400">(optional)</span></span>
                                            <input type="text" inputMode="numeric" value={asana.sectionGid}
                                                onChange={(e) => updateAsanaField('sectionGid', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Optional" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-medium text-gray-700">Assignee GID <span className="text-gray-400">(optional)</span></span>
                                            <input type="text" inputMode="numeric" value={asana.assigneeGid}
                                                onChange={(e) => updateAsanaField('assigneeGid', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Optional" />
                                        </label>
                                        <label className="block md:col-span-2">
                                            <span className="text-xs font-medium text-gray-700">Tag GIDs <span className="text-gray-400">(comma-separated, optional)</span></span>
                                            <input type="text"
                                                value={Array.isArray(asana.tagGids) ? asana.tagGids.join(', ') : asana.tagGids}
                                                onChange={(e) => updateAsanaField('tagGids', e.target.value)}
                                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                                placeholder="Optional" />
                                        </label>
                                    </div>

                                    <p className="text-xs text-gray-500">
                                        After saving, set the Contact CTA link to <code className="bg-gray-100 px-1 rounded">/contact</code> in Homepage settings to direct visitors to the form.
                                    </p>
                                </div>
                            </section>
                        )}

                        {/* Notes and Audit */}
                        {selectedSettingsSection === 'operations' && (
                            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                                <h2 className="text-base font-semibold text-gray-900 mb-4">Notes and Audit</h2>
                                <label className="block">
                                    <span className="text-xs font-medium text-gray-700">Domain Notes</span>
                                    <textarea value={activeSettings.notes} onChange={(e) => updateField('notes', e.target.value)}
                                        className="mt-1 w-full min-h-[100px] px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        placeholder="Capture deployment notes, owners, and operational details." />
                                </label>
                                <p className="mt-3 text-xs text-gray-400">
                                    Last saved: {activeSettings.updatedAt ? new Date(activeSettings.updatedAt).toLocaleString() : 'Not saved yet'}
                                </p>

                                <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
                                    <button onClick={resetActiveDomain}
                                        className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">
                                        Reset Domain Defaults
                                    </button>
                                    <button onClick={saveSettings} disabled={saving}
                                        className="px-3 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                        {saving ? 'Saving…' : 'Save Domain Settings'}
                                    </button>
                                </div>
                            </section>
                        )}
                    </div>
                </section>

                <AdminBackgroundColorModal
                    isOpen={showAdminBackgroundColorModal}
                    onClose={() => setShowAdminBackgroundColorModal(false)}
                    domain={activeDomain}
                    onSave={saveAdminBackgroundColor}
                    loading={saving}
                />
            </main>
        </div>
    )
}
