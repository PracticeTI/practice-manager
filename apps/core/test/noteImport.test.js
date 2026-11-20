import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildNoteContentText,
    buildNoteBlocks,
    diffNoteFields,
    extractNoteText,
    isEmptyNoteContent,
    joinNoteText,
    mapCsvRowToNote,
    mergeNoteMetadata,
    noteDocumentFromText,
    normalizeNoteContent,
    normalizeNoteRecord,
    parseNoteCsv,
    parseImportedTimestamp,
} from '../src/lib/notes.js'
import { importNotesFromCsv } from '../src/lib/noteImport.js'
import { buildNoteRenderGroups, describeNoteSummary, notePreview, noteWordCount } from '../src/lib/noteDisplay.js'

// A trimmed copy of the reference Splose note export: the same headers, a
// rich-text body, a draft row and a patient name carrying an external ref.
const SESSION_CONTENT = JSON.stringify({
    type: 'doc',
    content: [
        {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: '1. Background & Injury Details' }],
        },
        {
            type: 'bulletList',
            content: [
                {
                    type: 'listItem',
                    content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Kate was involved in a motorbike vs car accident.' }],
                    }],
                },
                {
                    type: 'listItem',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Developed a pulmonary embolism.' }],
                        },
                        {
                            type: 'bulletList',
                            content: [{
                                type: 'listItem',
                                content: [{
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Wound infection to the right foot.' }],
                                }],
                            }],
                        },
                    ],
                },
            ],
        },
        { type: 'horizontalRule', attrs: { id: 'rule-1' } },
        { type: 'image', attrs: { alt: 'Photo' } },
    ],
})

const FOLLOW_UP_CONTENT = JSON.stringify({
    type: 'doc',
    content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Bel called to ask about the front opening seat.' }],
    }],
})

const escapeCell = (value) => `"${String(value).replace(/"/g, '""')}"`

const NOTE_CSV = [
    'ID,Title,Draft,Content,Patient Name,Patient ID,Practitioner Name,Practitioner ID,Appointment ID',
    [
        '48564032',
        'Occupational Therapy Session',
        'No',
        escapeCell(SESSION_CONTENT),
        'Kate Hicks',
        '7402273',
        'Kate O’Callaghan',
        '30119',
        '124207029',
    ].join(','),
    [
        '48770666',
        'Follow Up',
        'Yes',
        escapeCell(FOLLOW_UP_CONTENT),
        'Belinda Gauci - 431580664',
        '5339824',
        'Kate O’Callaghan',
        '30119',
        '',
    ].join(','),
].join('\n')

// A template-shaped export: the reference headers plus the note's creation time.
const NOTE_CSV_WITH_CREATED_AT = [
    'ID,Title,Draft,Content,Patient Name,Patient ID,Practitioner Name,Practitioner ID,Appointment ID,Created At',
    [
        '48564032',
        'Occupational Therapy Session',
        'No',
        escapeCell(SESSION_CONTENT),
        'Kate Hicks',
        '7402273',
        'Kate O’Callaghan',
        '30119',
        '124207029',
        '2026-07-13T01:02:49.000Z',
    ].join(','),
].join('\n')

// Enough of a pg connection for the importer: it answers the note/patient
// lookups and records the writes it is asked to make.
function createFakeConnection({ existing = [] } = {}) {
    const calls = []
    return {
        calls,
        query: async (sql, params) => {
            calls.push({ sql, params })
            if (sql.includes('FROM notes')) return { rows: existing }
            if (sql.includes('FROM patients')) return { rows: [] }
            if (sql.startsWith('INSERT INTO notes')) return { rows: [{ id: 1 }] }
            return { rows: [] }
        },
    }
}

function insertedColumns(call) {
    const columns = call.sql.slice(call.sql.indexOf('(') + 1, call.sql.indexOf(')'))
    return columns.split(',').map((column) => column.trim())
}

