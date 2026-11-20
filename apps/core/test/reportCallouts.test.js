import test from 'node:test'
import assert from 'node:assert/strict'
import { remark } from 'remark'
import remarkHtml from 'remark-html'

import {
    buildCalloutBorderXml,
    buildCalloutShadingXml,
    normalizeCalloutVariant,
    parseCalloutMarker,
    remarkReportCallouts,
    resolveCalloutPalette,
    takeCalloutFromBlocks,
} from '../src/lib/reportCallouts.js'
import { buildReportPageCss, REPORT_CALLOUT_VARIANTS } from '../src/lib/reportPageMetrics.js'

function renderMarkdown(markdown) {
    return String(remark().use(remarkReportCallouts).use(remarkHtml, { sanitize: false }).processSync(markdown))
}

test('callout markers name a known variant', () => {
    assert.equal(parseCalloutMarker('[!evidence] **Weight of evidence.** Text').variant, 'evidence')
    assert.equal(parseCalloutMarker('[!EVIDENCE] Text').variant, 'evidence')
    assert.equal(parseCalloutMarker('[!opinion] Text').variant, 'opinion')
})

test('callout marker aliases resolve to the drawn palettes', () => {
    assert.equal(normalizeCalloutVariant('weight-of-evidence'), 'evidence')
    assert.equal(normalizeCalloutVariant('in-short'), 'summary')
    assert.equal(normalizeCalloutVariant('determination'), 'finding')
    assert.equal(normalizeCalloutVariant('clinical-opinion'), 'opinion')
    assert.equal(normalizeCalloutVariant('recommendation'), 'opinion')
})

test('callout marker keeps the rest of the line as content', () => {
    assert.deepEqual(parseCalloutMarker('[!evidence] **Weight of evidence.** Text'), {
        variant: 'evidence',
        text: '**Weight of evidence.** Text',
    })
    assert.deepEqual(parseCalloutMarker('[!opinion]'), { variant: 'opinion', text: '' })
})

test('unknown or absent markers are left as ordinary text', () => {
    assert.equal(parseCalloutMarker('[!cite: 3] Text'), null)
    assert.equal(parseCalloutMarker('Plain text'), null)
    assert.equal(parseCalloutMarker(''), null)
    assert.equal(resolveCalloutPalette('cite'), null)
})

test('the marker is stripped from the first block the DOCX writer renders', () => {
    const result = takeCalloutFromBlocks([['[!evidence] **Weight of evidence.** Text', 'continues'], ['Second block']])
    assert.equal(result.variant, 'evidence')
    assert.deepEqual(result.blocks, [['**Weight of evidence.** Text', 'continues'], ['Second block']])
})

test('a marker on its own line leaves the following line as the callout body', () => {
    const result = takeCalloutFromBlocks([['[!opinion]', '**Clinical opinion.** Text']])
    assert.equal(result.variant, 'opinion')
    assert.deepEqual(result.blocks, [['**Clinical opinion.** Text']])
})

test('a blockquote without a marker keeps its blocks untouched', () => {
    const blocks = [['A plain quote']]
    const result = takeCalloutFromBlocks(blocks)
    assert.equal(result.variant, '')
    assert.deepEqual(result.blocks, blocks)
})

test('the preview renders a marked blockquote as a callout and hides the marker', () => {
    const html = renderMarkdown('> [!evidence] **Weight of evidence.** Findings resting on my direct observation.')
    assert.match(html, /<blockquote[^>]*data-callout="evidence"/)
    assert.match(html, /class="report-callout report-callout--evidence"/)
    assert.doesNotMatch(html, /\[!evidence\]/)
    assert.match(html, /<strong>Weight of evidence\.<\/strong> Findings resting on my direct observation\./)
})

test('the preview handles a marker on its own line', () => {
    const html = renderMarkdown('> [!opinion]\n> **Clinical opinion.** Seven hours per day is reasonable.')
    assert.match(html, /data-callout="opinion"/)
    assert.doesNotMatch(html, /\[!opinion\]/)
    assert.match(html, /<strong>Clinical opinion\.<\/strong>/)
})

