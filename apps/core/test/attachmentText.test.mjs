import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
    extractAttachmentText,
    cleanExtractedText,
    toFileBuffer,
    ATTACHMENT_TEXT_OK,
    ATTACHMENT_TEXT_EMPTY,
    ATTACHMENT_TEXT_UNSUPPORTED,
    ATTACHMENT_TEXT_UNREADABLE,
} from '../src/lib/attachmentText.js'
import {
    MAX_ATTACHMENT_TEXT_CHARS,
    ATTACHMENT_TRUNCATION_MARKER,
    normalizeAttachmentFiles,
    parseAttachmentContext,
    serializeAttachmentContext,
} from '../src/lib/fcaAttachments.js'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'

/** Build a minimal but real .docx so the mammoth path is exercised, not stubbed. */
async function buildDocx(paragraphText) {
    const zip = new JSZip()
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    )
    zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    )
    zip.file(
        'word/document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p></w:body>` +
        '</w:document>'
    )
    return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * Build a minimal but real PDF so the PDF.js path is exercised.
 *
 * The xref offsets are computed while writing, because PDF.js refuses a document whose trailer
 * points at the wrong byte offset. Passing no lines produces a page with an empty content stream:
 * the shape of a scanned document with no text layer.
 */
function buildPdf(lines = []) {
    const content = lines
        .map((line, index) => `BT /F1 12 Tf 50 ${750 - index * 18} Td (${line}) Tj ET`)
        .join('\n')
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ]

    let pdf = '%PDF-1.4\n'
    const offsets = []
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(pdf))
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    })
    const xrefOffset = Buffer.byteLength(pdf)
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    return Buffer.from(pdf, 'latin1')
}

test('extracts text-like files and normalises the bytes', () => {
    const buffer = Buffer.from('\uFEFFLine one\r\nLine two   \n\u0000Line three\n', 'utf8')

    return extractAttachmentText({ mimeType: 'text/plain', fileName: 'notes.txt', buffer }).then((result) => {
        assert.equal(result.status, ATTACHMENT_TEXT_OK)
        assert.equal(result.source, 'text')
        assert.equal(result.truncated, false)
        assert.equal(result.originalLength, 'Line one\nLine two\nLine three'.length)
        // BOM and NULs are gone, CRLF is normalised, and trailing whitespace is stripped.
        assert.equal(result.text, 'Line one\nLine two\nLine three')
    })
})

test('treats a text-like file by extension even when the mime type is unhelpful', async () => {
    const result = await extractAttachmentText({
        mimeType: 'application/octet-stream',
        fileName: 'attachment.md',
        buffer: Buffer.from('# Heading\nBody copy.', 'utf8'),
    })

    assert.equal(result.status, ATTACHMENT_TEXT_OK)
    assert.equal(result.source, 'text')
    assert.match(result.text, /Body copy\./)
})

test('caps extracted text at the limit it is given and reports what was dropped', async () => {
    const buffer = Buffer.from('a'.repeat(500), 'utf8')

    const capped = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'long.txt', buffer, maxChars: 100 })
    assert.equal(capped.text.length, 100)
    assert.equal(capped.truncated, true)
    assert.equal(capped.originalLength, 500)
    // The cut is marked here because no later layer can detect it: `serializeAttachmentContext`
    // caps at the same 60,000 characters, so it sees a full-looking string.
    assert.ok(capped.text.endsWith(ATTACHMENT_TRUNCATION_MARKER))

    const uncapped = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'long.txt', buffer })
    assert.equal(uncapped.text.length, 500)
    assert.equal(uncapped.truncated, false)
    assert.equal(uncapped.originalLength, 500)
})

test('extracts DOCX paragraphs through mammoth', async () => {
    const buffer = await buildDocx('The participant requires supervision during transfers.')

    const result = await extractAttachmentText({ mimeType: DOCX_MIME, fileName: 'letter.docx', buffer })

    assert.equal(result.status, ATTACHMENT_TEXT_OK)
    assert.equal(result.source, 'docx')
    assert.match(result.text, /requires supervision during transfers/)
})

test('reports a corrupt DOCX as unreadable instead of throwing', async () => {
    // Right name and mime type, but the bytes are not a zip: this used to surface as a 500.
    const result = await extractAttachmentText({
        mimeType: DOCX_MIME,
        fileName: 'broken.docx',
        buffer: Buffer.from('not really a docx'),
    })

    assert.equal(result.status, ATTACHMENT_TEXT_UNREADABLE)
    assert.equal(result.text, '')
    assert.equal(result.truncated, false)
    assert.ok(result.error)
})

test('reports unreadable images as unsupported and names the file for the picker', async () => {
    const result = await extractAttachmentText({
        mimeType: 'image/png',
        fileName: 'progress-photo.png',
        buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    })

    assert.equal(result.status, ATTACHMENT_TEXT_UNSUPPORTED)
    assert.equal(result.source, 'binary')
    assert.equal(result.text, '')
    assert.match(result.error, /progress-photo\.png/)
    assert.match(result.error, /named reference/)
})

