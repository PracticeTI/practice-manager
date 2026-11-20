'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import BackendSummary from '@/admin-ui/components/BackendSummary'
import InfoSummary from '@/admin-ui/components/InfoSummary'
import DatabaseSetupModal from '@/admin-ui/components/DatabaseSetupModal'
import BraveApiSetupModal from '@/admin-ui/components/BraveApiSetupModal'
import OpenAiSetupModal from '@/admin-ui/components/OpenAiSetupModal'
import CustomerCohortsPanel from '@/admin-ui/components/CustomerCohortsPanel'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getAdminAuthHeaders, getOrCreateAdminTokenForLocalhost, getCurrentUser, persistAdminSession, clearAdminSession } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, detectDomainFromHostname, getEffectiveDomainMode } from '@/lib/domainMode'
import { ADMIN_DOMAIN_OVERRIDE_SOURCE, clearAdminDomainOverride } from '@/lib/adminDomainOverride'
import { isDevToolingEnabled } from '@/lib/devTools'
import { buildDomainOptions, formatDomainLabelFromKey, isDefaultDomainSelectorOption } from '@/lib/domainSettings'
import {
  SYNTHETIC_SIM_TARGET,
  buildSimulationOptions,
  defaultSimulationTarget,
  filterSimulationAdmins,
  isSimulationTargetChosen,
  resolveSimulationUsername,
} from '@/lib/adminSimulationTargets'
import { DEFAULT_REPORT_AI_PROVIDER_MODELS, normalizeReportAiProviderModels } from '@/lib/reportAiProviders'
import {
  AI_SERVICE_KEYS,
  AI_SERVICE_META,
  getServiceProviderOptions,
  normalizeAiServiceSettings,
} from '@/lib/ai/services'
import { getFunderLinkStatusLabel } from '@/lib/funderLinkCheck'
import { clearStoredDefaultDomain, readStoredDefaultDomain, writeStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const LOCAL_WIT_APP_URL = 'http://localhost:3030/'
const DEFAULT_DOMAIN_VALUE = DEFAULT_DOMAIN_MODE
const INFRA_MODE_STORAGE_KEY = 'infra_mode_v1'
const DEFAULT_INFRA_MODE = 'onboard'
const SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY = 'admin_superadmin_token_backup_v1'
const SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY = 'admin_superadmin_username_backup_v1'
const ADMIN_TOOLS_VISIBLE_STORAGE_KEY = 'admin_tools_visible_v1'

const OPENAI_MODEL_OPTIONS = [
  'gpt-5.5',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini'
]

const CLAUDE_MODEL_OPTIONS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5'
]

const GEMINI_MODEL_OPTIONS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
]

const DEEPSEEK_MODEL_OPTIONS = [
  'deepseek-chat',
  'deepseek-reasoner'
]

const MODEL_TIER_OPTIONS = [
  { key: 'flagship', label: 'Flagship' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'value', label: 'Value' },
]

function getAuthLabelForToken(token) {
  if (token === 'localhost-dev-admin-bypass-token') {
    return 'Signed in via Localhost dev bypass as'
  }

  if (token === 'vercel-preview-admin-bypass-token') {
    return 'Signed in via Preview admin bypass as'
  }

  return 'Signed in via ADMIN_USERNAME/ADMIN_PASSWORD as'
}

function getSignInMethodForToken(token) {
  if (token === 'localhost-dev-admin-bypass-token') {
    return 'Localhost dev bypass'
  }

  if (token === 'vercel-preview-admin-bypass-token') {
    return 'Preview admin bypass'
  }

  return 'ADMIN_USERNAME/ADMIN_PASSWORD'
}

function getJwtUsername(token) {
  if (token && token.includes('.')) {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const payloadSegment = parts[1]
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
      const paddedBase64 = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
      const payloadText = atob(paddedBase64)
      const payload = JSON.parse(payloadText)
      return payload?.username || null
    } catch {
      return null
    }
  }

  return null
}

function getDisplayUsername(token, savedUsername) {
  if (token === 'localhost-dev-admin-bypass-token') {
    return 'localhost-dev'
  }

  if (token === 'vercel-preview-admin-bypass-token') {
    return savedUsername || 'vercel-preview'
  }

  return getJwtUsername(token) || savedUsername || 'unknown'
}

function maskDatabaseConnectionString(connectionString) {
  if (!connectionString) return 'Not configured'

  try {
    const parsed = new URL(connectionString)
    if (parsed.password) parsed.password = '********'
    return parsed.toString()
  } catch {
    return 'Configured'
  }
}

