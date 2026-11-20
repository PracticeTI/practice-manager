// The single source of truth for the page a report is displayed on and the page it is exported to.
//
// The preview paginator (`src/components/A4PagedReport.jsx`) measures real DOM heights, and the DOCX
// writer emits WordprocessingML measurements. They can only agree on where a page breaks if both are
// derived from the same numbers, so every page, margin, font, leading and block-spacing value in
// either path comes from here.
//
// Word measures in twips (1/1440 inch) and half-points (1/2 point). The browser measures in CSS
// pixels at 96 dpi, where 1 point is 4/3 px.

const TWIPS_PER_INCH = 1440
const TWIPS_PER_POINT = 20
const PX_PER_POINT = 4 / 3

export const twipsToPx = (twips) => (Number(twips) / TWIPS_PER_POINT) * PX_PER_POINT
export const pointsToPx = (points) => Number(points) * PX_PER_POINT
export const halfPointsToPx = (halfPoints) => pointsToPx(Number(halfPoints) / 2)
export const inchesToTwips = (inches) => Math.round(Number(inches) * TWIPS_PER_INCH)

// A4, 210mm x 297mm, rounded to the twip. Word stores the page at this size and the paginator uses
// the matching whole-pixel page, so the two cannot drift by the fraction of a pixel that 210mm does
// not divide evenly into 96 dpi pixels.
export const REPORT_PAGE_WIDTH_TWIPS = 11906
export const REPORT_PAGE_HEIGHT_TWIPS = 16838
export const REPORT_PAGE_MARGIN_TWIPS = inchesToTwips(0.75)

export const REPORT_PAGE_WIDTH_PX = Math.round(twipsToPx(REPORT_PAGE_WIDTH_TWIPS))
export const REPORT_PAGE_HEIGHT_PX = Math.round(twipsToPx(REPORT_PAGE_HEIGHT_TWIPS))
export const REPORT_PAGE_MARGIN_PX = Math.round(twipsToPx(REPORT_PAGE_MARGIN_TWIPS))

export const REPORT_CONTENT_WIDTH_PX = REPORT_PAGE_WIDTH_PX - REPORT_PAGE_MARGIN_PX * 2
export const REPORT_CONTENT_HEIGHT_PX = REPORT_PAGE_HEIGHT_PX - REPORT_PAGE_MARGIN_PX * 2

// Body text: Times New Roman 12pt on 14pt leading, with a full line of space after each paragraph.
// The reference FCA measures 13.5pt leading with a 6pt gap, which is legible on paper but reads
// cramped on screen and in the exported page; a full line between paragraphs gives the body the
// separation the finished reports have, and the extra half-point of leading stops 12pt Times from
// looking set solid.
//
// The leading is written as an absolute value (`w:lineRule="exact"`) rather than a multiple of
// single spacing. Word's "single" for 12pt Times is ~13.8pt and `w:lineRule="auto"` multiplies it,
// so an `auto` value cannot be made to equal the preview's `line-height`, which is absolute.
export const REPORT_BODY_FONT_FAMILY = 'Times New Roman'
export const REPORT_BODY_FONT_STACK = "'Times New Roman', Times, serif"
export const REPORT_BODY_FONT_SIZE_HALF_POINTS = 24
export const REPORT_BODY_FONT_SIZE_PX = halfPointsToPx(REPORT_BODY_FONT_SIZE_HALF_POINTS)
export const REPORT_BODY_LINE_TWIPS = 280
export const REPORT_BODY_LINE_HEIGHT_PX = twipsToPx(REPORT_BODY_LINE_TWIPS)
export const REPORT_BODY_SPACE_BEFORE_TWIPS = 0
// One line: the gap between two paragraphs is the same as the distance between two lines of one.
export const REPORT_BODY_SPACE_AFTER_TWIPS = REPORT_BODY_LINE_TWIPS

/** Format a pixel measurement for a CSS value or a Tailwind arbitrary value. */
export const px = (value) => `${Math.round(Number(value) * 1000) / 1000}px`

/**
 * Heading scale, shared by the DOCX styles and the preview classes. Each level carries its Word size
 * in half-points, its word spacing in twips, and its line height in twips; the pixel values the
 * preview uses are converted from exactly those numbers.
 */
