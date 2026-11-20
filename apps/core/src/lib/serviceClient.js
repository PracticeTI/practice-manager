/**
 * Service Client - Communication with Domain Backend
 * Used by core APIs for domain-specific operations
 */

const DOMAIN_BACKEND_URL = process.env.DOMAIN_BACKEND_URL || 'http://localhost:3003'
const CORE_BACKEND_SECRET = String(process.env.CORE_BACKEND_SECRET || '').trim()
const DOMAIN_BACKEND_QUEUE_PATH = String(process.env.DOMAIN_BACKEND_QUEUE_PATH || '').trim()
const DOMAIN_BACKEND_REPORT_QUEUE_PATH = String(process.env.DOMAIN_BACKEND_REPORT_QUEUE_PATH || '').trim()
const DOMAIN_BACKEND_BILLING_QUEUE_PATH = String(process.env.DOMAIN_BACKEND_BILLING_QUEUE_PATH || '').trim()
const DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH = String(process.env.DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH || '').trim()
const DOMAIN_BACKEND_SCRIBE_QUEUE_PATH = String(process.env.DOMAIN_BACKEND_SCRIBE_QUEUE_PATH || '').trim()
const EMAIL_WORKER_TRIGGER_URL = String(process.env.EMAIL_WORKER_TRIGGER_URL || '').trim()
const EMAIL_WORKER_TRIGGER_SECRET = String(process.env.EMAIL_WORKER_TRIGGER_SECRET || '').trim()
const EMAIL_QUEUE_MAX_ATTEMPTS = Number(process.env.EMAIL_QUEUE_MAX_ATTEMPTS || '')
const EMAIL_RETRY_BASE_SECONDS = Number(process.env.EMAIL_RETRY_BASE_SECONDS || '')
const REPORT_QUEUE_TIMEOUT_MS = parsePositiveInt(process.env.REPORT_QUEUE_TIMEOUT_MS, 3000)
const REPORT_STATUS_TIMEOUT_MS = parsePositiveInt(process.env.REPORT_STATUS_TIMEOUT_MS, 2500)
const PATIENT_REPORT_TIMEOUT_MS = parsePositiveInt(process.env.PATIENT_REPORT_TIMEOUT_MS, 2500)

function parsePositiveInt(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

function buildAbortSignal(timeoutMs) {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timerId)
  }
}

/**
 * True when this process is the queue host: workers run in-process, so queue writes must
 * land in the local database rather than going over HTTP. `INLINE_WORKERS=true` is the
 * same flag that starts the poll loops (see `src/instrumentation.js`), so the two cannot
 * disagree and leave work queued with nothing to consume it.
 */
function inlineQueueWrites() {
  return String(process.env.INLINE_WORKERS || '').trim().toLowerCase() === 'true'
}

/**
 * Write to the local queue when no runtime service is configured.
 *
 * Single-install deployments run the worker pollers in-process (see
 * `src/instrumentation.js`), so there is no HTTP hop to enqueue through. The jobs package
 * is imported lazily: routes that never queue anything must not pull it into their bundle.
 *
 * @param {'enqueueReportJob'|'enqueueAnalysisJob'|'enqueueScribeJob'|'enqueueBillingJob'|'enqueueEmailMessage'} name
 * @param {object} job
 */
/**
 * Read queue/job state locally when this process owns the queue (see `inlineQueueWrites`).
 * Same lazy-import rule as the write side.
 *
 * @param {string} name - Export name from `@practice-manager/jobs/read`.
 * @param {object} request
 */
async function inlineRead(name, request) {
  try {
    const read = await import('@practice-manager/jobs/read')
    return await read[name](request || {})
  } catch (error) {
    return {
      success: false,
      status: Number(error?.status) || 500,
      code: error?.code,
      error: error?.message || 'Inline queue read failed'
    }
  }
}

async function enqueueInline(name, job) {
  try {
    const queues = await import('@practice-manager/jobs/enqueue')
    return await queues[name](job || {})
  } catch (error) {
    return {
      success: false,
      status: Number(error?.status) || 500,
      code: error?.code,
      error: error?.message || 'Inline queue write failed'
    }
  }
}

function withQueueDefaults(message) {
  if (!message || typeof message !== 'object') return {}
  if (Number.isFinite(Number(message.maxAttempts))) return message
  if (!Number.isFinite(EMAIL_QUEUE_MAX_ATTEMPTS)) return message

  return {
    ...message,
    maxAttempts: Math.max(1, Math.floor(EMAIL_QUEUE_MAX_ATTEMPTS))
  }
}

