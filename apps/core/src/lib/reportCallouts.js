// Boxed callouts in report markdown.
//
// A blockquote that opens with a `[!variant]` marker is a callout: the preview draws it as the
// coloured, fully bordered box the practice uses for weight-of-evidence notes and the closing
// clinical opinion, and the DOCX writer emits the same box as a shaded, bordered paragraph. The
// marker itself never reaches the reader. A blockquote without a marker keeps the plain quote style.
//
//   > [!evidence] **Weight of evidence.** Findings resting on my direct observation ...
//   > [!summary] **Summary.** Most of the risks above are mitigated by a support person ...
//   > [!finding] **It is not recommended** that the bed rails be removed ...
//   > [!opinion] **Clinical opinion.** An increase in funded core supports to seven hours per day ...
//
// The variant names and their colours live in `reportPageMetrics`, which both the stylesheet and the
// DOCX writer read, so the two renderings cannot drift apart.
//
// Lives in `src/lib` (rather than in the export route or the viewer) because the markdown preview,
// the DOCX export and the unit tests all need the same interpretation of the marker.

import {
    calloutBorderEighths,
    REPORT_CALLOUT_BORDER_SPACE_POINTS,
    REPORT_CALLOUT_VARIANTS,
} from './reportPageMetrics.js'

const CALLOUT_MARKER_PATTERN = /^\s*\[!([A-Za-z][A-Za-z0-9-]*)\]\s*([\s\S]*)$/

// Marker spellings a writer might reach for, mapped onto the palettes we actually draw.
// `recommendation` shares the solid navy opinion box - the reference report draws the funding
// request and the closing clinical opinion identically.
const CALLOUT_VARIANT_ALIASES = {
    evidence: 'evidence',
    'weight-of-evidence': 'evidence',
    weight: 'evidence',
    summary: 'summary',
    'section-summary': 'summary',
    'in-short': 'summary',
    precis: 'summary',
    finding: 'finding',
    determination: 'finding',
    'clinical-finding': 'finding',
    context: 'finding',
    opinion: 'opinion',
    'clinical-opinion': 'opinion',
    recommendation: 'opinion',
    notice: 'notice',
    cover: 'notice',
    'cover-notice': 'notice',
}

export function normalizeCalloutVariant(value) {
    const key = String(value || '').trim().toLowerCase()
    return CALLOUT_VARIANT_ALIASES[key] || null
}

export function resolveCalloutPalette(variant) {
    const name = normalizeCalloutVariant(variant)
    if (!name) return null
    return { name, ...REPORT_CALLOUT_VARIANTS[name] }
}

/**
 * Splits a `[!variant]` marker off the start of a line.
 *
 * Returns null for an unknown variant so that text such as `[!cite: 3]` survives untouched rather than
 * being swallowed as a malformed callout.
 */
export function parseCalloutMarker(value) {
    const match = String(value || '').match(CALLOUT_MARKER_PATTERN)
    if (!match) return null
    const variant = normalizeCalloutVariant(match[1])
    if (!variant) return null
    return { variant, text: match[2].trim() }
}

/**
 * Removes the marker from the first line of a blockquote split into blank-line-separated blocks, the
 * shape the DOCX writer already builds from `>` lines.
 */
export function takeCalloutFromBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return { variant: '', blocks: [] }

    const firstBlock = blocks[0]
    if (!Array.isArray(firstBlock) || firstBlock.length === 0) return { variant: '', blocks }

    const parsed = parseCalloutMarker(firstBlock[0])
    if (!parsed) return { variant: '', blocks }

    const nextBlocks = blocks
        .map((block, index) => {
            if (index !== 0) return block
            return parsed.text ? [parsed.text, ...block.slice(1)] : block.slice(1)
        })
        .filter((block) => block.length > 0)

    return { variant: parsed.variant, blocks: nextBlocks }
}

/**
 * The `<w:pBdr>` rule for a callout: a full border on all four sides, in the variant's colour.
 *
 * Each side can carry its own width; variants that do not define one keep the uniform callout
 * border, which is how the classic treatments stay unchanged.
 */
export function buildCalloutBorderXml(variant) {
    const palette = resolveCalloutPalette(variant)
    if (!palette) return ''
    const widths = calloutBorderEighths(palette)
    const side = (name) => `<w:${name} w:val="single" w:sz="${widths[name]}" w:space="${REPORT_CALLOUT_BORDER_SPACE_POINTS}" w:color="${palette.borderColor}"/>`
    return `<w:pBdr>${['top', 'left', 'bottom', 'right'].map(side).join('')}</w:pBdr>`
}

/** The `<w:shd>` fill for a callout box. */
export function buildCalloutShadingXml(variant) {
    const palette = resolveCalloutPalette(variant)
    if (!palette) return ''
    return `<w:shd w:val="clear" w:color="auto" w:fill="${palette.fillColor}"/>`
}

/**
 * Rewrites `[!variant]` markers into the `data-callout` attribute the report stylesheet keys on.
 *
 * Written as a remark plugin with no dependencies: a marker only ever appears at the start of the
 * first text node of a blockquote's first paragraph, so plain tree walking is enough, and going
 * through the AST means the marker is removed from the rendered text rather than hidden with CSS.
 */
export function remarkReportCallouts() {
    return (tree) => {
        visitCallouts(tree)
    }
}

function visitCallouts(node) {
    if (!node || !Array.isArray(node.children)) return

    node.children = node.children.filter((child) => {
        visitCallouts(child)
        if (child?.type !== 'blockquote') return true
        applyCalloutToBlockquote(child)
        return child.children.length > 0
    })
}

function applyCalloutToBlockquote(node) {
    const firstParagraph = node.children[0]
    if (firstParagraph?.type !== 'paragraph') return

    const firstText = firstParagraph.children?.[0]
    if (firstText?.type !== 'text') return

    const parsed = parseCalloutMarker(firstText.value)
    if (!parsed) return

    if (parsed.text) {
        firstText.value = parsed.text
    } else {
        firstParagraph.children.shift()
        if (firstParagraph.children.length === 0) node.children.shift()
    }

    const data = node.data || (node.data = {})
    data.hProperties = {
        ...(data.hProperties || {}),
        'data-callout': parsed.variant,
        className: ['report-callout', `report-callout--${parsed.variant}`],
    }
}
