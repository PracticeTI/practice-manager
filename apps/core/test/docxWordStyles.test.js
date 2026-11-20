import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildWordStylesXml,
    WORD_BODY_FONT_FAMILY,
    WORD_BODY_FONT_SIZE_HALF_POINTS,
    WORD_BODY_LINE_TWIPS,
    WORD_BODY_SPACING_AFTER_TWIPS,
    WORD_DOCUMENT_GRID_LINE_PITCH_TWIPS,
    WORD_HEADING_COLORS,
    WORD_PAGE_HEIGHT_TWIPS,
    WORD_PAGE_MARGIN_TWIPS,
    WORD_PAGE_WIDTH_TWIPS,
} from '../src/lib/docxWordStyles.js'
import {
    REPORT_BODY_FONT_FAMILY,
    REPORT_BODY_FONT_SIZE_HALF_POINTS,
    REPORT_BODY_LINE_TWIPS,
    REPORT_BODY_SPACE_AFTER_TWIPS,
    REPORT_PAGE_HEIGHT_TWIPS,
    REPORT_PAGE_MARGIN_TWIPS,
    REPORT_PAGE_WIDTH_TWIPS,
} from '../src/lib/reportPageMetrics.js'

function readElement(xml, tagName) {
    return new RegExp(`<${tagName}\\b[\\s\\S]*?</${tagName}>`).exec(xml)?.[0] || ''
}

test('body paragraphs get a document-level space after', () => {
    const stylesXml = buildWordStylesXml()
    const docDefaults = readElement(stylesXml, 'w:docDefaults')

    // The converter emits bare `<w:p>` elements for body paragraphs, so this is the only
    // place paragraph spacing can come from. Without it a blank line in the report
    // markdown survives as a paragraph break but renders with no visible gap.
    assert.ok(docDefaults, 'styles.xml must define w:docDefaults')
    assert.match(
        docDefaults,
        new RegExp(`<w:spacing w:before="0" w:after="${WORD_BODY_SPACING_AFTER_TWIPS}"`)
    )
})

test('body paragraphs use the reference report leading rather than a stretched grid line', () => {
    const stylesXml = buildWordStylesXml()
    const docDefaults = readElement(stylesXml, 'w:docDefaults')

    // 270 twips (13.5pt) is the line pitch measured from a clinician's finalised FCA. Without an
    // explicit `w:line`, body text snapped to the 18pt document grid and read as double-spaced.
    // 14pt leading for 12pt Times, with a full line of space after each paragraph.
    assert.equal(WORD_BODY_LINE_TWIPS, 280)
    assert.equal(WORD_BODY_SPACING_AFTER_TWIPS, 280)
    // `exact`, not `auto`: Word's "auto" multiplies its own single spacing (~13.8pt for 12pt Times),
    // which cannot be made to equal the preview's absolute line-height.
    assert.match(docDefaults, new RegExp(`w:line="${WORD_BODY_LINE_TWIPS}" w:lineRule="exact"`))
    assert.match(docDefaults, /<w:snapToGrid w:val="0"\/>/)
})

test('body text defaults to Times New Roman 12pt', () => {
    const stylesXml = buildWordStylesXml()
    const docDefaults = readElement(stylesXml, 'w:docDefaults')

    // The document has no theme or font table, so this is what Word uses everywhere.
    assert.equal(WORD_BODY_FONT_SIZE_HALF_POINTS, 24)
    assert.match(
        docDefaults,
        new RegExp(`<w:rFonts w:ascii="${WORD_BODY_FONT_FAMILY}" w:hAnsi="${WORD_BODY_FONT_FAMILY}" w:cs="${WORD_BODY_FONT_FAMILY}" w:eastAsia="${WORD_BODY_FONT_FAMILY}"/>`)
    )
    assert.match(docDefaults, new RegExp(`<w:sz w:val="${WORD_BODY_FONT_SIZE_HALF_POINTS}"/>`))
    assert.match(docDefaults, new RegExp(`<w:szCs w:val="${WORD_BODY_FONT_SIZE_HALF_POINTS}"/>`))
})

test('docDefaults keeps rPrDefault before pPrDefault', () => {
    const docDefaults = readElement(buildWordStylesXml(), 'w:docDefaults')

    assert.ok(docDefaults.indexOf('<w:rPrDefault>') !== -1)
    assert.ok(docDefaults.indexOf('<w:rPrDefault>') < docDefaults.indexOf('<w:pPrDefault>'))
})

