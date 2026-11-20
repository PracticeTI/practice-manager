// Explicit page-break markers for report markdown.
//
// A report template can end its cover page with a standalone
// `<div data-page-break></div>` line. Both renderers have to agree that the marker
// starts a new A4 page and is not itself visible content:
//
// - the A4 preview (`src/components/A4PagedReport.jsx`) closes the current page
//   before the marker and drops the marker from the page body;
// - the DOCX export (`src/app/api/database/patients/formal-report/export/route.js`)
//   writes a `<w:br w:type="page"/>` instead of a paragraph.
//
// A raw HTML element is used rather than an HTML comment because `remark` turns a
// comment into a DOM comment node, which the paginator cannot see and which
// `remark-html` may strip.

export const REPORT_PAGE_BREAK_MARKER = '<div data-page-break></div>'

const PAGE_BREAK_OPEN_TAG = /^<(div|section|p|hr)\b[^>]*\bdata-page-break(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*\/?>/i

/** Whether a markdown line is only a page-break marker element. */
export function isReportPageBreak(value) {
    const source = String(value || '').trim()
    if (!source) return false

    const match = PAGE_BREAK_OPEN_TAG.exec(source)
    if (!match) return false

    const tag = match[1].toLowerCase()
    const rest = source.slice(match[0].length).trim()
    if (!rest) return true
    if (tag === 'hr') return false
    if (rest === '/>' || rest === `</${tag}>`) return true
    return false
}

/** Remove page-break markers from text that is not paginated (plain-text exports, prompts). */
export function stripReportPageBreaks(value) {
    return String(value || '')
        .replace(/(?:^|\n)[ \t]*<(?:div|section|p|hr)\b[^>]*\bdata-page-break[^>]*>(?:\s*<\/[a-z]+>)?[ \t]*(?=\n|$)/gi, '\n')
        .replace(/\n{3,}/g, '\n\n')
}

/** Whether a heading is a numbered report section (`1. Executive Summary`, `12. Conclusion`). */
export function isNumberedSectionHeading(value) {
    return /^\d{1,2}[.)]\s+\S/.test(String(value || '').trim())
}

/** Whether an HTML element is a page-break marker (directly or as a wrapper's only element). */
export function isReportPageBreakElement(node) {
    if (!node || node.nodeType !== 1) return false
    if (typeof node.hasAttribute === 'function' && node.hasAttribute('data-page-break')) return true
    const children = node.children
    if (children && children.length === 1) {
        const child = children[0]
        if (child && typeof child.hasAttribute === 'function' && child.hasAttribute('data-page-break')) {
            return true
        }
    }
    return false
}
