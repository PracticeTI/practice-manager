import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildAttachmentRows,
    classifyAttachmentTextSource,
    DOCX_MIME_TYPE,
    formatFileSize,
    isRecordingAttachment,
    isRecordingFile,
    isTextExtractable,
    MAX_ATTACHMENT_CONTEXT_CHARS,
    MAX_ATTACHMENT_TEXT_CHARS,
    normalizeAttachmentFiles,
    parseAttachmentContext,
    serializeAttachmentContext,
    splitAttachmentContextFromBuilderFormData,
    toAttachmentEntry,
} from '../src/lib/fcaAttachments.js'
import {
    MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS,
    MAX_ANALYSIS_DOCUMENT_TEXT_CHARS,
} from '../src/lib/analysisEvidenceDocumentScope.js'

const CSV_FILE = { id: 2, file_name: 'progressNote.csv', mime_type: 'text/csv', file_size: 50148, created_at: '2026-08-17T20:14:04.262Z' }
const PDF_FILE = { id: 11, file_name: 'DEC_00FF045D.pdf', mime_type: 'application/pdf', file_size: 128100, created_at: '2026-08-26T19:31:22.555Z' }

test('classifies which files can be read as text', () => {
    assert.equal(classifyAttachmentTextSource('text/csv', 'progressNote.csv'), 'text')
    assert.equal(classifyAttachmentTextSource('application/json', 'patient-transcript-import.json'), 'text')
    assert.equal(classifyAttachmentTextSource('text/plain', 'note.txt'), 'text')
    assert.equal(
        classifyAttachmentTextSource('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'letter.docx'),
        'docx'
    )
    // Browsers often send an empty/octet-stream mime type for DOCX uploads.
    assert.equal(classifyAttachmentTextSource('application/octet-stream', 'LETTER.DOCX'), 'docx')
    assert.equal(classifyAttachmentTextSource('application/pdf', 'Authority.pdf'), 'pdf')
    assert.equal(classifyAttachmentTextSource('application/octet-stream', 'DEC_00FF045D.PDF'), 'pdf')
    assert.equal(classifyAttachmentTextSource('video/webm', 'note-recording.webm'), 'binary')

    assert.equal(isTextExtractable('application/pdf', 'Authority.pdf'), true)
    assert.equal(isTextExtractable('image/png', 'progress-photo.png'), false)
    assert.equal(isTextExtractable('text/csv', 'progressNote.csv'), true)
})

test('identifies consultation recordings so they can be kept out of the picker', () => {
    const RECORDING = { id: 12, file_name: 'note-recording-060826-142220.webm', mime_type: 'video/webm' }

    assert.equal(isRecordingFile('video/webm', 'note-recording-060826-142220.webm'), true)
    assert.equal(isRecordingFile('audio/mpeg', 'session.mp3'), true)
    assert.equal(isRecordingFile('audio/mp4', 'session.m4a'), true)
    // Extension alone is enough: browsers sometimes send an empty or octet-stream mime type.
    assert.equal(isRecordingFile('application/octet-stream', 'RECORDING.WEBM'), true)
    assert.equal(isRecordingFile('', 'note-recording-010926-140222.webm'), true)

    assert.equal(isRecordingAttachment(RECORDING), true)
    assert.equal(isRecordingAttachment({ fileName: 'session.mov' }), true)

    // Unreadable but still worth attaching by name, so NOT filtered as a recording.
    assert.equal(isRecordingFile('application/pdf', 'Authority.pdf'), false)
    assert.equal(isRecordingAttachment(PDF_FILE), false)
    assert.equal(isRecordingFile('image/png', 'screenshot.png'), false)
    assert.equal(isRecordingAttachment(CSV_FILE), false)
    assert.equal(isRecordingAttachment(null), false)

    // "recording" in a normal document name must not trigger the recording filter.
    assert.equal(isRecordingAttachment({ file_name: 'recording-equipment-request.docx', mime_type: DOCX_MIME_TYPE }), false)
})

test('normalises patient_files rows and drops unusable entries', () => {
    assert.deepEqual(toAttachmentEntry(CSV_FILE), {
        id: '2',
        fileName: 'progressNote.csv',
        mimeType: 'text/csv',
        fileSize: 50148,
        createdAt: '2026-08-17T20:14:04.262Z',
    })

    assert.equal(toAttachmentEntry({ file_name: 'no-id.txt' }), null)
    assert.equal(toAttachmentEntry({ id: 5 }), null)

    // Duplicate ids collapse to the first entry so a file cannot be attached twice.
    const files = normalizeAttachmentFiles([CSV_FILE, { id: 2, file_name: 'progressNote.csv', mime_type: 'text/csv' }])
    assert.equal(files.length, 1)
    assert.deepEqual(normalizeAttachmentFiles('not-an-array'), [])
})

test('attachment context round-trips file text', () => {
    const files = normalizeAttachmentFiles([CSV_FILE, PDF_FILE])
    const texts = new Map([
        ['2', 'date,activity\n17/08/2026,hydrotherapy'],
        ['11', ''],
    ])

    const context = serializeAttachmentContext(files, texts)
    const parsed = parseAttachmentContext(context)

    assert.equal(parsed.size, 1)
    assert.equal(parsed.get('2'), 'date,activity\n17/08/2026,hydrotherapy')
    // The PDF has no readable text, so it stays a named reference only.
    assert.equal(parsed.has('11'), false)
    assert.ok(context.includes('progressNote.csv'))
})

test('attachment context caps long file text and reports truncation', () => {
    const files = normalizeAttachmentFiles([{ id: 3, file_name: 'big.csv', mime_type: 'text/csv' }])
    const longText = 'x'.repeat(MAX_ATTACHMENT_TEXT_CHARS + 500)

    const parsed = parseAttachmentContext(serializeAttachmentContext(files, { 3: longText }))
    const stored = parsed.get('3')

    assert.ok(stored.length < longText.length)
    assert.ok(stored.endsWith('[truncated]'))
    // The marker is budgeted for, so the stored text still fits the per-file cap.
    assert.ok(stored.length <= MAX_ATTACHMENT_TEXT_CHARS)
})

test('attachment context stops once the context budget is spent', () => {
    const files = normalizeAttachmentFiles([
        { id: 1, file_name: 'first.csv', mime_type: 'text/csv' },
        { id: 2, file_name: 'second.csv', mime_type: 'text/csv' },
        { id: 3, file_name: 'third.csv', mime_type: 'text/csv' },
    ])
    const texts = { 1: 'a'.repeat(MAX_ATTACHMENT_TEXT_CHARS), 2: 'b'.repeat(MAX_ATTACHMENT_TEXT_CHARS), 3: 'c'.repeat(1000) }

    const context = serializeAttachmentContext(files, texts)
    const parsed = parseAttachmentContext(context)

    assert.ok(context.length <= MAX_ATTACHMENT_CONTEXT_CHARS + 200, 'context stays near the budget')
    assert.ok(parsed.has('1'), 'first file is kept whole')
    assert.equal(parsed.has('3'), false, 'later files are dropped once the budget is spent')
})

test('attachment caps match the analyst document caps', () => {
    // A document should read the same whether it is attached to the report or routed through
    // reference documents. Drift between the two is how the old 20k/40k limits stayed invisible.
    assert.equal(MAX_ATTACHMENT_TEXT_CHARS, MAX_ANALYSIS_DOCUMENT_TEXT_CHARS)
    assert.equal(MAX_ATTACHMENT_CONTEXT_CHARS, MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS)
})

test('rows merge the file store with attachments a draft still references', () => {
    const rows = buildAttachmentRows([CSV_FILE], [{ id: '99', file_name: 'deleted-letter.pdf', mime_type: 'application/pdf' }])

    assert.deepEqual(rows.map((row) => row.id), ['2', '99'])
    assert.equal(rows[1].missing, true)
    assert.equal(rows[0].missing, undefined)
})

test('formats file sizes for the attachment list', () => {
    assert.equal(formatFileSize(0), '0 KB')
    assert.equal(formatFileSize(50148), '49 KB')
    assert.equal(formatFileSize(10372202), '9.9 MB')
})

test('splits the attachment text out of the queued builder form data', () => {
    const formData = {
        participantName: 'Justin McAdam',
        additionalNotes: 'Keep gardening',
        attachmentFiles: [{ id: 25, file_name: 'plan.csv', mime_type: 'text/csv' }],
        attachmentContext: '=== Attached file: plan.csv | text/csv | file:25 ===\nreview date, 12 Aug',
    }

    const { formData: queuedFormData, attachmentContext } = splitAttachmentContextFromBuilderFormData(formData)

    assert.equal(queuedFormData.attachmentContext, undefined)
    assert.equal(queuedFormData.participantName, 'Justin McAdam')
    assert.deepEqual(queuedFormData.attachmentFiles, formData.attachmentFiles)
    assert.ok(attachmentContext.startsWith('=== Attached file: plan.csv'))

    assert.deepEqual(splitAttachmentContextFromBuilderFormData(null), { formData: null, attachmentContext: '' })
})
