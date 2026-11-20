'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { remark } from 'remark'
import remarkHtml from 'remark-html'
import { normalizeCalloutVariant, remarkReportCallouts } from '@/lib/reportCallouts'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { buildCalloutCssRules, buildCoverCssRules, REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX } from '@/lib/reportPageMetrics'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getEffectiveDomainMode } from '@/lib/domainMode'
import {
    DEFAULT_REPORT_AI_PROVIDER,
    DEFAULT_REPORT_AI_TIER,
    DEFAULT_REPORT_AI_PROVIDER_MODELS,
    REPORT_AI_PROVIDER_KEYS,
    REPORT_AI_TIER_KEYS,
    getReportAiProviderDisplayName,
    normalizeReportAiProvider,
    normalizeReportAiTier,
    normalizeReportAiProviderModels,
} from '@/lib/reportAiProviders'
import {
    DEFAULT_STRICT_TEMPLATE_POLICY,
    DEFAULT_TEMPLATE_MODE,
    getStrictTemplatePolicies,
    normalizeRequiredAnchors,
    normalizeReportTypeTemplateSettings,
    normalizeRequiredPlaceholders,
    STRICT_TEMPLATE_POLICY_NONE,
    TEMPLATE_MODE_DOCX_LOCKED,
    TEMPLATE_MODE_MARKDOWN,
} from '@/lib/reportTemplatePolicies'
import { isTemplateLibraryTemplate } from '@/lib/templateLibrary'
import { FCA_LANGUAGE_MANIFEST } from '@/lib/fcaLanguageManifest'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const DEFAULT_REPORT_TYPE = {
    id: 'general-progress',
    name: 'General Progress',
    description: 'Default report template for general progress reporting.',
    templateId: null,
    templateMode: DEFAULT_TEMPLATE_MODE,
    strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
    requiredPlaceholders: [],
    requiredAnchors: [],
    isActive: true,
}

const OTF6_REPORT_TYPE = {
    id: 'otf6-initial-occupational-therapy-assessment',
    name: 'OTF6 Initial Occupational Therapy Assessment',
    description: 'Agent-ready report type for OTF6 initial occupational therapy assessment templates.',
    templateId: null,
    templateMode: DEFAULT_TEMPLATE_MODE,
    strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
    requiredPlaceholders: [],
    requiredAnchors: [],
    isActive: true,
}

const NDIS_FCA_REPORT_TYPE = {
    id: 'ndis-functional-capacity-assessment',
    name: 'NDIS - Functional Capacity Assessment',
    description: 'Guided interactive report builder for NDIS Functional Capacity Assessments with intelligent step-by-step guidance.',
    templateId: null,
    templateMode: DEFAULT_TEMPLATE_MODE,
    strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
    requiredPlaceholders: [],
    requiredAnchors: [],
    isActive: true,
}

const DEFAULT_REPORT_TYPES = [DEFAULT_REPORT_TYPE, OTF6_REPORT_TYPE, NDIS_FCA_REPORT_TYPE]

const FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT = [
    'You are an expert occupational therapist writing FCA report sections for NDIS plan review.',
    'Use only the supplied participant evidence; approved language stems are loose style guidance, never facts.',
    'Do not invent diagnoses, scores, dates, medications, incidents, support hours, or assessment findings.',
    'Write in professional Australian clinical English: specific, measured, readable, and grounded in real-world function.',
    'Aim for about {{MIN_WORDS}} words, but evidence takes priority over length; never pad or repeat content to reach a target.',
    'The report shell supplies the cover page and starts every numbered section on a new A4 page. Do not add a cover page, a second title, page-break markup, or a horizontal rule yourself.',
].join(' ')

const FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT = [
    'Section: {{SECTION_TITLE}}',
    '',
    'Participant: {{PATIENT_NAME}}',
    '',
    'Practice: {{PRACTICE_NAME}}',
    '',
    'Evidence:',
    '- {{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}',
    '',
    'Approved language stems (style guidance only):',
    '- {{APPROVED_SNIPPETS_OR_NONE}}',
    '',
    'Output requirements: link each relevant functional impact to practical support implications; attribute sources only as specifically as the evidence permits.',
    'Evidence may include [Evidence source: ...] labels. Use these to distinguish input categories, but do not copy the labels into the report or treat them as proof of who observed or said something.',
    'Write in the assessing OT’s clinical voice. Use first person for the OT’s assessment or observations only when the evidence explicitly identifies them; otherwise attribute reports to the named source when available and never invent a speaker.',
    'Do not claim direct observation, a formal assessment, family or support-worker report, or a clinical-record finding unless the evidence identifies that source.',
    'Separate current supports from requested supports. State exact hours and schedules only when the evidence supplies them. Include standardised measures only when instrument and result are explicitly documented; preserve scores and comparisons exactly.',
    'Boxed callouts: open a blockquote with [!summary], [!evidence], [!finding], [!recommendation] or [!opinion]; the system guidance says when each applies. Put the lead-in label in bold at the start of the box, and keep tables and lists outside it.',
	'Keep the section title as the main heading and use the provided topic headings as level-three headings when supported by evidence. Format the opening executive-summary recommendation as a short standalone callout; use concise lists or tables when they improve scanning. State each finding once, and avoid stock phrases, repetition, filler, template notices, and raw context dumps.',
	'Layout: the template supplies the cover page and the report assembler starts every numbered section on a new A4 page. Do not add a cover page, duplicate title, page-break markup, or "---" separators to the section body.',
].join('\n')

const FCA_SECTION_DEFAULTS = [
    { id: 'executive-summary', title: 'Executive Summary', defaultWords: 800 },
    { id: 'referral-purpose', title: 'Referral Context and Report Purpose', defaultWords: 330 },
    { id: 'participant-context', title: 'Participant Context and Living Situation', defaultWords: 420 },
    { id: 'medical-background', title: 'Clinical Background and Relevant History', defaultWords: 540 },
    { id: 'change-of-circumstances', title: 'Change of Circumstances Since the Last Plan Review', defaultWords: 420 },
    { id: 'falls-injury-history', title: 'Falls and Injury History', defaultWords: 420 },
    { id: 'current-functioning', title: 'Current Functional Presentation', defaultWords: 660 },
    { id: 'adl-personal-care', title: 'Personal Care and Activities of Daily Living', defaultWords: 660 },
    { id: 'domestic-community', title: 'Domestic Function and Community Participation', defaultWords: 570 },
    { id: 'overnight-sleep', title: 'Sleep, Overnight Needs and Wellbeing', defaultWords: 390 },
    { id: 'assistive-technology', title: 'Assistive Technology and Environmental Supports', defaultWords: 420 },
    { id: 'risk-safeguarding', title: 'Risk Profile and Safeguarding Considerations', defaultWords: 540 },
    { id: 'restrictive-practice', title: 'Restrictive Practice Considerations', defaultWords: 330 },
    { id: 'support-worker-training', title: 'Capability and Training Requirements for Support Workers', defaultWords: 330 },
    { id: 'standardised-assessment-summary', title: 'Assessment Findings and Clinical Interpretation', defaultWords: 420 },
    { id: 'goals-outcomes', title: 'Goals and Expected Outcomes', defaultWords: 390 },
    { id: 'alternatives-considered', title: 'Consideration of Alternatives', defaultWords: 420 },
    { id: 'recommendations-funding', title: 'Recommendations and Funding Rationale', defaultWords: 780 },
    { id: 'rationale-conclusion', title: 'Conclusion and Review Recommendations', defaultWords: 360 },
]

const DEFAULT_STRICT_TEMPLATE_POLICIES = getStrictTemplatePolicies()

const DEFAULT_CONFIG = {
    defaultReportTypeId: DEFAULT_REPORT_TYPE.id,
    includeSourceNotesByDefault: true,
    autoSaveDrafts: true,
    requireTemplateForGeneration: false,
    aiProvider: DEFAULT_REPORT_AI_PROVIDER,
    aiModelTier: DEFAULT_REPORT_AI_TIER,
    providerModels: normalizeReportAiProviderModels(DEFAULT_REPORT_AI_PROVIDER_MODELS),
}

const MODEL_TIER_LABELS = {
    flagship: 'Flagship',
    balanced: 'Balanced',
    value: 'Value',
}

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const REPORT_TABLE_SURFACE_CLASS = 'report-template-surface'
const REPORT_EDITOR_A4_SURFACE_CLASS = 'template-editor-a4-surface'
const TEMPLATE_IMAGE_MIN_WIDTH = 120

const REPORT_DOCUMENT_CLASSES = [
    'mx-auto max-w-[816px] rounded-lg border border-stone-200 bg-white px-10 py-8 shadow-sm',
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
    '[&_img]:my-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:shadow-sm',
    '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[0.95em] [&_table]:leading-6',
    '[&_th]:border [&_th]:border-stone-300 [&_th]:bg-stone-100 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
    '[&_td]:border [&_td]:border-stone-300 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
    '[&_thead]:bg-stone-100',
    '[&_hr]:my-6 [&_hr]:border-stone-200',
].join(' ')

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

// Word XML fragments (e.g. <w:tab .../>) can leak in from DOCX conversion; they are never valid template content.
function stripWordXmlArtifacts(value) {
    const source = String(value || '')
    if (!source) {
        return ''
    }

    return source
        .replace(/&lt;\/?[A-Za-z][\w.-]*:[A-Za-z][\w.-]*(?:\s[^<>]*?)?\/?&gt;/g, '')
        .replace(/<\/?[A-Za-z][\w.-]*:[A-Za-z][\w.-]*(?:\s[^<>]*?)?\/?>/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
}

function countTemplateStructure(markdown) {
    const source = String(markdown || '')
    const fallback = {
        headings: (source.match(/^#{1,6} /gm) || []).length,
        tables: (source.match(/<table\b/gi) || []).length,
        blocks: source.split(/\n{2,}/).filter((block) => block.trim()).length,
    }

    if (!source.trim() || typeof DOMParser === 'undefined') {
        return fallback
    }

    try {
        const rendered = markdownToReportHtml(source)
        const parsed = new DOMParser().parseFromString(`<div>${rendered}</div>`, 'text/html')
        const root = parsed.body.firstElementChild
        if (!root) {
            return fallback
        }

        const meaningfulBlocks = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,hr,img'))
            .filter((element) => {
                const tagName = String(element?.tagName || '').toUpperCase()
                if (tagName === 'TABLE' || tagName === 'HR' || tagName === 'IMG') {
                    return true
                }
                return normalizeReportText(element?.textContent || '').trim().length > 0
            }).length

        return {
            headings: Math.max(fallback.headings, root.querySelectorAll('h1,h2,h3,h4,h5,h6').length),
            tables: Math.max(fallback.tables, root.querySelectorAll('table').length),
            blocks: Math.max(fallback.blocks, meaningfulBlocks),
        }
    } catch {
        return fallback
    }
}

function markdownToReportHtml(markdown) {
    const source = String(markdown || '').replace(/\r\n/g, '\n').trim()

    if (!source) {
        return ''
    }

    try {
        return String(remark().use(remarkReportCallouts).use(remarkHtml, { sanitize: false }).processSync(source))
    } catch {
        return `<p>${escapeHtml(source).replace(/\n/g, '<br />')}</p>`
    }
}

function normalizeReportText(value) {
    return String(value || '').replace(/\u00a0/g, ' ')
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
        // A wrapper such as the cover's centred div holds block children (paragraphs, callouts).
        // Serializing those as inline text would collapse the cover into one paragraph on save.
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
        return content ? `${content}\n\n` : ''
    }

    if (tagName === 'TABLE') {
        // Preserve full table HTML so DOCX-derived table structure is retained in editable templates.
        return `${node.outerHTML}\n\n`
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

    if (tagName === 'HR') {
        return '---\n\n'
    }

    if (tagName === 'IMG') {
        return `${node.outerHTML}\n\n`
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

function base64ToUtf8(base64Value) {
    const normalized = String(base64Value || '').trim()
    if (!normalized) return ''

    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
}

function utf8ToBase64(textValue) {
    const bytes = new TextEncoder().encode(String(textValue || ''))
    let binary = ''
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index])
    }
    return btoa(binary)
}

function sanitizeHtmlAttribute(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function applyHeaderImageClass(imageElement) {
    if (!imageElement || typeof imageElement.classList === 'undefined') {
        return
    }

    imageElement.classList.add('template-header-image')
}

function getFirstMeaningfulChildNode(root) {
    if (!root || typeof Node === 'undefined') {
        return null
    }

    for (const child of Array.from(root.childNodes || [])) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (normalizeReportText(child.textContent || '').trim()) {
                return child
            }
            continue
        }

        if (child.nodeType === Node.ELEMENT_NODE) {
            return child
        }
    }

    return null
}

function getLeadingImageNode(root) {
    if (!root || typeof Node === 'undefined') {
        return null
    }

    for (const child of Array.from(root.childNodes || [])) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (normalizeReportText(child.textContent || '').trim()) {
                return null
            }
            continue
        }

        if (child.nodeType !== Node.ELEMENT_NODE) {
            continue
        }

        const tagName = child.tagName.toUpperCase()
        if (tagName === 'IMG') {
            return child
        }

        const textContent = normalizeReportText(child.textContent || '').trim()
        const nestedImage = child.querySelector('img')
        if (nestedImage && textContent === '') {
            return nestedImage
        }

        return null
    }

    return null
}

function ensureTemplateHeaderImageLock(root, options = {}) {
    const { initializeFromLeading = false } = options
    if (!root) {
        return null
    }

    let lockedHeaderImage = root.querySelector('img[data-template-header-locked="true"]')
    if (!lockedHeaderImage && initializeFromLeading) {
        lockedHeaderImage = getLeadingImageNode(root)
    }

    if (!lockedHeaderImage) {
        return null
    }

    lockedHeaderImage.setAttribute('data-template-header-locked', 'true')
    lockedHeaderImage.classList.add('template-header-image')
    lockedHeaderImage.classList.remove('template-inline-image')

    const firstMeaningfulChild = getFirstMeaningfulChildNode(root)
    if (firstMeaningfulChild && firstMeaningfulChild !== lockedHeaderImage) {
        root.insertBefore(lockedHeaderImage, firstMeaningfulChild)
    } else if (!firstMeaningfulChild && root.firstChild !== lockedHeaderImage) {
        root.appendChild(lockedHeaderImage)
    }

    return lockedHeaderImage
}

function promoteLeadingImagesToHeader(root) {
    if (!root || typeof Node === 'undefined') {
        return
    }

    let headerImageApplied = false

    for (const child of Array.from(root.childNodes || [])) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (normalizeReportText(child.textContent || '').trim()) {
                break
            }
            continue
        }

        if (child.nodeType !== Node.ELEMENT_NODE) {
            continue
        }

        const tagName = child.tagName.toUpperCase()
        if (tagName === 'IMG') {
            if (!headerImageApplied) {
                applyHeaderImageClass(child)
                headerImageApplied = true
            }
            break
        }

        const textContent = normalizeReportText(child.textContent || '').trim()
        const images = Array.from(child.querySelectorAll('img'))
        if (images.length > 0 && textContent === '') {
            if (!headerImageApplied) {
                applyHeaderImageClass(images[0])
                headerImageApplied = true
            }
            break
        }

        break
    }
}

