import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildFcaReferenceSourceMetadata,
    FCA_REFERENCE_DOCUMENTS,
    FCA_REFERENCE_INCLUSION_NOTE,
    fcaReferenceSourceUrls,
    NDIS_FCA_FUNCTIONAL_AREAS,
    NDIS_FCA_REFERENCE_PDF_URL,
    NDIS_FCA_REFERENCE_URL,
} from '../src/lib/fcaReferenceDocuments.js'

test('catalogues the official NDIS functional capacity assessment page', () => {
    const [doc] = FCA_REFERENCE_DOCUMENTS

    assert.ok(doc, 'expected at least one reference document')
    assert.equal(doc.url, NDIS_FCA_REFERENCE_URL)
    assert.equal(doc.url, 'https://www.ndis.gov.au/applying/types-assessments/what-functional-capacity-assessment')
    assert.equal(doc.pdfUrl, NDIS_FCA_REFERENCE_PDF_URL)
    assert.match(doc.title, /functional capacity assessment/i)
    assert.match(doc.publisher, /National Disability Insurance Agency/)
    assert.ok(doc.pageCurrentAsOf)
    assert.ok(doc.summary.length > 0)
})

test('lists the six NDIA functional areas and the page key points', () => {
    const [doc] = FCA_REFERENCE_DOCUMENTS

    assert.deepEqual(NDIS_FCA_FUNCTIONAL_AREAS, [
        'Communication',
        'Learning',
        'Mobility',
        'Self-care',
        'Self-management',
        'Social interactions',
    ])

    assert.equal(doc.keyPoints.length, 4)
    assert.ok(doc.keyPoints.some((point) => /six functional areas/i.test(point)))
    assert.ok(doc.keyPoints.some((point) => /1 to 10 hours/i.test(point)))
})

test('every card link is an absolute https URL and each document has an id and link', () => {
    for (const doc of FCA_REFERENCE_DOCUMENTS) {
        assert.ok(doc.id)
        assert.match(doc.url, /^https:\/\//)
        assert.match(doc.pdfUrl, /^https:\/\//)
        for (const link of doc.relatedLinks || []) {
            assert.ok(link.title)
            assert.match(link.url, /^https:\/\//)
        }
    }
})

test('exposes the source list and provenance metadata used by the builder', () => {
    assert.deepEqual(fcaReferenceSourceUrls(), [NDIS_FCA_REFERENCE_URL])

    const metadata = buildFcaReferenceSourceMetadata()
    assert.equal(metadata.documents.length, 1)
    assert.deepEqual(metadata.documents[0], {
        id: 'ndis-what-is-a-functional-capacity-assessment',
        title: 'What is a functional capacity assessment',
        publisherShort: 'NDIS',
        url: NDIS_FCA_REFERENCE_URL,
        pageCurrentAsOf: '29 May 2026',
    })
    assert.equal(metadata.inclusionNote, FCA_REFERENCE_INCLUSION_NOTE)
    assert.match(metadata.inclusionNote, /never treated as evidence about the participant/)
})
