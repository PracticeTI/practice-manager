import { FileText, Mail, PackageSearch, ReceiptText } from 'lucide-react'

/**
 * The glyph each review kind carries. The queue's kinds come from
 * `workerReviewQueue.buildWorkerReviewItems`, and two of the three reuse the
 * icon the destination already shows: Report is the Reports card's FileText and
 * Equipment the Sourcing card's PackageSearch, so the Tasks surfaces stay
 * consistent with the pages they open. Enquiries reuse the Messages glyph, for
 * the same reason.
 */
export const TASK_KIND_ICONS = {
    quotes: ReceiptText,
    equipment: PackageSearch,
    report: FileText,
    enquiries: Mail,
}

/**
 * The tile behind each glyph. Distinct tints rather than the surfaces' shared
 * sky, because the point of the icon is telling the three kinds apart at a
 * glance in a list.
 */
export const TASK_KIND_ACCENTS = {
    quotes: 'bg-sky-50 text-sky-600',
    equipment: 'bg-amber-50 text-amber-600',
    report: 'bg-violet-50 text-violet-600',
    enquiries: 'bg-emerald-50 text-emerald-600',
}