async function triggerQueuedEmailProcessing(context = {}) {
  if (!EMAIL_WORKER_TRIGGER_URL) {
    return { attempted: false, skipped: true, reason: 'not_configured' }
  }

  const timeoutMs = parsePositiveInt(process.env.EMAIL_WORKER_TRIGGER_TIMEOUT_MS, 1500)
  const authToken = EMAIL_WORKER_TRIGGER_SECRET || CORE_BACKEND_SECRET
  const headers = {
    'Content-Type': 'application/json'
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const abort = buildAbortSignal(timeoutMs)
  try {
    const response = await fetch(EMAIL_WORKER_TRIGGER_URL, {
      method: 'POST',
      headers,
      signal: abort.signal,
      body: JSON.stringify({
        source: 'one:enqueueOutboundEmail',
        queuedMessageId: context?.queueId || null,
        domain: context?.domain || null,
        retryBaseSeconds: Number.isFinite(EMAIL_RETRY_BASE_SECONDS)
          ? Math.max(1, Math.floor(EMAIL_RETRY_BASE_SECONDS))
          : undefined
      })
    })

    return {
      attempted: true,
      ok: response.ok,
      status: response.status
    }
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error: err?.name === 'AbortError' ? 'trigger_timeout' : (err?.message || 'trigger_failed')
    }
  } finally {
    abort.clear()
  }
}

function buildQueueUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = DOMAIN_BACKEND_QUEUE_PATH
    ? (DOMAIN_BACKEND_QUEUE_PATH.startsWith('/') ? DOMAIN_BACKEND_QUEUE_PATH : `/${DOMAIN_BACKEND_QUEUE_PATH}`)
    : null

  const paths = requestedPath
    ? [requestedPath]
    : ['/api/email/queue', '/api/practice-manager/email/queue']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildReportQueueUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = DOMAIN_BACKEND_REPORT_QUEUE_PATH
    ? (DOMAIN_BACKEND_REPORT_QUEUE_PATH.startsWith('/')
      ? DOMAIN_BACKEND_REPORT_QUEUE_PATH
      : `/${DOMAIN_BACKEND_REPORT_QUEUE_PATH}`)
    : null

  const paths = requestedPath
    ? [requestedPath]
    : ['/api/report/queue', '/api/practice-manager/report/queue']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildReportStatusUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = String(process.env.DOMAIN_BACKEND_REPORT_STATUS_PATH || '').trim()
  const normalizedRequestedPath = requestedPath
    ? (requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`)
    : null

  const paths = normalizedRequestedPath
    ? [normalizedRequestedPath]
    : ['/api/report/queue/status', '/api/practice-manager/report/queue/status']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildPatientReportUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = String(process.env.DOMAIN_BACKEND_PATIENT_REPORT_PATH || '').trim()
  const normalizedRequestedPath = requestedPath
    ? (requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`)
    : null

  const paths = normalizedRequestedPath
    ? [normalizedRequestedPath]
    : ['/api/report/patient', '/api/practice-manager/report/patient']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildBillingQueueUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = DOMAIN_BACKEND_BILLING_QUEUE_PATH
    ? (DOMAIN_BACKEND_BILLING_QUEUE_PATH.startsWith('/')
      ? DOMAIN_BACKEND_BILLING_QUEUE_PATH
      : `/${DOMAIN_BACKEND_BILLING_QUEUE_PATH}`)
    : null

  const paths = requestedPath
    ? [requestedPath]
    : ['/api/billing/queue', '/api/practice-manager/billing/queue']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildBillingStatusUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = String(process.env.DOMAIN_BACKEND_BILLING_STATUS_PATH || '').trim()
  const normalizedRequestedPath = requestedPath
    ? (requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`)
    : null

  const paths = normalizedRequestedPath
    ? [normalizedRequestedPath]
    : ['/api/billing/queue/status', '/api/practice-manager/billing/queue/status']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildAnalysisQueueUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH
    ? (DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH.startsWith('/')
      ? DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH
      : `/${DOMAIN_BACKEND_ANALYSIS_QUEUE_PATH}`)
    : null

  const paths = requestedPath
    ? [requestedPath]
    : ['/api/analysis/queue', '/api/practice-manager/analysis/queue']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildAnalysisStatusUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = String(process.env.DOMAIN_BACKEND_ANALYSIS_STATUS_PATH || '').trim()
  const normalizedRequestedPath = requestedPath
    ? (requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`)
    : null

  const paths = normalizedRequestedPath
    ? [normalizedRequestedPath]
    : ['/api/analysis/queue/status', '/api/practice-manager/analysis/queue/status']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildScribeQueueUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = DOMAIN_BACKEND_SCRIBE_QUEUE_PATH
    ? (DOMAIN_BACKEND_SCRIBE_QUEUE_PATH.startsWith('/')
      ? DOMAIN_BACKEND_SCRIBE_QUEUE_PATH
      : `/${DOMAIN_BACKEND_SCRIBE_QUEUE_PATH}`)
    : null

  const paths = requestedPath
    ? [requestedPath]
    : ['/api/scribe/queue', '/api/practice-manager/scribe/queue']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

