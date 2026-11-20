import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'

const STATE_KEY = 'intake_responses_v1'

/**
 * GET /api/intake/save
 * Returns all saved intake responses.
 */
export async function GET() {
  const responses = await getSystemStateValue(STATE_KEY)
  return NextResponse.json({ responses: responses ?? [] })
}

/**
 * POST /api/intake/save
 * Body: { sessionId?, answers: {}, transcript: [{role, content}], schema: { fields } }
 * Appends a new response record to the intake_responses_v1 blob in system_settings.
 * Returns: { id, savedAt, answers, labelledAnswers }
 */
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { answers, transcript, schema } = body

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'Missing answers object' }, { status: 400 })
  }

  const id = body.sessionId ?? randomUUID()
  const savedAt = new Date().toISOString()

  // Build human-readable label map
  const labelledAnswers = {}
  if (schema?.fields) {
    for (const field of schema.fields) {
      if (answers[field.id] !== undefined) {
        labelledAnswers[field.label] = answers[field.id]
      }
    }
  }

  const record = {
    id,
    savedAt,
    formUuid: 'f68ceb87-f536-4f4d-aa2f-9092f9045a05',
    answers,
    labelledAnswers,
    transcript: transcript ?? [],
  }

  // Load existing array, append, and save back
  const existing = await getSystemStateValue(STATE_KEY)
  const responses = Array.isArray(existing) ? existing : []
  responses.push(record)

  const saved = await setSystemStateValue(STATE_KEY, responses)

  if (!saved) {
    return NextResponse.json(
      { error: 'Failed to save the intake response. Check DATABASE_URL is configured.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ id, savedAt, answers, labelledAnswers })
}