export const REPORT_HEADING_SCALE = [
    { level: 1, sizeHalfPoints: 36, lineTwips: 450, beforeTwips: 240, afterTwips: 120, color: '0C4A6E' },
    { level: 2, sizeHalfPoints: 30, lineTwips: 390, beforeTwips: 220, afterTwips: 100, color: '115E59' },
    { level: 3, sizeHalfPoints: 26, lineTwips: 330, beforeTwips: 180, afterTwips: 80, color: '0F766E' },
]

/** The level-2 rule the preview draws under each section heading, carried into the DOCX too. */
export const REPORT_HEADING_RULE = {
    level: 2,
    sizeEighths: 6,
    spacePoints: 3,
    color: 'CCFBF1',
    paddingPx: pointsToPx(3),
}

export function reportHeadingMetrics(level) {
    const entry = REPORT_HEADING_SCALE.find((item) => item.level === Number(level))
    if (!entry) return null
    return {
        ...entry,
        sizePx: halfPointsToPx(entry.sizeHalfPoints),
        lineHeightPx: twipsToPx(entry.lineTwips),
        beforePx: twipsToPx(entry.beforeTwips),
        afterPx: twipsToPx(entry.afterTwips),
    }
}

// List and quote geometry. Word's `w:ind`/`w:spacing` values here are the ones the exporter writes,
// so the preview indents by the same amounts instead of by whatever Tailwind's scale suggests.
export const REPORT_LIST_INDENT_TWIPS = 720
export const REPORT_LIST_HANGING_TWIPS = 360
export const REPORT_LIST_ITEM_SPACE_AFTER_TWIPS = 60
export const REPORT_LIST_INDENT_PX = twipsToPx(REPORT_LIST_INDENT_TWIPS)
export const REPORT_LIST_HANGING_PX = twipsToPx(REPORT_LIST_HANGING_TWIPS)
export const REPORT_LIST_ITEM_SPACE_AFTER_PX = twipsToPx(REPORT_LIST_ITEM_SPACE_AFTER_TWIPS)

export const REPORT_QUOTE_SPACE_TWIPS = 240
export const REPORT_QUOTE_BORDER_SIZE_EIGHTHS = 24
export const REPORT_QUOTE_BORDER_SPACE_POINTS = 12
export const REPORT_QUOTE_BORDER_COLOR = 'B2DFDB'
export const REPORT_QUOTE_FILL_COLOR = 'F0FDFA'
export const REPORT_QUOTE_SPACE_PX = twipsToPx(REPORT_QUOTE_SPACE_TWIPS)
export const REPORT_QUOTE_PADDING_PX = pointsToPx(REPORT_QUOTE_BORDER_SPACE_POINTS)

// Branded page header. The practice's reference FCA runs the logo, one credential line and a
// hairline rule at the top of every page, with the body starting below it. These measurements are
// the single source for the preview paginator and the Word header, so a page break lands at the
// same place in both. `REPORT_BRANDED_PAGE_MARGIN_TWIPS` is the body's top margin when the header is
// drawn; an unbranded report keeps `REPORT_PAGE_MARGIN_TWIPS`.
export const REPORT_HEADER_TOP_TWIPS = inchesToTwips(0.2)
export const REPORT_HEADER_LOGO_HEIGHT_TWIPS = inchesToTwips(0.3)
export const REPORT_HEADER_LOGO_GAP_TWIPS = inchesToTwips(0.05)
export const REPORT_HEADER_TEXT_HALF_POINTS = 16
export const REPORT_HEADER_TEXT_COLOR = '475569'
export const REPORT_HEADER_RULE_COLOR = 'B2DFDB'
export const REPORT_HEADER_RULE_SIZE_EIGHTHS = 6
export const REPORT_HEADER_RULE_SPACE_TWIPS = inchesToTwips(0.04)
export const REPORT_BRANDED_PAGE_MARGIN_TWIPS = inchesToTwips(1.05)

export const REPORT_HEADER_TOP_PX = twipsToPx(REPORT_HEADER_TOP_TWIPS)
export const REPORT_HEADER_LOGO_HEIGHT_PX = twipsToPx(REPORT_HEADER_LOGO_HEIGHT_TWIPS)
export const REPORT_HEADER_LOGO_GAP_PX = twipsToPx(REPORT_HEADER_LOGO_GAP_TWIPS)
export const REPORT_HEADER_TEXT_SIZE_PX = halfPointsToPx(REPORT_HEADER_TEXT_HALF_POINTS)
export const REPORT_HEADER_RULE_WIDTH_PX = Math.max(1, Math.round((REPORT_HEADER_RULE_SIZE_EIGHTHS / 8) * PX_PER_POINT))
export const REPORT_HEADER_RULE_SPACE_PX = twipsToPx(REPORT_HEADER_RULE_SPACE_TWIPS)
export const REPORT_BRANDED_PAGE_MARGIN_PX = twipsToPx(REPORT_BRANDED_PAGE_MARGIN_TWIPS)