test('parseNoteCsv maps the reference export headers onto note fields', () => {
    const { records, unknownHeaders, rowCount } = parseNoteCsv(NOTE_CSV)

    assert.equal(rowCount, 2)
    assert.deepEqual(unknownHeaders, [])
    assert.equal(records[0].raw.external_id, '48564032')
    assert.equal(records[0].raw.title, 'Occupational Therapy Session')
    assert.equal(records[0].raw.draft, 'No')
    assert.equal(records[1].raw.draft, 'Yes')
    assert.equal(records[1].raw.external_appointment_id, '')
    // The quoted JSON body survives the CSV round trip.
    assert.equal(JSON.parse(records[0].raw.content).type, 'doc')
})

test('normalizeNoteRecord reads the draft flag and flattens the body', () => {
    const { records } = parseNoteCsv(NOTE_CSV)
    const session = normalizeNoteRecord(records[0].raw)
    const followUp = normalizeNoteRecord(records[1].raw)

    assert.equal(session.draft, false)
    assert.equal(followUp.draft, true)
    assert.equal(session.external_patient_id, '7402273')
    assert.equal(session.practitioner_name, 'Kate O’Callaghan')
    assert.equal(session.content.type, 'doc')
    assert.match(session.content_text, /Background & Injury Details/)
    assert.equal(followUp.content_text, 'Bel called to ask about the front opening seat.')
})

test('extractNoteText renders headings, list items and nested items in order', () => {
    const text = extractNoteText(SESSION_CONTENT)

    assert.equal(text, [
        '1. Background & Injury Details',
        '- Kate was involved in a motorbike vs car accident.',
        '- Developed a pulmonary embolism.',
        '  - Wound infection to the right foot.',
        '[image: Photo]',
    ].join('\n'))
    // Horizontal rules are structural noise and carry no text.
    assert.doesNotMatch(text, /---/)
})

test('normalizeNoteContent is idempotent and wraps plain text', () => {
    const once = normalizeNoteContent(SESSION_CONTENT)
    const twice = normalizeNoteContent(once)

    assert.deepEqual(twice, once)

    const plain = normalizeNoteContent('Handwritten note\nSecond line')
    assert.deepEqual(normalizeNoteContent(plain), plain)
    assert.equal(extractNoteText(plain), 'Handwritten note\nSecond line')

    const bareArray = normalizeNoteContent([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }])
    assert.equal(bareArray.type, 'doc')
    assert.equal(extractNoteText(bareArray), 'Hi')

    assert.equal(normalizeNoteContent(''), null)
    assert.equal(normalizeNoteContent(null), null)
})

test('isEmptyNoteContent sees through structural nodes', () => {
    assert.equal(isEmptyNoteContent({ type: 'doc', content: [] }), true)
    assert.equal(isEmptyNoteContent({ type: 'doc', content: [{ type: 'horizontalRule' }] }), true)
    assert.equal(isEmptyNoteContent({ type: 'doc', content: [{ type: 'taskList', attrs: { id: 'x' } }] }), true)
    assert.equal(isEmptyNoteContent(FOLLOW_UP_CONTENT), false)
    assert.equal(isEmptyNoteContent({ type: 'doc', content: [{ type: 'image', attrs: { alt: '' } }] }), false)
})

test('buildNoteBlocks keeps nested list depth for rendering', () => {
    const blocks = buildNoteBlocks(SESSION_CONTENT)
    const nested = blocks.filter((block) => block.kind === 'listItem' && block.depth === 1)

    assert.equal(nested.length, 1)
    assert.equal(nested[0].text, 'Wound infection to the right foot.')

    const groups = buildNoteRenderGroups(SESSION_CONTENT)
    const listGroup = groups.find((group) => group.type === 'list')
    assert.equal(listGroup.ordered, false)
    assert.equal(listGroup.items.length, 2)
    // The nested item opens its own (indented) list group.
    assert.equal(groups.filter((group) => group.type === 'list').length, 2)
})