function getTableRowColumnCount(row) {
    if (!row) {
        return 0
    }

    return Array.from(row.children || [])
        .filter((cell) => {
            const tagName = String(cell?.tagName || '').toUpperCase()
            return tagName === 'TD' || tagName === 'TH'
        })
        .reduce((total, cell) => {
            const rawColSpan = Number.parseInt(String(cell.getAttribute('colspan') || '1'), 10)
            const safeColSpan = Number.isFinite(rawColSpan) && rawColSpan > 0 ? rawColSpan : 1
            return total + safeColSpan
        }, 0)
}

function normalizeMixedColumnTables(root) {
    if (!root) {
        return
    }

    const tables = Array.from(root.querySelectorAll('table'))
    for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'))
        if (rows.length === 0) {
            continue
        }

        const counts = rows.map((row) => getTableRowColumnCount(row)).filter((count) => count > 0)
        if (counts.length === 0) {
            continue
        }

        const maxColumnCount = Math.max(...counts)
        const minColumnCount = Math.min(...counts)
        const hasMixedColumns = maxColumnCount > minColumnCount
        if (!hasMixedColumns || maxColumnCount <= 1) {
            continue
        }

        const currentLayout = String(table.style.tableLayout || '').trim().toLowerCase()
        if (currentLayout === 'fixed') {
            table.style.tableLayout = 'auto'
        }

        for (const row of rows) {
            const cells = Array.from(row.children || []).filter((cell) => {
                const tagName = String(cell?.tagName || '').toUpperCase()
                return tagName === 'TD' || tagName === 'TH'
            })

            if (cells.length === 0) {
                continue
            }

            const currentCount = getTableRowColumnCount(row)
            if (currentCount >= maxColumnCount) {
                continue
            }

            const trailingCell = cells[cells.length - 1]
            const rawColSpan = Number.parseInt(String(trailingCell.getAttribute('colspan') || '1'), 10)
            const safeColSpan = Number.isFinite(rawColSpan) && rawColSpan > 0 ? rawColSpan : 1
            trailingCell.setAttribute('colspan', String(safeColSpan + (maxColumnCount - currentCount)))
        }
    }
}

function decorateTemplatePlaceholderTokens(root) {
    if (!root || typeof NodeFilter === 'undefined') {
        return
    }

    const documentRef = root.ownerDocument
    const textNodes = []
    const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement
            if (!parent || parent.closest('.template-placeholder-token')) {
                return NodeFilter.FILTER_REJECT
            }

            return /\{\{[^{}\n]+\}\}/.test(node.textContent || '')
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT
        },
    })

    while (walker.nextNode()) {
        textNodes.push(walker.currentNode)
    }

    for (const textNode of textNodes) {
        const fragment = documentRef.createDocumentFragment()
        const source = textNode.textContent || ''
        let cursor = 0

        source.replace(/\{\{[^{}\n]+\}\}/g, (match, offset) => {
            if (offset > cursor) {
                fragment.appendChild(documentRef.createTextNode(source.slice(cursor, offset)))
            }

            const token = documentRef.createElement('span')
            token.className = 'template-placeholder-token'
            token.textContent = match
            token.title = match
            fragment.appendChild(token)
            cursor = offset + match.length
            return match
        })

        if (cursor < source.length) {
            fragment.appendChild(documentRef.createTextNode(source.slice(cursor)))
        }

        textNode.replaceWith(fragment)
    }
}

function decorateLeadingImagesInHtml(html) {
    const source = String(html || '').trim()
    if (!source || typeof DOMParser === 'undefined') {
        return source
    }

    const parsed = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html')
    const root = parsed.body.firstElementChild
    if (!root) {
        return source
    }

    normalizeMixedColumnTables(root)
    decorateTemplatePlaceholderTokens(root)
    promoteLeadingImagesToHeader(root)
    return root.innerHTML
}

function insertHtmlAtSelection(html) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
        return null
    }

    const range = selection.getRangeAt(0)
    range.deleteContents()

    const fragment = range.createContextualFragment(html)
    const lastNode = fragment.lastChild
    range.insertNode(fragment)

    if (lastNode) {
        range.setStartAfter(lastNode)
        range.setEndAfter(lastNode)
        selection.removeAllRanges()
        selection.addRange(range)
    }

    return lastNode instanceof Element ? lastNode : null
}

function removeTemplateImageInsertAnchors(editor) {
    if (!editor) return
    const anchors = Array.from(editor.querySelectorAll('span[data-template-image-anchor="true"]'))
    for (const anchor of anchors) {
        anchor.remove()
    }
}

function insertTemplateImageAnchor(editor) {
    if (!editor || typeof window === 'undefined' || typeof document === 'undefined') {
        return null
    }

    removeTemplateImageInsertAnchors(editor)

    const selection = window.getSelection()
    let range = null

    if (selection && selection.rangeCount > 0) {
        const currentRange = selection.getRangeAt(0)
        if (currentRange.startContainer === editor || editor.contains(currentRange.startContainer)) {
            range = currentRange.cloneRange()
        }
    }

    if (!range) {
        range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
    }

    const anchor = document.createElement('span')
    anchor.setAttribute('data-template-image-anchor', 'true')
    anchor.setAttribute('contenteditable', 'false')
    anchor.style.display = 'inline-block'
    anchor.style.width = '0'
    anchor.style.height = '0'
    anchor.style.overflow = 'hidden'

    const editorEndRange = document.createRange()
    editorEndRange.selectNodeContents(editor)
    editorEndRange.collapse(false)
    const isAtEditorEnd = range.collapsed
        && range.compareBoundaryPoints(Range.START_TO_END, editorEndRange) === 0

    if (isAtEditorEnd) {
        const trailingParagraph = document.createElement('p')
        trailingParagraph.appendChild(anchor)
        editor.appendChild(trailingParagraph)
    } else {
        range.insertNode(anchor)
    }

    const afterAnchor = document.createRange()
    afterAnchor.setStartAfter(anchor)
    afterAnchor.setEndAfter(anchor)
    if (selection) {
        selection.removeAllRanges()
        selection.addRange(afterAnchor)
    }

    return anchor
}

function getNodePathWithinRoot(root, node) {
    if (!root || !node) {
        return null
    }

    const path = []
    let current = node

    while (current && current !== root) {
        const parent = current.parentNode
        if (!parent) {
            return null
        }

        const index = Array.prototype.indexOf.call(parent.childNodes, current)
        if (index < 0) {
            return null
        }

        path.unshift(index)
        current = parent
    }

    return current === root ? path : null
}

function getNodeFromPathWithinRoot(root, path) {
    if (!root || !Array.isArray(path)) {
        return null
    }

    let current = root
    for (const index of path) {
        if (!current?.childNodes || index < 0 || index >= current.childNodes.length) {
            return null
        }
        current = current.childNodes[index]
    }

    return current
}

function clampRangeOffset(node, offset) {
    const nextOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
    if (!node) {
        return 0
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length || 0
        return Math.min(nextOffset, length)
    }

    return Math.min(nextOffset, node.childNodes?.length || 0)
}

function snapshotEditorRange(editor, range) {
    if (!editor || !range) {
        return null
    }

    if ((range.startContainer !== editor && !editor.contains(range.startContainer)) || (range.endContainer !== editor && !editor.contains(range.endContainer))) {
        return null
    }

    const startPath = getNodePathWithinRoot(editor, range.startContainer)
    const endPath = getNodePathWithinRoot(editor, range.endContainer)
    if (!startPath || !endPath) {
        return null
    }

    return {
        startPath,
        startOffset: range.startOffset,
        endPath,
        endOffset: range.endOffset,
        collapsed: range.collapsed,
    }
}

function restoreEditorRangeFromSnapshot(editor, snapshot) {
    if (!editor || !snapshot || typeof document === 'undefined') {
        return null
    }

    const startNode = getNodeFromPathWithinRoot(editor, snapshot.startPath)
    const endNode = getNodeFromPathWithinRoot(editor, snapshot.endPath)
    if (!startNode || !endNode) {
        return null
    }

    const nextRange = document.createRange()
    const startOffset = clampRangeOffset(startNode, snapshot.startOffset)
    const endOffset = clampRangeOffset(endNode, snapshot.endOffset)

    nextRange.setStart(startNode, startOffset)
    if (snapshot.collapsed) {
        nextRange.collapse(true)
    } else {
        nextRange.setEnd(endNode, endOffset)
    }

    return nextRange
}

function isSelectionAtEditorStart(editor) {
    if (!editor || typeof window === 'undefined' || typeof document === 'undefined') {
        return false
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
        return false
    }

    const range = selection.getRangeAt(0)
    if (range.startContainer !== editor && !editor.contains(range.startContainer)) {
        return false
    }

    const testRange = document.createRange()
    testRange.selectNodeContents(editor)
    testRange.setEnd(range.startContainer, range.startOffset)

    return testRange.toString().trim().length === 0
}

function buildTemplateImageMarkup({ src, alt, isHeader = false }) {
    const className = isHeader ? 'template-header-image' : 'template-inline-image'
    return `<img src="${src}" alt="${alt}" class="${className}" />`
}

function collapseEmbeddedImageDataForSource(markdown) {
    const source = String(markdown || '')
    if (!source) {
        return {
            sourceText: '',
            tokenMap: new Map(),
        }
    }

    const tokenMap = new Map()
    let nextIndex = 1

    const registerDataUrl = (dataUrl) => {
        const existing = Array.from(tokenMap.entries()).find(([, value]) => value === dataUrl)
        if (existing) {
            return existing[0]
        }

        const token = `embedded-image-${nextIndex}`
        nextIndex += 1
        tokenMap.set(token, dataUrl)
        return token
    }

    let collapsed = source.replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/gi, (full, alt, dataUrl) => {
        const token = registerDataUrl(String(dataUrl || ''))
        return `![${String(alt || '')}](image-token:${token})`
    })

    collapsed = collapsed.replace(/<img\b([^>]*?)\bsrc=(['"])(data:image\/[^'"]+)\2([^>]*)>/gi, (full, beforeSrc, quote, dataUrl, afterSrc) => {
        const token = registerDataUrl(String(dataUrl || ''))
        return `<img${String(beforeSrc || '')}src=${quote}image-token:${token}${quote}${String(afterSrc || '')}>`
    })

    return {
        sourceText: collapsed,
        tokenMap,
    }
}

function expandEmbeddedImageTokensFromSource(sourceText, tokenMap) {
    const source = String(sourceText || '')
    if (!source || !(tokenMap instanceof Map) || tokenMap.size === 0) {
        return source
    }

    return source.replace(/image-token:([A-Za-z0-9_-]+)/g, (full, token) => {
        const replacement = tokenMap.get(String(token || ''))
        return replacement ? String(replacement) : full
    })
}

function getTemplateImageCurrentWidth(imageElement) {
    if (!imageElement) {
        return 0
    }

    const inlineWidth = Number.parseFloat(String(imageElement.style.width || '').replace(/px$/i, ''))
    if (Number.isFinite(inlineWidth) && inlineWidth > 0) {
        return inlineWidth
    }

    const measuredWidth = imageElement.getBoundingClientRect?.().width
    if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
        return measuredWidth
    }

    const naturalWidth = Number(imageElement.naturalWidth || 0)
    return Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 0
}

function getTemplateImageSelectionBox(imageElement, containerElement) {
    if (!imageElement || !containerElement) {
        return null
    }

    const imageRect = imageElement.getBoundingClientRect?.()
    const containerRect = containerElement.getBoundingClientRect?.()
    if (!imageRect || !containerRect) {
        return null
    }

    return {
        left: imageRect.left - containerRect.left,
        top: imageRect.top - containerRect.top,
        width: imageRect.width,
        height: imageRect.height,
    }
}

function applyTemplateImageAlignment(imageElement, alignment) {
    if (!imageElement) {
        return
    }

    imageElement.style.display = 'block'

    if (alignment === 'center') {
        imageElement.style.marginLeft = 'auto'
        imageElement.style.marginRight = 'auto'
        return
    }

    if (alignment === 'right') {
        imageElement.style.marginLeft = 'auto'
        imageElement.style.marginRight = '0px'
        return
    }

    imageElement.style.marginLeft = '0px'
    imageElement.style.marginRight = 'auto'
}

function isEditableTemplate(template) {
    const mimeType = String(template?.mimeType || '').trim().toLowerCase()
    return mimeType.startsWith('text/') || mimeType === 'application/json'
}

function isDocxTemplate(template) {
    const mimeType = String(template?.mimeType || '').trim().toLowerCase()
    return mimeType === DOCX_MIME_TYPE
}

function parseProviderTierSelection(value) {
    const raw = String(value || '').trim().toLowerCase()
    const [providerRaw, tierRaw] = raw.split(':')
    return {
        provider: normalizeReportAiProvider(providerRaw),
        tier: normalizeReportAiTier(tierRaw),
    }
}

function generateId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeFcaPromptConfig(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const sectionMinWords = source.sectionMinWords && typeof source.sectionMinWords === 'object' && !Array.isArray(source.sectionMinWords)
        ? Object.fromEntries(Object.entries(source.sectionMinWords).map(([key, value]) => {
            const parsed = Number.parseInt(String(value || '').trim(), 10)
            return [String(key || '').trim(), Number.isFinite(parsed) && parsed > 0 ? parsed : null]
        }).filter(([, value]) => value !== null))
        : {}
    const globalMinWords = Number.parseInt(String(source.minWords || source.minimumWords || '').trim(), 10)
    return {
        systemPromptTemplate: String(source.systemPromptTemplate || '').trim() || FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT,
        userPromptTemplate: String(source.userPromptTemplate || '').trim() || FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT,
        minWords: Number.isFinite(globalMinWords) && globalMinWords > 0 ? globalMinWords : null,
        sectionMinWords: Object.keys(sectionMinWords).length > 0 ? sectionMinWords : {},
    }
}

function normalizeReportTypeConfig(input, reportTypeId = '') {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const normalized = {}

    if (String(reportTypeId || '').trim() === NDIS_FCA_REPORT_TYPE.id) {
        normalized.fcaPromptConfig = normalizeFcaPromptConfig(source.fcaPromptConfig)
    }

    return normalized
}

