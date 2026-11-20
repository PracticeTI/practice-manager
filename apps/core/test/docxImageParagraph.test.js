import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildWordImageParagraphXml,
    imageLeadsLine,
    WORD_IMAGE_LINE_TWIPS,
} from '../src/lib/docxImageParagraph.js'
import { buildWordStylesXml } from '../src/lib/docxWordStyles.js'
import {
    REPORT_BODY_LINE_TWIPS,
    REPORT_BODY_SPACE_AFTER_TWIPS,
    REPORT_BODY_SPACE_BEFORE_TWIPS,
} from '../src/lib/reportPageMetrics.js'

function readParagraphProperties(xml) {
    return /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] || ''
}

function buildImageParagraph(overrides = {}) {
    return buildWordImageParagraphXml({
        relationshipId: 'rId2',
        docPrId: 1,
        altText: 'seot logo',
        extent: { cx: 2746061, cy: 732283 },
        ...overrides,
    })
}

test('image paragraphs opt out of the exact body leading', () => {
    const paragraph = buildImageParagraph()
    const paragraphProperties = readParagraphProperties(paragraph)

    // `styles.xml` gives body text an exact 14pt line. An exact line cannot grow to an image's
    // height, so the picture either clips (Word) or is drawn over the paragraph above it
    // (Google Docs, LibreOffice) - the exported FCA header logo overlapped its title.
    assert.match(buildWordStylesXml(), new RegExp(`w:line="${REPORT_BODY_LINE_TWIPS}" w:lineRule="exact"`))
    assert.equal(WORD_IMAGE_LINE_TWIPS, 240)
    assert.match(paragraphProperties, /w:line="240" w:lineRule="auto"/)
    assert.doesNotMatch(paragraphProperties, /w:lineRule="exact"/)
})

test('image paragraphs keep the body spacing and do not snap to the document grid', () => {
    const paragraphProperties = readParagraphProperties(buildImageParagraph())

    assert.match(
        paragraphProperties,
        new RegExp(`<w:spacing w:before="${REPORT_BODY_SPACE_BEFORE_TWIPS}" w:after="${REPORT_BODY_SPACE_AFTER_TWIPS}" w:line="240" w:lineRule="auto"/>`)
    )
    assert.match(paragraphProperties, /<w:snapToGrid w:val="0"\/>/)
})

test('paragraph properties follow the WordprocessingML child order', () => {
    const paragraphProperties = readParagraphProperties(buildImageParagraph({ alignment: 'center' }))

    const snapToGridIndex = paragraphProperties.indexOf('<w:snapToGrid')
    const spacingIndex = paragraphProperties.indexOf('<w:spacing')
    const justificationIndex = paragraphProperties.indexOf('<w:jc')

    assert.ok(snapToGridIndex !== -1 && spacingIndex !== -1 && justificationIndex !== -1)
    assert.ok(snapToGridIndex < spacingIndex)
    assert.ok(spacingIndex < justificationIndex)
})

test('image alignment is carried on the image paragraph', () => {
    assert.match(readParagraphProperties(buildImageParagraph({ alignment: 'center' })), /<w:jc w:val="center"\/>/)
    assert.match(readParagraphProperties(buildImageParagraph({ alignment: 'right' })), /<w:jc w:val="right"\/>/)
    assert.doesNotMatch(readParagraphProperties(buildImageParagraph({ alignment: 'left' })), /<w:jc/)
})

test('the picture keeps its extent, relationship and alt text', () => {
    const paragraph = buildImageParagraph({ altText: 'Acme OT "logo"&mark' })

    assert.match(paragraph, /<wp:extent cx="2746061" cy="732283"\/>/)
    assert.match(paragraph, /<a:ext cx="2746061" cy="732283"\/>/)
    assert.match(paragraph, /<a:blip r:embed="rId2"\/>/)
    assert.match(paragraph, /descr="Acme OT &quot;logo&quot;&amp;mark"/)
})

test('an image with no extent still falls back to a usable size', () => {
    const paragraph = buildImageParagraph({ extent: null })

    assert.match(paragraph, /<wp:extent cx="5486400" cy="3086100"\/>/)
})

test('an image that opens the line is written before the line text', () => {
    const logoAlt = 'seot logo'

    // The FCA template header is one heading whose first child is the practice logo:
    // `# <img src="/.../seot-logo.png" ...>Functional Capacity Assessment (NDIS)`.
    assert.equal(
        imageLeadsLine(`# <img src="/allied-health/domains/domain-a/seot-logo.png" alt="${logoAlt}" style="display: block;">Functional Capacity Assessment (NDIS)`),
        true
    )
    assert.equal(imageLeadsLine('![seot logo](/domain-a/logo.png)'), true)
    assert.equal(imageLeadsLine('  ##  ![chart](/chart.png)Costs by domain'), true)
})

test('an image that follows the line text is written after it', () => {
    assert.equal(imageLeadsLine('Functional Capacity Assessment ![seot logo](/domain-a/logo.png)'), false)
    assert.equal(imageLeadsLine('Costs by domain <img src="/chart.png" alt="chart">'), false)
    assert.equal(imageLeadsLine('- Costs by domain ![chart](/chart.png)'), false)
})

test('a line with no image never leads with one', () => {
    assert.equal(imageLeadsLine('Functional Capacity Assessment (NDIS)'), false)
    assert.equal(imageLeadsLine(''), false)
})

test('leading whitespace and an absent heading marker do not count as text', () => {
    assert.equal(imageLeadsLine('   ![logo](/logo.png)Title'), true)
    assert.equal(imageLeadsLine('#\t![logo](/logo.png)Title'), true)
})