test('mapCsvRowToNote records provenance and leaves patient linking to the importer', () => {
    const { records } = parseNoteCsv(NOTE_CSV)
    const mapped = mapCsvRowToNote(records[0].raw, { source: 'splose' })

    assert.equal(mapped.patient_id, null)
    assert.equal(mapped.external_source, 'splose')
    assert.equal(mapped.metadata.sploseNote.externalId, '48564032')
    assert.equal(mapped.metadata.sploseNote.practitionerName, 'Kate O’Callaghan')
    assert.equal(mapped.metadata.sploseNote.externalAppointmentId, '124207029')
    assert.equal(mapped.metadata.sploseNote.draft, false)
    assert.ok(mapped.metadata.sploseNote.wordCount > 0)
    assert.equal(mapped.metadata.sploseNote.blockCount, buildNoteBlocks(mapped.content).length)

    const followUp = mapCsvRowToNote(records[1].raw, { source: 'splose' })
    assert.equal(followUp.metadata.sploseNote.draft, true)
    assert.equal(followUp.metadata.sploseNote.externalAppointmentId, null)
})

test('mergeNoteMetadata preserves unrelated provenance keys', () => {
    const existing = { sploseNote: { externalId: '1' }, custom: 'kept' }
    const merged = mergeNoteMetadata(existing, { sploseNote: { draft: true } })

    assert.equal(merged.custom, 'kept')
    assert.equal(merged.sploseNote.externalId, '1')
    assert.equal(merged.sploseNote.draft, true)
})

test('diffNoteFields reports only real changes', () => {
    const { records } = parseNoteCsv(NOTE_CSV)
    const existing = mapCsvRowToNote(records[0].raw, { source: 'splose' })

    // A second run of the same file must not touch the row.
    const repeat = mapCsvRowToNote(records[0].raw, { source: 'splose' })
    assert.deepEqual(diffNoteFields(existing, { ...repeat, metadata: existing.metadata }), [])

    // A JSONB column comes back from the driver as an object, not a string.
    assert.deepEqual(diffNoteFields({ ...existing, content: existing.content }, existing), [])

    const edited = {
        ...existing,
        title: 'Occupational Therapy Review',
        content: normalizeNoteContent(FOLLOW_UP_CONTENT),
        content_text: buildNoteContentText(FOLLOW_UP_CONTENT),
    }
    const changedKeys = diffNoteFields(existing, edited).map((change) => change.key)
    assert.deepEqual(changedKeys.sort(), ['content', 'content_text', 'title'])

    const drafted = diffNoteFields(existing, { ...existing, draft: true }).map((change) => change.key)
    assert.deepEqual(drafted, ['draft'])
})

test('note display helpers summarise a note', () => {
    const { records } = parseNoteCsv(NOTE_CSV)
    const session = normalizeNoteRecord(records[0].raw)

    assert.equal(notePreview(session, 40), '1. Background & Injury Details')
    assert.equal(noteWordCount(session), extractNoteText(session.content).split(/\s+/).filter(Boolean).length)
    assert.match(describeNoteSummary(session), /^Occupational Therapy Session · \d+ words · Kate O’Callaghan$/)

    const draftSummary = describeNoteSummary(normalizeNoteRecord(records[1].raw))
    assert.match(draftSummary, /· Draft ·/)
})