test('extracts the text layer of a PDF', async () => {
    const buffer = buildPdf(['Occupational therapy review', 'Participant lives alone.'])

    const result = await extractAttachmentText({ mimeType: PDF_MIME, fileName: 'review.pdf', buffer })

    assert.equal(result.status, ATTACHMENT_TEXT_OK)
    assert.equal(result.source, 'pdf')
    assert.match(result.text, /Occupational therapy review/)
    assert.match(result.text, /Participant lives alone\./)
})

test('applies the same cap and truncation marker to PDF text', async () => {
    // Two lines that stay inside the page box: PDF.js drops glyphs that run off the page edge.
    const buffer = buildPdf(['a'.repeat(60), 'b'.repeat(60)])

    const result = await extractAttachmentText({ mimeType: PDF_MIME, fileName: 'long.pdf', buffer, maxChars: 100 })

    assert.equal(result.status, ATTACHMENT_TEXT_OK)
    assert.equal(result.text.length, 100)
    assert.equal(result.truncated, true)
    assert.equal(result.originalLength, 121)
    assert.ok(result.text.endsWith(ATTACHMENT_TRUNCATION_MARKER))
})

test('reports a scanned PDF with no text layer as unsupported, not as an empty document', async () => {
    const result = await extractAttachmentText({ mimeType: PDF_MIME, fileName: 'Authority.pdf', buffer: buildPdf([]) })

    assert.equal(result.status, ATTACHMENT_TEXT_UNSUPPORTED)
    assert.equal(result.source, 'pdf')
    assert.equal(result.text, '')
    assert.match(result.error, /Authority\.pdf/)
    assert.match(result.error, /no text layer/)
    assert.match(result.error, /named reference/)
})

test('reports a corrupt PDF as unreadable instead of throwing', async () => {
    // Right name and mime type, but the bytes are not a PDF: this used to surface as a 500.
    const result = await extractAttachmentText({
        mimeType: PDF_MIME,
        fileName: 'broken.pdf',
        buffer: Buffer.from('not really a pdf'),
    })

    assert.equal(result.status, ATTACHMENT_TEXT_UNREADABLE)
    assert.equal(result.source, 'pdf')
    assert.equal(result.text, '')
    assert.equal(result.truncated, false)
    assert.ok(result.error)
})

test('distinguishes a zero-byte stored file from a document with no words', async () => {
    const empty = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'empty.txt', buffer: Buffer.alloc(0) })
    assert.equal(empty.status, ATTACHMENT_TEXT_EMPTY)
    assert.equal(empty.error, 'Stored file is empty')

    const whitespaceOnly = await extractAttachmentText({
        mimeType: 'text/plain',
        fileName: 'blank.txt',
        buffer: Buffer.from('   \n\n  ', 'utf8'),
    })
    assert.equal(whitespaceOnly.status, ATTACHMENT_TEXT_OK)
    assert.equal(whitespaceOnly.text, '')
})

test('handles a missing buffer and a non-buffer file_data value', async () => {
    const missing = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'missing.txt' })
    assert.equal(missing.status, ATTACHMENT_TEXT_EMPTY)

    assert.equal(toFileBuffer(null).length, 0)
    assert.equal(toFileBuffer(new Uint8Array([65, 66])).toString('utf8'), 'AB')
})

test('cleanExtractedText is the single normaliser for every source', () => {
    assert.equal(cleanExtractedText(undefined), '')
    assert.equal(cleanExtractedText('\uFEFFa\r\nb\t  \n'), 'a\nb')
})

test('the default cap matches the picker cap, so extraction cannot silently drift', async () => {
    const buffer = Buffer.from('x'.repeat(MAX_ATTACHMENT_TEXT_CHARS + 50), 'utf8')

    const result = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'huge.txt', buffer })

    assert.equal(result.text.length, MAX_ATTACHMENT_TEXT_CHARS)
    assert.equal(result.truncated, true)
    assert.equal(result.originalLength, MAX_ATTACHMENT_TEXT_CHARS + 50)
})

test('a document cut at the default cap is marked, and stays marked through the context block', async () => {
    // Regression: an 8-page NDIS Letter of Support extracted to 21,204 characters was stored cut at
    // the then 20,000 cap with no marker at all, so the queued context simply ended mid-sentence
    // ("...continue to be met by the health system;"). The outer layer could not notice, because
    // both layers use the same cap.
    const dropped = 1204
    const buffer = Buffer.from('y'.repeat(MAX_ATTACHMENT_TEXT_CHARS + dropped), 'utf8')

    const extraction = await extractAttachmentText({ mimeType: 'text/plain', fileName: 'letter.txt', buffer })

    assert.equal(extraction.truncated, true)
    assert.equal(extraction.originalLength, MAX_ATTACHMENT_TEXT_CHARS + dropped)
    assert.equal(extraction.text.length, MAX_ATTACHMENT_TEXT_CHARS)
    assert.ok(extraction.text.endsWith('[truncated]'))

    const files = normalizeAttachmentFiles([{ id: 43, file_name: 'letter.txt', mime_type: 'text/plain' }])
    const stored = parseAttachmentContext(serializeAttachmentContext(files, { 43: extraction.text })).get('43')

    assert.ok(stored.endsWith('[truncated]'), 'the marker survives the context block')
    assert.equal(stored.match(/\[truncated\]/g).length, 1, 'the marker is not doubled')
})
