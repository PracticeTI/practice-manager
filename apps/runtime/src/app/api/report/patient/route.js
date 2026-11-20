import { NextResponse } from 'next/server'
import { getPatientReport, savePatientReport } from '@practice-manager/jobs/read'
import { isHeaderAuthorized, queueErrorResponse, unauthorized } from '@/lib/routeHandlers'

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePatientId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeText(value, maxLength) {
  return String(value || '').slice(0, maxLength)
}

/** The current formal report for a patient. Working drafts and generated output live elsewhere. */
export async function GET(request) {
  if (!isHeaderAuthorized(request)) return unauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const domain = normalizeDomain(searchParams.get('domain'))
    const patientId = normalizePatientId(searchParams.get('patient_id'))

    if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 })
    if (!patientId) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })

    return NextResponse.json(await getPatientReport({ domain, patientId }))
  } catch (error) {
    return queueErrorResponse(error, 'Failed to load patient report')
  }
}

export async function POST(request) {
  if (!isHeaderAuthorized(request)) return unauthorized()

  try {
    const payload = await request.json().catch(() => ({}))
    const domain = normalizeDomain(payload.domain)
    const patientId = normalizePatientId(payload.patient_id || payload.patientId)

    if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 })
    if (!patientId) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })

    const patientName = normalizeText(payload.patient_name || payload.patientName, 240).trim() || null
    const reportMarkdown = normalizeText(payload.report_markdown || payload.reportMarkdown, 200000)

    return NextResponse.json(await savePatientReport({ domain, patientId, patientName, reportMarkdown }))
  } catch (error) {
    return queueErrorResponse(error, 'Failed to save patient report')
  }
}