test('a note written in the app is stored as a document', () => {
    const document = noteDocumentFromText('Reviewed home setup.\n\nRails ordered.')

    assert.equal(document.type, 'doc')
    assert.equal(document.content.length, 3)
    assert.deepEqual(document.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Reviewed home setup.' }] })
    // A blank line is an empty paragraph, not a dropped one.
    assert.deepEqual(document.content[1], { type: 'paragraph', content: [] })

    // The API accepts the raw text and normalises it the same way.
    assert.deepEqual(normalizeNoteContent('Reviewed home setup.'), noteDocumentFromText('Reviewed home setup.'))
    // Flattening drops the empty paragraph, so a blank line does not survive
    // the round trip - the document is the source of truth, not `content_text`.
    assert.equal(buildNoteContentText(document), 'Reviewed home setup.\nRails ordered.')
    assert.equal(isEmptyNoteContent(document), false)
})

test('joinNoteText flattens the notes a caller treats as one body', () => {
    const { records } = parseNoteCsv(NOTE_CSV)
    const session = normalizeNoteRecord(records[0].raw)

    assert.equal(joinNoteText([session]), session.content_text)
    assert.equal(joinNoteText([session, { content_text: 'Follow-up booked.' }]), `${session.content_text}\n\nFollow-up booked.`)
    assert.equal(joinNoteText([{ content_text: '   ' }]), '')
    assert.equal(joinNoteText([]), '')
    assert.equal(joinNoteText(null), '')
})

test('parseNoteCsv retains the Created At column as an instant', () => {
    const { records, unknownHeaders } = parseNoteCsv(NOTE_CSV_WITH_CREATED_AT)

    assert.deepEqual(unknownHeaders, [])
    assert.equal(records[0].raw.created_at, '2026-07-13T01:02:49.000Z')
    assert.equal(normalizeNoteRecord(records[0].raw).created_at, '2026-07-13T01:02:49.000Z')

    // Zoneless cells are read as UTC, so one file imports one instant.
    assert.equal(parseImportedTimestamp('2026-07-13 01:02:49'), '2026-07-13T01:02:49.000Z')
    // A cell that is not a date is dropped rather than guessed at.
    assert.equal(parseImportedTimestamp('13/07/2026'), null)
    assert.equal(normalizeNoteRecord({ title: 'No date' }).created_at, null)
})

test('diffNoteFields compares created_at as an instant, not as text', () => {
    const stored = { created_at: new Date('2026-07-13T01:02:49.000Z') }

    assert.deepEqual(diffNoteFields(stored, { created_at: '2026-07-13T01:02:49.000Z' }), [])
    assert.deepEqual(
        diffNoteFields(stored, { created_at: '2026-07-14T01:02:49.000Z' }),
        [{ key: 'created_at', value: '2026-07-14T01:02:49.000Z' }]
    )
})

test('the importer writes the Created At the template carries', async () => {
    const connection = createFakeConnection()

    const summary = await importNotesFromCsv(connection, {
        domain: 'acmeot',
        csvText: NOTE_CSV_WITH_CREATED_AT,
    })

    assert.equal(summary.inserted, 1)
    const insert = connection.calls.find((call) => call.sql.startsWith('INSERT INTO notes'))
    const createdAt = insert.params[insertedColumns(insert).indexOf('created_at')]
    assert.equal(createdAt, '2026-07-13T01:02:49.000Z')
})

test('a file without Created At leaves the stored timestamp alone', async () => {
    const mapped = mapCsvRowToNote(parseNoteCsv(NOTE_CSV).records[0].raw, { source: 'splose' })

    const withoutColumn = createFakeConnection()
    await importNotesFromCsv(withoutColumn, { domain: 'acmeot', csvText: NOTE_CSV })
    const insert = withoutColumn.calls.find((call) => call.sql.startsWith('INSERT INTO notes'))
    // Omitted so the column's DEFAULT NOW() applies.
    assert.equal(insertedColumns(insert).includes('created_at'), false)

    // Re-importing the reference export must not blank the retained instant.
    const stored = { ...mapped, id: 42, domain: 'acmeot', created_at: new Date('2026-07-13T01:02:49.000Z') }
    const withExisting = createFakeConnection({ existing: [stored] })
    const repeat = await importNotesFromCsv(withExisting, { domain: 'acmeot', csvText: NOTE_CSV })
    assert.equal(repeat.updated, 0)
    assert.equal(repeat.unchanged, 1)
    assert.equal(withExisting.calls.some((call) => call.sql.startsWith('UPDATE notes')), false)
})