export default function BackendPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isDomainScopedAdmin, setIsDomainScopedAdmin] = useState(false)
  const [showDbSetup, setShowDbSetup] = useState(false)
  const [showBraveApiSetup, setShowBraveApiSetup] = useState(false)
  const [showOpenAiSetup, setShowOpenAiSetup] = useState(false)
  const [showAsanaContactSetup, setShowAsanaContactSetup] = useState(false)
  const [showDefaultDomainModal, setShowDefaultDomainModal] = useState(false)
  const [domainBackendStatus, setDomainBackendStatus] = useState(null)
  const [defaultDomain, setDefaultDomain] = useState(DEFAULT_DOMAIN_VALUE)
  const [defaultDomainSource, setDefaultDomainSource] = useState('default')
  const [defaultDomainDraft, setDefaultDomainDraft] = useState(DEFAULT_DOMAIN_VALUE)
  const [defaultDomainSourceDraft, setDefaultDomainSourceDraft] = useState('hostname')
  const [defaultDomainOptions, setDefaultDomainOptions] = useState(() => buildDomainOptions())
  const [infraMode, setInfraMode] = useState(DEFAULT_INFRA_MODE)
  const [infraModeDraft, setInfraModeDraft] = useState(DEFAULT_INFRA_MODE)
  const [showInfraModeModal, setShowInfraModeModal] = useState(false)
  const currentHostname = useMemo(() => (typeof window !== 'undefined' ? window.location.hostname : ''), [])
  const [braveApiStatus, setBraveApiStatus] = useState(null)
  const [openAiStatus, setOpenAiStatus] = useState(null)
  const [aiProviderCatalog, setAiProviderCatalog] = useState(() => normalizeReportAiProviderModels(DEFAULT_REPORT_AI_PROVIDER_MODELS))
  const [aiServiceSettings, setAiServiceSettings] = useState(() => normalizeAiServiceSettings({}))
  const [savingAiService, setSavingAiService] = useState({})
  const [savingAiProviderModel, setSavingAiProviderModel] = useState({})
  const [savedAiProviderModel, setSavedAiProviderModel] = useState({})
  const [openRouterModels, setOpenRouterModels] = useState([])
  const [loadingOpenRouterModels, setLoadingOpenRouterModels] = useState(false)
  const [openRouterModelDrafts, setOpenRouterModelDrafts] = useState({})
  const [backendOnline] = useState(true)
  const [currentDbType, setCurrentDbType] = useState(null)
  const [currentEnvValues, setCurrentEnvValues] = useState({})
  const [primaryConfigured, setPrimaryConfigured] = useState(false)
  const openAiPollRef = useRef(null)
  const aiProviderSavedTimersRef = useRef({})
  const [testingOpenAi, setTestingOpenAi] = useState(false)
  const [testingBraveApi, setTestingBraveApi] = useState(false)
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminRole, setAdminRole] = useState('admin')
  const [signInMethod, setSignInMethod] = useState('Admin credentials')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [simulatingAdmin, setSimulatingAdmin] = useState(false)
  // Which admin to impersonate, remembered per domain: one admin needs no choice,
  // while several require one before a simulation can start.
  const [simulateAdminUsers, setSimulateAdminUsers] = useState([])
  const [simulateTargetByDomain, setSimulateTargetByDomain] = useState({})

  const simulateAdmins = useMemo(
    () => filterSimulationAdmins(simulateAdminUsers, defaultDomain),
    [simulateAdminUsers, defaultDomain]
  )

  const simulateOptions = useMemo(
    () => buildSimulationOptions(simulateAdmins, defaultDomain),
    [simulateAdmins, defaultDomain]
  )

  const simulateTarget = Object.prototype.hasOwnProperty.call(simulateTargetByDomain, defaultDomain)
    ? simulateTargetByDomain[defaultDomain]
    : defaultSimulationTarget(simulateAdmins)

  const setSimulateTarget = (value) => {
    setSimulateTargetByDomain((prev) => ({ ...prev, [defaultDomain]: value }))
  }

  useEffect(() => {
    if (!isSuperAdmin) return undefined

    let cancelled = false

    async function loadSimulateAdmins() {
      try {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) return

        const response = await fetch('/api/auth/users', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        if (!cancelled) setSimulateAdminUsers(Array.isArray(data?.users) ? data.users : [])
      } catch {
        // The picker falls back to the synthetic identity when the list is unavailable.
      }
    }

    loadSimulateAdmins()
    return () => { cancelled = true }
  }, [isSuperAdmin])
  const [adminToolsMenuEnabled, setAdminToolsMenuEnabled] = useState(false)
  const [showFunderLinksModal, setShowFunderLinksModal] = useState(false)
  const [funderLinkCheckRunning, setFunderLinkCheckRunning] = useState(false)
  const [funderLinkCheckApply, setFunderLinkCheckApply] = useState(false)
  const [funderLinkCheckResult, setFunderLinkCheckResult] = useState(null)
  const [funderLinkCheckError, setFunderLinkCheckError] = useState('')
  const [authLabel, setAuthLabel] = useState('Signed in via Admin credentials as')
  const [recentActivity, setRecentActivity] = useState([])
  const [recentActivityLoading, setRecentActivityLoading] = useState(false)
  const [activitySnapshotMs, setActivitySnapshotMs] = useState(0)
  const router = useRouter()
  const backendUrl = ''
  useEffect(() => {
    document.title = 'Settings'
  }, [])

  // Persisted preference that shows/hides the floating admin tools (⋮) menu
  // on the dashboard. Kept in localStorage so the dashboard can read it. The read is
  // deferred to a task so it can neither cause a hydration mismatch nor a cascading
  // render from a synchronous setState in the effect.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(ADMIN_TOOLS_VISIBLE_STORAGE_KEY)
        setAdminToolsMenuEnabled(stored === '1')
      } catch {
        // ignore storage access errors
      }
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const apiIntegrationCardOrder = useMemo(() => {
    return ['openai', 'claude', 'gemini', 'deepseek', 'openrouter', 'brave']
  }, [])

  const witAppUrl = useMemo(() => {
    const isLocalhost =
      typeof window !== 'undefined' && (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '[::1]' ||
        window.location.port === '3000'
      )

    if (isLocalhost) {
      return LOCAL_WIT_APP_URL
    }

    return (process.env.NEXT_PUBLIC_WIT_APP_URL || '').trim()
  }, [])

  const witLaunchUrl = useMemo(() => {
    if (!witAppUrl) return ''

    let targetUrl
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : LOCAL_WIT_APP_URL
      targetUrl = new URL(witAppUrl, base)
    } catch {
      return ''
    }

    const token = (typeof window !== 'undefined' ? window.localStorage.getItem('adminToken') : '') || ''
    if (token.trim()) {
      targetUrl.hash = `token=${encodeURIComponent(token.trim())}`
    }

    return targetUrl.toString()
  }, [witAppUrl])

  const openWitWithAdminToken = () => {
    if (typeof window === 'undefined') return

    if (!witLaunchUrl) {
      window.alert('Set NEXT_PUBLIC_WIT_APP_URL to configure the ingestion app link.')
      return
    }

    const popup = window.open(witLaunchUrl, '_blank', 'noopener,noreferrer')
    if (!popup) {
      window.location.assign(witLaunchUrl)
    }
  }

  const simulateAdminForCurrentDomain = async () => {
    if (typeof window === 'undefined' || simulatingAdmin) return

    const domain = (defaultDomain || '').trim().toLowerCase()
    if (!domain) {
      window.alert('No active domain found to simulate.')
      return
    }

    if (!isSimulationTargetChosen(simulateTarget)) {
      window.alert('Choose which admin to simulate.')
      return
    }

    const adminToken = window.localStorage.getItem('adminToken')
    if (!adminToken) {
      router.push('/login')
      return
    }

    setSimulatingAdmin(true)
    try {
      window.localStorage.setItem(SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY, adminToken)
      window.localStorage.setItem(
        SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY,
        window.localStorage.getItem('adminUsername') || adminUsername
      )

      const response = await fetch('/api/auth/simulate-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          domain,
          username: resolveSimulationUsername(simulateTarget) || undefined,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.token) {
        throw new Error(data?.error || 'Failed to simulate admin user')
      }

      persistAdminSession(data.token, data.username || `sim-admin-${domain}`)
      router.replace('/admin')
    } catch (error) {
      window.alert(error?.message || 'Failed to simulate admin user')
    } finally {
      setSimulatingAdmin(false)
    }
  }

  const toggleAdminToolsMenu = () => {
    setAdminToolsMenuEnabled((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(ADMIN_TOOLS_VISIBLE_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  // The funder link check fans out real outbound requests to ndis.gov.au, so it is
  // offered only on a local host — the API route enforces the same rule.
  const isLocalHost = useMemo(() => {
    const hostname = String(currentHostname || '').toLowerCase()
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '127.0.0.1'
      || hostname === '::1'
  }, [currentHostname])

  const runFunderLinkCheck = async () => {
    if (funderLinkCheckRunning) return

    setFunderLinkCheckRunning(true)
    setFunderLinkCheckError('')
    setFunderLinkCheckResult(null)

    try {
      const token = await getOrCreateAdminTokenForLocalhost()
      if (!token) throw new Error('Missing admin session token')

      const response = await fetch('/api/funders/check-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ apply: funderLinkCheckApply }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to check funder links')
      }

      setFunderLinkCheckResult(data)
    } catch (error) {
      setFunderLinkCheckError(error?.message || 'Failed to check funder links')
    } finally {
      setFunderLinkCheckRunning(false)
    }
  }

  const resolvedDefaultDomainOptions = useMemo(() => {
    const options = Array.isArray(defaultDomainOptions) ? [...defaultDomainOptions] : []
    const hasCurrentDomain = options.some((item) => item.key === defaultDomain)

    if (!hasCurrentDomain && defaultDomain) {
      options.push({
        key: defaultDomain,
        label: formatDomainLabelFromKey(defaultDomain),
        description: ''
      })
    }

    return options
  }, [defaultDomainOptions, defaultDomain])

  const defaultDomainSelectorOptions = useMemo(() => {
    return resolvedDefaultDomainOptions.filter((option) => isDefaultDomainSelectorOption(option.key))
  }, [resolvedDefaultDomainOptions])

  const defaultDomainLabel = useMemo(() => {
    return resolvedDefaultDomainOptions.find((item) => item.key === defaultDomain)?.label || formatDomainLabelFromKey(defaultDomain)
  }, [resolvedDefaultDomainOptions, defaultDomain])

  const detectedHostnameMode = useMemo(() => {
    // Hostname only: `?domain=` and any remembered override must not change what
    // "auto-detected from the hostname" means in the selector below.
    return detectDomainFromHostname(currentHostname || '') || DEFAULT_DOMAIN_VALUE
  }, [currentHostname])

  const hostnameMode = useMemo(
    () => detectDomainFromHostname(currentHostname || ''),
    [currentHostname]
  )

  const hostnameIsAuthoritative = Boolean(hostnameMode) && hostnameMode !== DEFAULT_DOMAIN_MODE

  const detectedHostnameLabel = useMemo(() => {
    return resolvedDefaultDomainOptions.find((item) => item.key === detectedHostnameMode)?.label || formatDomainLabelFromKey(detectedHostnameMode)
  }, [resolvedDefaultDomainOptions, detectedHostnameMode])

  const activeDatabaseString = useMemo(
    () => maskDatabaseConnectionString(currentEnvValues.DATABASE_URL || currentEnvValues.MONGODB_URI),
    [currentEnvValues]
  )

  const hostnameLockedDomain = defaultDomainSource === 'hostname' && hostnameIsAuthoritative
  const hostnameDetectedDomainLocked = hostnameIsAuthoritative

  const fetchRecentActivity = async () => {
    setRecentActivityLoading(true)
    try {
      const token = window.localStorage.getItem('adminToken')
      const response = await fetch('/api/database/recent-activity', {
        mode: 'cors',
        cache: 'no-cache',
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : undefined,
      })

      if (!response.ok) {
        throw new Error(`Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      setRecentActivity(Array.isArray(data?.activity) ? data.activity : [])
    } catch (error) {
      console.error('Failed to fetch recent activity:', error)
      setRecentActivity([])
    } finally {
      setActivitySnapshotMs(Date.now())
      setRecentActivityLoading(false)
    }
  }

  const formatRelativeTime = (isoString) => {
    if (!isoString) return 'Unknown time'
    const timestamp = new Date(isoString).getTime()
    if (!Number.isFinite(timestamp)) return 'Unknown time'

    const baseMs = activitySnapshotMs || timestamp
    const diffMs = Math.max(0, baseMs - timestamp)
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} minute(s) ago`
    if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} hour(s) ago`
    return `${Math.max(1, Math.floor(diffMs / day))} day(s) ago`
  }

  const formatRelativeDayLabel = (isoString) => {
    if (!isoString) return null
    const timestamp = new Date(isoString)
    if (!Number.isFinite(timestamp.getTime())) return null

    const now = new Date(activitySnapshotMs || timestamp)
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)

    const startOfTimestampDay = new Date(timestamp)
    startOfTimestampDay.setHours(0, 0, 0, 0)

    const dayDiff = Math.floor((startOfToday.getTime() - startOfTimestampDay.getTime()) / 86400000)

    if (dayDiff === 0) {
      return 'earlier today'
    }
    if (dayDiff === 1) {
      return 'yesterday'
    }

    const weekday = timestamp.toLocaleDateString(undefined, { weekday: 'long' })
    return `on ${weekday}`
  }

  const getActivityIconClasses = (type) => {
    if (type === 'database_update') {
      return {
        wrap: 'bg-green-100',
        icon: 'text-green-600'
      }
    }

    if (type === 'content_update') {
      return {
        wrap: 'bg-indigo-100',
        icon: 'text-indigo-600'
      }
    }

    if (type === 'domain_service_startup') {
      return {
        wrap: 'bg-purple-100',
        icon: 'text-purple-600'
      }
    }

    return {
      wrap: 'bg-blue-100',
      icon: 'text-blue-600'
    }
  }

  const buildRecentActivityRows = () => {
    const latestByType = new Map()
    for (const item of recentActivity) {
      if (!item?.type) continue

      const current = latestByType.get(item.type)
      if (!current || new Date(item.timestamp).getTime() > new Date(current.timestamp).getTime()) {
        latestByType.set(item.type, item)
      }
    }

    const domainServiceRecord = latestByType.get('domain_service_startup')
    const domainServiceDay = formatRelativeDayLabel(domainServiceRecord?.timestamp)

    return [
      latestByType.get('enrichment') || {
        id: 'fallback-enrichment',
        type: 'enrichment',
        title: 'Enrichment Session',
        description: 'No recent enrichment session found.',
        timestamp: null
      },
      latestByType.get('database_update') || {
        id: 'fallback-open-data',
        type: 'database_update',
        title: 'NYC Open Data refresh',
        description: 'No recent Open Data refresh found.',
        timestamp: null
      },
      latestByType.get('content_update') || {
        id: 'fallback-content-update',
        type: 'content_update',
        title: 'Last content item update',
        description: 'No content updates found yet.',
        timestamp: null
      },
      domainServiceRecord
        ? {
          ...domainServiceRecord,
          title: 'Domain services',
          description: domainServiceDay
            ? `Last started up ${domainServiceDay}`
            : 'Domain services startup recorded.'
        }
        : {
          id: 'fallback-domain-service',
          type: 'domain_service_startup',
          title: 'Domain services',
          description: 'No domain services startup record found yet.',
          timestamp: null
        }
    ]
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrapAdmin() {
      const token = await getOrCreateAdminTokenForLocalhost()
      if (cancelled) {
        return
      }

      if (!token) {
        router.push('/login')
        return
      }

      const savedUsername = localStorage.getItem('adminUsername')
      const resolvedUsername = getDisplayUsername(token, savedUsername)
      setAdminUsername(resolvedUsername)
      setSignInMethod(getSignInMethodForToken(token))
      setAuthLabel(getAuthLabelForToken(token))
      const currentUser = getCurrentUser()
      // Settings manages domain configuration and provider keys, so it stays a
      // superadmin surface: a database-managed admin is sent back to /admin and
      // edits only their own user-level settings on /admin/profile.
      const nonSuperAdminSession = Boolean(currentUser && currentUser.role !== 'superadmin')
      setIsDomainScopedAdmin(nonSuperAdminSession)
      if (nonSuperAdminSession) {
        setLoading(false)
        router.replace('/admin')
        return
      }
      setAdminRole(currentUser?.role || 'admin')
      setIsSuperAdmin(currentUser?.role === 'superadmin')
      setIsAuthenticated(true)
      setLoading(false)
      fetchCurrentDatabaseConfig()
      refreshApiIntegrationStatuses()
      checkDomainBackendStatus()
      loadAiProviderModels(token)
      loadAiServiceSettings(token)
      loadDefaultDomainOptions(token)
      fetchRecentActivity()

      try {
        const savedDefaultDomain = readStoredDefaultDomain()
        const { mode, source } = getEffectiveDomainMode(
          currentHostname || null,
          savedDefaultDomain
        )
        setDefaultDomain(mode)
        setDefaultDomainSource(source)
      } catch (error) {
        console.error('Failed to load default domain preference:', error)
      }

      try {
        const savedInfraMode = localStorage.getItem(INFRA_MODE_STORAGE_KEY)
        if (savedInfraMode === 'onboard' || savedInfraMode === 'external-tenant') {
          setInfraMode(savedInfraMode)
        }
      } catch (error) {
        console.error('Failed to load infra mode preference:', error)
      }

      try {
        const res = await fetch('/api/settings/infra-mode', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        if (res.ok) {
          const data = await res.json()
          if (data.mode === 'onboard' || data.mode === 'external-tenant') {
            setInfraMode(data.mode)
            try {
              localStorage.setItem(INFRA_MODE_STORAGE_KEY, data.mode)
            } catch {
              // ignore
            }
          }
        }
      } catch (error) {
        console.error('Failed to load infra mode from database:', error)
      }

    }

    bootstrapAdmin()

    return () => {
      cancelled = true
    }
  }, [router, currentHostname]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshApiIntegrationStatuses() {
    // Kick off all integration checks together so cards populate in parallel.
    await Promise.allSettled([
      checkOpenAiStatus(),
      checkBraveApiStatus(),
    ])
  }

  useEffect(() => {
    const currentModel = String(openAiStatus?.model || '').trim()
    if (currentModel) {
      const timeoutId = window.setTimeout(() => {
        setAiProviderCatalog(prev => {
          const next = normalizeReportAiProviderModels(prev)
          next.openai.balanced = currentModel
          return next
        })
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [openAiStatus?.model])

  useEffect(() => {
    const timers = aiProviderSavedTimersRef.current || {}

    return () => {
      if (openAiPollRef.current) {
        clearInterval(openAiPollRef.current)
        openAiPollRef.current = null
      }

      Object.values(timers).forEach((timerId) => {
        if (timerId) {
          clearTimeout(timerId)
        }
      })
    }
  }, [])

  async function fetchCurrentDatabaseConfig() {
    try {
      const response = await fetch('/api/database/current-config', {
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Fetched database config:', data)
        setCurrentDbType(data?.type || null)
        setCurrentEnvValues(data || {})
        setPrimaryConfigured(Boolean(data?.DATABASE_URL))
      } else {
        console.error('Failed to fetch config - status:', response.status)
        setPrimaryConfigured(false)
      }
    } catch (error) {
      console.error('Failed to fetch current database config:', error)
      setPrimaryConfigured(false)
    }
  }

  const checkOpenAiStatus = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/openai/check`, {
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
      })

      if (response.ok) {
        const data = await response.json()
        setOpenAiStatus(data)
      }
    } catch (error) {
      console.error('Failed to check OpenAI status:', error)
    }
  }

  const checkBraveApiStatus = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/brave-api/check`, {
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
      })

      if (response.ok) {
        const data = await response.json()
        setBraveApiStatus(data)
      }
    } catch (error) {
      console.error('Failed to check Brave API status:', error)
    }
  }

  async function checkDomainBackendStatus() {
    try {
      const response = await fetch('/api/domain-backend/status', {
        cache: 'no-store',
        headers: await getAdminAuthHeaders(),
      })

      if (response.ok) {
        const data = await response.json()
        setDomainBackendStatus(data)
      } else {
        setDomainBackendStatus({
          online: false,
          status: 'error',
          message: `HTTP ${response.status}`
        })
      }
    } catch (error) {
      console.error('Failed to check domain backend status:', error)
      setDomainBackendStatus({
        online: false,
        status: 'offline',
        message: error.message
      })
    }
  }

  async function loadAiProviderModels(providedToken) {
    try {
      const token = providedToken || localStorage.getItem('adminToken')
      if (!token) return

      const response = await fetch('/api/settings/ai-provider-models', {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: 'no-store'
      })

      if (!response.ok) return

      const data = await response.json().catch(() => ({}))
      const models = normalizeReportAiProviderModels(data?.models || {})
      setAiProviderCatalog(models)
    } catch (error) {
      console.error('Failed to load AI provider models:', error)
    }
  }

  async function loadOpenRouterModels() {
    setLoadingOpenRouterModels(true)
    try {
      const response = await fetch('/api/openai/models?provider=openrouter', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load OpenRouter models')
      }
      if (data?.fallback) {
        throw new Error(data?.error || 'Configure OPENROUTER_API_KEY on the server to load available models.')
      }
      setOpenRouterModels(Array.isArray(data?.models) ? data.models : [])
    } catch (error) {
      alert(`Error loading OpenRouter models: ${error?.message || 'Unknown error'}`)
    } finally {
      setLoadingOpenRouterModels(false)
    }
  }

  async function loadAiServiceSettings(providedToken) {
    try {
      const token = providedToken || localStorage.getItem('adminToken')
      if (!token) return

      const response = await fetch('/api/ai/services', {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: 'no-store'
      })

      if (!response.ok) return

      const data = await response.json().catch(() => ({}))
      setAiServiceSettings(normalizeAiServiceSettings(data?.services || {}))
    } catch (error) {
      console.error('Failed to load AI service settings:', error)
    }
  }

  async function saveAiServiceSelection(service, provider, model) {
    if (!AI_SERVICE_KEYS.includes(service) || !provider) return

    const providerOption = getServiceProviderOptions(service).find((option) => option.id === provider)
    const nextModel = String(model ?? providerOption?.defaultModel ?? '').trim()
    setSavingAiService(prev => ({ ...prev, [service]: true }))
    try {
      const adminToken = localStorage.getItem('adminToken')
      const response = await fetch('/api/ai/services', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminToken ? `Bearer ${adminToken}` : ''
        },
        body: JSON.stringify({ services: { [service]: { provider, model: nextModel } }, adminToken })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || 'Failed to save AI service provider')
      }

      setAiServiceSettings(normalizeAiServiceSettings(data?.services || {}))
    } catch (error) {
      alert(`Error saving ${AI_SERVICE_META[service]?.label || service} provider: ${error?.message || 'Unknown error'}`)
      await loadAiServiceSettings()
    } finally {
      setSavingAiService(prev => ({ ...prev, [service]: false }))
    }
  }

  async function loadDefaultDomainOptions(adminToken) {
    try {
      const response = await fetch('/api/settings/domains', {
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
        cache: 'no-store'
      })

      if (!response.ok) {
        setDefaultDomainOptions(buildDomainOptions())
        return
      }

      const data = await response.json().catch(() => ({}))
      setDefaultDomainOptions(buildDomainOptions(data?.domains || {}))
    } catch (error) {
      console.error('Failed to load configured domains for default selector:', error)
      setDefaultDomainOptions(buildDomainOptions())
    }
  }

  const handleDefaultDomainChange = (value) => {
    // The selector never offers a retired domain, but keep the guard here so no
    // code path can persist one as the Default Domain.
    if (!isDefaultDomainSelectorOption(value)) return

    setDefaultDomain(value)
    setDefaultDomainSource('stored')
    // An explicit choice here supersedes a `?domain=` request, which would
    // otherwise keep winning over this preference (see src/lib/domainMode.js).
    clearAdminDomainOverride()
    try {
      writeStoredDefaultDomain(value)
    } catch (error) {
      console.error('Failed to save default domain preference:', error)
    }
  }

  const getDefaultDomainDraftState = useCallback(() => {
    // A saved override can point at a domain the selector no longer offers, so
    // fall back to hostname mode instead of opening with nothing selected.
    const isSelectable = isDefaultDomainSelectorOption(defaultDomain)
    return {
      draft: isSelectable ? defaultDomain : detectedHostnameMode,
      source: defaultDomainSource === 'stored' && isSelectable ? 'override' : 'hostname',
    }
  }, [defaultDomain, defaultDomainSource, detectedHostnameMode])

  const openDefaultDomainModal = useCallback(() => {
    const { draft, source } = getDefaultDomainDraftState()
    setDefaultDomainDraft(draft)
    setDefaultDomainSourceDraft(source)
    setShowDefaultDomainModal(true)
  }, [getDefaultDomainDraftState])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOpenDefaultDomainModal = () => {
      openDefaultDomainModal()
    }

    window.addEventListener('domain:open-default-domain-modal', handleOpenDefaultDomainModal)
    return () => window.removeEventListener('domain:open-default-domain-modal', handleOpenDefaultDomainModal)
  }, [openDefaultDomainModal])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const searchParams = new URLSearchParams(window.location.search)
    const shouldOpenDefaultDomain = searchParams.get('defaultDomain')
    if (shouldOpenDefaultDomain !== '1' && shouldOpenDefaultDomain !== 'true') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const { draft, source } = getDefaultDomainDraftState()
      setDefaultDomainDraft(draft)
      setDefaultDomainSourceDraft(source)
      setShowDefaultDomainModal(true)
    }, 0)

    const params = new URLSearchParams(searchParams.toString())

    params.delete('defaultDomain')
    const nextSearch = params.toString()
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`
    window.history.replaceState({}, '', nextUrl)
    return () => window.clearTimeout(timeoutId)
  }, [getDefaultDomainDraftState])

  const saveDefaultDomainSelection = () => {
    let hasChanged = false

    if (defaultDomainSourceDraft === 'hostname') {
      try {
        clearStoredDefaultDomain()
      } catch (error) {
        console.error('Failed to clear default domain override:', error)
      }

      clearAdminDomainOverride()

      const { mode, source } = getEffectiveDomainMode(currentHostname || null, null)
      hasChanged = mode !== defaultDomain || source !== defaultDomainSource
      setDefaultDomain(mode)
      setDefaultDomainSource(source)
    } else {
      hasChanged = defaultDomainDraft !== defaultDomain || defaultDomainSource !== 'stored'
      handleDefaultDomainChange(defaultDomainDraft)
    }

    setShowDefaultDomainModal(false)

    if (hasChanged && typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  const handleInfraModeChange = async (value) => {
    setInfraMode(value)
    try {
      localStorage.setItem(INFRA_MODE_STORAGE_KEY, value)
    } catch (error) {
      console.error('Failed to save infra mode preference to localStorage:', error)
    }
    try {
      const res = await fetch('/api/settings/infra-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: value, adminToken: localStorage.getItem('adminToken') })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Failed to save infra mode to database:', data?.error || res.status)
      }
    } catch (error) {
      console.error('Failed to save infra mode to database:', error)
    }
  }

  const openInfraModeModal = () => {
    setInfraModeDraft(infraMode)
    setShowInfraModeModal(true)
  }

  const saveInfraModeSelection = () => {
    handleInfraModeChange(infraModeDraft)
    setShowInfraModeModal(false)
  }

  const testDatabaseConnection = async (dbType, envValues) => {
    try {
      console.log('Testing database connection:', { dbType, envValues })

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // Increased to 10s

      const endpoint = `${backendUrl}/api/database/test-primary`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({ envValues }),
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache'
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      console.log('Test response:', data)

      return {
        connected: data.connected,
        type: data.type,
        timestamp: data.timestamp,
        error: data.error,
        suggestion: data.suggestion
      }
    } catch (error) {
      console.error('Test connection error:', error)
      if (error.name === 'AbortError') {
        throw new Error('Connection test timed out. Check your database URL and network connection.')
      }
      throw error
    }
  }

  const handleBraveApiSetup = async (apiKey) => {
    try {
      const response = await fetch(`${backendUrl}/api/brave-api/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({
          envVars: {
            BRAVE_API_KEY: apiKey
          },
          adminToken: localStorage.getItem('adminToken')
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setShowBraveApiSetup(false)
        await checkBraveApiStatus()
      } else {
        throw new Error(data.error || 'Unknown error')
      }
    } catch (error) {
      alert(`Error: ${error.message}`)
      throw error
    }
  }

  const handleDatabaseSetup = (selectedDb, envValues) => {
    console.log('Database configured:', selectedDb.name, envValues)
    setShowDbSetup(false)
    // Optionally, you could show a success message or instructions
    alert('Database configuration saved! Please restart your backend server.')
  }

  const handleOpenAiSetup = async ({ apiKey, model }) => {
    try {
      const envVars = {
        OPENAI_MODEL: model
      }
      if (apiKey) {
        envVars.OPENAI_API_KEY = apiKey
      }

      const response = await fetch(`${backendUrl}/api/openai/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({
          envVars,
          adminToken: localStorage.getItem('adminToken')
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setShowOpenAiSetup(false)
        await checkOpenAiStatus()
      } else {
        throw new Error(data?.error || 'Failed to save OpenAI configuration')
      }
    } catch (error) {
      alert(`Error: ${error.message}`)
      throw error
    }
  }

  const saveAiProviderModel = async (provider, tier, model) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    const normalizedTier = String(tier || '').trim().toLowerCase()
    const nextModel = String(model || '').trim()
    if (!normalizedProvider || !normalizedTier || !nextModel) return

    const statusKey = `${normalizedProvider}:${normalizedTier}`

    setAiProviderCatalog(prev => {
      const next = normalizeReportAiProviderModels(prev)
      next[normalizedProvider][normalizedTier] = nextModel
      return next
    })
    setSavingAiProviderModel(prev => ({ ...prev, [statusKey]: true }))
    setSavedAiProviderModel(prev => ({ ...prev, [statusKey]: false }))

    try {
      const adminToken = localStorage.getItem('adminToken')
      const response = await fetch('/api/settings/ai-provider-models', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminToken ? `Bearer ${adminToken}` : ''
        },
        body: JSON.stringify({
          provider: normalizedProvider,
          tier: normalizedTier,
          model: nextModel,
          adminToken
        })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || 'Failed to save provider model')
      }

      setSavedAiProviderModel(prev => ({ ...prev, [statusKey]: true }))

      const existingTimer = aiProviderSavedTimersRef.current?.[statusKey]
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      aiProviderSavedTimersRef.current[statusKey] = setTimeout(() => {
        setSavedAiProviderModel(prev => ({ ...prev, [statusKey]: false }))
        aiProviderSavedTimersRef.current[statusKey] = null
      }, 2200)
    } catch (error) {
      alert(`Error saving ${normalizedProvider} ${normalizedTier} model: ${error?.message || 'Unknown error'}`)
      setSavedAiProviderModel(prev => ({ ...prev, [statusKey]: false }))
      await loadAiProviderModels()
    } finally {
      setSavingAiProviderModel(prev => ({ ...prev, [statusKey]: false }))
    }
  }

  const testOpenAiKey = async () => {
    setTestingOpenAi(true)
    try {
      const response = await fetch(`${backendUrl}/api/openai/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
      })

      const result = await response.json()

      if (response.ok) {
        alert('OpenAI key is valid and working!')
        await checkOpenAiStatus()
      } else {
        alert(`Error testing OpenAI key: ${result.error || 'Unknown error'}`)
        await checkOpenAiStatus()
      }
    } catch (error) {
      alert(`Error testing OpenAI key: ${error.message}`)
      await checkOpenAiStatus()
    } finally {
      setTestingOpenAi(false)
    }
  }

  const resolvedOpenAiModelOptions = useMemo(() => {
    const selected = String(aiProviderCatalog?.openai?.balanced || '').trim()
    const configured = String(openAiStatus?.model || '').trim()

    return Array.from(new Set([
      selected,
      configured,
      ...OPENAI_MODEL_OPTIONS
    ].filter(Boolean)))
  }, [aiProviderCatalog, openAiStatus?.model])

  const testBraveApiKey = async () => {
    setTestingBraveApi(true)
    try {
      const response = await fetch(`${backendUrl}/api/brave-api/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({})
      })

      const result = await response.json()

      if (response.ok && result.valid) {
        alert(`Brave API is valid and working! Found ${result.resultsFound} image result(s) in test.`)
        await checkBraveApiStatus()
      } else {
        alert(`Error testing Brave API: ${result.error || 'Unknown error'}`)
        await checkBraveApiStatus()
      }
    } catch (error) {
      alert(`Error testing Brave API: ${error.message}`)
      await checkBraveApiStatus()
    } finally {
      setTestingBraveApi(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (isDomainScopedAdmin) {
    return null
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <>
      {showDbSetup && (
        <DatabaseSetupModal
          isOpen={showDbSetup}
          onClose={() => {
            setShowDbSetup(false)
          }}
          onSetup={handleDatabaseSetup}
          currentDbType={currentDbType}
          currentEnvValues={currentEnvValues}

          onTestConnection={testDatabaseConnection}
        />
      )}
      {showBraveApiSetup && (
        <BraveApiSetupModal
          isOpen={showBraveApiSetup}
          onClose={() => setShowBraveApiSetup(false)}
          onSetup={handleBraveApiSetup}
          onTest={testBraveApiKey}
          testing={testingBraveApi}
          braveApiStatus={braveApiStatus}
        />
      )}
      {showOpenAiSetup && (
        <OpenAiSetupModal
          isOpen={showOpenAiSetup}
          onClose={() => setShowOpenAiSetup(false)}
          onSetup={handleOpenAiSetup}
          openAiStatus={openAiStatus}
          onTestOpenAi={testOpenAiKey}
          testingOpenAi={testingOpenAi}
        />
      )}

      {showFunderLinksModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Funder links</h2>
              <button
                onClick={() => setShowFunderLinksModal(false)}
                className="h-8 w-8 inline-flex items-center justify-center admin-btn"
                aria-label="Close funder links"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-600">
                Check every documentation URL on the Funders entity (pricing schedules, support
                catalogue, guidance). Local development only.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={funderLinkCheckApply}
                    onChange={(event) => setFunderLinkCheckApply(event.target.checked)}
                  />
                  Save results
                </label>
                <button
                  type="button"
                  onClick={runFunderLinkCheck}
                  disabled={!isLocalHost || funderLinkCheckRunning}
                  className="text-xs px-2 py-1 admin-btn disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isLocalHost
                    ? 'Check the funder documentation links'
                    : 'Only available when running locally'}
                >
                  {funderLinkCheckRunning ? 'Checking…' : 'Check funder links'}
                </button>
              </div>

              {funderLinkCheckError && (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                  {funderLinkCheckError}
                </p>
              )}

              {funderLinkCheckResult && (
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-700">
                    {funderLinkCheckResult.summaryText}
                    {funderLinkCheckResult.updated ? ` · saved ${funderLinkCheckResult.updated}` : ''}
                  </p>
                  {funderLinkCheckResult.problems?.length > 0 ? (
                    <div className="mt-1 space-y-0.5 max-h-64 overflow-y-auto">
                      {funderLinkCheckResult.problems.slice(0, 8).map((problem) => (
                        <p key={`${problem.funderKey}-${problem.documentId ?? problem.url}`} className="text-xs text-gray-600 break-all">
                          <span className={`font-semibold ${problem.status === 'broken' || problem.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                            {getFunderLinkStatusLabel(problem.status)}
                          </span>
                          {problem.httpStatus ? ` ${problem.httpStatus}` : ''} · {problem.url}
                        </p>
                      ))}
                      {funderLinkCheckResult.problems.length > 8 && (
                        <p className="text-xs text-gray-500">+{funderLinkCheckResult.problems.length - 8} more</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-green-700">Every link responded.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showDefaultDomainModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Select Default Domain</h2>
              <button
                onClick={() => setShowDefaultDomainModal(false)}
                className="h-8 w-8 inline-flex items-center justify-center admin-btn"
                aria-label="Close default domain selector"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-gray-500">Choose whether to auto-resolve the active domain from the hostname or use an explicit override.</p>
              {defaultDomainSourceDraft === 'hostname' && (
                <div className={`rounded-md border px-3 py-2 text-xs ${hostnameDetectedDomainLocked
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
                  }`}>
                  Domain mode is currently auto-detected from the hostname{' '}
                  <span className="font-mono font-medium">
                    {currentHostname}
                  </span>
                  {hostnameDetectedDomainLocked
                    ? '. This domain is the ultimate authority - the saved Default Domain will not override it.'
                    : '. Saving a Default Domain here will override URL-based mode for this browser.'}
                </div>
              )}
              <fieldset className="space-y-2" aria-label="Default domain mode">
                <label className="flex items-start gap-2 text-sm text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="defaultDomainMode"
                    value="hostname"
                    checked={defaultDomainSourceDraft === 'hostname'}
                    onChange={() => setDefaultDomainSourceDraft('hostname')}
                    className="h-4 w-4 mt-0.5"
                  />
                  <span>
                    Hostname (default) - Detect domain from current URL ({currentHostname || 'unknown host'}), currently: {detectedHostnameLabel}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="defaultDomainMode"
                    value="override"
                    checked={defaultDomainSourceDraft === 'override'}
                    onChange={() => setDefaultDomainSourceDraft('override')}
                    className="h-4 w-4 mt-0.5"
                  />
                  <span>Override - Force one domain for this browser regardless of hostname</span>
                </label>
              </fieldset>
              {defaultDomainSourceDraft === 'override' && (
                <fieldset className="space-y-2" aria-label="Default domain selection">
                  {defaultDomainSelectorOptions.map((domainOption) => (
                    <label key={domainOption.key} className="flex items-center gap-2 text-sm text-gray-900 cursor-pointer">
                      <input
                        type="radio"
                        name="defaultDomain"
                        value={domainOption.key}
                        checked={defaultDomainDraft === domainOption.key}
                        onChange={(e) => setDefaultDomainDraft(e.target.value)}
                        className="h-4 w-4"
                      />
                      <span>
                        {domainOption.label}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowDefaultDomainModal(false)}
                className="px-4 py-2 text-sm font-medium admin-btn"
              >
                Cancel
              </button>
              <button
                onClick={saveDefaultDomainSelection}
                className="px-4 py-2 text-sm font-medium admin-btn"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {showInfraModeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Select Infra Mode</h2>
              <button
                onClick={() => setShowInfraModeModal(false)}
                className="h-8 w-8 inline-flex items-center justify-center admin-btn"
                aria-label="Close infra mode selector"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-gray-500">Select whether to use on-board APIs or those from a separate tenant.</p>
              <fieldset className="space-y-2" aria-label="Infra mode selection">
                <label className="flex items-center gap-2 text-sm text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="infraMode"
                    value="onboard"
                    checked={infraModeDraft === 'onboard'}
                    onChange={(e) => setInfraModeDraft(e.target.value)}
                    className="h-4 w-4"
                  />
                  <span>On-board — Use this installation&apos;s own APIs (default)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="infraMode"
                    value="external-tenant"
                    checked={infraModeDraft === 'external-tenant'}
                    onChange={(e) => setInfraModeDraft(e.target.value)}
                    className="h-4 w-4"
                  />
                  <span>External Tenant — Use APIs from a separate tenant</span>
                </label>
              </fieldset>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowInfraModeModal(false)}
                className="px-4 py-2 text-sm font-medium admin-btn"
              >
                Cancel
              </button>
              <button
                onClick={saveInfraModeSelection}
                className="px-4 py-2 text-sm font-medium admin-btn"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <AdminHeader title="Settings" />

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {/* Top Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* System + Info */}
              <div className="lg:col-span-1 flex flex-col gap-8 lg:grid lg:grid-rows-2">
                <BackendSummary
                  backendOnline={backendOnline}
                  openAiStatus={openAiStatus}
                  onSetupOpenAi={() => setShowOpenAiSetup(true)}
                  onTestOpenAi={testOpenAiKey}
                  testingOpenAi={testingOpenAi}
                  onOpenDatabaseSettings={() => {
                    fetchCurrentDatabaseConfig()
                    setShowDbSetup(true)
                  }}
                />
                <InfoSummary activeDatabaseString={activeDatabaseString} />
              </div>

              {/* Account + Dev Tools (stacked, each half of the column height) */}
              <div className="lg:col-span-1 flex flex-col gap-8 lg:grid lg:grid-rows-2">
                {/* Account */}
                <div className="admin-card p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Account</h2>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="mt-3 space-y-1">
                        <p className="text-sm text-gray-600">Method: <span className="font-medium text-gray-900">{signInMethod}</span></p>
                        <p className="text-sm text-gray-600">Role: <span className="font-medium text-gray-900">{adminRole}</span></p>
                        <p className="text-sm text-gray-600">User: <span className="font-medium text-gray-900">{adminUsername}</span></p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        clearAdminSession()
                        localStorage.removeItem(SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY)
                        localStorage.removeItem(SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY)
                        router.push('/login')
                      }}
                      className="text-xs px-2 py-1 admin-btn disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Logout
                    </button>
                  </div>
                </div>

                {/* Dev Tools */}
                {isSuperAdmin && (
                  <div className="admin-card p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Dev Tools</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={openWitWithAdminToken}
                        className="text-xs px-2 py-1 admin-btn"
                        title="Open the ingestion app"
                      >
                        Ingestion
                      </button>
                      {isDevToolingEnabled() && (
                        <button
                          onClick={() => router.push('/settings/hero-review')}
                          className="text-xs px-2 py-1 admin-btn"
                          title="Review live mobile hero cards for allied health providers (superadmin, local Chrome only)"
                        >
                          Hero Review
                        </button>
                      )}
                      <button
                        onClick={() => router.push('/settings/activities')}
                        className="text-xs px-2 py-1 admin-btn"
                        title="Audit trail of who created, changed or deleted records across every domain (superadmin)"
                      >
                        Activities
                      </button>
                      <button
                        onClick={() => setShowFunderLinksModal(true)}
                        className="text-xs px-2 py-1 admin-btn"
                        title="Check the funder documentation links"
                      >
                        Funder links
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Management + Admin */}
              {isSuperAdmin && (
                <div className="lg:col-span-1 flex flex-col gap-8 lg:grid lg:grid-rows-2">
                  {/* Management */}
                  <div className="admin-card p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Management</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => router.push('/presence')}
                        className="text-xs px-2 py-1 admin-btn"
                        title="Web presence: search, social, and favicon preview"
                      >
                        Presence
                      </button>
                      <button
                        onClick={() => router.push('/admin/users')}
                        className="text-xs px-2 py-1 admin-btn disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Admins
                      </button>
                      <button
                        onClick={() => router.push('/admin/settings/suppliers')}
                        className="text-xs px-2 py-1 admin-btn"
                      >
                        Suppliers
                      </button>
                      <button
                        onClick={() => router.push('/admin/settings/providers')}
                        className="text-xs px-2 py-1 admin-btn"
                      >
                        Providers
                      </button>
                      <button
                        onClick={() => router.push('/settings/system-state')}
                        className="text-xs px-2 py-1 admin-btn"
                      >
                        System State
                      </button>
                      <button
                        onClick={() => router.push('/admin/settings/rls')}
                        className="text-xs px-2 py-1 admin-btn"
                        title="Row-level security posture of the primary database"
                      >
                        RLS Check
                      </button>
                    </div>
                  </div>

                  {/* Admin */}
                  <div className="admin-card p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Admin</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="simulate-admin-target" className="text-xs text-gray-600">
                        Simulate as
                      </label>
                      <select
                        id="simulate-admin-target"
                        value={simulateTarget}
                        onChange={(event) => setSimulateTarget(event.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
                      >
                        {simulateOptions.map((option) => (
                          <option
                            key={option.value || 'placeholder'}
                            value={option.value}
                            disabled={option.disabled}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={simulateAdminForCurrentDomain}
                        disabled={simulatingAdmin || !isSimulationTargetChosen(simulateTarget)}
                        className="text-xs px-2 py-1 admin-btn disabled:opacity-50 disabled:cursor-not-allowed"
                        title={`Switch to a domain-scoped admin user for ${defaultDomainLabel}`}
                      >
                        {simulatingAdmin ? 'Simulating...' : `Simulate admin (${defaultDomainLabel})`}
                      </button>
                    </div>

                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">Admin tools menu</p>
                          <p className="text-xs text-gray-500">Show the floating debug tools (⋮) on the dashboard.</p>
                        </div>
                        <button
                          type="button"
                          onClick={toggleAdminToolsMenu}
                          role="switch"
                          aria-checked={adminToolsMenuEnabled}
                          aria-label="Toggle admin tools menu"
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${adminToolsMenuEnabled ? 'bg-slate-500' : 'bg-slate-300'}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${adminToolsMenuEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Activity panel hidden for now */}
            {false && (
              <div className="admin-card p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Recent Activity</h2>
                </div>
                <div className="space-y-4">
                  {recentActivityLoading && (
                    <div className="text-sm text-gray-600">Loading activity…</div>
                  )}

                  {!recentActivityLoading && buildRecentActivityRows().map((item) => {
                    const iconClasses = getActivityIconClasses(item.type)
                    return (
                      <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                        <div className={`${iconClasses.wrap} rounded-full p-2`}>
                          <svg className={`w-5 h-5 ${iconClasses.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                          <p className="text-xs text-gray-600 truncate">{item.description}</p>
                          <p className="text-xs text-gray-500 mt-1">{item.timestamp ? formatRelativeTime(item.timestamp) : 'No timestamp yet'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Configuration Section */}
            <div className="admin-card p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Configuration</h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Databases */}
                <div className="border border-gray-300 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">Databases</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {/* Primary Database */}
                    <div className="border border-gray-300 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-3 h-3 rounded-full ${primaryConfigured ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                          <p className="text-sm font-medium text-gray-900">Primary</p>
                        </div>
                        <button
                          onClick={() => {
                            fetchCurrentDatabaseConfig()
                            setShowDbSetup(true)
                          }}
                          className="h-8 w-8 inline-flex items-center justify-center admin-btn"
                          title="Edit database settings"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-xs text-gray-600">{primaryConfigured ? '✅ Configured' : '⚠️ Not configured'}</p>
                    </div>

                  </div>
                </div>

                <CustomerCohortsPanel />

                {/* API Integrations */}
                <div className="border border-gray-300 rounded-lg p-4 lg:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-4">API Integrations</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {apiIntegrationCardOrder.map((cardId) => {
                      const apiCardMap = {
                        openai: {
                          label: 'OpenAI',
                          kind: 'model-tier-selector',
                          provider: 'openai',
                          options: resolvedOpenAiModelOptions,
                          description: 'Configure predefined OpenAI models for Flagship, Balanced, and Value tiers.',
                        },
                        claude: {
                          label: 'Claude',
                          kind: 'model-tier-selector',
                          provider: 'claude',
                          options: CLAUDE_MODEL_OPTIONS,
                          description: 'Configure predefined Claude models for Flagship, Balanced, and Value tiers.',
                        },
                        gemini: {
                          label: 'Gemini',
                          kind: 'model-tier-selector',
                          provider: 'gemini',
                          options: GEMINI_MODEL_OPTIONS,
                          description: 'Configure predefined Gemini models for Flagship, Balanced, and Value tiers.',
                        },
                        deepseek: {
                          label: 'DeepSeek',
                          kind: 'model-tier-selector',
                          provider: 'deepseek',
                          options: DEEPSEEK_MODEL_OPTIONS,
                          description: 'Configure predefined DeepSeek models for Flagship, Balanced, and Value tiers.',
                        },
                        openrouter: {
                          label: 'OpenRouter',
                          kind: 'model-tier-selector',
                          provider: 'openrouter',
                          options: openRouterModels,
                          description: 'Choose from OpenRouter models or enter any OpenRouter model ID. Configure OPENROUTER_API_KEY on the server.',
                        },
                        brave: {
                          label: 'Brave',
                          kind: 'api-status',
                          configured: braveApiStatus?.configured,
                          onClick: () => setShowBraveApiSetup(true),
                          title: 'Brave API settings',
                          meta: null,
                        },
                      }

                      const card = apiCardMap[cardId]
                      if (!card) return null

                      if (card.kind === 'model-tier-selector') {
                        const providerCatalog = aiProviderCatalog?.[card.provider] || {}

                        return (
                          <div key={cardId} className="border border-gray-300 rounded-lg p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-900">{card.label}</p>
                              {card.provider === 'openrouter' && (
                                <button
                                  type="button"
                                  onClick={loadOpenRouterModels}
                                  disabled={loadingOpenRouterModels}
                                  className="text-xs px-2 py-1 admin-btn disabled:opacity-60"
                                >
                                  {loadingOpenRouterModels ? 'Loading...' : 'Load models'}
                                </button>
                              )}
                            </div>
                            <div className="space-y-2">
                              {MODEL_TIER_OPTIONS.map((tierOption) => {
                                const statusKey = `${card.provider}:${tierOption.key}`
                                const selectedModel = String(providerCatalog?.[tierOption.key] || '').trim()
                                const tierOptions = Array.from(new Set([
                                  selectedModel,
                                  ...card.options,
                                ].filter(Boolean)))

                                return (
                                  <label key={statusKey} className="block">
                                    <span className="block text-xs font-medium text-gray-700">{tierOption.label}</span>
                                    {card.provider === 'openrouter' ? (
                                      <input
                                        list="openrouter-model-options"
                                        value={openRouterModelDrafts[statusKey] ?? selectedModel}
                                        onChange={(e) => setOpenRouterModelDrafts(prev => ({ ...prev, [statusKey]: e.target.value }))}
                                        onBlur={(e) => saveAiProviderModel(card.provider, tierOption.key, e.target.value)}
                                        disabled={savingAiProviderModel[statusKey] === true}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white disabled:opacity-60"
                                        placeholder="provider/model"
                                      />
                                    ) : (
                                      <select
                                        value={selectedModel}
                                        onChange={(e) => saveAiProviderModel(card.provider, tierOption.key, e.target.value)}
                                        disabled={savingAiProviderModel[statusKey] === true}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white disabled:opacity-60"
                                      >
                                        {tierOptions.map((modelOption) => (
                                          <option key={modelOption} value={modelOption}>{modelOption}</option>
                                        ))}
                                      </select>
                                    )}
                                    {savingAiProviderModel[statusKey] && (
                                      <p className="text-xs text-gray-500 mt-1">Saving {tierOption.label.toLowerCase()} model...</p>
                                    )}
                                    {!savingAiProviderModel[statusKey] && savedAiProviderModel[statusKey] && (
                                      <p className="text-xs text-green-700 mt-1">Saved.</p>
                                    )}
                                  </label>
                                )
                              })}
                            </div>
                            {card.provider === 'openrouter' && (
                              <datalist id="openrouter-model-options">
                                {openRouterModels.map((modelOption) => (
                                  <option key={modelOption} value={modelOption} />
                                ))}
                              </datalist>
                            )}
                            <p className="text-xs text-gray-500 mt-2">{card.description}</p>
                          </div>
                        )
                      }

                      return (
                        <div key={cardId} className="border border-gray-300 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-3 h-3 rounded-full ${card.configured ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                              <p className="text-sm font-medium text-gray-900">{card.label}</p>
                            </div>
                            <button
                              onClick={card.onClick}
                              className="h-8 w-8 inline-flex items-center justify-center admin-btn"
                              title={card.title}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </button>
                          </div>
                          <p className="text-xs text-gray-600">{card.configured ? '✅ Configured' : '⚠️ Not configured'}</p>
                          {card.meta && (
                            <p className="text-xs text-gray-500 mt-1">{card.meta}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">AI services</h4>
                    <p className="text-xs text-gray-600 mb-3">
                      Chat, web search and transcription can each run on a different provider.
                      Only providers that support a service are offered.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {AI_SERVICE_KEYS.map((serviceKey) => {
                        const meta = AI_SERVICE_META[serviceKey]
                        const selected = String(aiServiceSettings?.[serviceKey]?.provider || '').trim()
                        const selectedModel = String(aiServiceSettings?.[serviceKey]?.model || '').trim()
                        const options = getServiceProviderOptions(serviceKey)
                        const selectedOption = options.find((option) => option.id === selected)
                        const modelOptions = Array.from(new Set([
                          selectedModel,
                          ...(selectedOption?.models || []),
                        ].filter(Boolean)))
                        const modelDraftKey = `service:${serviceKey}`

                        return (
                          <div key={serviceKey} className="border border-gray-300 rounded-lg p-3">
                            <p className="text-sm font-medium text-gray-900">{meta.label}</p>
                            <select
                              value={selected}
                              onChange={(e) => saveAiServiceSelection(serviceKey, e.target.value)}
                              disabled={!isSuperAdmin || savingAiService[serviceKey] === true}
                              className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white disabled:opacity-60"
                            >
                              {options.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                            {selected === 'openrouter' ? (
                              <input
                                list="openrouter-model-options"
                                value={openRouterModelDrafts[modelDraftKey] ?? selectedModel}
                                onChange={(e) => setOpenRouterModelDrafts(prev => ({ ...prev, [modelDraftKey]: e.target.value }))}
                                onBlur={(e) => {
                                  if (e.target.value.trim()) {
                                    saveAiServiceSelection(serviceKey, selected, e.target.value)
                                  }
                                }}
                                disabled={!isSuperAdmin || savingAiService[serviceKey] === true}
                                className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white disabled:opacity-60"
                                placeholder="OpenRouter model ID"
                                aria-label={`${meta.label} model`}
                              />
                            ) : modelOptions.length > 0 && (
                              <select
                                value={selectedModel}
                                onChange={(e) => saveAiServiceSelection(serviceKey, selected, e.target.value)}
                                disabled={!isSuperAdmin || savingAiService[serviceKey] === true}
                                className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white disabled:opacity-60"
                                aria-label={`${meta.label} model`}
                              >
                                {modelOptions.map((model) => (
                                  <option key={model} value={model}>{model}</option>
                                ))}
                              </select>
                            )}
                            <p className="text-xs text-gray-500 mt-2">{meta.description}</p>
                            {savingAiService[serviceKey] && (
                              <p className="text-xs text-gray-500 mt-1">Saving...</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                </div>

                {/* Plugins */}
                <div className="border border-gray-300 rounded-lg p-4 lg:col-span-2 lg:order-first">
                  <div className="mb-4">
                    <h3 className="font-semibold text-gray-900">Plugins</h3>
                  </div>

                  <div className="mt-4 flex items-center justify-start gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-600">
                        Default Domain:{' '}
                        <span className="font-medium text-gray-900">
                          {defaultDomainLabel}
                        </span>
                        {defaultDomainSource === 'hostname' && (
                          <span
                            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700"
                            title={`Auto-detected from hostname: ${currentHostname}`}
                          >
                            via URL
                          </span>
                        )}
                        {defaultDomainSource === ADMIN_DOMAIN_OVERRIDE_SOURCE && (
                          <span
                            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700"
                            title="Requested with the ?domain= URL parameter in this browser. Choosing Hostname (default) clears it."
                          >
                            via ?domain
                          </span>
                        )}
                      </p>
                      <button
                        onClick={openDefaultDomainModal}
                        className="h-7 w-7 inline-flex items-center justify-center admin-btn disabled:opacity-50 disabled:cursor-not-allowed"
                        title={defaultDomainSource === 'hostname'
                          ? (hostnameLockedDomain
                            ? `Domain mode is locked to ${defaultDomainLabel} by the current hostname (${currentHostname}). This domain always takes priority.`
                            : `Domain mode is currently determined by the current hostname. Save a Default Domain to override URL-based mode for this browser.`)
                          : 'Edit default domain'}
                        aria-label="Edit default domain"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-600">
                        Infra Mode:{' '}
                        <span className="font-medium text-gray-900">
                          {infraMode === 'external-tenant' ? 'External Tenant' : 'On-board'}
                        </span>
                      </p>
                      <button
                        onClick={openInfraModeModal}
                        className="h-7 w-7 inline-flex items-center justify-center admin-btn"
                        title="Edit infra mode"
                        aria-label="Edit infra mode"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          </div>


        </main>
      </div>
    </>
  )
}