// Cover page. The practice's reference FCA sets its cover in Calibri - not the report body's Times -
// and every size, colour and gap below is measured from that page. The template marks each cover
// line with `data-cover-line="<kind>"`; the preview stylesheet and the DOCX writer both read this
// table, so the on-screen cover and the printed one stay in step.
export const REPORT_COVER_FONT_FAMILY = 'Calibri'
export const REPORT_COVER_FONT_STACK = "'Calibri', 'Carlito', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

export const REPORT_COVER_SCALE = {
    eyebrow: { sizePoints: 15, bold: true, color: '3C5488', letterSpacingPoints: 1.2, beforePoints: 46, afterPoints: 8 },
    title: { sizePoints: 24, bold: true, color: '011A4C', linePoints: 29.5, beforePoints: 0, afterPoints: 13 },
    rule: { thicknessPoints: 1.5, color: '011A4C', afterPoints: 16 },
    name: { sizePoints: 17, bold: false, color: '000000', linePoints: 21, beforePoints: 0, afterPoints: 7 },
    meta: { sizePoints: 10, bold: false, color: '595959', linePoints: 13, beforePoints: 0, afterPoints: 13 },
    provider: { sizePoints: 10, bold: false, color: '595959', leadSizePoints: 11, leadColor: '000000', linePoints: 13.5, beforePoints: 27, afterPoints: 0 },
    practice: { sizePoints: 9.5, bold: false, color: '595959', linePoints: 13, beforePoints: 2, afterPoints: 0 },
}


// Callouts. A blockquote whose first line opens with a callout marker is drawn as a fully bordered,
// filled box instead of the plain quote's left rule - the format the practice already uses in its own
// reports. The palette lives here so the preview stylesheet and the DOCX writer paint the same box.
//
// The treatments are the practice's own, taken from its reference FCA:
// - `evidence`  green, used once for a weight-of-evidence note.
// - `summary`   rose, for the short bold-labelled precis that closes a substantial section.
// - `finding`   outlined navy, for a key clinical determination that is not a recommendation.
// - `opinion`   solid navy, for the funding request and the closing clinical opinion.
// - `notice`    outlined navy cover box: the reference cover's "Prepared for ..." panel, drawn with
//               a hairline rule and a heavy left edge rather than the uniform callout border.
export const REPORT_CALLOUT_BORDER_SIZE_EIGHTHS = 12
export const REPORT_CALLOUT_BORDER_SPACE_POINTS = 8
export const REPORT_CALLOUT_PADDING_PX = pointsToPx(REPORT_CALLOUT_BORDER_SPACE_POINTS)

export const REPORT_CALLOUT_VARIANTS = {
    evidence: {
        borderColor: '5E7A3B',
        fillColor: 'ECF5E6',
        textColor: '1C1917',
        labelColor: '3F6212',
    },
    summary: {
        borderColor: '8A1538',
        fillColor: 'FBEEF2',
        textColor: '1C1917',
        labelColor: '8A1538',
    },
    finding: {
        borderColor: '011A4C',
        fillColor: 'EDF0F6',
        textColor: '1C1917',
        labelColor: '011A4C',
    },
    opinion: {
        borderColor: '011A4C',
        fillColor: '011A4C',
        textColor: 'FFFFFF',
        labelColor: 'FFFFFF',
    },
    notice: {
        borderColor: '011A4C',
        fillColor: 'EDF0F6',
        textColor: '1C1917',
        labelColor: '011A4C',
        borderEighths: { top: 4, right: 4, bottom: 4, left: 16 },
        align: 'center',
        // Both lines live in one Word paragraph so the printed box has a single border, not one
        // per paragraph relying on Word's adjacent-border merge.
        singleBox: true,
    },
}

/**
 * The callout's border width on each side, in eighths of a point - the unit `w:sz` uses.
 *
 * Variants without their own widths keep the uniform callout border, so the existing treatments
 * render exactly as before.
 */
