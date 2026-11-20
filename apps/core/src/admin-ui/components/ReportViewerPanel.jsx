'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import A4PagedReport from '@/components/A4PagedReport'
import { getAdminAuthHeaders } from '@/lib/clientAdminAuth'
import { buildReportBranding } from '@/lib/reportBranding'
import { normalizeCalloutVariant, remarkReportCallouts } from '@/lib/reportCallouts'
import { REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX } from '@/lib/reportPageMetrics'
import { isTacSectionLabel, normalizeTacHeading } from '@/lib/tacReportHeadings'

const REPORT_DOCUMENT_CLASSES = [
    'mx-auto max-w-[816px] rounded-lg border border-stone-200 bg-white px-6 py-6 shadow-sm',
    'font-serif text-[15px] leading-7 text-stone-900',
    '[&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:text-sky-900',
    '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:border-b [&_h2]:border-teal-100 [&_h2]:pb-1 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:text-teal-800',
    '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:leading-snug [&_h3]:text-teal-700',
    '[&_p]:my-3 [&_p]:whitespace-pre-wrap',
    '[&_ul]:my-3 [&_ul]:ml-6 [&_ul]:list-disc',
    '[&_ol]:my-3 [&_ol]:ml-6 [&_ol]:list-decimal',
    '[&_li]:my-1 [&_li]:pl-1',
    '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-stone-300 [&_blockquote]:pl-4 [&_blockquote]:text-stone-700 [&_blockquote]:italic',
    '[&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-stone-100 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6',
    '[&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.95em]',
    '[&_a]:font-medium [&_a]:text-sky-700 [&_a]:underline [&_a]:decoration-sky-300 [&_a]:underline-offset-2',
    '[&_hr]:my-6 [&_hr]:border-stone-200',
    '[&_img]:mb-4 [&_img]:block',
    '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
    '[&_thead_th]:bg-stone-100 [&_th]:border [&_th]:border-stone-300 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
    '[&_td]:border [&_td]:border-stone-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
    '[&_td.label-cell]:border-0',
    '[&_td[data-cell="label"]]:border-0',
    '[&_td.value-cell]:border [&_td.value-cell]:border-stone-300',
    '[&_td[data-cell="value"]]:border [&_td[data-cell="value"]]:border-stone-300',
].join(' ')

const REPORT_A4_SURFACE_CLASS = 'report-viewer-a4-surface'