test('docDefaults is the first child of w:styles', () => {
    const stylesXml = buildWordStylesXml()
    const firstElement = stylesXml.slice(stylesXml.indexOf('<w:styles')).match(/<w:(?!styles\b)[A-Za-z0-9:]+/)?.[0]

    assert.equal(firstElement, '<w:docDefaults')
})

test('default Normal style does not override the document spacing back to zero', () => {
    const normalStyle = readElement(buildWordStylesXml(), 'w:style')
    const normalStyleId = normalStyle.match(/w:styleId="([^"]+)"/)?.[1]

    assert.equal(normalStyleId, 'Normal')
    assert.doesNotMatch(normalStyle, /<w:spacing/)
})

test('heading styles keep their own spacing instead of inheriting docDefaults', () => {
    const stylesXml = buildWordStylesXml()

    for (const [styleId, before, after] of [
        ['Heading1', '240', '120'],
        ['Heading2', '220', '100'],
        ['Heading3', '180', '80'],
    ]) {
        const styleXml = new RegExp(`<w:style[^>]*w:styleId="${styleId}">[\\s\\S]*?</w:style>`).exec(stylesXml)?.[0] || ''
        assert.ok(styleXml, `${styleId} style must be present`)
        // Each heading carries its own absolute leading, because the body's 13.5pt exact line would
        // clip an 18pt heading.
        assert.match(styleXml, new RegExp(`<w:spacing w:before="${before}" w:after="${after}" w:line="\\d+" w:lineRule="exact"/>`))
    }
})

test('heading styles use a consistent navy and teal accent palette', () => {
    const stylesXml = buildWordStylesXml()

    for (const [styleId, color] of [
        ['Heading1', WORD_HEADING_COLORS.level1],
        ['Heading2', WORD_HEADING_COLORS.level2],
        ['Heading3', WORD_HEADING_COLORS.level3],
    ]) {
        const styleXml = new RegExp(`<w:style[^>]*w:styleId="${styleId}">[\\s\\S]*?</w:style>`).exec(stylesXml)?.[0] || ''
        assert.match(styleXml, new RegExp(`<w:color w:val="${color}"/>`))
    }
})

test('the exported page is A4, not US Letter', () => {
    // A4 is 11906 x 16838 twips; US Letter is 12240 x 15840. The preview has always laid out A4, so
    // a Letter export printed 14 pages of content on 13 pages and the page count disagreed.
    assert.equal(WORD_PAGE_WIDTH_TWIPS, 11906)
    assert.equal(WORD_PAGE_HEIGHT_TWIPS, 16838)
    assert.equal(WORD_PAGE_MARGIN_TWIPS, 1080)
})

test('every page, margin and body metric comes from the shared page metrics', () => {
    assert.equal(WORD_PAGE_WIDTH_TWIPS, REPORT_PAGE_WIDTH_TWIPS)
    assert.equal(WORD_PAGE_HEIGHT_TWIPS, REPORT_PAGE_HEIGHT_TWIPS)
    assert.equal(WORD_PAGE_MARGIN_TWIPS, REPORT_PAGE_MARGIN_TWIPS)
    assert.equal(WORD_BODY_FONT_FAMILY, REPORT_BODY_FONT_FAMILY)
    assert.equal(WORD_BODY_FONT_SIZE_HALF_POINTS, REPORT_BODY_FONT_SIZE_HALF_POINTS)
    assert.equal(WORD_BODY_LINE_TWIPS, REPORT_BODY_LINE_TWIPS)
    assert.equal(WORD_DOCUMENT_GRID_LINE_PITCH_TWIPS, REPORT_BODY_LINE_TWIPS)
    assert.equal(WORD_BODY_SPACING_AFTER_TWIPS, REPORT_BODY_SPACE_AFTER_TWIPS)
})

test('the heading rule under a section heading is drawn, not only previewed', () => {
    const stylesXml = buildWordStylesXml()
    const heading2 = readElement(stylesXml, 'w:style')

    assert.ok(heading2)
    assert.match(stylesXml, /<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="3" w:color="CCFBF1"\/><\/w:pBdr>/)
})