export function calloutBorderEighths(variant) {
    const sides = ['top', 'right', 'bottom', 'left']
    const custom = variant?.borderEighths || {}
    return Object.fromEntries(sides.map((side) => {
        const value = Number(custom[side])
        return [side, Number.isFinite(value) && value > 0 ? value : REPORT_CALLOUT_BORDER_SIZE_EIGHTHS]
    }))
}

// Tables: Word's default cell margin is 0.08in each side, with no vertical padding. The preview used
// 12px/8px at 14px text, which wrapped differently from the exported table.
export const REPORT_TABLE_CELL_MARGIN_TWIPS = 115
export const REPORT_TABLE_CELL_MARGIN_PX = twipsToPx(REPORT_TABLE_CELL_MARGIN_TWIPS)
export const REPORT_TABLE_BORDER_COLOR = '808080'
export const REPORT_TABLE_BORDER_SIZE_EIGHTHS = 6

/**
 * The callout rules for a given scope.
 *
 * Shared by the report paginator's stylesheet and the template editor preview, so a boxed callout
 * looks the same before a report exists as it does after one is generated.
 */
export function buildCalloutCssRules(scope = '.report-page') {
    const sides = ['top', 'right', 'bottom', 'left']
    const toPixels = (eighths) => px(Math.max(1, Math.round(Number(eighths) / 6)))

    return Object.entries(REPORT_CALLOUT_VARIANTS).flatMap(([name, variant]) => {
        const widths = calloutBorderEighths(variant)
        const uniform = sides.every((side) => widths[side] === widths.top)
        const border = uniform
            ? `border: ${toPixels(widths.top)} solid #${variant.borderColor}`
            : `border-style: solid; border-color: #${variant.borderColor}; border-width: ${sides.map((side) => toPixels(widths[side])).join(' ')}`
        const align = variant.align ? ` text-align: ${variant.align};` : ''
        const selector = `${scope} blockquote[data-callout="${name}"]`

        return [
            `${selector} { padding: ${px(REPORT_CALLOUT_PADDING_PX)}; ${border}; background: #${variant.fillColor}; color: #${variant.textColor}; font-style: normal;${align} }`,
            `${selector} p { margin: 0; color: inherit; }`,
            `${selector} strong { color: #${variant.labelColor}; }`,
        ]
    })
}

/**
 * The cover rules for a given scope, mirroring the reference FCA cover.
 *
 * Shared by the report paginator's stylesheet and the template editor preview, so the cover reads
 * the same in the library as it does once a report is generated.
 */
export function buildCoverCssRules(scope = '.report-page') {
    const line = (kind) => {
        const metrics = REPORT_COVER_SCALE[kind]
        const lineHeight = metrics.linePoints ? ` line-height: ${px(pointsToPx(metrics.linePoints))};` : ''
        return `${scope} [data-cover-line="${kind}"] { font-family: ${REPORT_COVER_FONT_STACK}; font-size: ${px(pointsToPx(metrics.sizePoints))}; font-weight: ${metrics.bold ? 700 : 400}; color: #${metrics.color};${lineHeight} text-align: center; margin: ${px(pointsToPx(metrics.beforePoints))} 0 ${px(pointsToPx(metrics.afterPoints))}; }`
    }
    const eyebrow = REPORT_COVER_SCALE.eyebrow
    const rule = REPORT_COVER_SCALE.rule

    return [
        line('eyebrow'),
        `${scope} [data-cover-line="eyebrow"] { letter-spacing: ${px(pointsToPx(eyebrow.letterSpacingPoints))}; }`,
        line('title'),
        `${scope} [data-cover-line="rule"] { height: 0; border: 0; border-top: ${Math.max(1, Math.round(pointsToPx(rule.thicknessPoints)))}px solid #${rule.color}; margin: 0 0 ${px(pointsToPx(rule.afterPoints))}; }`,
        line('name'),
        line('meta'),
        line('provider'),
        `${scope} [data-cover-line="provider"] strong { font-size: ${px(pointsToPx(REPORT_COVER_SCALE.provider.leadSizePoints))}; font-weight: 700; color: #000000; }`,
        line('practice'),
    ]
}

/**
 * The stylesheet the paginator measures against.
 *
 * Written as CSS rather than as Tailwind classes because these values are computed: a utility name
 * assembled at runtime (`mb-[${...}px]`) is invisible to Tailwind's scanner, so the rule never
 * reaches the page and the element silently keeps the reset. That is what left paragraphs with no
 * space after them and headings at body size.
 */