const REPORT_EDITOR_ACTIONS = [
    {
        id: 'bold',
        label: 'Bold',
        command: 'bold',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M6.5 4.5h4.2a2.8 2.8 0 1 1 0 5.6H6.5z" />
                <path d="M6.5 10.1h5a2.95 2.95 0 1 1 0 5.9h-5z" />
            </svg>
        ),
    },
    {
        id: 'italic',
        label: 'Italic',
        command: 'italic',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M12.5 4.5h-5" />
                <path d="M12.5 15.5h-5" />
                <path d="M11.5 4.5l-3 11" />
            </svg>
        ),
    },
    {
        id: 'h1',
        label: 'Heading 1',
        command: 'formatBlock',
        value: 'H1',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M3.5 5v10" />
                <path d="M8 5v10" />
                <path d="M3.5 10h4.5" />
                <path d="M12.5 7.2h2.2v7.8" />
            </svg>
        ),
    },
    {
        id: 'h2',
        label: 'Heading 2',
        command: 'formatBlock',
        value: 'H2',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M3.5 5v10" />
                <path d="M8 5v10" />
                <path d="M3.5 10h4.5" />
                <path d="M12.3 8a2 2 0 0 1 4 0c0 1.4-1.1 2.1-2 2.9-.9.7-1.8 1.3-2 2.6h4" />
            </svg>
        ),
    },
    {
        id: 'quote',
        label: 'Quote',
        command: 'formatBlock',
        value: 'BLOCKQUOTE',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M5.5 8.2h3v3h-3z" />
                <path d="M11.5 8.2h3v3h-3z" />
                <path d="M8.5 11.2c0 2-1 3.2-3 3.8" />
                <path d="M14.5 11.2c0 2-1 3.2-3 3.8" />
            </svg>
        ),
    },
    {
        id: 'unordered-list',
        label: 'Bulleted list',
        command: 'insertUnorderedList',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <circle cx="4.2" cy="6" r="0.9" fill="currentColor" stroke="none" />
                <circle cx="4.2" cy="10" r="0.9" fill="currentColor" stroke="none" />
                <circle cx="4.2" cy="14" r="0.9" fill="currentColor" stroke="none" />
                <path d="M7 6h9" />
                <path d="M7 10h9" />
                <path d="M7 14h9" />
            </svg>
        ),
    },
    {
        id: 'ordered-list',
        label: 'Numbered list',
        command: 'insertOrderedList',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M2.8 6h1.8" />
                <path d="M2.8 10h1.8" />
                <path d="M2.8 14h1.8" />
                <path d="M7 6h9" />
                <path d="M7 10h9" />
                <path d="M7 14h9" />
            </svg>
        ),
    },
    {
        id: 'clear-format',
        label: 'Clear formatting',
        command: 'removeFormat',
        icon: (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M5 5h10" />
                <path d="M10 5v4" />
                <path d="M6.5 9h7" />
                <path d="M4.5 15.5l11-11" />
            </svg>
        ),
    },
]

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function markdownToReportHtml(markdown) {
    const source = normalizeEmbeddedImageMarkup(String(markdown || ''))
        .replace(/\r\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .trim()

    if (!source) {
        return ''
    }

    try {
        const rendered = String(remark().use(remarkGfm).use(remarkReportCallouts).use(remarkHtml, { sanitize: false }).processSync(source))
        return normalizeTacSectionHeadings(
            normalizeStandaloneReportImages(normalizeTableCellLists(removeSyntheticTableHeaders(rendered)))
        )
    } catch {
        return `<p>${escapeHtml(source).replace(/\n/g, '<br />')}</p>`
    }
}

function normalizeTacSectionHeadings(html) {
    if (typeof DOMParser === 'undefined') {
        return html
    }

    const document = new DOMParser().parseFromString(String(html || ''), 'text/html')
    for (const sectionLabel of Array.from(document.querySelectorAll('h1'))) {
        if (!isTacSectionLabel(sectionLabel.textContent)) continue

        sectionLabel.textContent = normalizeTacHeading(sectionLabel.textContent)
        sectionLabel.setAttribute('data-tac-section-label', 'true')

        const sectionTitle = sectionLabel.nextElementSibling
        if (sectionTitle?.tagName === 'H2') {
            sectionTitle.textContent = normalizeTacHeading(sectionTitle.textContent)
            sectionTitle.setAttribute('data-tac-section-title', 'true')
        }
    }

    return document.body.innerHTML
}

function normalizeStandaloneReportImages(html) {
    if (typeof DOMParser === 'undefined') {
        return html
    }

    const document = new DOMParser().parseFromString(String(html || ''), 'text/html')
    for (const image of Array.from(document.body.children).filter((node) => node.tagName === 'IMG')) {
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-report-image-block', 'true')
        image.replaceWith(wrapper)
        wrapper.appendChild(image)
    }

    return document.body.innerHTML
}

function normalizeTableCellLists(html) {
    if (typeof DOMParser === 'undefined') {
        return html
    }

    const document = new DOMParser().parseFromString(String(html || ''), 'text/html')
    for (const block of Array.from(document.querySelectorAll('td p, th p, td div, th div'))) {
        if (block.querySelector('ul, ol')) continue

        const lines = normalizeReportText(block.textContent || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        if (lines.length < 2) continue

        const isUnordered = lines.every((line) => /^[-*+]\s+\S/.test(line))
        const isOrdered = lines.every((line) => /^\d+[.)]\s+\S/.test(line))
        if (!isUnordered && !isOrdered) continue

        const list = document.createElement(isOrdered ? 'ol' : 'ul')
        for (const line of lines) {
            const item = document.createElement('li')
            item.textContent = line.replace(isOrdered ? /^\d+[.)]\s+/ : /^[-*+]\s+/, '')
            list.appendChild(item)
        }
        block.replaceWith(list)
    }

    return document.body.innerHTML
}

function removeSyntheticTableHeaders(html) {
    if (typeof DOMParser === 'undefined') {
        return html
    }

    const document = new DOMParser().parseFromString(String(html || ''), 'text/html')
    for (const table of Array.from(document.querySelectorAll('table'))) {
        const headerRow = table.querySelector('thead tr')
        const headerCells = Array.from(headerRow?.children || [])
            .filter((cell) => String(cell?.tagName || '').toUpperCase() === 'TH')
        const hasSyntheticHeaders = headerCells.length > 0
            && headerCells.every((cell, index) => String(cell.textContent || '').trim() === `Column ${index + 1}`)

        if (hasSyntheticHeaders) {
            headerRow.parentElement?.remove()
        }
    }

    return document.body.innerHTML
}

