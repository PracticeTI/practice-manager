// Official NDIS reference material for the FCA report builder.
//
// The builder's Step 1 introduces the assessment, so it also carries the sources the report is
// framed against. This module is the display catalogue: the title, publisher, link, page date and
// the key points shown in the Step 1 reference card. Keeping it here (rather than inline in the
// component) means the card, the queue-context preview and the tests all read the same facts.
//
// The worker keeps its own copy of the wording it sends to the model
// (two/src/lib/jobs/fcaReferenceGuidance.js) - the guidance text is a server-side prompt concern and
// `two` is a separate deployment, so it cannot import from here. Both copies cite the same source
// URL below; if the NDIS page changes materially, update both.
//
// Browser-safe by design (no `@/` aliases) so `node --test` can import it directly, matching the
// `fcaIntakeGoals.js` / `fcaParticipantSources.js` precedent.

/** The NDIS page the report's framing language is taken from. */
export const NDIS_FCA_REFERENCE_URL = 'https://www.ndis.gov.au/applying/types-assessments/what-functional-capacity-assessment'

/** Printable version of the same page, offered alongside the live link. */
export const NDIS_FCA_REFERENCE_PDF_URL = 'https://www.ndis.gov.au/print/pdf/node/11163'

/**
 * The six functional areas the NDIA splits a functional capacity assessment into. These are the
 * NDIA's own domain names, so the report should map its evidence onto them.
 */
export const NDIS_FCA_FUNCTIONAL_AREAS = [
    'Communication',
    'Learning',
    'Mobility',
    'Self-care',
    'Self-management',
    'Social interactions',
]

/** What the assessment is, what it is for, and what it looks like. */
export const FCA_REFERENCE_DOCUMENTS = [
    {
        id: 'ndis-what-is-a-functional-capacity-assessment',
        title: 'What is a functional capacity assessment',
        publisher: 'National Disability Insurance Agency (NDIA)',
        publisherShort: 'NDIS',
        url: NDIS_FCA_REFERENCE_URL,
        pdfUrl: NDIS_FCA_REFERENCE_PDF_URL,
        pageCurrentAsOf: '29 May 2026',
        summary: 'The NDIS definition of a functional capacity assessment: what it is, what it is for, and what it is like.',
        keyPoints: [
            'An official assessment of a person\u2019s ability to perform daily tasks at home, at work and in the community, completed by a qualified occupational therapist, physiotherapist, psychologist or medical specialist.',
            'Split into six functional areas: communication, learning, mobility, self-care, self-management and social interactions.',
            'Used to gather evidence of how a permanent impairment reduces functional capacity, and to determine the supports a plan needs \u2014 including assistive technology, therapies and home or workplace modifications.',
            'Typically takes 1 to 10 hours and examines personal care, mobility, communication, work tasks, leisure and social activities, and cognitive function.',
        ],
        relatedLinks: [
            {
                title: 'What is supporting evidence',
                url: 'https://www.ndis.gov.au/applying/gathering-evidence/what-supporting-evidence',
            },
            {
                title: 'What are NDIS supports',
                url: 'https://www.ndis.gov.au/participants/using-your-funding/understanding-your-ndis-funding/what-are-ndis-supports',
            },
        ],
    },
]

/** How the reference is described to the clinician wherever it is listed. */
export const FCA_REFERENCE_INCLUSION_NOTE = 'Always included as reference guidance in the model context for every section of this report. It frames the report in the NDIA\u2019s own definitions and is never treated as evidence about the participant.'

/** Every source URL the report is framed against, in display order. */
export function fcaReferenceSourceUrls() {
    return FCA_REFERENCE_DOCUMENTS.map((doc) => String(doc?.url || '').trim()).filter(Boolean)
}

/**
 * Provenance record for the queued report. The worker compiles the guidance text itself; this is
 * what the builder records and previews so the clinician can see which sources were applied.
 */
export function buildFcaReferenceSourceMetadata() {
    return {
        documents: FCA_REFERENCE_DOCUMENTS.map((doc) => ({
            id: doc.id,
            title: doc.title,
            publisherShort: doc.publisherShort,
            url: doc.url,
            pageCurrentAsOf: doc.pageCurrentAsOf,
        })),
        inclusionNote: FCA_REFERENCE_INCLUSION_NOTE,
    }
}