function normalizeSettings(input) {
    const candidate = input && typeof input === 'object' ? input : {}
    const policyOptions = Array.isArray(candidate.strictTemplatePolicies) && candidate.strictTemplatePolicies.length > 0
        ? candidate.strictTemplatePolicies
        : DEFAULT_STRICT_TEMPLATE_POLICIES

    const reportTypesRaw = Array.isArray(candidate.reportTypes) ? candidate.reportTypes : []
    const reportTypes = reportTypesRaw.length > 0
        ? reportTypesRaw.map((item) => {
            const templateSettings = normalizeReportTypeTemplateSettings(item)
            const id = String(item?.id || '').trim() || generateId('report-type')
            return {
                id,
                name: String(item?.name || '').trim() || 'Untitled Report Type',
                description: String(item?.description || '').trim(),
                templateId: String(item?.templateId || '').trim() || null,
                templateMode: templateSettings.templateMode,
                strictTemplatePolicy: templateSettings.strictTemplatePolicy,
                requiredPlaceholders: normalizeRequiredPlaceholders(templateSettings.requiredPlaceholders),
                requiredAnchors: normalizeRequiredAnchors(templateSettings.requiredAnchors),
                config: normalizeReportTypeConfig(item?.config || item?.options, id),
                isActive: item?.isActive !== false,
            }
        })
        : DEFAULT_REPORT_TYPES.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            templateId: item.templateId,
            templateMode: item.templateMode,
            strictTemplatePolicy: item.strictTemplatePolicy,
            requiredPlaceholders: normalizeRequiredPlaceholders(item.requiredPlaceholders),
            requiredAnchors: normalizeRequiredAnchors(item.requiredAnchors),
            config: normalizeReportTypeConfig(item?.config || item?.options, item.id),
            isActive: item.isActive !== false,
        }))

    if (!reportTypes.some((item) => item.id === OTF6_REPORT_TYPE.id)) {
        reportTypes.push({
            id: OTF6_REPORT_TYPE.id,
            name: OTF6_REPORT_TYPE.name,
            description: OTF6_REPORT_TYPE.description,
            templateId: OTF6_REPORT_TYPE.templateId,
            templateMode: OTF6_REPORT_TYPE.templateMode,
            strictTemplatePolicy: OTF6_REPORT_TYPE.strictTemplatePolicy,
            requiredPlaceholders: normalizeRequiredPlaceholders(OTF6_REPORT_TYPE.requiredPlaceholders),
            requiredAnchors: normalizeRequiredAnchors(OTF6_REPORT_TYPE.requiredAnchors),
            config: normalizeReportTypeConfig(OTF6_REPORT_TYPE?.config || OTF6_REPORT_TYPE?.options, OTF6_REPORT_TYPE.id),
            isActive: OTF6_REPORT_TYPE.isActive !== false,
        })
    }

    if (!reportTypes.some((item) => item.id === NDIS_FCA_REPORT_TYPE.id)) {
        reportTypes.push({
            id: NDIS_FCA_REPORT_TYPE.id,
            name: NDIS_FCA_REPORT_TYPE.name,
            description: NDIS_FCA_REPORT_TYPE.description,
            templateId: NDIS_FCA_REPORT_TYPE.templateId,
            templateMode: NDIS_FCA_REPORT_TYPE.templateMode,
            strictTemplatePolicy: NDIS_FCA_REPORT_TYPE.strictTemplatePolicy,
            requiredPlaceholders: normalizeRequiredPlaceholders(NDIS_FCA_REPORT_TYPE.requiredPlaceholders),
            requiredAnchors: normalizeRequiredAnchors(NDIS_FCA_REPORT_TYPE.requiredAnchors),
            config: normalizeReportTypeConfig(NDIS_FCA_REPORT_TYPE?.config || NDIS_FCA_REPORT_TYPE?.options, NDIS_FCA_REPORT_TYPE.id),
            isActive: NDIS_FCA_REPORT_TYPE.isActive !== false,
        })
    }

    const templatesRaw = Array.isArray(candidate.templates) ? candidate.templates : []
    const templates = templatesRaw.map((item) => ({
        id: String(item?.id || '').trim() || generateId('template'),
        name: String(item?.name || '').trim() || String(item?.fileName || '').trim() || 'Template',
        fileName: String(item?.fileName || '').trim() || 'template.txt',
        mimeType: String(item?.mimeType || '').trim() || 'application/octet-stream',
        size: Number.parseInt(String(item?.size || '0'), 10) || 0,
        contentBase64: String(item?.contentBase64 || '').trim(),
        uploadedAt: String(item?.uploadedAt || '').trim() || new Date().toISOString(),
        source: String(item?.source || '').trim(),
        relativePath: String(item?.relativePath || '').trim(),
    }))

    const knownTypeIds = new Set(reportTypes.map((item) => item.id))
    const requestedDefault = String(candidate?.config?.defaultReportTypeId || '').trim()
    const legacyGateway = String(candidate?.config?.aiGateway || '').trim().toLowerCase()
    const legacyVendor = String(candidate?.config?.aimlVendor || '').trim().toLowerCase()
    const inferredLegacyProvider = legacyGateway === 'aimlapi'
        ? (legacyVendor.includes('claude') || legacyVendor.includes('anthropic')
            ? 'claude'
            : legacyVendor.includes('gemini') || legacyVendor.includes('google')
                ? 'gemini'
                : 'openai')
        : 'openai'
    const providerModels = normalizeReportAiProviderModels(candidate?.config?.providerModels || DEFAULT_CONFIG.providerModels)
    const legacyOpenAiModel = String(candidate?.config?.openAiModel || '').trim()
    if (legacyOpenAiModel) {
        providerModels.openai.balanced = legacyOpenAiModel
    }

    return {
        strictTemplatePolicies: policyOptions,
        reportTypes,
        templates,
        config: {
            defaultReportTypeId: knownTypeIds.has(requestedDefault) ? requestedDefault : reportTypes[0].id,
            includeSourceNotesByDefault: candidate?.config?.includeSourceNotesByDefault !== false,
            autoSaveDrafts: candidate?.config?.autoSaveDrafts !== false,
            requireTemplateForGeneration: candidate?.config?.requireTemplateForGeneration === true,
            aiProvider: normalizeReportAiProvider(candidate?.config?.aiProvider || inferredLegacyProvider || DEFAULT_CONFIG.aiProvider),
            aiModelTier: normalizeReportAiTier(candidate?.config?.aiModelTier || DEFAULT_CONFIG.aiModelTier),
            providerModels,
            providerDetails: String(candidate?.config?.providerDetails || '').trim(),
            reportHeaderText: String(candidate?.config?.reportHeaderText || '').trim(),
            reportHeaderLogoUrl: String(candidate?.config?.reportHeaderLogoUrl || '').trim(),
            daysHoursAvailable: String(candidate?.config?.daysHoursAvailable || '').trim(),
            hasProviderApiKeys: candidate?.config?.hasProviderApiKeys && typeof candidate.config.hasProviderApiKeys === 'object'
                ? candidate.config.hasProviderApiKeys
                : { openai: false, claude: false, gemini: false },
        },
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })
}

