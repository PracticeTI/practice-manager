import { Brain, Briefcase, ClipboardList, FileSignature, FileText, NotebookPen } from 'lucide-react'

/**
 * The look of each patient document type, keyed by the type key in
 * `src/lib/patientDocumentTypes.js`.
 *
 * Both surfaces read these maps — the Docs page (`/admin/docs`) for its type tabs
 * and modules, and the Admin dashboard's Docs card for its recent-document rows —
 * so one document type cannot show a different glyph or colour on the card than
 * it does on the page it opens. The theme lives here rather than in
 * `patientDocumentTypes.js` so that data module stays pure enough to unit test
 * without a JSX runtime.
 */

/** The glyph each document type carries. */
export const PATIENT_DOCUMENT_TYPE_ICONS = {
    quotes: FileText,
    cases: Briefcase,
    agreements: FileSignature,
    forms: ClipboardList,
    analyses: Brain,
    summaries: NotebookPen,
}

/**
 * The colour each document type is accented with. Distinct hues rather than one
 * shared grey, because the point of the colour on the Docs card is telling the
 * types apart at a glance in a short list of otherwise similar documents. `band`
 * is the solid fill behind the white page-header glyph and `label` the matching
 * text colour for the type name printed on the page.
 */
export const PATIENT_DOCUMENT_TYPE_ACCENTS = {
    quotes: { band: 'bg-sky-600', label: 'text-sky-700' },
    cases: { band: 'bg-violet-600', label: 'text-violet-700' },
    agreements: { band: 'bg-emerald-600', label: 'text-emerald-700' },
    forms: { band: 'bg-teal-600', label: 'text-teal-700' },
    analyses: { band: 'bg-amber-500', label: 'text-amber-700' },
    summaries: { band: 'bg-rose-600', label: 'text-rose-700' },
}