export function buildReportPageCss(scopeClass = 'report-page') {
    const scope = `.${scopeClass}`
    const heading = (level, metrics) => `
${scope} h${level} { margin: ${px(metrics.beforePx)} 0 ${px(metrics.afterPx)}; font-size: ${px(metrics.sizePx)}; line-height: ${px(metrics.lineHeightPx)}; font-weight: 600; color: #0f766e; }`
    const h1 = reportHeadingMetrics(1)
    const h2 = reportHeadingMetrics(2)
    const h3 = reportHeadingMetrics(3)

    return [
        `${scope} { font-family: ${REPORT_BODY_FONT_STACK}; font-size: ${px(REPORT_BODY_FONT_SIZE_PX)}; line-height: ${px(REPORT_BODY_LINE_HEIGHT_PX)}; color: #1c1917; }`,
        `${scope} p { margin: 0 0 ${px(twipsToPx(REPORT_BODY_SPACE_AFTER_TWIPS))}; white-space: pre-wrap; }`,
        heading(1, h1),
        heading(2, h2),
        heading(3, h3),
        `${scope} h1 { text-align: center; color: #134e4a; }`,
        `${scope} h2 { color: #115e59; border-bottom: 1px solid #ccfbf1; padding-bottom: ${px(REPORT_HEADING_RULE.paddingPx)}; }`,
        `${scope} strong { font-weight: 600; color: #0c0a09; }`,
        `${scope} ul, ${scope} ol { margin: 0; padding-left: ${px(REPORT_LIST_INDENT_PX)}; }`,
        `${scope} ul { list-style: disc outside; }`,
        `${scope} ol { list-style: decimal outside; }`,
        `${scope} li { margin: 0 0 ${px(REPORT_LIST_ITEM_SPACE_AFTER_PX)}; padding-left: 0; }`,
        `${scope} blockquote { margin: ${px(REPORT_QUOTE_SPACE_PX)} 0; padding: 0 0 0 16px; border-left: 4px solid #99f6e4; background: rgba(240, 253, 250, 0.4); color: #44403c; }`,
        `${scope} blockquote p { margin: 0; }`,
        ...buildCalloutCssRules(scope),
        ...buildCoverCssRules(scope),
        `${scope} pre { margin: 16px 0; padding: 16px; overflow: auto; border-radius: 6px; background: #f5f5f4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; line-height: 24px; }`,
        `${scope} code { border-radius: 4px; background: #f5f5f4; padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }`,
        `${scope} a { color: #0369a1; text-decoration: underline; }`,
        `${scope} hr { margin: 24px 0; border: 0; border-top: 1px solid #e7e5e4; }`,
        `${scope} img { display: block; margin: 0 auto 16px; max-width: 100%; height: auto; }`,
        `${scope} table { width: 100%; margin: 0; border-collapse: collapse; }`,
        `${scope} th, ${scope} td { border: 1px solid #${REPORT_TABLE_BORDER_COLOR}; padding: 0 ${px(REPORT_TABLE_CELL_MARGIN_PX)}; text-align: left; vertical-align: top; }`,
        `${scope} th { background: #f5f5f4; font-weight: 600; }`,
        `${scope} table p { margin: 0; }`,
        `${scope} [data-tac-section-label="true"] { margin: 28px 0 6px; text-align: center; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 18px; font-weight: 700; text-transform: uppercase; }`,
        `${scope} [data-tac-section-title="true"] { margin: 0 0 24px; text-align: center; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 20px; font-weight: 700; text-transform: uppercase; color: #134e4a; }`,
    ].join('\n')
}

export const REPORT_PAGE_SCOPE_CLASS = 'report-page'
export const REPORT_PAGE_CSS = buildReportPageCss(REPORT_PAGE_SCOPE_CLASS)

/**
 * Words per A4 page, for the length estimate the builder shows before a report exists.
 *
 * Measured, not guessed: a real 8,119-word FCA paginates to 19 A4 pages through the preview
 * paginator at these metrics, an average of 425 words per page (a dense page carries ~500-560; the
 * last page of a section drops to ~300 because of the heading that follows). The old 350 was a page
 * size the document did not have, so every estimate read long.
 */
export const REPORT_WORDS_PER_PAGE_ESTIMATE = 425
