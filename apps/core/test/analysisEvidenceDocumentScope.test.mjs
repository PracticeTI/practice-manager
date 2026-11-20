import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS,
    normalizeAnalysisDocuments,
} from '../src/lib/analysisEvidenceDocumentScope.js'

test('keeps a document whole when it fits the combined budget', () => {
    const [document] = normalizeAnalysisDocuments([
        {
            id: 43,
            fileName: 'NDIS Letter of Support.docx',
            text: 'FIM total 50 of 126.',
            truncated: false,
            originalLength: 21204,
        },
    ])

    assert.equal(document.id, 43)
    assert.equal(document.fileName, 'NDIS Letter of Support.docx')
    assert.equal(document.text, 'FIM total 50 of 126.')
    assert.equal(document.truncated, false)
    assert.equal(document.originalLength, 21204)
})

test('drops empty and malformed entries', () => {
    assert.deepEqual(normalizeAnalysisDocuments(null), [])
    assert.deepEqual(normalizeAnalysisDocuments([null, 'a string', { fileName: 'blank.docx', text: '   ' }]), [])
})

test('drops a document that no longer fits rather than cutting it mid-document', () => {
    const documents = normalizeAnalysisDocuments(
        [
            { id: 1, fileName: 'first.docx', text: 'a'.repeat(60) },
            { id: 2, fileName: 'second.docx', text: 'b'.repeat(60) },
        ],
        { maxTotalChars: 100 }
    )

    assert.deepEqual(documents.map((document) => document.id), [1])
    assert.equal(documents[0].text.length, 60, 'the kept document is whole')
})

test('defaults the combined budget to the analyst document cap', () => {
    const oversized = 'x'.repeat(MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS + 1)

    assert.deepEqual(normalizeAnalysisDocuments([{ fileName: 'huge.docx', text: oversized }]), [])
})