function buildScribeStatusUrls() {
  const base = String(DOMAIN_BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) return []

  const requestedPath = String(process.env.DOMAIN_BACKEND_SCRIBE_STATUS_PATH || '').trim()
  const normalizedRequestedPath = requestedPath
    ? (requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`)
    : null

  const paths = normalizedRequestedPath
    ? [normalizedRequestedPath]
    : ['/api/scribe/queue/status', '/api/practice-manager/scribe/queue/status']

  return [...new Set(paths.map((path) => `${base}${path}`))]
}

/**
 * Call domain backend API
 * @param {string} path - API path (e.g., '/api/email/queue')
 * @param {object} options - Fetch options
 * @returns {Promise} Response JSON
 */
export async function callDomainBackend(path, options = {}) {
  const url = `${DOMAIN_BACKEND_URL}${path}`

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      timeout: 10000
    })

    if (!response.ok) {
      console.error(`Domain backend error: ${response.status} ${response.statusText}`)
      return null
    }

    return await response.json()
  } catch (err) {
    console.error('Domain backend call failed:', err.message)
    // Don't throw - callers treat the domain backend as best-effort
    return null
  }
}

/**
 * Request domain backend service status
 */
export async function getDomainBackendStatus() {
  return callDomainBackend('/health', {
    method: 'GET'
  })
}

/**
 * Enqueue an outbound email for asynchronous delivery by the domain backend.
 * @param {object} message
 */
export async function enqueueOutboundEmail(message) {
  const outboundMessage = withQueueDefaults(message)
  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return enqueueInline('enqueueEmailMessage', outboundMessage)
  }

  const queueUrls = buildQueueUrls()
  if (queueUrls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of queueUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(outboundMessage || {})
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        const trigger = await triggerQueuedEmailProcessing({
          queueId: body?.id || null,
          domain: outboundMessage?.payload?.domain || null
        })

        return {
          ...(body || { success: true }),
          workerTrigger: trigger
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      // Some deployments namespace APIs under /api/practice-manager; retry there only for not-found.
      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend queue call failed'
  }
}

/**
 * Enqueue a patient report job for asynchronous processing by the domain backend.
 * @param {object} job
 */
export async function enqueueReportTask(job) {
  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return enqueueInline('enqueueReportJob', job)
  }

  const queueUrls = buildReportQueueUrls()
  if (queueUrls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of queueUrls) {
    const abort = buildAbortSignal(REPORT_QUEUE_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal: abort.signal,
        body: JSON.stringify(job || {})
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          ...(body || { success: true })
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.name === 'AbortError'
          ? `Domain backend report queue timeout after ${REPORT_QUEUE_TIMEOUT_MS}ms`
          : (err?.message || 'Domain backend call failed'),
        url
      }
    } finally {
      abort.clear()
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend report queue call failed'
  }
}

/**
 * Fetch latest queued/processing/completed report task status for a patient.
 * @param {object} request
 */
export async function getPatientReportTaskStatus(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('getReportJobStatus', { domain, patientId })
  }

  const urls = buildReportStatusUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null
  const query = `domain=${encodeURIComponent(domain)}&patient_id=${encodeURIComponent(String(patientId))}`

  for (const baseUrl of urls) {
    const url = `${baseUrl}?${query}`
    const abort = buildAbortSignal(REPORT_STATUS_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal: abort.signal,
        cache: 'no-store'
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.name === 'AbortError'
          ? `Domain backend report status timeout after ${REPORT_STATUS_TIMEOUT_MS}ms`
          : (err?.message || 'Domain backend call failed'),
        url
      }
    } finally {
      abort.clear()
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend report status call failed'
  }
}

/**
 * Fetch the latest generated formal patient report.
 * @param {object} request
 */
export async function getPatientFormalReport(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('getPatientReport', { domain, patientId })
  }

  const urls = buildPatientReportUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null
  const query = `domain=${encodeURIComponent(domain)}&patient_id=${encodeURIComponent(String(patientId))}`

  for (const baseUrl of urls) {
    const url = `${baseUrl}?${query}`
    const abort = buildAbortSignal(PATIENT_REPORT_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal: abort.signal,
        cache: 'no-store'
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.name === 'AbortError'
          ? `Domain backend patient report timeout after ${PATIENT_REPORT_TIMEOUT_MS}ms`
          : (err?.message || 'Domain backend call failed'),
        url
      }
    } finally {
      abort.clear()
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend patient report call failed'
  }
}

/**
 * Save (create/update) the latest formal patient report.
 * @param {object} request
 */
export async function savePatientFormalReport(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)
  const patientName = String(request?.patientName || '').trim()
  const reportMarkdown = String(request?.reportMarkdown || '')

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('savePatientReport', { domain, patientId, patientName, reportMarkdown })
  }

  const urls = buildPatientReportUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          domain,
          patient_id: patientId,
          patient_name: patientName || null,
          report_markdown: reportMarkdown
        })
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend patient report save failed'
  }
}

/**
 * Enqueue a patient billing job for asynchronous processing by the domain backend.
 * @param {object} job
 */
export async function enqueueBillingTask(job) {
  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return enqueueInline('enqueueBillingJob', job)
  }

  const queueUrls = buildBillingQueueUrls()
  if (queueUrls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of queueUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(job || {})
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          ...(body || { success: true })
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend billing queue call failed'
  }
}

/**
 * Fetch latest queued/processing/completed billing task status for a patient.
 * @param {object} request
 */
export async function getPatientBillingTaskStatus(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('getBillingJobStatus', { domain, patientId })
  }

  const urls = buildBillingStatusUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null
  const query = `domain=${encodeURIComponent(domain)}&patient_id=${encodeURIComponent(String(patientId))}`

  for (const baseUrl of urls) {
    const url = `${baseUrl}?${query}`
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        cache: 'no-store'
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend billing status call failed'
  }
}

/**
 * Enqueue a patient analysis job for asynchronous processing by the domain backend.
 * @param {object} job
 */
export async function enqueueAnalysisTask(job) {
  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return enqueueInline('enqueueAnalysisJob', job)
  }

  const queueUrls = buildAnalysisQueueUrls()
  if (queueUrls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of queueUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(job || {})
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          ...(body || { success: true })
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend analysis queue call failed'
  }
}

/**
 * Fetch latest queued/processing/completed analysis task status for a patient.
 * @param {object} request
 */
export async function getPatientAnalysisTaskStatus(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('getAnalysisJobStatus', { domain, patientId })
  }

  const urls = buildAnalysisStatusUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null
  const query = `domain=${encodeURIComponent(domain)}&patient_id=${encodeURIComponent(String(patientId))}`

  for (const baseUrl of urls) {
    const url = `${baseUrl}?${query}`
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        cache: 'no-store'
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend analysis status call failed'
  }
}

/**
 * Enqueue a patient transcript scribe job for asynchronous processing by the domain backend.
 * @param {object} job
 */
export async function enqueueScribeTask(job) {
  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return enqueueInline('enqueueScribeJob', job)
  }

  const queueUrls = buildScribeQueueUrls()
  if (queueUrls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null

  for (const url of queueUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(job || {})
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          ...(body || { success: true })
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend scribe queue call failed'
  }
}

/**
 * Fetch latest queued/processing/completed scribe task status for a patient.
 * @param {object} request
 */
export async function getPatientScribeTaskStatus(request) {
  const domain = String(request?.domain || '').trim().toLowerCase()
  const patientId = Number.parseInt(String(request?.patientId || ''), 10)

  if (!domain || !Number.isFinite(patientId) || patientId <= 0) {
    return {
      success: false,
      error: 'domain and patientId are required'
    }
  }

  const headers = CORE_BACKEND_SECRET
    ? { Authorization: `Bearer ${CORE_BACKEND_SECRET}` }
    : {}

  if (inlineQueueWrites()) {
    return inlineRead('getScribeJobStatus', { domain, patientId })
  }

  const urls = buildScribeStatusUrls()
  if (urls.length === 0) {
    return {
      success: false,
      error: 'DOMAIN_BACKEND_URL is not configured'
    }
  }

  let lastFailure = null
  const query = `domain=${encodeURIComponent(domain)}&patient_id=${encodeURIComponent(String(patientId))}`

  for (const baseUrl of urls) {
    const url = `${baseUrl}?${query}`
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        cache: 'no-store'
      })

      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      if (response.ok) {
        return {
          success: true,
          ...(body || {})
        }
      }

      const failure = {
        success: false,
        status: response.status,
        error: body?.error || `Domain backend returned ${response.status}`,
        upstream: body,
        url
      }

      if (response.status === 404) {
        lastFailure = failure
        continue
      }

      return failure
    } catch (err) {
      lastFailure = {
        success: false,
        networkError: true,
        error: err?.message || 'Domain backend call failed',
        url
      }
    }
  }

  return lastFailure || {
    success: false,
    error: 'Domain backend scribe status call failed'
  }
}

const serviceClientApi = {
  callDomainBackend,
  getDomainBackendStatus,
  enqueueOutboundEmail,
  enqueueReportTask,
  getPatientReportTaskStatus,
  getPatientFormalReport,
  savePatientFormalReport,
  enqueueBillingTask,
  getPatientBillingTaskStatus,
  enqueueAnalysisTask,
  getPatientAnalysisTaskStatus,
  enqueueScribeTask,
  getPatientScribeTaskStatus
}

export default serviceClientApi