function formatBytes(value) {
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function buildImageAltFromFileName(fileName) {
    const base = String(fileName || '').replace(/\.[^/.]+$/, '')
    return base
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function serializePlaceholderCsv(value) {
    const placeholders = normalizeRequiredPlaceholders(value)
    return placeholders.join(', ')
}

function parsePlaceholderCsv(value) {
    const source = String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    return normalizeRequiredPlaceholders(source)
}

function serializeAnchorCsv(value) {
    return normalizeRequiredAnchors(value).join(', ')
}

function parseAnchorCsv(value) {
    const source = String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    return normalizeRequiredAnchors(source)
}

export default function ReportSettingsPage() {
    const router = useRouter()
    const templateEditorCanvasRef = useRef(null)
    const templateEditorRef = useRef(null)
    const templateEditorSelectionRangeRef = useRef(null)
    const templateEditorSelectionSnapshotRef = useRef(null)
    const templateImagePickerRef = useRef(null)
    const templateImageResizeHandleRef = useRef(null)
    const selectedTemplateImageRef = useRef(null)
    const selectedTemplateImageDragCleanupRef = useRef(null)
    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [hasSuperAdminAccess, setHasSuperAdminAccess] = useState(false)
    const [activeDomain, setActiveDomain] = useState('')
    const [settings, setSettings] = useState(() => normalizeSettings({}))
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [validatingTemplates, setValidatingTemplates] = useState(false)
    const [loadingTemplateLibrary, setLoadingTemplateLibrary] = useState(false)
    const [templateLibraryFiles, setTemplateLibraryFiles] = useState([])
    const [templateLibraryPath, setTemplateLibraryPath] = useState('')
    const [isTemplateLibraryModalOpen, setIsTemplateLibraryModalOpen] = useState(false)
    const [isImportMenuOpen, setIsImportMenuOpen] = useState(false)
    const [fcaPromptModalTypeId, setFcaPromptModalTypeId] = useState('')
    const [fcaPromptModalTab, setFcaPromptModalTab] = useState('templates')
    const [statusTone, setStatusTone] = useState('info')
    const [statusMessage, setStatusMessage] = useState('')
    const [editingTemplateId, setEditingTemplateId] = useState('')
    const [templateEditorName, setTemplateEditorName] = useState('')
    const [templateEditorContent, setTemplateEditorContent] = useState('')
    const [templateEditorSourceContent, setTemplateEditorSourceContent] = useState('')
    const [templateEditorMode, setTemplateEditorMode] = useState('visual')
    const [templateEditorError, setTemplateEditorError] = useState('')
    const [templateEditorSaving, setTemplateEditorSaving] = useState(false)
    const [templateEditorSyncKey, setTemplateEditorSyncKey] = useState(0)
    const [templateImagePickerOpen, setTemplateImagePickerOpen] = useState(false)
    const [templateImagePickerLoading, setTemplateImagePickerLoading] = useState(false)
    const [templateImagePickerError, setTemplateImagePickerError] = useState('')
    const [templateImageLibraryItems, setTemplateImageLibraryItems] = useState([])
    const [templateImageLibraryGroups, setTemplateImageLibraryGroups] = useState([])
    const [docxPreviewOpen, setDocxPreviewOpen] = useState(false)
    const [docxPreviewName, setDocxPreviewName] = useState('')
    const [docxPreviewHtml, setDocxPreviewHtml] = useState('')
    const [docxPreviewError, setDocxPreviewError] = useState('')
    const [docxPreviewLoading, setDocxPreviewLoading] = useState(false)
    const [convertingTemplateId, setConvertingTemplateId] = useState('')
    const [exportingTemplates, setExportingTemplates] = useState(false)
    const [importingTemplatePack, setImportingTemplatePack] = useState(false)
    const [pendingTemplatePackFile, setPendingTemplatePackFile] = useState(null)
    const [isImportTemplatePackConfirmOpen, setIsImportTemplatePackConfirmOpen] = useState(false)
    const templateEditorImageTokenMapRef = useRef(new Map())
    const templateEditorHydrationRef = useRef('')

    // Content that came from the live editor DOM must not trigger re-hydration, or the caret and inserted nodes are lost.
    const applyTemplateEditorContentFromDom = useCallback((markdown) => {
        const nextMarkdown = String(markdown || '')
        templateEditorHydrationRef.current = `${templateEditorSyncKey}:${decorateLeadingImagesInHtml(markdownToReportHtml(nextMarkdown))}`
        setTemplateEditorContent(nextMarkdown)
    }, [templateEditorSyncKey])

    const captureTemplateEditorSelection = useCallback(() => {
        if (typeof window === 'undefined') {
            templateEditorSelectionRangeRef.current = null
            templateEditorSelectionSnapshotRef.current = null
            return null
        }

        const editor = templateEditorRef.current
        const selection = window.getSelection()
        if (!editor || !selection || selection.rangeCount === 0) {
            templateEditorSelectionRangeRef.current = null
            templateEditorSelectionSnapshotRef.current = null
            return null
        }

        const range = selection.getRangeAt(0)
        if (range.startContainer !== editor && !editor.contains(range.startContainer)) {
            templateEditorSelectionRangeRef.current = null
            templateEditorSelectionSnapshotRef.current = null
            return null
        }

        const cloned = range.cloneRange()
        templateEditorSelectionRangeRef.current = cloned
        templateEditorSelectionSnapshotRef.current = snapshotEditorRange(editor, range)
        return cloned
    }, [])

    const restoreTemplateEditorSelection = useCallback(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return false
        }

        const editor = templateEditorRef.current
        if (!editor) {
            return false
        }

        const selection = window.getSelection()
        if (!selection) {
            return false
        }

        const savedRange = templateEditorSelectionRangeRef.current
        if (savedRange && (savedRange.startContainer === editor || editor.contains(savedRange.startContainer))) {
            selection.removeAllRanges()
            selection.addRange(savedRange)
            return true
        }

        const savedSnapshot = templateEditorSelectionSnapshotRef.current
        const restoredFromSnapshot = restoreEditorRangeFromSnapshot(editor, savedSnapshot)
        if (restoredFromSnapshot) {
            selection.removeAllRanges()
            selection.addRange(restoredFromSnapshot)
            templateEditorSelectionRangeRef.current = restoredFromSnapshot.cloneRange()
            return true
        }

        const endRange = document.createRange()
        endRange.selectNodeContents(editor)
        endRange.collapse(false)
        selection.removeAllRanges()
        selection.addRange(endRange)
        templateEditorSelectionRangeRef.current = endRange.cloneRange()
        templateEditorSelectionSnapshotRef.current = snapshotEditorRange(editor, endRange)
        return true
    }, [])

    const loadSettings = useCallback(async (domain) => {
        const scopedDomain = String(domain || '').trim().toLowerCase()
        if (!scopedDomain) {
            setSettings(normalizeSettings({}))
            return
        }

        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) {
            throw new Error('Missing admin session token')
        }

        const response = await fetch(`/api/settings/reports?domain=${encodeURIComponent(scopedDomain)}`, {
            cache: 'no-store',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load report settings')
        }

        setSettings(normalizeSettings(data?.settings || {}))
    }, [])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (!token || cancelled) {
                    if (!cancelled) router.push('/login')
                    return
                }

                const user = getCurrentUser()
                if (!user) {
                    router.push('/login')
                    return
                }

                const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
                const storedDomain = readStoredDefaultDomain()
                const { mode } = getEffectiveDomainMode(hostname, storedDomain)
                const userDomain = String(user?.domain || '').trim().toLowerCase()
                const scopedDomain = userDomain || mode

                setActiveDomain(scopedDomain)
                setHasSuperAdminAccess(String(user?.role || '').trim().toLowerCase() === 'superadmin')
                setIsAuthenticated(true)
                await loadSettings(scopedDomain)
            } catch (error) {
                if (!cancelled) {
                    setStatusTone('error')
                    setStatusMessage(error?.message || 'Failed to initialize report settings')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [loadSettings, router])

    const templateOptionGroups = useMemo(() => {
        const domainOptions = []
        const libraryOptions = []

        for (const template of settings.templates) {
            const option = { value: template.id, label: template.name }
            if (isTemplateLibraryTemplate(template)) {
                libraryOptions.push(option)
            } else {
                domainOptions.push(option)
            }
        }

        return [
            { key: 'domain', label: 'Templates', options: domainOptions },
            { key: 'library', label: 'Template Library', options: libraryOptions },
        ].filter((group) => group.options.length > 0)
    }, [settings.templates])

    const templateImageGroupSections = useMemo(() => {
        if (templateImageLibraryGroups.length > 0) {
            return templateImageLibraryGroups
                .map((group) => ({
                    ...group,
                    items: templateImageLibraryItems.filter((item) => item.group === group.key),
                }))
                .filter((group) => group.items.length > 0)
        }

        return templateImageLibraryItems.length > 0
            ? [{ key: 'all', label: 'Template Library', relativePath: '', items: templateImageLibraryItems }]
            : []
    }, [templateImageLibraryGroups, templateImageLibraryItems])

    const strictTemplatePolicyOptions = useMemo(() => {
        const options = Array.isArray(settings.strictTemplatePolicies) && settings.strictTemplatePolicies.length > 0
            ? settings.strictTemplatePolicies
            : DEFAULT_STRICT_TEMPLATE_POLICIES

        return options.map((item) => ({
            value: String(item?.key || '').trim() || STRICT_TEMPLATE_POLICY_NONE,
            label: String(item?.label || '').trim() || 'Strict policy',
            enforceDocxLocked: item?.enforceDocxLocked === true,
        }))
    }, [settings.strictTemplatePolicies])

    const reportAiPresetOptions = useMemo(() => {
        const models = normalizeReportAiProviderModels(settings.config.providerModels || DEFAULT_CONFIG.providerModels)
        const options = []

        for (const providerKey of REPORT_AI_PROVIDER_KEYS) {
            for (const tierKey of REPORT_AI_TIER_KEYS) {
                const model = String(models?.[providerKey]?.[tierKey] || '').trim()
                if (!model) continue
                options.push({
                    value: `${providerKey}:${tierKey}`,
                    provider: providerKey,
                    tier: tierKey,
                    model,
                    label: `${getReportAiProviderDisplayName(providerKey)} - ${MODEL_TIER_LABELS[tierKey] || tierKey} (${model})`,
                })
            }
        }

        return options
    }, [settings.config.providerModels])

    const hideTemplateImageResizeHandle = useCallback(() => {
        const handle = templateImageResizeHandleRef.current
        if (!handle) {
            return
        }

        handle.style.display = 'none'
    }, [])

    const clearSelectedTemplateImage = useCallback(() => {
        if (selectedTemplateImageRef.current) {
            selectedTemplateImageRef.current.classList.remove('template-editor-selected-image')
            selectedTemplateImageRef.current = null
        }
        hideTemplateImageResizeHandle()
    }, [hideTemplateImageResizeHandle])

    const updateSelectedTemplateImageBox = useCallback((imageElement = selectedTemplateImageRef.current) => {
        const container = templateEditorCanvasRef.current
        const handle = templateImageResizeHandleRef.current
        if (!imageElement || !container || !handle) {
            hideTemplateImageResizeHandle()
            return
        }

        const box = getTemplateImageSelectionBox(imageElement, container)
        if (!box) {
            hideTemplateImageResizeHandle()
            return
        }

        handle.style.display = 'block'
        handle.style.left = `${box.left + box.width - 8}px`
        handle.style.top = `${box.top + box.height - 8}px`
    }, [hideTemplateImageResizeHandle])

    const updateReportType = useCallback((id, updates) => {
        setSettings((prev) => {
            const nextTypes = prev.reportTypes.map((item) => {
                if (item.id !== id) return item
                return {
                    ...item,
                    ...updates,
                }
            })
            return {
                ...prev,
                reportTypes: nextTypes,
            }
        })
    }, [])

    const removeReportType = useCallback((id) => {
        setSettings((prev) => {
            const nextTypes = prev.reportTypes.filter((item) => item.id !== id)
            const safeTypes = nextTypes.length > 0 ? nextTypes : [DEFAULT_REPORT_TYPE]
            const typeIds = new Set(safeTypes.map((item) => item.id))
            const nextDefault = typeIds.has(prev.config.defaultReportTypeId)
                ? prev.config.defaultReportTypeId
                : safeTypes[0].id

            return {
                ...prev,
                reportTypes: safeTypes,
                config: {
                    ...prev.config,
                    defaultReportTypeId: nextDefault,
                },
            }
        })
    }, [])

    const addReportType = useCallback(() => {
        setSettings((prev) => ({
            ...prev,
            reportTypes: [
                ...prev.reportTypes,
                {
                    id: generateId('report-type'),
                    name: 'New Report Type',
                    description: '',
                    templateId: null,
                    templateMode: DEFAULT_TEMPLATE_MODE,
                    strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
                    requiredPlaceholders: [],
                    requiredAnchors: [],
                    config: {},
                    isActive: true,
                },
            ],
        }))
    }, [])

    const removeTemplate = useCallback((id) => {
        setSettings((prev) => {
            const nextTemplates = prev.templates.filter((item) => item.id !== id)
            const nextTypes = prev.reportTypes.map((item) => {
                if (item.templateId !== id) return item
                return { ...item, templateId: null }
            })

            return {
                ...prev,
                templates: nextTemplates,
                reportTypes: nextTypes,
            }
        })

        if (editingTemplateId === id) {
            setEditingTemplateId('')
            setTemplateEditorName('')
            setTemplateEditorContent('')
            setTemplateEditorError('')
        }
    }, [editingTemplateId])

    const openTemplateEditor = useCallback((template) => {
        try {
            const decoded = stripWordXmlArtifacts(base64ToUtf8(template?.contentBase64))
            clearSelectedTemplateImage()
            setTemplateImagePickerOpen(false)
            setTemplateImagePickerError('')
            setEditingTemplateId(String(template?.id || ''))
            setTemplateEditorName(String(template?.name || 'Template'))
            setTemplateEditorContent(decoded)
            setTemplateEditorSourceContent(decoded)
            setTemplateEditorMode('visual')
            setTemplateEditorError('')
            setTemplateEditorSyncKey((value) => value + 1)
        } catch {
            setEditingTemplateId('')
            setTemplateEditorName('')
            setTemplateEditorContent('')
            setTemplateEditorSourceContent('')
            setTemplateEditorMode('visual')
            setTemplateEditorError('This template cannot be decoded as text.')
            clearSelectedTemplateImage()
            setStatusTone('error')
            setStatusMessage('This template cannot be edited because it is not valid text content.')
        }
    }, [clearSelectedTemplateImage])

    const closeTemplateEditor = useCallback(() => {
        clearSelectedTemplateImage()
        removeTemplateImageInsertAnchors(templateEditorRef.current)
        setTemplateImagePickerOpen(false)
        setTemplateImagePickerError('')
        templateEditorSelectionRangeRef.current = null
        templateEditorSelectionSnapshotRef.current = null
        setEditingTemplateId('')
        setTemplateEditorName('')
        setTemplateEditorContent('')
        setTemplateEditorSourceContent('')
        setTemplateEditorMode('visual')
        setTemplateEditorError('')
        setTemplateEditorSaving(false)
        templateEditorImageTokenMapRef.current = new Map()
    }, [clearSelectedTemplateImage])

    const closeDocxPreview = useCallback(() => {
        setDocxPreviewOpen(false)
        setDocxPreviewName('')
        setDocxPreviewHtml('')
        setDocxPreviewError('')
    }, [])

    const convertDocxTemplateToHtml = useCallback(async (template, options = {}) => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) {
            throw new Error('Missing admin session token')
        }

        const response = await fetch('/api/settings/reports/templates/convert-docx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                domain: activeDomain,
                template,
                includeImages: options?.includeImages !== false,
            }),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to convert DOCX template')
        }

        return {
            html: String(data?.html || '').trim(),
            text: String(data?.text || '').trim(),
        }
    }, [activeDomain])

    const openDocxTemplatePreview = useCallback(async (template) => {
        if (!template) return

        setDocxPreviewOpen(true)
        setDocxPreviewName(String(template?.name || template?.fileName || 'DOCX Template'))
        setDocxPreviewHtml('')
        setDocxPreviewError('')
        setDocxPreviewLoading(true)

        try {
            const converted = await convertDocxTemplateToHtml(template)
            const html = decorateLeadingImagesInHtml(converted.html || (converted.text ? `<p>${escapeHtml(converted.text).replace(/\n/g, '<br />')}</p>` : ''))
            setDocxPreviewHtml(html)
        } catch (error) {
            setDocxPreviewError(error?.message || 'Failed to preview DOCX template')
        } finally {
            setDocxPreviewLoading(false)
        }
    }, [convertDocxTemplateToHtml])

    const convertDocxTemplateToEditable = useCallback(async (template, options = {}) => {
        const templateId = String(template?.id || '').trim()
        if (!templateId) return

        const replaceOriginal = options?.replaceOriginal === true

        setConvertingTemplateId(templateId)
        try {
            // Images are inserted manually from the template image library, so they are dropped on conversion.
            const converted = await convertDocxTemplateToHtml(template, { includeImages: false })
            const html = decorateLeadingImagesInHtml(converted.html || (converted.text ? `<p>${escapeHtml(converted.text).replace(/\n/g, '<br />')}</p>` : ''))
            const markdown = stripWordXmlArtifacts(htmlToReportMarkdown(html))
            const nextTemplateName = `${String(template?.name || 'Template').trim() || 'Template'} (Editable)`
            const baseFileName = String(template?.fileName || 'template.docx').replace(/\.docx$/i, '') || 'template'
            const nextTemplateId = replaceOriginal ? templateId : generateId('template')
            const newTemplate = {
                id: nextTemplateId,
                name: nextTemplateName,
                fileName: `${baseFileName}.md`,
                mimeType: 'text/markdown',
                size: new TextEncoder().encode(markdown).length,
                contentBase64: utf8ToBase64(markdown),
                uploadedAt: new Date().toISOString(),
            }

            setSettings((prev) => {
                if (replaceOriginal) {
                    return {
                        ...prev,
                        templates: prev.templates.map((item) => {
                            if (String(item?.id || '').trim() !== templateId) return item
                            return {
                                ...item,
                                ...newTemplate,
                            }
                        }),
                    }
                }

                return {
                    ...prev,
                    templates: [...prev.templates, newTemplate],
                }
            })

            openTemplateEditor(newTemplate)
            setStatusTone('success')
            setStatusMessage(replaceOriginal
                ? `Replaced ${template.name || template.fileName || 'DOCX template'} with an editable markdown version.`
                : `Converted ${template.name || template.fileName || 'DOCX template'} to an editable markdown template copy.`)
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to convert DOCX template to editable text')
        } finally {
            setConvertingTemplateId('')
        }
    }, [convertDocxTemplateToHtml, openTemplateEditor])

    const getTemplateEditorMarkdownSnapshot = useCallback(() => {
        const editor = templateEditorRef.current
        if (!editor) {
            return stripWordXmlArtifacts(templateEditorContent)
        }

        const markdown = expandEmbeddedImageTokensFromSource(
            htmlToReportMarkdown(editor.innerHTML),
            templateEditorImageTokenMapRef.current,
        )
        return stripWordXmlArtifacts(markdown)
    }, [templateEditorContent])

    const handleTemplateEditorModeChange = useCallback((nextMode) => {
        const safeMode = ['visual', 'markdown', 'split'].includes(String(nextMode || '').trim())
            ? String(nextMode || '').trim()
            : 'visual'

        if (templateEditorMode === safeMode) {
            return
        }

        if (templateEditorMode === 'visual' && safeMode !== 'visual') {
            const snapshot = getTemplateEditorMarkdownSnapshot()
            applyTemplateEditorContentFromDom(snapshot)
            const collapsed = collapseEmbeddedImageDataForSource(snapshot)
            templateEditorImageTokenMapRef.current = collapsed.tokenMap
            setTemplateEditorSourceContent(collapsed.sourceText)
            clearSelectedTemplateImage()
        }

        if (templateEditorMode !== 'visual' && safeMode === 'visual') {
            const expanded = expandEmbeddedImageTokensFromSource(templateEditorSourceContent, templateEditorImageTokenMapRef.current)
            setTemplateEditorContent(expanded)
            setTemplateEditorSyncKey((value) => value + 1)
        }

        setTemplateEditorMode(safeMode)
    }, [applyTemplateEditorContentFromDom, clearSelectedTemplateImage, getTemplateEditorMarkdownSnapshot, templateEditorMode, templateEditorSourceContent])

    const handleTemplateEditorCommand = useCallback((command, value = null) => {
        if (templateEditorMode !== 'visual') {
            return
        }

        const editor = templateEditorRef.current
        if (!editor || typeof document === 'undefined') {
            return
        }

        editor.focus()
        document.execCommand(command, false, value)
    }, [templateEditorMode])

    const loadTemplateImageLibrary = useCallback(async () => {
        if (!activeDomain) {
            setTemplateImagePickerError('Domain is required to load template images.')
            return
        }

        setTemplateImagePickerLoading(true)
        setTemplateImagePickerError('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetch(`/api/settings/reports/template-images?domain=${encodeURIComponent(activeDomain)}`, {
                cache: 'no-store',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })

            const payload = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to load template images')
            }

            const items = Array.isArray(payload?.items)
                ? payload.items
                    .map((item) => ({
                        id: String(item?.id || ''),
                        src: String(item?.src || ''),
                        label: String(item?.label || ''),
                        fileName: String(item?.fileName || ''),
                        group: String(item?.group || ''),
                        groupLabel: String(item?.groupLabel || ''),
                    }))
                    .filter((item) => item.id && item.src)
                : []

            const groups = Array.isArray(payload?.groups)
                ? payload.groups
                    .map((group) => ({
                        key: String(group?.key || ''),
                        label: String(group?.label || ''),
                        relativePath: String(group?.relativePath || ''),
                        itemCount: Number(group?.itemCount || 0),
                    }))
                    .filter((group) => group.key)
                : []

            setTemplateImageLibraryItems(items)
            setTemplateImageLibraryGroups(groups)
            if (items.length === 0) {
                const scanned = groups
                    .map((group) => group.label)
                    .filter(Boolean)
                    .join(' and ')
                setTemplateImagePickerError(scanned
                    ? `No template images found in ${scanned}.`
                    : 'No template images found.')
            }
        } catch (error) {
            setTemplateImageLibraryItems([])
            setTemplateImageLibraryGroups([])
            setTemplateImagePickerError(error?.message || 'Failed to load template images')
        } finally {
            setTemplateImagePickerLoading(false)
        }
    }, [activeDomain])

    const handleTemplateImageInsertClick = useCallback(async () => {
        if (templateEditorMode !== 'visual') {
            return
        }

        const editor = templateEditorRef.current
        if (editor) {
            insertTemplateImageAnchor(editor)
        }

        captureTemplateEditorSelection()

        if (templateImagePickerOpen) {
            removeTemplateImageInsertAnchors(editor)
            setTemplateImagePickerOpen(false)
            return
        }

        setTemplateImagePickerOpen(true)
        if (templateImageLibraryItems.length === 0 && !templateImagePickerLoading) {
            await loadTemplateImageLibrary()
        }
    }, [captureTemplateEditorSelection, loadTemplateImageLibrary, templateEditorMode, templateImageLibraryItems.length, templateImagePickerLoading, templateImagePickerOpen])

    useEffect(() => {
        if (!templateImagePickerOpen) {
            return
        }

        templateImagePickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [templateImagePickerOpen])

    const handleSelectedTemplateImageAlignment = useCallback((alignment) => {
        if (templateEditorMode !== 'visual') {
            return
        }

        const editor = templateEditorRef.current
        const imageElement = selectedTemplateImageRef.current
        if (!editor || !imageElement || !editor.contains(imageElement)) {
            clearSelectedTemplateImage()
            return
        }

        applyTemplateImageAlignment(imageElement, alignment)
        updateSelectedTemplateImageBox(imageElement)
    }, [clearSelectedTemplateImage, templateEditorMode, updateSelectedTemplateImageBox])

    const handleRemoveSelectedTemplateImage = useCallback(() => {
        if (templateEditorMode !== 'visual') {
            return
        }

        const editor = templateEditorRef.current
        const imageElement = selectedTemplateImageRef.current
        if (!editor || !imageElement || !editor.contains(imageElement)) {
            clearSelectedTemplateImage()
            return
        }

        imageElement.remove()
        clearSelectedTemplateImage()

        const nextMarkdown = htmlToReportMarkdown(editor.innerHTML)
        applyTemplateEditorContentFromDom(nextMarkdown)
        setTemplateEditorSourceContent(nextMarkdown)
        editor.focus()
    }, [applyTemplateEditorContentFromDom, clearSelectedTemplateImage, templateEditorMode])

    const selectTemplateImage = useCallback((imageElement) => {
        const previousImage = selectedTemplateImageRef.current
        if (previousImage && previousImage !== imageElement) {
            previousImage.classList.remove('template-editor-selected-image')
        }

        if (!imageElement) {
            clearSelectedTemplateImage()
            return
        }

        imageElement.classList.add('template-editor-selected-image')
        selectedTemplateImageRef.current = imageElement
        updateSelectedTemplateImageBox(imageElement)
    }, [clearSelectedTemplateImage, updateSelectedTemplateImageBox])

    const handleTemplateEditorClick = useCallback((event) => {
        captureTemplateEditorSelection()
        const nextImage = event.target instanceof Element ? event.target.closest('img') : null
        const editor = templateEditorRef.current
        if (nextImage && editor?.contains(nextImage)) {
            selectTemplateImage(nextImage)
            return
        }

        selectTemplateImage(null)
    }, [captureTemplateEditorSelection, selectTemplateImage])

    const handleSelectedTemplateImageResizeStart = useCallback((event) => {
        const editor = templateEditorRef.current
        const imageElement = selectedTemplateImageRef.current
        if (!editor || !imageElement || !editor.contains(imageElement) || typeof window === 'undefined') {
            clearSelectedTemplateImage()
            return
        }

        event.preventDefault()
        event.stopPropagation()

        const handleElement = event.currentTarget
        if (handleElement && typeof handleElement.setPointerCapture === 'function') {
            try {
                handleElement.setPointerCapture(event.pointerId)
            } catch {
                // Ignore browsers that reject pointer capture for this interaction.
            }
        }

        const startX = event.clientX
        const startWidth = getTemplateImageCurrentWidth(imageElement)
        const maxWidth = Math.max(TEMPLATE_IMAGE_MIN_WIDTH, Math.floor(editor.getBoundingClientRect().width))

        const handlePointerMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX
            const nextWidth = Math.max(
                TEMPLATE_IMAGE_MIN_WIDTH,
                Math.min(maxWidth, startWidth + deltaX),
            )

            imageElement.style.width = `${nextWidth}px`
            imageElement.style.maxWidth = '100%'
            imageElement.style.height = 'auto'
            updateSelectedTemplateImageBox(imageElement)
        }

        const cleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            if (handleElement && typeof handleElement.releasePointerCapture === 'function') {
                try {
                    if (handleElement.hasPointerCapture?.(event.pointerId)) {
                        handleElement.releasePointerCapture(event.pointerId)
                    }
                } catch {
                    // Ignore browsers that reject pointer release after cancellation.
                }
            }
            selectedTemplateImageDragCleanupRef.current = null
            updateSelectedTemplateImageBox(imageElement)
        }

        const handlePointerUp = () => {
            cleanup()
        }

        selectedTemplateImageDragCleanupRef.current?.()
        selectedTemplateImageDragCleanupRef.current = cleanup
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'nwse-resize'
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)
    }, [clearSelectedTemplateImage, updateSelectedTemplateImageBox])

    useEffect(() => {
        if (typeof window === 'undefined' || !editingTemplateId) {
            return undefined
        }

        const handleWindowResize = () => {
            updateSelectedTemplateImageBox()
        }

        window.addEventListener('resize', handleWindowResize)
        return () => {
            window.removeEventListener('resize', handleWindowResize)
        }
    }, [editingTemplateId, updateSelectedTemplateImageBox])

    useEffect(() => {
        return () => {
            selectedTemplateImageDragCleanupRef.current?.()
        }
    }, [])

    const handleTemplateImageInsertFromLibrary = useCallback((libraryItem) => {
        if (templateEditorMode !== 'visual') {
            return
        }

        const src = String(libraryItem?.src || '').trim()
        if (!src) {
            return
        }

        try {
            const altSource = String(libraryItem?.label || libraryItem?.fileName || '').trim()
            const escapedAlt = sanitizeHtmlAttribute(buildImageAltFromFileName(altSource) || 'Image')

            const editor = templateEditorRef.current
            if (editor) {
                editor.focus()
                restoreTemplateEditorSelection()
                // Re-anchor at the caret so a click made after the library opened wins over the anchor placed on open.
                insertTemplateImageAnchor(editor)
                ensureTemplateHeaderImageLock(editor, { initializeFromLeading: true })
            }

            const existingLockedHeaderImage = editor
                ? editor.querySelector('img[data-template-header-locked="true"]')
                : null
            const shouldUseHeaderPresentation = Boolean(editor)
                && !existingLockedHeaderImage
                && ((((editor.textContent || '').trim().length === 0) || isSelectionAtEditorStart(editor)))
            const imageHtml = buildTemplateImageMarkup({
                src,
                alt: escapedAlt,
                isHeader: shouldUseHeaderPresentation,
            })

            let insertedImage = null
            const anchor = editor ? editor.querySelector('span[data-template-image-anchor="true"]') : null
            if (anchor && editor) {
                const wrapper = document.createElement('div')
                wrapper.innerHTML = imageHtml
                const candidate = wrapper.firstElementChild
                if (candidate?.tagName?.toUpperCase() === 'IMG') {
                    anchor.replaceWith(candidate)
                    insertedImage = candidate

                    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
                        const selection = window.getSelection()
                        const range = document.createRange()
                        range.setStartAfter(candidate)
                        range.setEndAfter(candidate)
                        selection?.removeAllRanges()
                        selection?.addRange(range)
                    }
                } else {
                    anchor.remove()
                }
            }

            if (!insertedImage) {
                insertedImage = insertHtmlAtSelection(imageHtml)
            }

            if (!insertedImage && editor) {
                editor.insertAdjacentHTML('beforeend', imageHtml)
                if (shouldUseHeaderPresentation) {
                    promoteLeadingImagesToHeader(editor)
                }
            }

            const activeImage = insertedImage?.tagName?.toUpperCase() === 'IMG'
                ? insertedImage
                : (editor ? editor.querySelector('img:last-of-type') : null)

            const lockedHeaderImage = editor
                ? ensureTemplateHeaderImageLock(editor, { initializeFromLeading: true })
                : null

            if (activeImage && typeof window !== 'undefined' && typeof document !== 'undefined') {
                const selection = window.getSelection()
                const range = document.createRange()
                range.setStartAfter(activeImage)
                range.setEndAfter(activeImage)
                selection?.removeAllRanges()
                selection?.addRange(range)
            } else if (lockedHeaderImage && typeof window !== 'undefined' && typeof document !== 'undefined') {
                const selection = window.getSelection()
                const range = document.createRange()
                range.setStartAfter(lockedHeaderImage)
                range.setEndAfter(lockedHeaderImage)
                selection?.removeAllRanges()
                selection?.addRange(range)
            }

            removeTemplateImageInsertAnchors(editor)
            clearSelectedTemplateImage()
            captureTemplateEditorSelection()

            if (editor) {
                const nextMarkdown = htmlToReportMarkdown(editor.innerHTML)
                applyTemplateEditorContentFromDom(nextMarkdown)
                setTemplateEditorSourceContent(nextMarkdown)
            }

            setTemplateImagePickerOpen(false)
        } catch (error) {
            setTemplateEditorError(error?.message || 'Failed to insert image')
        }
    }, [applyTemplateEditorContentFromDom, captureTemplateEditorSelection, clearSelectedTemplateImage, restoreTemplateEditorSelection, templateEditorMode])

    const templatePreviewHtml = useMemo(() => decorateLeadingImagesInHtml(markdownToReportHtml(templateEditorContent)), [templateEditorContent])

    useEffect(() => {
        const editor = templateEditorRef.current
        if (!editor) {
            return
        }

        const nextHtml = templatePreviewHtml || ''
        const hydrationToken = `${templateEditorSyncKey}:${nextHtml}`
        if (templateEditorHydrationRef.current === hydrationToken) {
            return
        }

        templateEditorHydrationRef.current = hydrationToken
        editor.innerHTML = nextHtml
    }, [editingTemplateId, templateEditorMode, templateEditorSyncKey, templatePreviewHtml])
    const templateHasHeaderImage = useMemo(() => templatePreviewHtml.includes('template-header-image'), [templatePreviewHtml])

    const templateEditorLinkedReportTypes = useMemo(() => {
        const templateId = String(editingTemplateId || '').trim()
        if (!templateId) return []

        return settings.reportTypes.filter((reportType) => String(reportType?.templateId || '').trim() === templateId)
    }, [editingTemplateId, settings.reportTypes])

    const templateEditorRequiredPlaceholders = useMemo(() => {
        const deduped = new Set()
        for (const reportType of templateEditorLinkedReportTypes) {
            for (const placeholder of normalizeRequiredPlaceholders(reportType?.requiredPlaceholders)) {
                deduped.add(placeholder)
            }
        }
        return Array.from(deduped)
    }, [templateEditorLinkedReportTypes])

    const templateEditorRequiredAnchors = useMemo(() => {
        const deduped = new Set()
        for (const reportType of templateEditorLinkedReportTypes) {
            for (const anchor of normalizeRequiredAnchors(reportType?.requiredAnchors)) {
                deduped.add(anchor)
            }
        }
        return Array.from(deduped)
    }, [templateEditorLinkedReportTypes])

    const templateEditorMissingPlaceholders = useMemo(() => {
        if (templateEditorRequiredPlaceholders.length === 0) return []
        const content = String(templateEditorContent || '')
        return templateEditorRequiredPlaceholders.filter((placeholder) => !content.includes(placeholder))
    }, [templateEditorContent, templateEditorRequiredPlaceholders])

    const templateEditorMissingAnchors = useMemo(() => {
        if (templateEditorRequiredAnchors.length === 0) return []
        const content = String(templateEditorContent || '')
        return templateEditorRequiredAnchors.filter((anchor) => !content.includes(anchor))
    }, [templateEditorContent, templateEditorRequiredAnchors])

    const saveTemplateEditor = useCallback(async () => {
        const templateId = String(editingTemplateId || '').trim()
        if (!templateId) return

        const editor = templateEditorRef.current
        if (editor) {
            promoteLeadingImagesToHeader(editor)
        }

        const nextTemplateContent = getTemplateEditorMarkdownSnapshot()
        const nextTemplateName = String(templateEditorName || '').trim() || 'Template'

        const storedTemplate = settings.templates.find((item) => item.id === templateId)
        let storedContent = ''
        try {
            storedContent = stripWordXmlArtifacts(base64ToUtf8(storedTemplate?.contentBase64))
        } catch {
            storedContent = ''
        }

        const before = countTemplateStructure(storedContent)
        const after = countTemplateStructure(nextTemplateContent)
        const structureLost = (before.headings > 0 && after.headings === 0)
            || (before.tables > 0 && after.tables === 0)
            || (before.blocks > 4 && after.blocks * 2 < before.blocks)

        if (storedContent.trim() && (!nextTemplateContent.trim() || structureLost)) {
            const proceed = window.confirm('This save would drop most of the template structure (headings, tables or blocks). This usually means the editor content did not load correctly. Save anyway?')
            if (!proceed) return
        }

        const encoded = utf8ToBase64(nextTemplateContent)
        const contentLengthBytes = new TextEncoder().encode(nextTemplateContent).length

        const nextSettings = {
            ...settings,
            templates: settings.templates.map((item) => {
                if (item.id !== templateId) return item
                return {
                    ...item,
                    name: nextTemplateName,
                    contentBase64: encoded,
                    size: contentLengthBytes,
                }
            }),
        }

        setSettings(nextSettings)
        applyTemplateEditorContentFromDom(nextTemplateContent)
        const collapsed = collapseEmbeddedImageDataForSource(nextTemplateContent)
        templateEditorImageTokenMapRef.current = collapsed.tokenMap
        setTemplateEditorSourceContent(collapsed.sourceText)
        setTemplateEditorSaving(true)
        setTemplateEditorError('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const payload = normalizeSettings(nextSettings)
            const response = await fetch('/api/settings/reports', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    settings: payload,
                }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save report settings')
            }

            setSettings(normalizeSettings(data?.settings || payload))
            setStatusTone('success')
            setStatusMessage(`Saved template ${nextTemplateName}.`)
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to save template')
            setTemplateEditorError(error?.message || 'Failed to save template')
        } finally {
            setTemplateEditorSaving(false)
        }
    }, [activeDomain, applyTemplateEditorContentFromDom, editingTemplateId, getTemplateEditorMarkdownSnapshot, settings, templateEditorName])
    const handleUploadTemplate = useCallback(async (event) => {
        const file = event.target.files?.[0]
        if (!file) return

        setStatusMessage('')
        setUploading(true)

        try {
            const dataUrl = await readFileAsDataUrl(file)
            const delimiterIndex = dataUrl.indexOf(',')
            if (delimiterIndex < 0) {
                throw new Error('Unable to parse uploaded template')
            }

            const contentBase64 = dataUrl.slice(delimiterIndex + 1)
            if (!contentBase64) {
                throw new Error('Uploaded template is empty')
            }

            setSettings((prev) => ({
                ...prev,
                templates: [
                    ...prev.templates,
                    {
                        id: generateId('template'),
                        name: file.name.replace(/\.[^/.]+$/, '') || file.name,
                        fileName: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        size: file.size,
                        contentBase64,
                        uploadedAt: new Date().toISOString(),
                    },
                ],
            }))

            setStatusTone('success')
            setStatusMessage(`Uploaded ${file.name}`)
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to upload template')
        } finally {
            setUploading(false)
            if (event.target) {
                event.target.value = ''
            }
        }
    }, [])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const payload = normalizeSettings(settings)

            const response = await fetch('/api/settings/reports', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    settings: payload,
                }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save report settings')
            }

            setSettings(normalizeSettings(data?.settings || payload))
            setStatusTone('success')
            setStatusMessage('Report settings saved successfully')
            return true
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to save report settings')
            return false
        } finally {
            setSaving(false)
        }
    }, [activeDomain, settings])

    const handleSaveAndCloseFcaPromptModal = useCallback(async () => {
        const saved = await handleSave()
        if (!saved) return
        setFcaPromptModalTypeId('')
        setFcaPromptModalTab('templates')
    }, [handleSave])

    const handleValidateTemplates = useCallback(async () => {
        const strictTypes = settings.reportTypes.filter((type) => {
            const mode = String(type?.templateMode || DEFAULT_TEMPLATE_MODE)
            const policy = String(type?.strictTemplatePolicy || STRICT_TEMPLATE_POLICY_NONE)
            const placeholders = normalizeRequiredPlaceholders(type?.requiredPlaceholders)
            return mode === TEMPLATE_MODE_DOCX_LOCKED || policy !== STRICT_TEMPLATE_POLICY_NONE || placeholders.length > 0
        })

        if (strictTypes.length === 0) {
            setStatusTone('info')
            setStatusMessage('No strict template report types are configured.')
            return
        }

        setValidatingTemplates(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const templateMap = new Map(settings.templates.map((template) => [String(template?.id || '').trim(), template]))
            const failures = []

            for (const reportType of strictTypes) {
                const templateId = String(reportType?.templateId || '').trim()
                const typeName = String(reportType?.name || '').trim() || String(reportType?.id || '').trim() || 'Report type'
                if (!templateId) {
                    failures.push(`${typeName}: missing linked template`)
                    continue
                }

                const template = templateMap.get(templateId)
                if (!template) {
                    failures.push(`${typeName}: linked template not found`)
                    continue
                }

                const response = await fetch('/api/settings/reports/templates/validate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        domain: activeDomain,
                        reportType,
                        template,
                    }),
                })

                const data = await response.json().catch(() => ({}))
                if (!response.ok || data?.valid !== true) {
                    const errors = Array.isArray(data?.errors) ? data.errors : [data?.error || 'Validation failed']
                    failures.push(`${typeName}: ${errors.join(' ')}`)
                }
            }

            if (failures.length > 0) {
                setStatusTone('error')
                setStatusMessage(`Strict template validation failed. ${failures.join(' | ')}`)
                return
            }

            setStatusTone('success')
            setStatusMessage('Strict template validation passed for all configured report types.')
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to validate strict templates')
        } finally {
            setValidatingTemplates(false)
        }
    }, [activeDomain, settings.reportTypes, settings.templates])

    const loadTemplateLibrary = useCallback(async () => {
        setLoadingTemplateLibrary(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetch(`/api/settings/reports/template-library?domain=${encodeURIComponent(activeDomain)}`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load Template Library')
            }

            setTemplateLibraryPath(String(data?.path || '').trim())
            setTemplateLibraryFiles(Array.isArray(data?.files) ? data.files : [])
            setStatusTone('success')
            setStatusMessage(`Loaded ${Array.isArray(data?.files) ? data.files.length : 0} Markdown template(s) from the library`)
        } catch (error) {
            setTemplateLibraryPath('')
            setTemplateLibraryFiles([])
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to load Template Library')
        } finally {
            setLoadingTemplateLibrary(false)
        }
    }, [activeDomain])

    const openTemplateLibrary = useCallback(() => {
        setIsImportMenuOpen(false)
        setIsTemplateLibraryModalOpen(true)
        void loadTemplateLibrary()
    }, [loadTemplateLibrary])

    const addTemplateLibraryFile = useCallback((file) => {
        const templateId = String(file?.id || '').trim()
        if (!templateId) return

        setSettings((prev) => {
            if (prev.templates.some((template) => template.id === templateId)) return prev
            return { ...prev, templates: [...prev.templates, file] }
        })
        setStatusTone('success')
        setStatusMessage(`Loaded ${file.name || file.fileName || 'Markdown template'} from the Template Library`)
    }, [])

    const handleExportTemplatePack = useCallback(async (templateIds = null) => {
        if (!activeDomain) {
            setStatusTone('error')
            setStatusMessage('No active domain is available for export.')
            return
        }

        const selectedIds = Array.isArray(templateIds)
            ? templateIds.map((item) => String(item || '').trim()).filter(Boolean)
            : []

        setExportingTemplates(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetch('/api/settings/reports/templates/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    sourceDomain: activeDomain,
                    templateIds: selectedIds.length > 0 ? selectedIds : undefined,
                    includeReportTypeBindings: true,
                }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to export templates')
            }

            const blob = await response.blob()
            const contentDisposition = String(response.headers.get('content-disposition') || '')
            const match = contentDisposition.match(/filename="([^"]+)"/i)
            const fileName = match?.[1] || `report-templates-${activeDomain}.zip`

            const objectUrl = window.URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = objectUrl
            anchor.download = fileName
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
            window.URL.revokeObjectURL(objectUrl)

            setStatusTone('success')
            setStatusMessage(selectedIds.length > 0
                ? 'Template pack exported for selected template.'
                : 'Template pack exported.')
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to export templates')
        } finally {
            setExportingTemplates(false)
        }
    }, [activeDomain])

    const closeImportTemplatePackConfirm = useCallback(() => {
        setPendingTemplatePackFile(null)
        setIsImportTemplatePackConfirmOpen(false)
    }, [])

    const handleImportTemplatePackSelection = useCallback((event) => {
        const file = event.target.files?.[0]
        if (!file) return

        setPendingTemplatePackFile(file)
        setIsImportTemplatePackConfirmOpen(true)

        if (event.target) {
            event.target.value = ''
        }
    }, [])

    const handleImportTemplatePack = useCallback(async () => {
        const file = pendingTemplatePackFile
        if (!file) return

        setImportingTemplatePack(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch(`/api/settings/reports/templates/import?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to import template pack')
            }

            await loadSettings(activeDomain)

            const importedTemplates = Number(data?.summary?.importedTemplates || 0)
            const importedReportTypes = Number(data?.summary?.importedReportTypes || 0)
            setStatusTone('success')
            setStatusMessage(`Imported template pack (${importedTemplates} template${importedTemplates === 1 ? '' : 's'}, ${importedReportTypes} report type${importedReportTypes === 1 ? '' : 's'}) into ${activeDomain}.`)
            closeImportTemplatePackConfirm()
        } catch (error) {
            setStatusTone('error')
            setStatusMessage(error?.message || 'Failed to import template pack')
        } finally {
            setImportingTemplatePack(false)
        }
    }, [activeDomain, closeImportTemplatePackConfirm, loadSettings, pendingTemplatePackFile])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading report settings...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen">
            <AdminHeader title="Report Settings" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Reporting Settings</h1>
                            <p className="mt-1 text-sm text-gray-600">Manage report types, upload report templates, and configure reporting behavior.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {hasSuperAdminAccess && (
                                <button
                                    type="button"
                                    onClick={() => handleExportTemplatePack()}
                                    disabled={saving || uploading || validatingTemplates || exportingTemplates || importingTemplatePack || settings.templates.length === 0}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {exportingTemplates ? 'Exporting...' : 'Export Template Pack'}
                                </button>
                            )}
                            {hasSuperAdminAccess && (
                                <label className={`rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${importingTemplatePack || saving || uploading || validatingTemplates ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                    {importingTemplatePack ? 'Importing...' : 'Import Template Pack'}
                                    <input
                                        type="file"
                                        accept="application/zip,.zip"
                                        className="hidden"
                                        disabled={importingTemplatePack || saving || uploading || validatingTemplates}
                                        onChange={handleImportTemplatePackSelection}
                                    />
                                </label>
                            )}
                            <button
                                type="button"
                                onClick={handleValidateTemplates}
                                disabled={saving || uploading || validatingTemplates}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {validatingTemplates ? 'Validating...' : 'Validate Strict Templates'}
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving || uploading || validatingTemplates}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>
                    </div>

                    {statusMessage && (
                        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : statusTone === 'success'
                                ? 'border-green-200 bg-green-50 text-green-700'
                                : 'border-gray-200 bg-gray-50 text-gray-700'
                            }`}>
                            {statusMessage}
                        </div>
                    )}
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">Report Types</h2>
                        <button
                            type="button"
                            onClick={addReportType}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Add Report Type
                        </button>
                    </div>

                    <div className="mt-4 space-y-3">
                        {settings.reportTypes.map((type) => (
                            <article key={type.id} className="rounded-md border border-gray-200 p-4">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                                    <label className="md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Name</span>
                                        <input
                                            type="text"
                                            value={type.name}
                                            onChange={(event) => updateReportType(type.id, { name: event.target.value })}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>
                                    <label className="md:col-span-3">
                                        <span className="text-xs font-medium text-gray-700">Description</span>
                                        <input
                                            type="text"
                                            value={type.description}
                                            onChange={(event) => updateReportType(type.id, { description: event.target.value })}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>
                                    <label className="md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Template</span>
                                        <select
                                            value={type.templateId || ''}
                                            onChange={(event) => updateReportType(type.id, { templateId: event.target.value || null })}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        >
                                            <option value="">No template</option>
                                            {templateOptionGroups.map((group) => (
                                                <optgroup key={group.key} label={group.label}>
                                                    {group.options.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Template Mode</span>
                                        <select
                                            value={String(type.templateMode || DEFAULT_TEMPLATE_MODE)}
                                            onChange={(event) => updateReportType(type.id, { templateMode: event.target.value || DEFAULT_TEMPLATE_MODE })}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        >
                                            <option value={TEMPLATE_MODE_MARKDOWN}>Markdown (editable)</option>
                                            <option value={TEMPLATE_MODE_DOCX_LOCKED}>DOCX locked</option>
                                        </select>
                                    </label>
                                    <label className="md:col-span-2">
                                        <span className="text-xs font-medium text-gray-700">Strict Policy</span>
                                        <select
                                            value={String(type.strictTemplatePolicy || STRICT_TEMPLATE_POLICY_NONE)}
                                            onChange={(event) => {
                                                const nextPolicy = String(event.target.value || STRICT_TEMPLATE_POLICY_NONE)
                                                const selectedOption = strictTemplatePolicyOptions.find((option) => option.value === nextPolicy)
                                                updateReportType(type.id, {
                                                    strictTemplatePolicy: nextPolicy,
                                                    templateMode: selectedOption?.enforceDocxLocked ? TEMPLATE_MODE_DOCX_LOCKED : (type.templateMode || DEFAULT_TEMPLATE_MODE),
                                                })
                                            }}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        >
                                            {strictTemplatePolicyOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <div className="md:col-span-2 flex items-end gap-2">
                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={type.isActive !== false}
                                                onChange={(event) => updateReportType(type.id, { isActive: event.target.checked })}
                                            />
                                            Active
                                        </label>
                                        {type.id === NDIS_FCA_REPORT_TYPE.id && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFcaPromptModalTypeId(type.id)
                                                    setFcaPromptModalTab('templates')
                                                }}
                                                className="whitespace-nowrap rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
                                            >
                                                Prompt Setup
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => removeReportType(type.id)}
                                            className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>

                                <label className="mt-3 block">
                                    <span className="text-xs font-medium text-gray-700">Required placeholders (comma-separated)</span>
                                    <input
                                        type="text"
                                        value={serializePlaceholderCsv(type.requiredPlaceholders)}
                                        onChange={(event) => updateReportType(type.id, { requiredPlaceholders: parsePlaceholderCsv(event.target.value) })}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="{{patient_name}}, {{report_date}}, {{clinician_name}}"
                                    />
                                </label>
                                <p className="mt-2 text-xs text-gray-500">
                                    Strict policies can enforce DOCX-only templates and required placeholders for this report type.
                                </p>

                                <label className="mt-3 block">
                                    <span className="text-xs font-medium text-gray-700">Required anchor text (comma-separated)</span>
                                    <input
                                        type="text"
                                        value={serializeAnchorCsv(type.requiredAnchors)}
                                        onChange={(event) => updateReportType(type.id, { requiredAnchors: parseAnchorCsv(event.target.value) })}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="Section 1, client details, Date of review"
                                    />
                                </label>

                                {type.id === NDIS_FCA_REPORT_TYPE.id && fcaPromptModalTypeId === type.id && (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                                        <div className="h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
                                            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                                                <div>
                                                    <h3 className="text-base font-semibold text-gray-900">NDIS FCA Prompt Setup</h3>
                                                    <p className="mt-1 text-sm text-gray-600">Configure templates and minimum-word targets for this report type.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveAndCloseFcaPromptModal}
                                                    disabled={saving || uploading || validatingTemplates}
                                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {saving ? 'Saving...' : 'Save & Close'}
                                                </button>
                                            </div>
                                            <div className="p-5">
                                                <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1 text-xs font-medium">
                                                    <button
                                                        type="button"
                                                        onClick={() => setFcaPromptModalTab('templates')}
                                                        className={`rounded px-2.5 py-1.5 ${fcaPromptModalTab === 'templates' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                                    >
                                                        Templates
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFcaPromptModalTab('word-count')}
                                                        className={`rounded px-2.5 py-1.5 ${fcaPromptModalTab === 'word-count' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                                    >
                                                        Word Count
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFcaPromptModalTab('language')}
                                                        className={`rounded px-2.5 py-1.5 ${fcaPromptModalTab === 'language' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                                    >
                                                        Language
                                                    </button>
                                                </div>

                                                <p className="text-xs text-teal-700">Use template tokens: {'{{MIN_WORDS}}'}, {'{{SECTION_TITLE}}'}, {'{{PATIENT_NAME}}'}, {'{{PRACTICE_NAME}}'} (practice name, e.g. Acme OT), {'{{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}'}, {'{{APPROVED_SNIPPETS_OR_NONE}}'}. {'{{DOMAIN}}'} still resolves, to the same practice name.</p>
                                                <p className="mt-1 text-xs text-teal-700">Callout boxes: a {'>'} quote whose first line opens with <code>[!summary]</code> renders as a rose section-summary box, <code>[!evidence]</code> as a green weight-of-evidence box, <code>[!finding]</code> as an outlined navy finding box, and <code>[!recommendation]</code> or <code>[!opinion]</code> as a solid navy box for the funding request and closing clinical opinion.</p>

                                                {fcaPromptModalTab === 'templates' && (
                                                    <>
                                                        <label className="mt-3 block">
                                                            <span className="text-xs font-medium text-gray-700">System prompt template</span>
                                                            <textarea
                                                                value={String(type?.config?.fcaPromptConfig?.systemPromptTemplate || '')}
                                                                onChange={(event) => updateReportType(type.id, {
                                                                    config: {
                                                                        ...(type?.config && typeof type.config === 'object' ? type.config : {}),
                                                                        fcaPromptConfig: {
                                                                            ...(type?.config?.fcaPromptConfig && typeof type.config.fcaPromptConfig === 'object' ? type.config.fcaPromptConfig : {}),
                                                                            systemPromptTemplate: event.target.value,
                                                                        },
                                                                    },
                                                                })}
                                                                className="mt-1 min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="System prompt template"
                                                            />
                                                        </label>

                                                        <label className="mt-3 block">
                                                            <span className="text-xs font-medium text-gray-700">User prompt template</span>
                                                            <textarea
                                                                value={String(type?.config?.fcaPromptConfig?.userPromptTemplate || '')}
                                                                onChange={(event) => updateReportType(type.id, {
                                                                    config: {
                                                                        ...(type?.config && typeof type.config === 'object' ? type.config : {}),
                                                                        fcaPromptConfig: {
                                                                            ...(type?.config?.fcaPromptConfig && typeof type.config.fcaPromptConfig === 'object' ? type.config.fcaPromptConfig : {}),
                                                                            userPromptTemplate: event.target.value,
                                                                        },
                                                                    },
                                                                })}
                                                                className="mt-1 min-h-36 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                                                placeholder="User prompt template"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {fcaPromptModalTab === 'word-count' && (
                                                    <>
                                                        <label className="mt-3 block">
                                                            <span className="text-xs font-medium text-gray-700">Minimum words override</span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={String(type?.config?.fcaPromptConfig?.minWords ?? '')}
                                                                onChange={(event) => {
                                                                    const nextValue = event.target.value
                                                                    const parsed = Number.parseInt(nextValue, 10)
                                                                    updateReportType(type.id, {
                                                                        config: {
                                                                            ...(type?.config && typeof type.config === 'object' ? type.config : {}),
                                                                            fcaPromptConfig: {
                                                                                ...(type?.config?.fcaPromptConfig && typeof type.config.fcaPromptConfig === 'object' ? type.config.fcaPromptConfig : {}),
                                                                                minWords: nextValue === '' ? null : (Number.isFinite(parsed) && parsed > 0 ? parsed : null),
                                                                            },
                                                                        },
                                                                    })
                                                                }}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Leave blank to use section defaults"
                                                            />
                                                            <p className="mt-1 text-xs text-gray-500">Set a global minimum word count for FCA sections. Leave blank to keep each section’s built-in target.</p>
                                                        </label>

                                                        <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Section defaults</p>
                                                                <p className="text-[11px] text-gray-500">Override individual FCA sections below</p>
                                                            </div>
                                                            <p className="mt-2 text-[11px] text-gray-500">
                                                                These are the Standard targets. The builder’s Extended style multiplies each one (about 2.2×) and
                                                                gives the executive summary its own larger target, so an override here scales with the style rather
                                                                than replacing it.
                                                            </p>
                                                            <div className="mt-3 space-y-2">
                                                                {FCA_SECTION_DEFAULTS.map((section) => {
                                                                    const currentValue = type?.config?.fcaPromptConfig?.sectionMinWords?.[section.id]
                                                                    return (
                                                                        <label key={section.id} className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                                                                            <div className="min-w-0 flex-1">
                                                                                <p className="text-xs font-medium text-gray-800">{section.title}</p>
                                                                                <p className="text-[11px] text-gray-500">Default: {section.defaultWords} words</p>
                                                                            </div>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                value={currentValue ?? ''}
                                                                                onChange={(event) => {
                                                                                    const nextValue = event.target.value
                                                                                    const parsed = Number.parseInt(nextValue, 10)
                                                                                    const currentSectionMinWords = type?.config?.fcaPromptConfig?.sectionMinWords && typeof type.config.fcaPromptConfig.sectionMinWords === 'object'
                                                                                        ? { ...type.config.fcaPromptConfig.sectionMinWords }
                                                                                        : {}
                                                                                    if (nextValue === '') {
                                                                                        delete currentSectionMinWords[section.id]
                                                                                    } else {
                                                                                        currentSectionMinWords[section.id] = Number.isFinite(parsed) && parsed > 0 ? parsed : null
                                                                                    }
                                                                                    updateReportType(type.id, {
                                                                                        config: {
                                                                                            ...(type?.config && typeof type.config === 'object' ? type.config : {}),
                                                                                            fcaPromptConfig: {
                                                                                                ...(type?.config?.fcaPromptConfig && typeof type.config.fcaPromptConfig === 'object' ? type.config.fcaPromptConfig : {}),
                                                                                                sectionMinWords: currentSectionMinWords,
                                                                                            },
                                                                                        },
                                                                                    })
                                                                                }}
                                                                                className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                                                                placeholder={String(section.defaultWords)}
                                                                            />
                                                                        </label>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    </>
                                                )}

                                                {fcaPromptModalTab === 'language' && (
                                                    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Approved language manifest</p>
                                                            <p className="text-[11px] text-gray-500">Version {String(FCA_LANGUAGE_MANIFEST?.version || '')}</p>
                                                        </div>
                                                        <p className="mt-2 text-xs text-gray-500">Read-only stems and guardrails are used as optional style guidance during FCA section generation.</p>
                                                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Prompt guardrails</p>
                                                            <ul className="mt-1 space-y-1 text-[11px] text-amber-900">
                                                                <li>• Do not copy approved stems verbatim.</li>
                                                                <li>• Do not reuse generic template phrases such as “The purpose of this assessment”.</li>
                                                                <li>• Prefer fresh, section-specific wording based on the supplied evidence.</li>
                                                            </ul>
                                                        </div>
                                                        <div className="mt-3 space-y-3">
                                                            {FCA_SECTION_DEFAULTS.map((section) => {
                                                                const snippets = Array.isArray(FCA_LANGUAGE_MANIFEST?.sections?.[section.id])
                                                                    ? FCA_LANGUAGE_MANIFEST.sections[section.id]
                                                                    : []
                                                                return (
                                                                    <div key={section.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                                                        <p className="text-xs font-medium text-gray-800">{section.title}</p>
                                                                        {snippets.length === 0 ? (
                                                                            <p className="mt-1 text-[11px] text-gray-500">No approved stems configured for this section.</p>
                                                                        ) : (
                                                                            <ul className="mt-2 space-y-2">
                                                                                {snippets.map((snippet, snippetIndex) => (
                                                                                    <li key={String(snippet?.id || `${section.id}-snippet-${snippetIndex + 1}`)} className="rounded border border-gray-200 bg-white px-2.5 py-2">
                                                                                        <p className="text-xs text-gray-800">{String(snippet?.text || '')}</p>
                                                                                        <p className="mt-1 text-[11px] text-gray-500">Tags: {Array.isArray(snippet?.tags) && snippet.tags.length > 0 ? snippet.tags.join(', ') : 'none'}</p>
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="mt-3 flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateReportType(type.id, {
                                                            config: {
                                                                ...(type?.config && typeof type.config === 'object' ? type.config : {}),
                                                                fcaPromptConfig: normalizeFcaPromptConfig({}),
                                                            },
                                                        })}
                                                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Reset FCA prompt templates
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">Templates</h2>
                        <div className="flex items-center gap-2">
                            <details className="relative" open={isImportMenuOpen} onToggle={(event) => setIsImportMenuOpen(event.currentTarget.open)}>
                                <summary className="list-none cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                    Add Template
                                </summary>
                                <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg">
                                    <label className={`block w-full rounded px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 ${uploading || saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                        {uploading ? 'Uploading...' : 'Upload Template'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            onChange={(event) => {
                                                setIsImportMenuOpen(false)
                                                handleUploadTemplate(event)
                                            }}
                                            disabled={uploading || saving}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={openTemplateLibrary}
                                        disabled={loadingTemplateLibrary || saving || uploading}
                                        className="w-full rounded px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Template Library
                                    </button>
                                </div>
                            </details>
                        </div>
                    </div>

                    <div className="mt-4 space-y-3">
                        {settings.templates.length === 0 && (
                            <p className="text-sm text-gray-500">No templates uploaded yet.</p>
                        )}

                        {settings.templates.map((template) => {
                            const dataUrl = `data:${template.mimeType || 'application/octet-stream'};base64,${template.contentBase64}`
                            const isLibraryTemplate = isTemplateLibraryTemplate(template)
                            const canEdit = isEditableTemplate(template) && !isLibraryTemplate
                            const isDocx = isDocxTemplate(template)
                            const isConvertingThisTemplate = convertingTemplateId === String(template?.id || '')

                            return (
                                <article key={template.id} className="rounded-md border border-gray-200 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (canEdit) {
                                                            openTemplateEditor(template)
                                                            return
                                                        }
                                                        if (isDocx) {
                                                            openDocxTemplatePreview(template)
                                                        }
                                                    }}
                                                    disabled={!canEdit && !isDocx}
                                                    className="text-left text-sm font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800 disabled:cursor-not-allowed disabled:text-gray-500 disabled:no-underline"
                                                    title={canEdit ? 'View or edit template text' : isDocx ? 'Preview converted DOCX content' : 'Preview unavailable for this template type'}
                                                >
                                                    {template.name}
                                                </button>
                                                {isLibraryTemplate && (
                                                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                                                        Library
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 text-xs text-gray-600">{template.fileName} · {formatBytes(template.size)}</p>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {isLibraryTemplate
                                                    ? 'From the Template Library (read-only)'
                                                    : `Uploaded ${new Date(template.uploadedAt).toLocaleString()}`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {!isLibraryTemplate && (isDocx ? (
                                                <details className="group relative">
                                                    <summary className="list-none rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                                                        {isConvertingThisTemplate ? 'Converting...' : 'Edit'}
                                                    </summary>
                                                    <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg">
                                                        <button
                                                            type="button"
                                                            onClick={() => convertDocxTemplateToEditable(template)}
                                                            disabled={isConvertingThisTemplate}
                                                            className="w-full rounded px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                            title="Convert DOCX into an editable markdown template copy"
                                                        >
                                                            Convert to Editable Copy
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const confirmed = window.confirm('Replace this DOCX template with an editable markdown version? This cannot be undone.')
                                                                if (!confirmed) return
                                                                convertDocxTemplateToEditable(template, { replaceOriginal: true })
                                                            }}
                                                            disabled={isConvertingThisTemplate}
                                                            className="w-full rounded px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                            title="Replace this DOCX template with an editable markdown version"
                                                        >
                                                            Replace with Editable
                                                        </button>
                                                    </div>
                                                </details>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => openTemplateEditor(template)}
                                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    Edit
                                                </button>
                                            ))}
                                            <a
                                                href={dataUrl}
                                                download={template.fileName}
                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Download
                                            </a>
                                            {hasSuperAdminAccess && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleExportTemplatePack([template.id])}
                                                    disabled={exportingTemplates || importingTemplatePack}
                                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    Export Pack
                                                </button>
                                            )}
                                            {!isLibraryTemplate && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeTemplate(template.id)}
                                                    className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                </section>

                {editingTemplateId && (
                    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/40 p-4">
                        <div className="mx-auto flex w-full max-w-6xl flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-xl max-h-[calc(100vh-2rem)]">
                            <div className="shrink-0 space-y-3 border-b border-gray-200 pb-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="sr-only" htmlFor="template-editor-name-input">Template name</label>
                                    <input
                                        id="template-editor-name-input"
                                        type="text"
                                        value={templateEditorName}
                                        onChange={(event) => setTemplateEditorName(event.target.value)}
                                        className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm"
                                        placeholder="Template name"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {REPORT_EDITOR_ACTIONS.map((action) => (
                                            <button
                                                key={action.id}
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => handleTemplateEditorCommand(action.command, action.value || null)}
                                                disabled={templateEditorMode !== 'visual'}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                                aria-label={action.label}
                                                title={action.label}
                                            >
                                                {action.icon}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={handleTemplateImageInsertClick}
                                            disabled={templateEditorMode !== 'visual'}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                            aria-label="Insert image"
                                            title={templateImagePickerOpen ? 'Hide image library' : 'Insert image'}
                                        >
                                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                                <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
                                                <path d="M5.5 12l2.7-2.7a1 1 0 0 1 1.4 0L12 12" />
                                                <circle cx="8.1" cy="7.7" r="1.1" fill="currentColor" stroke="none" />
                                            </svg>
                                        </button>
                                        <div className="inline-flex overflow-hidden rounded-md border border-stone-200 bg-white">
                                            <button
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => handleSelectedTemplateImageAlignment('left')}
                                                disabled={templateEditorMode !== 'visual'}
                                                className="inline-flex h-8 w-8 items-center justify-center text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                                aria-label="Align selected image left"
                                                title="Align selected image left"
                                            >
                                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                                    <path d="M3.5 5h13" />
                                                    <path d="M3.5 9h7" />
                                                    <path d="M3.5 13h9" />
                                                    <path d="M3.5 17h6" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => handleSelectedTemplateImageAlignment('center')}
                                                disabled={templateEditorMode !== 'visual'}
                                                className="inline-flex h-8 w-8 items-center justify-center border-x border-stone-200 text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                                aria-label="Align selected image center"
                                                title="Align selected image center"
                                            >
                                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                                    <path d="M3.5 5h13" />
                                                    <path d="M6.5 9h7" />
                                                    <path d="M5.5 13h9" />
                                                    <path d="M7 17h6" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => handleSelectedTemplateImageAlignment('right')}
                                                disabled={templateEditorMode !== 'visual'}
                                                className="inline-flex h-8 w-8 items-center justify-center text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                                                aria-label="Align selected image right"
                                                title="Align selected image right"
                                            >
                                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                                    <path d="M3.5 5h13" />
                                                    <path d="M9.5 9h7" />
                                                    <path d="M7.5 13h9" />
                                                    <path d="M10.5 17h6" />
                                                </svg>
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={handleRemoveSelectedTemplateImage}
                                            disabled={templateEditorMode !== 'visual'}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800 disabled:opacity-60"
                                            aria-label="Delete selected image"
                                            title="Delete selected image"
                                        >
                                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                                <path d="M4.5 6h11" />
                                                <path d="M7.5 6V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6" />
                                                <path d="M6.5 6l.8 9.2a1 1 0 0 0 1 .8h3.4a1 1 0 0 0 1-.8l.8-9.2" />
                                            </svg>
                                        </button>
                                    </div>
                                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white">
                                        <button
                                            type="button"
                                            onClick={() => handleTemplateEditorModeChange('visual')}
                                            className={`px-2.5 py-1 text-xs font-medium ${templateEditorMode === 'visual' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                                        >
                                            Visual
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleTemplateEditorModeChange('markdown')}
                                            className={`border-l border-gray-300 px-2.5 py-1 text-xs font-medium ${templateEditorMode === 'markdown' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                                        >
                                            Markdown
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleTemplateEditorModeChange('split')}
                                            className={`border-l border-gray-300 px-2.5 py-1 text-xs font-medium ${templateEditorMode === 'split' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                                        >
                                            Split
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={closeTemplateEditor}
                                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Close
                                    </button>
                                </div>

                                {templateImagePickerOpen && (
                                    <div ref={templateImagePickerRef} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Template Image Library</p>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={loadTemplateImageLibrary}
                                                    disabled={templateImagePickerLoading}
                                                    className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
                                                >
                                                    {templateImagePickerLoading ? 'Loading...' : 'Refresh'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setTemplateImagePickerOpen(false)}
                                                    className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-100"
                                                >
                                                    Close
                                                </button>
                                            </div>
                                        </div>
                                        {templateImagePickerError && (
                                            <p className="mb-2 text-xs text-red-600">{templateImagePickerError}</p>
                                        )}
                                        {templateImageGroupSections.map((section) => (
                                            <div key={section.key} className="mb-3 last:mb-0">
                                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                                                    {section.label}
                                                </p>
                                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                                    {section.items.map((item) => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => handleTemplateImageInsertFromLibrary(item)}
                                                            className="overflow-hidden rounded-md border border-stone-200 bg-white text-left hover:border-stone-400"
                                                            title={`Insert ${item.label || item.fileName || 'image'}`}
                                                        >
                                                            <Image
                                                                src={item.src}
                                                                alt={item.label || item.fileName || 'Template image'}
                                                                unoptimized
                                                                width={320}
                                                                height={160}
                                                                className="h-20 w-full object-cover"
                                                            />
                                                            <span className="block truncate px-2 py-1 text-[11px] text-stone-700">{item.label || item.fileName}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                                <div className={`grid min-h-0 gap-3 ${templateEditorMode === 'split' ? 'lg:grid-cols-2' : ''}`}>
                                    {templateEditorMode !== 'markdown' && (
                                        <div ref={templateEditorCanvasRef} className={`relative overflow-hidden rounded-xl border border-stone-200 bg-stone-50 ${templateHasHeaderImage ? 'p-0' : 'p-3'}`}>
                                            <div
                                                key={`template-editor-${templateEditorSyncKey}`}
                                                ref={templateEditorRef}
                                                contentEditable={templateEditorMode === 'visual'}
                                                suppressContentEditableWarning
                                                spellCheck
                                                onClick={handleTemplateEditorClick}
                                                onKeyUp={captureTemplateEditorSelection}
                                                onMouseUp={captureTemplateEditorSelection}
                                                onBlur={() => {
                                                    if (templateEditorMode === 'visual') {
                                                        applyTemplateEditorContentFromDom(getTemplateEditorMarkdownSnapshot())
                                                    }
                                                }}
                                                onInput={() => {
                                                    captureTemplateEditorSelection()
                                                    const editor = templateEditorRef.current
                                                    const imageElement = selectedTemplateImageRef.current
                                                    if (imageElement && !editor?.contains(imageElement)) {
                                                        selectTemplateImage(null)
                                                    } else if (imageElement) {
                                                        updateSelectedTemplateImageBox(imageElement)
                                                    }
                                                }}
                                                className={`${REPORT_DOCUMENT_CLASSES} ${REPORT_TABLE_SURFACE_CLASS} ${REPORT_EDITOR_A4_SURFACE_CLASS} min-h-[320px] outline-none template-editor-surface ${templateHasHeaderImage ? 'template-editor-surface-has-header-image' : ''}`}
                                                aria-label="Template editor"
                                            />
                                            {templateEditorMode === 'visual' && (
                                                <button
                                                    ref={templateImageResizeHandleRef}
                                                    type="button"
                                                    onPointerDown={handleSelectedTemplateImageResizeStart}
                                                    className="absolute z-10 hidden h-4 w-4 rounded-sm border border-teal-700 bg-teal-600 shadow-sm hover:bg-teal-500"
                                                    style={{ cursor: 'nwse-resize' }}
                                                    aria-label="Drag to resize selected image"
                                                    title="Drag to resize selected image"
                                                >
                                                    <span className="sr-only">Drag to resize selected image</span>
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {templateEditorMode !== 'visual' && (
                                        <textarea
                                            value={templateEditorSourceContent}
                                            onChange={(event) => {
                                                const nextSource = String(event.target.value || '')
                                                setTemplateEditorSourceContent(nextSource)
                                                const expanded = expandEmbeddedImageTokensFromSource(nextSource, templateEditorImageTokenMapRef.current)
                                                setTemplateEditorContent(expanded)
                                            }}
                                            className="min-h-[320px] h-[calc(100vh-20rem)] max-h-[720px] w-full resize-y rounded-xl border border-stone-300 bg-white p-3 font-mono text-sm leading-6 text-stone-900 outline-none focus:border-stone-500"
                                            aria-label="Template markdown source"
                                            placeholder="Write markdown template content here"
                                            spellCheck
                                        />
                                    )}
                                </div>

                                {(templateEditorMissingPlaceholders.length > 0 || templateEditorMissingAnchors.length > 0) && (
                                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                        <p className="font-semibold">Template checks</p>
                                        {templateEditorMissingPlaceholders.length > 0 && (
                                            <p className="mt-1">
                                                Missing placeholders: {templateEditorMissingPlaceholders.join(', ')}
                                            </p>
                                        )}
                                        {templateEditorMissingAnchors.length > 0 && (
                                            <p className="mt-1">
                                                Missing anchor text: {templateEditorMissingAnchors.join(', ')}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {templateEditorError && (
                                    <p className="mt-2 text-xs text-red-600">{templateEditorError}</p>
                                )}

                            </div>

                            <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 pt-4">
                                <button
                                    type="button"
                                    onClick={closeTemplateEditor}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={saveTemplateEditor}
                                    disabled={templateEditorSaving}
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {templateEditorSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {docxPreviewOpen && (
                    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/40 p-4">
                        <div className="mx-auto flex w-full max-w-4xl flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-xl max-h-[calc(100vh-2rem)]">
                            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 pb-4">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900">DOCX Preview</h3>
                                    <p className="mt-1 text-xs text-gray-600">{docxPreviewName || 'Template'}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeDocxPreview}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                                {docxPreviewLoading ? (
                                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">Converting DOCX for preview...</div>
                                ) : docxPreviewError ? (
                                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{docxPreviewError}</div>
                                ) : docxPreviewHtml ? (
                                    <div className={`${REPORT_DOCUMENT_CLASSES} ${REPORT_TABLE_SURFACE_CLASS}`} dangerouslySetInnerHTML={{ __html: docxPreviewHtml }} />
                                ) : (
                                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">No preview content available.</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {isTemplateLibraryModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
                        <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900">Template Library</h3>
                                    <p className="mt-1 text-xs text-gray-600">
                                        Read-only Markdown files from <span className="font-mono text-gray-800">{templateLibraryPath || 'No path configured'}</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={loadTemplateLibrary}
                                        disabled={loadingTemplateLibrary}
                                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {loadingTemplateLibrary ? 'Loading...' : 'Refresh'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsTemplateLibraryModalOpen(false)}
                                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 max-h-80 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2">
                                {loadingTemplateLibrary ? (
                                    <p className="px-2 py-3 text-sm text-gray-600">Loading Markdown templates...</p>
                                ) : templateLibraryFiles.length === 0 ? (
                                    <p className="px-2 py-3 text-sm text-gray-600">
                                        {templateLibraryPath ? 'No .md files found in this directory.' : 'Configure a Template Library path in Domain Settings first.'}
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {templateLibraryFiles.map((file) => {
                                            const alreadyLoaded = settings.templates.some((template) => template.id === file.id)
                                            return (
                                                <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-gray-900">{file.name || file.fileName}</p>
                                                        <p className="truncate text-xs text-gray-500">{file.relativePath || file.fileName}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => addTemplateLibraryFile(file)}
                                                        disabled={alreadyLoaded}
                                                        className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        {alreadyLoaded ? 'Loaded' : 'Load'}
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {isImportTemplatePackConfirmOpen && pendingTemplatePackFile && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
                        <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900">Import Template Pack</h3>
                                    <p className="mt-1 text-sm text-gray-600">This will apply the selected package to the active domain.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeImportTemplatePackConfirm}
                                    disabled={importingTemplatePack}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                Importing will reload report settings for <span className="font-medium">{activeDomain}</span> after the package is applied. Any unsaved local edits currently on this page will be replaced.
                            </div>

                            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                                <p className="font-medium text-gray-900">Selected file</p>
                                <p className="mt-1 break-all">{pendingTemplatePackFile.name}</p>
                            </div>

                            <div className="mt-5 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={closeImportTemplatePackConfirm}
                                    disabled={importingTemplatePack}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleImportTemplatePack}
                                    disabled={importingTemplatePack}
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {importingTemplatePack ? 'Importing...' : 'Confirm Import'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900">Configuration</h2>

                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label>
                            <span className="text-xs font-medium text-gray-700">Default report type</span>
                            <select
                                value={settings.config.defaultReportTypeId || ''}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: {
                                        ...prev.config,
                                        defaultReportTypeId: event.target.value,
                                    },
                                }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {settings.reportTypes.map((type) => (
                                    <option key={type.id} value={type.id}>{type.name}</option>
                                ))}
                            </select>
                        </label>

                        <label>
                            <span className="text-xs font-medium text-gray-700">Report AI preset</span>
                            <select
                                value={`${settings.config.aiProvider || DEFAULT_CONFIG.aiProvider}:${settings.config.aiModelTier || DEFAULT_CONFIG.aiModelTier}`}
                                onChange={(event) => {
                                    const next = parseProviderTierSelection(event.target.value)
                                    setSettings((prev) => ({
                                        ...prev,
                                        config: {
                                            ...prev.config,
                                            aiProvider: next.provider,
                                            aiModelTier: next.tier,
                                        },
                                    }))
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {reportAiPresetOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <div className="md:col-span-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                            Selected provider: {getReportAiProviderDisplayName(settings.config.aiProvider || DEFAULT_CONFIG.aiProvider)}
                            {' · '}
                            Tier: {MODEL_TIER_LABELS[settings.config.aiModelTier] || settings.config.aiModelTier}
                            {' · '}
                            API key status: {settings.config?.hasProviderApiKeys?.[settings.config.aiProvider || DEFAULT_CONFIG.aiProvider] ? 'Configured' : 'Not configured'}
                        </div>

                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Provider details</span>
                            <textarea
                                value={settings.config.providerDetails || ''}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: { ...prev.config, providerDetails: event.target.value },
                                }))}
                                rows={4}
                                placeholder="Provider name, address, phone, email and registration details"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-xs text-gray-500">Used for the <code>{'{{provider_details}}'}</code> report placeholder.</span>
                        </label>

                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Report header line</span>
                            <input
                                type="text"
                                value={settings.config.reportHeaderText || ''}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: { ...prev.config, reportHeaderText: event.target.value },
                                }))}
                                placeholder="e.g. Kate O'Callaghan · Occupational Therapist · AHPRA registered"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-xs text-gray-500">Printed under the logo at the top of every report page and in the exported Word file. Leave blank to use the first line of Provider details.</span>
                        </label>

                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Report header logo URL</span>
                            <input
                                type="text"
                                value={settings.config.reportHeaderLogoUrl || ''}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: { ...prev.config, reportHeaderLogoUrl: event.target.value },
                                }))}
                                placeholder="/<domain>/logo.png (blank uses the domain logo)"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-xs text-gray-500">Optional. Blank uses the domain&apos;s own <code>/&lt;domain&gt;/logo.png</code>.</span>
                        </label>

                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Days and hours available</span>
                            <textarea
                                value={settings.config.daysHoursAvailable || ''}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: { ...prev.config, daysHoursAvailable: event.target.value },
                                }))}
                                rows={3}
                                placeholder="For example: Monday-Friday, 9:00 am-5:00 pm"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-xs text-gray-500">Used for the <code>{'{{days_hours_available}}'}</code> report placeholder.</span>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={settings.config.includeSourceNotesByDefault === true}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: {
                                        ...prev.config,
                                        includeSourceNotesByDefault: event.target.checked,
                                    },
                                }))}
                            />
                            Include source notes by default
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={settings.config.autoSaveDrafts === true}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: {
                                        ...prev.config,
                                        autoSaveDrafts: event.target.checked,
                                    },
                                }))}
                            />
                            Auto-save report drafts
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={settings.config.requireTemplateForGeneration === true}
                                onChange={(event) => setSettings((prev) => ({
                                    ...prev,
                                    config: {
                                        ...prev.config,
                                        requireTemplateForGeneration: event.target.checked,
                                    },
                                }))}
                            />
                            Require template for report generation
                        </label>
                    </div>
                </section>
            </main>
            <style jsx global>{`
                ${buildCalloutCssRules(`.${REPORT_TABLE_SURFACE_CLASS}`).join('\n')}
                ${buildCoverCssRules(`.${REPORT_TABLE_SURFACE_CLASS}`).join('\n')}

                .${REPORT_TABLE_SURFACE_CLASS} .template-header-image {
                    display: block;
                    margin-top: 0;
                    margin-left: -2.5rem;
                    margin-right: -2.5rem;
                    width: calc(100% + 5rem);
                    max-width: none;
                    height: auto;
                    object-fit: contain;
                    object-position: initial;
                    margin-bottom: 1.5rem;
                }

                @media (max-width: 640px) {
                    .${REPORT_TABLE_SURFACE_CLASS} .template-header-image {
                        height: auto;
                    }
                }

                .${REPORT_TABLE_SURFACE_CLASS} .template-inline-image {
                    display: block;
                    max-width: 100%;
                    height: auto;
                    margin: 1rem 0;
                }

                .${REPORT_TABLE_SURFACE_CLASS} .template-placeholder-token {
                    display: inline-block;
                    max-width: 100%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    vertical-align: bottom;
                    white-space: nowrap;
                }

                .${REPORT_TABLE_SURFACE_CLASS} .template-editor-selected-image {
                    outline: 2px solid #0f766e;
                    outline-offset: 2px;
                }

                .${REPORT_TABLE_SURFACE_CLASS} .template-editor-selected-image:hover {
                    cursor: default;
                }

                .template-editor-surface > :first-child .template-header-image {
                    margin-top: 0;
                }

                .template-editor-surface-has-header-image {
                    padding-top: 0 !important;
                }

                .${REPORT_EDITOR_A4_SURFACE_CLASS} {
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
                }

                @media print {
                    .${REPORT_EDITOR_A4_SURFACE_CLASS} {
                        background-image: none;
                    }
                }

                .${REPORT_TABLE_SURFACE_CLASS} table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1rem 0;
                }

                .${REPORT_TABLE_SURFACE_CLASS} th,
                .${REPORT_TABLE_SURFACE_CLASS} td {
                    border: 1px solid #a8a29e;
                    padding: 0.375rem 0.5rem;
                    vertical-align: top;
                }

                .${REPORT_TABLE_SURFACE_CLASS} th {
                    background-color: #f5f5f4;
                    font-weight: 600;
                    text-align: left;
                }
            `}</style>
        </div>
    )
}