function normalizeEmbeddedImageMarkup(markdown) {
    let source = String(markdown || '')
    if (!source) {
        return ''
    }

    // Remove accidental leading quote marks before embedded markdown images.
    source = source.replace(/^["'](!\[[^\]]*\]\(\s*data:image\/[^)\s]+\s*\))\s*$/gim, '$1')

    const htmlDataImageSources = new Set(
        Array.from(source.matchAll(/<img\b[^>]*\bsrc=(['"])(data:image\/[^'"\s]+)\1[^>]*>/gi), (match) => String(match[2] || '').trim())
            .filter(Boolean)
    )

    if (htmlDataImageSources.size === 0) {
        return source
    }

    source = source.replace(/^\s*!\[[^\]]*\]\(\s*(data:image\/[^)\s]+)\s*\)\s*$/gim, (full, dataUrl) => {
        const normalized = String(dataUrl || '').trim()
        return htmlDataImageSources.has(normalized) ? '' : full
    })

    return source.replace(/\n{3,}/g, '\n\n')
}

const reportA4SurfaceStyles = `
    .${REPORT_A4_SURFACE_CLASS} {
        --report-a4-page-height: ${REPORT_PAGE_HEIGHT_PX}px;
        --report-a4-break-strong: rgba(120, 113, 108, 0.5);
        --report-a4-break-soft: rgba(214, 211, 209, 0.5);
        max-width: ${REPORT_PAGE_WIDTH_PX}px;
        min-height: var(--report-a4-page-height);
        background-image: repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent calc(var(--report-a4-page-height) - 2px),
            var(--report-a4-break-soft) calc(var(--report-a4-page-height) - 2px),
            var(--report-a4-break-strong) calc(var(--report-a4-page-height) - 1px),
            var(--report-a4-break-soft) var(--report-a4-page-height)
        );
        background-repeat: repeat-y;
        background-size: 100% var(--report-a4-page-height);
        background-position: top left;
        margin-left: auto;
        margin-right: auto;
    }

    .${REPORT_A4_SURFACE_CLASS} [data-tac-section-label="true"] {
        margin-top: 28px;
        margin-bottom: 6px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 18px;
        line-height: 1.25;
        font-weight: 700;
        color: #111111;
        text-transform: uppercase;
    }

    .${REPORT_A4_SURFACE_CLASS} [data-tac-section-title="true"] {
        display: flex;
        align-items: center;
        gap: 24px;
        margin-top: 0;
        margin-bottom: 24px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 20px;
        line-height: 1.25;
        font-weight: 700;
        color: #1e2850;
        text-transform: uppercase;
    }

    .${REPORT_A4_SURFACE_CLASS} [data-tac-section-title="true"]::after {
        content: "";
        flex: 1 1 auto;
        height: 6px;
        background: #c8c8c8;
    }

    @media print {
        .${REPORT_A4_SURFACE_CLASS} {
            background-image: none;
        }
    }
`

function normalizeReportText(value) {
    return String(value || '').replace(/\u00a0/g, ' ')
}

function normalizeTableCellText(value) {
    return String(value || '')
        .replace(/\|/g, '\\|')
        .replace(/\s+/g, ' ')
        .trim()
}

function toMarkdownTable(node) {
    const allRows = Array.from(node.querySelectorAll('tr'))
    if (allRows.length === 0) return ''

    const rows = allRows.map((row) => Array.from(row.children)
        .filter((cell) => {
            const tag = String(cell?.tagName || '').toUpperCase()
            return tag === 'TH' || tag === 'TD'
        })
        .map((cell) => normalizeTableCellText(serializeReportInline(cell))))
        .filter((cells) => cells.length > 0)

    if (rows.length === 0) return ''

    const maxColumnCount = rows.reduce((max, cells) => Math.max(max, cells.length), 0)
    if (maxColumnCount === 0) return ''

    const pad = (cells) => {
        const next = [...cells]
        while (next.length < maxColumnCount) next.push('')
        return next
    }

    const hasThead = Boolean(node.querySelector('thead tr'))
    const firstRowCells = Array.from(allRows[0]?.children || [])
    const firstRowHasHeaderCells = firstRowCells.some((cell) => String(cell?.tagName || '').toUpperCase() === 'TH')
    const hasHeaderRow = hasThead || firstRowHasHeaderCells

    const header = hasHeaderRow
        ? pad(rows[0])
        : Array.from({ length: maxColumnCount }, (_, index) => `Column ${index + 1}`)

    const bodyRows = hasHeaderRow
        ? rows.slice(1).map(pad)
        : rows.map(pad)

    const headerLine = `| ${header.join(' | ')} |`
    const dividerLine = `| ${header.map(() => '---').join(' | ')} |`
    const bodyLines = bodyRows.map((cells) => `| ${cells.join(' | ')} |`)

    return [headerLine, dividerLine, ...bodyLines].join('\n')
}

function shouldPreserveTableHtml(node) {
    if (!node) return false

    if (node.hasAttribute('data-preserve-html')) {
        return true
    }

    if (node.classList?.contains('preserve-html-table')) {
        return true
    }

    if (node.querySelector('td.value-cell, td[data-cell="value"]')) {
        return true
    }

    const firstRow = node.querySelector('tr')
    const firstRowCells = Array.from(firstRow?.children || [])
    const hasHeaderRow = Boolean(node.querySelector('thead tr'))
        || firstRowCells.some((cell) => String(cell?.tagName || '').toUpperCase() === 'TH')

    return !hasHeaderRow
}

function serializeReportInline(node) {
    if (!node) return ''

    if (node.nodeType === Node.TEXT_NODE) {
        return normalizeReportText(node.textContent || '')
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return ''
    }

    const tagName = node.tagName.toUpperCase()

    if (tagName === 'BR') {
        return '\n'
    }

    if (tagName === 'STRONG' || tagName === 'B') {
        const content = Array.from(node.childNodes).map(serializeReportInline).join('').trim()
        return content ? `**${content}**` : ''
    }

    if (tagName === 'EM' || tagName === 'I') {
        const content = Array.from(node.childNodes).map(serializeReportInline).join('').trim()
        return content ? `*${content}*` : ''
    }

    if (tagName === 'CODE' && node.parentElement?.tagName?.toUpperCase() !== 'PRE') {
        const content = Array.from(node.childNodes).map(serializeReportInline).join('').trim()
        return content ? `\`${content}\`` : ''
    }

    if (tagName === 'A') {
        const content = Array.from(node.childNodes).map(serializeReportInline).join('').trim() || normalizeReportText(node.textContent || '').trim()
        const href = String(node.getAttribute('href') || '').trim()
        if (!href) {
            return content
        }

        return `[${content || href}](${href})`
    }

    if (tagName === 'IMG') {
        return node.outerHTML || ''
    }

    return Array.from(node.childNodes).map(serializeReportInline).join('')
}

function serializeReportBlock(node) {
    if (!node) return ''

    if (node.nodeType === Node.TEXT_NODE) {
        const content = normalizeReportText(node.textContent || '').trim()
        return content ? `${content}\n\n` : ''
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return ''
    }

    const tagName = node.tagName.toUpperCase()

    if (node.hasAttribute?.('data-report-image-block')) {
        const images = Array.from(node.children)
            .filter((child) => String(child?.tagName || '').toUpperCase() === 'IMG')
            .map((image) => image.outerHTML)
        return images.length > 0
            ? `${images.join('\n\n')}\n\n`
            : '<p data-report-spacer="true"><br></p>\n\n'
    }

    if (node.hasAttribute?.('data-page-break') || node.querySelector?.('[data-page-break]')) {
        return '<div data-page-break></div>\n\n'
    }

    // Cover lines carry their own HTML so the styled cover survives a save from the visual editor.
    if (node.hasAttribute?.('data-cover-line')) {
        const kind = String(node.getAttribute('data-cover-line') || '').trim()
        const coverTag = node.tagName.toLowerCase()
        if (coverTag === 'hr') return `<hr data-cover-line="${kind}">\n\n`

        const inner = Array.from(node.childNodes).map((child) => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const childTag = child.tagName.toUpperCase()
                if (childTag === 'BR') return '<br>'
                if (childTag === 'STRONG' || childTag === 'B') {
                    return `<strong>${normalizeReportText(child.textContent || '')}</strong>`
                }
            }
            return normalizeReportText(child.textContent || '')
        }).join('').trim()

        return `<${coverTag} data-cover-line="${kind}">${inner}</${coverTag}>\n\n`
    }

    if (tagName === 'H1') return `# ${serializeReportInline(node).trim()}\n\n`
    if (tagName === 'H2') return `## ${serializeReportInline(node).trim()}\n\n`
    if (tagName === 'H3') return `### ${serializeReportInline(node).trim()}\n\n`
    if (tagName === 'P' || tagName === 'DIV') {
        const hasBlockChildren = Array.from(node.children).some((child) => [
            'BLOCKQUOTE',
            'DIV',
            'H1',
            'H2',
            'H3',
            'HR',
            'OL',
            'P',
            'PRE',
            'TABLE',
            'UL',
        ].includes(String(child?.tagName || '').toUpperCase()))
        if (hasBlockChildren) {
            return Array.from(node.childNodes).map(serializeReportBlock).join('')
        }

        const content = serializeReportInline(node).replace(/\s+/g, ' ').trim()
        return content ? `${content}\n\n` : '<p data-report-spacer="true"><br></p>\n\n'
    }

    if (tagName === 'BLOCKQUOTE') {
        const content = Array.from(node.childNodes).map(serializeReportBlock).join('').trim()
        if (!content) {
            return ''
        }

        // Keep the `[!variant]` marker, or a round trip through the visual editor turns a boxed
        // callout back into a plain quote.
        const variant = normalizeCalloutVariant(node.getAttribute?.('data-callout'))
        const body = content.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
        return `${variant ? `> [!${variant}]\n${body}` : body}\n\n`
    }

    if (tagName === 'UL') {
        const items = Array.from(node.children).map((child) => `- ${serializeReportInline(child).replace(/\s+/g, ' ').trim()}`)
        return items.length > 0 ? `${items.join('\n')}\n\n` : ''
    }

    if (tagName === 'OL') {
        const items = Array.from(node.children).map((child, index) => `${index + 1}. ${serializeReportInline(child).replace(/\s+/g, ' ').trim()}`)
        return items.length > 0 ? `${items.join('\n')}\n\n` : ''
    }

    if (tagName === 'PRE') {
        const code = normalizeReportText(node.textContent || '').replace(/\n+$/g, '')
        return code ? `\`\`\`\n${code}\n\`\`\`\n\n` : ''
    }

    if (tagName === 'TABLE') {
        if (shouldPreserveTableHtml(node)) {
            return `${node.outerHTML}\n\n`
        }

        const tableMarkdown = toMarkdownTable(node)
        return tableMarkdown ? `${tableMarkdown}\n\n` : ''
    }

    if (tagName === 'HR') {
        return '---\n\n'
    }

    if (tagName === 'LI') {
        const content = serializeReportInline(node).replace(/\s+/g, ' ').trim()
        return content ? `${content}\n` : ''
    }

    const childBlocks = Array.from(node.childNodes).map(serializeReportBlock).join('')
    if (childBlocks.trim()) {
        return childBlocks
    }

    const content = serializeReportInline(node).replace(/\s+/g, ' ').trim()
    return content ? `${content}\n\n` : ''
}

function htmlToReportMarkdown(html) {
    const source = String(html || '').trim()
    if (!source) {
        return ''
    }

    if (typeof DOMParser === 'undefined') {
        return source
    }

    const parsed = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html')
    const root = parsed.body.firstElementChild
    if (!root) {
        return ''
    }

    return Array.from(root.childNodes)
        .map(serializeReportBlock)
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function formatTimestamp(value) {
    if (!value) return ''

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return ''

    return parsed.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
}

function toPrettyJson(value) {
    if (value == null) return ''
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

export default function ReportViewerPanel({
    title,
    patientName,
    patientId,
    domain = '',
    report,
    initialMarkdown = '',
    loading = false,
    saving = false,
    deleting = false,
    onSave,
    onDelete,
    onLoadVersions,
    onRefresh,
    onSelectVersion,
    onClose,
    onExportDocx,
    exportingDocx = false,
    statusMessage = '',
    statusTone = 'info',
}) {
    const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
    const [reportMetadataOpen, setReportMetadataOpen] = useState(false)
    const [versionsOpen, setVersionsOpen] = useState(false)
    const [versionsLoading, setVersionsLoading] = useState(false)
    const [versionsError, setVersionsError] = useState('')
    const [reportVersions, setReportVersions] = useState([])
    const [pagedPreview, setPagedPreview] = useState(true)
    const [editedPreview, setEditedPreview] = useState({ seed: '', html: '' })
    const editorRef = useRef(null)
    const actionsMenuRef = useRef(null)
    const editorTextRef = useRef(String(initialMarkdown || ''))
    const editorSeed = `${String(initialMarkdown || '').trim()}::${report?.id || 'new'}`

    // The branded page header reads the domain's logo and the practice's report settings. The domain
    // logo is available immediately; the settings read refines the credential line. A failed read
    // leaves the domain logo, so the preview never blocks on settings.
    const scopedBrandDomain = String(domain || '').trim().toLowerCase()
    const fallbackBranding = useMemo(
        () => (scopedBrandDomain ? buildReportBranding({ domain: scopedBrandDomain }) : null),
        [scopedBrandDomain]
    )
    const [fetchedBranding, setFetchedBranding] = useState({ domain: '', branding: null })
    const reportBranding = fetchedBranding.domain === scopedBrandDomain && fetchedBranding.branding
        ? fetchedBranding.branding
        : fallbackBranding

    useEffect(() => {
        if (!scopedBrandDomain) return undefined

        let cancelled = false

        ;(async () => {
            let nextBranding = buildReportBranding({ domain: scopedBrandDomain })
            try {
                const headers = await getAdminAuthHeaders()
                const response = await fetch(`/api/settings/reports?domain=${encodeURIComponent(scopedBrandDomain)}`, {
                    headers,
                    cache: 'no-store',
                })
                if (response.ok) {
                    const data = await response.json().catch(() => ({}))
                    nextBranding = buildReportBranding({ domain: scopedBrandDomain, settings: data?.settings })
                }
            } catch {
                // Keep the domain-logo header.
            }
            if (!cancelled) setFetchedBranding({ domain: scopedBrandDomain, branding: nextBranding })
        })()

        return () => {
            cancelled = true
        }
    }, [scopedBrandDomain])

    const initialPreviewHtml = useMemo(
        () => markdownToReportHtml(String(initialMarkdown || '')),
        [initialMarkdown]
    )
    const previewHtml = editedPreview.seed === editorSeed && editedPreview.html
        ? editedPreview.html
        : initialPreviewHtml
    const reportName = String(title || patientName || 'Report')
    const sourceMetadata = report?.sourceMetadata && typeof report.sourceMetadata === 'object' && !Array.isArray(report.sourceMetadata)
        ? report.sourceMetadata
        : {}
    const metadataPayload = {
        reportId: report?.id ?? null,
        patientId: report?.patientId ?? patientId ?? null,
        patientName: String(report?.patientName || patientName || '').trim() || null,
        title: reportName.trim() || null,
        status: String(report?.status || '').trim() || null,
        sourceTable: String(report?.sourceTable || '').trim() || null,
        lastJobId: String(report?.lastJobId || '').trim() || null,
        createdAt: report?.createdAt || null,
        updatedAt: report?.updatedAt || null,
        sourceMetadata,
    }
    const generationMetadata = sourceMetadata?.generationMetadata && typeof sourceMetadata.generationMetadata === 'object' && !Array.isArray(sourceMetadata.generationMetadata)
        ? sourceMetadata.generationMetadata
        : sourceMetadata?.metadata?.generationMetadata && typeof sourceMetadata.metadata.generationMetadata === 'object' && !Array.isArray(sourceMetadata.metadata.generationMetadata)
            ? sourceMetadata.metadata.generationMetadata
            : null
    const hasGenerationMetadata = Boolean(generationMetadata)
    const hasReportMetadata = Boolean(report)
    const versionsPatientId = Number(report?.patientId ?? patientId)
    const hasVersionsAction = typeof onLoadVersions === 'function'
        && typeof onSelectVersion === 'function'
        && Number.isFinite(versionsPatientId)
        && versionsPatientId > 0
    const isHistoricalVersion = report?.isHistoricalVersion === true
    const hasActionsMenu = hasReportMetadata || typeof onDelete === 'function' || hasVersionsAction
    const reportMetadataJson = toPrettyJson(metadataPayload)
    const generationSummary = {
        adapter: String(generationMetadata?.adapter || '').trim(),
        sourceSentenceCount: Number.isFinite(Number(generationMetadata?.sourceSentenceCount)) ? Number(generationMetadata.sourceSentenceCount) : null,
        sourceTextLength: Number.isFinite(Number(generationMetadata?.sourceTextLength)) ? Number(generationMetadata.sourceTextLength) : null,
        qaPass: typeof generationMetadata?.qa?.pass === 'boolean' ? generationMetadata.qa.pass : null,
        generator: String(sourceMetadata?.generator || '').trim(),
        generatedAt: formatTimestamp(sourceMetadata?.generatedAt || report?.generatedAt || report?.updatedAt || ''),
        jobId: String(sourceMetadata?.jobId || report?.lastJobId || '').trim(),
    }

    useEffect(() => {
        const editor = editorRef.current
        const nextHtml = markdownToReportHtml(String(initialMarkdown || ''))
        if (!editor) return

        if (editor.innerHTML !== nextHtml) {
            editor.innerHTML = nextHtml
        }
        editorTextRef.current = String(initialMarkdown || '')
    }, [editorSeed, initialMarkdown])

    useEffect(() => {
        if (!reportMetadataOpen || typeof window === 'undefined') return undefined

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setReportMetadataOpen(false)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [reportMetadataOpen])

    const syncReportDraftFromEditor = useCallback(() => {
        const editor = editorRef.current
        if (!editor) return
        editorTextRef.current = htmlToReportMarkdown(editor.innerHTML)
        setEditedPreview({ seed: editorSeed, html: editor.innerHTML })
    }, [editorSeed])

    const handleReportEditorInput = useCallback(() => {
        syncReportDraftFromEditor()
    }, [syncReportDraftFromEditor])

    const handleReportEditorCommand = (command, value = null) => {
        const editor = editorRef.current
        if (!editor || typeof document === 'undefined') return

        editor.focus()
        document.execCommand(command, false, value)
        window.requestAnimationFrame(() => {
            syncReportDraftFromEditor()
        })
    }

    const handleSave = useCallback(async () => {
        if (typeof onSave !== 'function') return
        syncReportDraftFromEditor()
        await onSave(editorTextRef.current)
    }, [onSave, syncReportDraftFromEditor])

    const handleExportDocx = useCallback(async () => {
        if (typeof onExportDocx !== 'function') return
        syncReportDraftFromEditor()
        await onExportDocx(editorTextRef.current)
    }, [onExportDocx, syncReportDraftFromEditor])

    useEffect(() => {
        if (!actionsMenuOpen || typeof window === 'undefined') return undefined

        const handlePointerDown = (event) => {
            const wrapper = actionsMenuRef.current
            if (wrapper && !wrapper.contains(event.target)) {
                setActionsMenuOpen(false)
            }
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setActionsMenuOpen(false)
            }
        }

        window.addEventListener('mousedown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            window.removeEventListener('mousedown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [actionsMenuOpen])

    useEffect(() => {
        if (!versionsOpen || typeof window === 'undefined') return undefined

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setVersionsOpen(false)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [versionsOpen])

    const handleOpenVersions = async () => {
        setActionsMenuOpen(false)
        setVersionsOpen(true)
        setVersionsLoading(true)
        setVersionsError('')

        try {
            const rows = await onLoadVersions(report)
            setReportVersions(Array.isArray(rows) ? rows : [])
        } catch (error) {
            setReportVersions([])
            setVersionsError(error?.message || 'Failed to load report versions')
        } finally {
            setVersionsLoading(false)
        }
    }

    const handleSelectVersion = (version) => {
        if (typeof onSelectVersion !== 'function') return
        setVersionsOpen(false)
        onSelectVersion(version, { isCurrent: version?.isCurrent === true })
    }

    const handleClose = async () => {
        // Closing a previous version must not silently overwrite the current report.
        if (typeof onSave === 'function' && !isHistoricalVersion) {
            await handleSave()
        }

        if (typeof onClose === 'function') {
            onClose()
        }
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white/95 pb-4 backdrop-blur-sm">
                <input
                    type="text"
                    value={reportName}
                    readOnly
                    className="h-9 flex-1 min-w-[180px] rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-700"
                    aria-label="Report title"
                    title="Report title is derived from patient/report data"
                />

                <div className="inline-flex rounded-md border border-stone-200 bg-stone-50 p-0.5" role="group" aria-label="Report layout">
                    <button
                        type="button"
                        onClick={() => {
                            syncReportDraftFromEditor()
                            setPagedPreview(true)
                        }}
                        aria-pressed={pagedPreview}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${pagedPreview ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                    >
                        Pages
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setPagedPreview(false)
                            window.requestAnimationFrame(() => editorRef.current?.focus())
                        }}
                        aria-pressed={!pagedPreview}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${!pagedPreview ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                    >
                        Edit
                    </button>
                </div>

                {!pagedPreview ? (
                    <div className="flex flex-wrap gap-2">
                        {REPORT_EDITOR_ACTIONS.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => handleReportEditorCommand(action.command, action.value || null)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                aria-label={action.label}
                                title={action.label}
                            >
                                {action.icon}
                            </button>
                        ))}
                    </div>
                ) : null}

                {hasActionsMenu ? (
                    <div className="relative" ref={actionsMenuRef}>
                        <button
                            type="button"
                            onClick={() => setActionsMenuOpen((value) => !value)}
                            disabled={saving || loading || deleting}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-haspopup="menu"
                            aria-expanded={actionsMenuOpen}
                            aria-label="More actions"
                            title="More actions"
                        >
                            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                                <circle cx="10" cy="4.5" r="1.5" />
                                <circle cx="10" cy="10" r="1.5" />
                                <circle cx="10" cy="15.5" r="1.5" />
                            </svg>
                        </button>

                        {actionsMenuOpen ? (
                            <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg" role="menu" aria-label="Report actions">
                                {hasReportMetadata ? (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            setActionsMenuOpen(false)
                                            setReportMetadataOpen(true)
                                        }}
                                        className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                                    >
                                        View metadata
                                    </button>
                                ) : null}

                                {hasVersionsAction ? (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={handleOpenVersions}
                                        className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                                    >
                                        Previous versions
                                    </button>
                                ) : null}

                                {typeof onDelete === 'function' ? (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={async () => {
                                            setActionsMenuOpen(false)
                                            await onDelete()
                                        }}
                                        disabled={saving || loading || deleting}
                                        className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {deleting ? 'Deleting...' : 'Delete'}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || loading || deleting}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {saving ? 'Saving...' : isHistoricalVersion ? 'Save as Current' : 'Save Draft'}
                </button>

                {typeof onClose === 'function' ? (
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={saving || loading || deleting}
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Close
                    </button>
                ) : null}
            </div>

            {isHistoricalVersion ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Viewing a previous version. Saving will replace the current report.
                </div>
            ) : null}

            {statusMessage ? (
                <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${statusTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                    {statusMessage}
                </div>
            ) : null}

            {pagedPreview ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-stone-200">
                    <A4PagedReport key={editorSeed} html={previewHtml} branding={reportBranding} emptyMessage="No report content yet." />
                </div>
            ) : null}

            <div className={`mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 ${pagedPreview ? 'hidden' : ''}`}>
                <div className="relative">
                    <div
                        key={editorSeed}
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck
                        onInput={handleReportEditorInput}
                        onBlur={handleReportEditorInput}
                        className={`${REPORT_DOCUMENT_CLASSES} ${REPORT_A4_SURFACE_CLASS} min-h-[320px] outline-none`}
                        aria-label="Report editor"
                    />
                </div>
            </div>

            <div className="sticky bottom-0 z-10 mt-4 flex justify-end border-t border-stone-200 bg-white/95 px-2 py-3 backdrop-blur-sm">
                <button
                    type="button"
                    onClick={handleExportDocx}
                    disabled={exportingDocx || saving || loading || deleting}
                    className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {exportingDocx ? 'Exporting...' : 'Export'}
                </button>
            </div>

            {versionsOpen ? (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 py-6"
                    onClick={() => setVersionsOpen(false)}
                >
                    <div
                        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900">Report versions</h3>
                                <p className="mt-0.5 text-xs text-gray-500">{reportName}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setVersionsOpen(false)}
                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="overflow-auto p-4">
                            {versionsLoading ? (
                                <p className="text-sm text-gray-600">Loading versions...</p>
                            ) : versionsError ? (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{versionsError}</p>
                            ) : reportVersions.length === 0 ? (
                                <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                                    No previous versions were found for this patient.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {reportVersions.map((version, index) => {
                                        const versionKey = `${String(version?.sourceTable || 'report')}:${String(version?.id ?? index)}`
                                        const canOpen = Boolean(String(version?.reportMarkdown || '').trim())

                                        return (
                                            <div
                                                key={versionKey}
                                                className="rounded-lg border border-gray-200 bg-white p-3"
                                            >
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <p className="text-sm font-semibold text-gray-900">
                                                                {version?.isCurrent ? 'Current version' : version?.timestampLabel || 'Unknown date'}
                                                            </p>
                                                            {version?.isCurrent ? (
                                                                <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                                                                    Current
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-1 text-xs text-gray-500">
                                                            {version?.timestampLabel || 'Unknown date'}
                                                            {version?.typeLabel ? ` · ${version.typeLabel}` : ''}
                                                            {version?.status ? ` · ${version.status}` : ''}
                                                        </p>
                                                        <p className="mt-1 text-sm text-gray-600">
                                                            {version?.preview || 'No preview available'}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectVersion(version)}
                                                        disabled={!canOpen}
                                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Open version
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {reportMetadataOpen ? (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6"
                    onClick={() => setReportMetadataOpen(false)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="border-b border-gray-200 px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-gray-900">Report Metadata</h3>
                                <button
                                    type="button"
                                    onClick={() => setReportMetadataOpen(false)}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[calc(85vh-56px)] overflow-auto p-4">
                            <div className="mb-3 flex flex-wrap gap-2 text-xs">
                                {generationSummary.adapter ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Adapter: {generationSummary.adapter}</span>
                                ) : null}
                                {generationSummary.generator ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Generator: {generationSummary.generator}</span>
                                ) : null}
                                {generationSummary.jobId ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Job ID: {generationSummary.jobId}</span>
                                ) : null}
                                {generationSummary.generatedAt ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Generated: {generationSummary.generatedAt}</span>
                                ) : null}
                                {generationSummary.sourceSentenceCount != null ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Source sentences: {generationSummary.sourceSentenceCount}</span>
                                ) : null}
                                {generationSummary.sourceTextLength != null ? (
                                    <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-gray-700">Source chars: {generationSummary.sourceTextLength}</span>
                                ) : null}
                                {generationSummary.qaPass != null ? (
                                    <span className={`rounded-full border px-2 py-1 ${generationSummary.qaPass ? 'border-green-300 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                                        QA: {generationSummary.qaPass ? 'pass' : 'review needed'}
                                    </span>
                                ) : null}
                            </div>

                            <pre className="max-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-800">{reportMetadataJson || 'No metadata found for this report.'}</pre>
                        </div>
                    </div>
                </div>
            ) : null}
            <style jsx>{reportA4SurfaceStyles}</style>
        </div>
    )
}
