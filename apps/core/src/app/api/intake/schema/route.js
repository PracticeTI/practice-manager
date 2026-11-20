import { NextResponse } from 'next/server'

const FORM_UUID = 'f68ceb87-f536-4f4d-aa2f-9092f9045a05'
const SCHEMA_URL = `https://au.splose.com/api/embeddableForm/${FORM_UUID}`

/**
 * Normalize raw Splose schema into a flat ordered field list the chat agent uses.
 * Only includes fields that require a user answer (skips Image and Statement types).
 */
function normalizeSchema(raw) {
  const fields = []

  for (const section of raw.form.content) {
    for (const q of section.questions) {
      if (q.type === 'Image' || q.type === 'Statement') continue

      const field = {
        id: q.id,
        type: q.type,
        label: q.title,
        required: q.required ?? false,
        section: section.title.trim(),
      }

      if (q.type === 'Dropdown' && q.choices?.length) {
        field.options = q.choices.map(c => c.body)
      }

      fields.push(field)
    }
  }

  return {
    formTitle: raw.form.title,
    orgName: raw.orgInfo.name,
    formUuid: FORM_UUID,
    fields,
  }
}

/**
 * GET /api/splose-intake/schema
 * Returns the normalised form field list. Cached for 1 hour.
 */
export async function GET() {
  try {
    const res = await fetch(SCHEMA_URL, {
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch form schema: ${res.status}` },
        { status: 502 }
      )
    }

    const raw = await res.json()
    const schema = normalizeSchema(raw)

    return NextResponse.json(schema)
  } catch (err) {
    return NextResponse.json(
      { error: 'Error loading form schema', detail: err.message },
      { status: 500 }
    )
  }
}
