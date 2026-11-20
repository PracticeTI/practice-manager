// Report-type artwork for the /admin dashboard Reports card.
//
// The Reports card shows each recent report as the artwork of its report *type*
// instead of the report's text preview (see `ReportTypeTile` in
// `src/app/admin/page.jsx`), so every configured report type needs a cover image.
// A type with no entry here — or a type whose art is only published for some
// domains — resolves to `null`, and the card falls back to its text tile, so
// adding a report type never produces an empty frame.
//
// The art is the same artwork the patient modal already uses for the matching
// agent hero card: one raster per domain for the FCA Builder and
// `/allied-health/OT/OTF10-Preview.png` for the HSR Writer (OTF10).
//
// That hero art is worn by an *agent*, so the associated agent is a second handle
// on the report type: a report row that carries no type metadata of its own (an
// imported record, or one queued before the type was recorded) still resolves to
// its type's cover through the worker that produced it — `reporting` is the FCA
// Builder, `hsrCreator` is the HSR Writer. Callers pass it as `agent`.

import { isNdisFcaReportType, isOtf10ReportType } from './reportTypeSelection.js'
import { getPrivateDomainFieldMap } from './domainExtension.js'

// The published art is landscape page artwork (both covers are 3:2).
export const REPORT_TYPE_ARTWORK_ASPECT_RATIO = 3 / 2

// Each entry claims a configured report type through the same predicates the API
// sorts report types with, so "what counts as the FCA type" lives in one place
// (`src/lib/reportTypeSelection.js`) rather than a second set of id/name matchers.
// The configured id and its display name are tested separately, because a queued
// job's metadata can carry either. `agent` names the patient agent whose hero card
// wears the same cover, used when the report row carries no type metadata.
const REPORT_TYPE_ARTWORK = [
    {
        matches: isNdisFcaReportType,
        agent: 'reporting',
        label: 'FCA Builder',
        alt: 'NDIS Functional Capacity Assessment report cover',
        // The FCA cover carries the practice's own branding, so it is per domain.
        srcByDomain: getPrivateDomainFieldMap('reportArtwork'),
    },
    {
        matches: isOtf10ReportType,
        agent: 'hsrCreator',
        label: 'OTF10 Home Services Review',
        alt: 'OTF10 Home Services Review report cover',
        src: '/allied-health/OT/OTF10-Preview.png',
    },
]

/**
 * Resolve the artwork for one report's type.
 *
 * The report type wins when the row names one; `agent` is only the fallback for
 * reports whose row carries no type metadata, so it can never point a report at
 * another type's cover.
 *
 * @param {{ reportTypeId?: string, reportType?: string, agent?: string, domain?: string }} report
 * @returns {{ src: string, alt: string, label: string } | null}
 */
export function resolveReportTypeArtwork({ reportTypeId, reportType, agent, domain } = {}) {
    const domainKey = String(domain || '').trim().toLowerCase()
    const agentKey = String(agent || '').trim()

    const entry = REPORT_TYPE_ARTWORK.find((candidate) => (
        candidate.matches(reportTypeId) || candidate.matches(reportType)
    )) || REPORT_TYPE_ARTWORK.find((candidate) => agentKey && candidate.agent === agentKey)

    if (!entry) return null

    const src = entry.srcByDomain
        ? entry.srcByDomain[domainKey] || ''
        : String(entry.src || '')

    if (!src) return null

    return { src, alt: entry.alt, label: entry.label }
}
