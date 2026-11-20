/**
 * Shared plumbing for the queue, status and worker routes.
 *
 * The routes in this app are the HTTP face of `@practice-manager/jobs`: the same
 * `enqueue*`, `get*JobStatus` and worker-cycle functions a single-install core app imports
 * directly. Everything below is therefore transport only — authentication, request
 * parsing, status codes and response shapes — so the runtime and the inline bridge cannot
 * disagree about what a queue write does.
 */

import { NextResponse } from 'next/server'
import { WORKERS } from '@practice-manager/jobs/driver'
import { isWorkerRunAuthorized } from '@practice-manager/jobs/workerRunAuth'

const BEARER_PREFIX = 'Bearer '

function bearerToken(request) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : ''
}

/**
 * Core-to-runtime auth. An unset `CORE_BACKEND_SECRET` leaves the endpoint open, which is
 * what a local development pair expects; a shared deployment must set it.
 *
 * The body token is accepted alongside the header because the queue callers post JSON and
 * some of them cannot set headers (browser-initiated enqueues from the admin UI).
 */
export function isCoreBackendAuthorized(request, payload) {
  const secret = String(process.env.CORE_BACKEND_SECRET || '')
  if (!secret) return true
  if (bearerToken(request) === secret) return true
  return String(payload?.adminToken || '').trim() === secret
}

/** Reads carry no body, so only the header can authenticate them. */
export function isHeaderAuthorized(request) {
  const secret = String(process.env.CORE_BACKEND_SECRET || '')
  if (!secret) return true
  return bearerToken(request) === secret
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * A thrown queue error already carries the status it wants: 400 for a bad request, 503
 * when no PostgreSQL is configured. Anything else is an unexpected failure.
 */
export function queueErrorResponse(error, fallbackMessage) {
  const status = Number(error?.status) || 500
  return NextResponse.json({ error: error?.message || fallbackMessage }, { status })
}

/**
 * `POST /api/<queue>/queue` — hand the parsed body to the matching enqueue function.
 *
 * @param {{ enqueue: (input: object) => Promise<object>, fallbackMessage: string }} options
 */
export function createQueueRoute({ enqueue, fallbackMessage }) {
  return async function POST(request) {
    const payload = await request.json().catch(() => ({}))
    if (!isCoreBackendAuthorized(request, payload)) return unauthorized()

    try {
      return NextResponse.json(await enqueue(payload))
    } catch (error) {
      return queueErrorResponse(error, fallbackMessage)
    }
  }
}

/** `patient_id` is the query parameter the core has always sent. */
function normalizePatientId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * `GET /api/<queue>/queue/status?domain=&patient_id=` — latest job plus a per-status tally.
 *
 * @param {{ read: (input: object) => Promise<object>, fallbackMessage: string }} options
 */
export function createStatusRoute({ read, fallbackMessage }) {
  return async function GET(request) {
    if (!isHeaderAuthorized(request)) return unauthorized()

    try {
      const { searchParams } = new URL(request.url)
      const domain = String(searchParams.get('domain') || '').trim().toLowerCase()
      const patientId = normalizePatientId(searchParams.get('patient_id'))

      if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 })
      if (!patientId) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })

      return NextResponse.json(await read({ domain, patientId }))
    } catch (error) {
      return queueErrorResponse(error, fallbackMessage)
    }
  }
}

/**
 * `GET|POST /api/<queue>/worker/run` — one cycle on demand, for a Cloud Run job or a
 * scheduler that triggers over HTTP instead of running the poll loops.
 *
 * `worker` is a key in the jobs registry, which is where the cycle function lives.
 *
 * @param {{ worker: string, label: string, forceRun?: boolean, fallbackMessage: string }} options
 */
export function createWorkerRunRoute({ worker, label, forceRun = true, fallbackMessage }) {
  const spec = WORKERS[worker]
  if (!spec) throw new Error(`Unknown worker "${worker}" — expected one of ${Object.keys(WORKERS).join(', ')}`)

  async function run(request) {
    if (!isWorkerRunAuthorized(request)) return unauthorized()

    try {
      const result = await spec.run(forceRun ? { forceRun: true } : {})
      const body = result && typeof result === 'object' ? result : { result }
      return NextResponse.json({ success: true, worker: label, ...body })
    } catch (error) {
      return NextResponse.json(
        { success: false, worker: label, error: error?.message || fallbackMessage },
        { status: 500 }
      )
    }
  }

  return { GET: run, POST: run }
}