test('plain and unknown-marker blockquotes are still rendered as before', () => {
    const plain = renderMarkdown('> A plain quote.')
    assert.match(plain, /<blockquote>\s*<p>A plain quote\.<\/p>\s*<\/blockquote>/)

    const unknown = renderMarkdown('> [!cite] Unknown marker.')
    assert.match(unknown, /<blockquote>\s*<p>\[!cite\] Unknown marker\.<\/p>\s*<\/blockquote>/)
})

test('a callout with no content is dropped rather than rendered as an empty box', () => {
    assert.equal(renderMarkdown('> [!evidence]').trim(), '')
})

test('the DOCX border is a full box in the variant colour', () => {
    const xml = buildCalloutBorderXml('evidence')
    for (const side of ['top', 'left', 'bottom', 'right']) {
        assert.match(xml, new RegExp(`<w:${side} [^/]*w:color="5E7A3B"`))
    }
    assert.match(buildCalloutBorderXml('summary'), /w:color="8A1538"/)
    assert.match(buildCalloutBorderXml('finding'), /w:color="011A4C"/)
    assert.match(buildCalloutBorderXml('opinion'), /w:color="011A4C"/)
    assert.equal(buildCalloutBorderXml('unknown'), '')
})

test('the DOCX fill matches the variant palette', () => {
    assert.match(buildCalloutShadingXml('evidence'), /w:fill="ECF5E6"/)
    assert.match(buildCalloutShadingXml('summary'), /w:fill="FBEEF2"/)
    assert.match(buildCalloutShadingXml('finding'), /w:fill="EDF0F6"/)
    assert.match(buildCalloutShadingXml('opinion'), /w:fill="011A4C"/)
    assert.equal(buildCalloutShadingXml('unknown'), '')
})

test('the recommendation alias renders as the solid navy opinion box', () => {
    const palette = resolveCalloutPalette('recommendation')
    assert.equal(palette.name, 'opinion')
    assert.equal(palette.fillColor, REPORT_CALLOUT_VARIANTS.opinion.fillColor)
    assert.equal(palette.textColor, 'FFFFFF')
})

test('the preview stylesheet paints both callout variants', () => {
    const css = buildReportPageCss()
    for (const [name, variant] of Object.entries(REPORT_CALLOUT_VARIANTS)) {
        assert.match(css, new RegExp(`blockquote\\[data-callout="${name}"\\]`))
        assert.match(css, new RegExp(`#${variant.borderColor}`))
        assert.match(css, new RegExp(`#${variant.fillColor}`))
    }
    // The undecorated quote keeps its left rule so existing reports do not change.
    assert.match(css, /blockquote \{ margin: [^}]*border-left: 4px solid #99f6e4/)
})

test('the notice box matches the reference cover panel', () => {
    assert.equal(normalizeCalloutVariant('cover'), 'notice')
    assert.equal(normalizeCalloutVariant('cover-notice'), 'notice')

    const palette = resolveCalloutPalette('notice')
    assert.equal(palette.fillColor, 'EDF0F6')
    assert.equal(palette.align, 'center')

    // A hairline rule with a heavy left edge, centred inside the full-width box.
    const css = buildReportPageCss()
    assert.match(css, /blockquote\[data-callout="notice"\] \{[^}]*border-width: 1px 1px 1px 3px/)
    assert.match(css, /blockquote\[data-callout="notice"\] \{[^}]*text-align: center/)

    const border = buildCalloutBorderXml('notice')
    assert.match(border, /<w:top [^/]*w:sz="4"/)
    assert.match(border, /<w:left [^/]*w:sz="16"/)
    assert.match(border, /<w:right [^/]*w:sz="4"/)
    assert.match(border, /<w:bottom [^/]*w:sz="4"/)
})
