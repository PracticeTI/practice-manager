import test from 'node:test'
import assert from 'node:assert/strict'

import {
    REPORT_BODY_LINE_HEIGHT_PX,
    REPORT_BODY_SPACE_AFTER_TWIPS,
    REPORT_PAGE_CSS,
    REPORT_PAGE_HEIGHT_PX,
    REPORT_PAGE_WIDTH_PX,
    REPORT_WORDS_PER_PAGE_ESTIMATE,
    px,
    reportHeadingMetrics,
    twipsToPx,
} from '../src/lib/reportPageMetrics.js'
import { WORD_BODY_FONT_FAMILY, WORD_BODY_LINE_TWIPS } from '../src/lib/docxWordStyles.js'

const ruleFor = (selector) => {
    const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(REPORT_PAGE_CSS)
    return match ? match[1] : ''
}

test('the page the preview lays out is A4 in pixels', () => {
    // 210mm and 297mm at 96 dpi. Word stores the same page as 11906 x 16838 twips.
    assert.equal(REPORT_PAGE_WIDTH_PX, 794)
    assert.equal(REPORT_PAGE_HEIGHT_PX, 1123)
})

test('paragraphs are separated by one full body line', () => {
    const bodyRule = ruleFor('.report-page p')

    // The gap has to be a real CSS rule: it used to be a Tailwind class assembled at runtime, which
    // the scanner never sees, so paragraphs rendered with no space after them at all.
    assert.ok(bodyRule, 'the stylesheet must carry a paragraph rule')
    assert.match(bodyRule, new RegExp(`margin: 0 0 ${px(twipsToPx(REPORT_BODY_SPACE_AFTER_TWIPS))}`))
    assert.equal(px(twipsToPx(REPORT_BODY_SPACE_AFTER_TWIPS)), px(REPORT_BODY_LINE_HEIGHT_PX))
})

test('headings keep their own size and spacing instead of the body reset', () => {
    for (const level of [1, 2, 3]) {
        const metrics = reportHeadingMetrics(level)
        const rule = ruleFor(`.report-page h${level}`)

        assert.ok(rule, `h${level} must have a rule`)
        assert.match(rule, new RegExp(`font-size: ${px(metrics.sizePx)}`))
        assert.match(rule, new RegExp(`line-height: ${px(metrics.lineHeightPx)}`))
        assert.match(rule, new RegExp(`margin: ${px(metrics.beforePx)} 0 ${px(metrics.afterPx)}`))
    }
})

test('the preview and the exported document agree on the body metrics', () => {
    const bodyRule = ruleFor('.report-page')

    assert.match(bodyRule, new RegExp(`font-family: '${WORD_BODY_FONT_FAMILY}'`))
    assert.match(bodyRule, new RegExp(`line-height: ${px(REPORT_BODY_LINE_HEIGHT_PX)}`))
    // Word is given the same leading in twips: 280 twips is 14pt.
    assert.equal(WORD_BODY_LINE_TWIPS, 280)
    assert.equal(twipsToPx(WORD_BODY_LINE_TWIPS), REPORT_BODY_LINE_HEIGHT_PX)
})

test('lists, quotes and table cells carry explicit geometry', () => {
    assert.match(ruleFor('.report-page ul, .report-page ol'), /padding-left: 48px/)
    assert.match(ruleFor('.report-page li'), /margin: 0 0 4px/)
    assert.match(ruleFor('.report-page blockquote'), /border-left: 4px solid/)
    assert.match(ruleFor('.report-page th, .report-page td'), /padding: 0 7\.667px/)
})

test('the words-per-page estimate is a plausible page, not a placeholder', () => {
    assert.ok(REPORT_WORDS_PER_PAGE_ESTIMATE > 300)
    assert.ok(REPORT_WORDS_PER_PAGE_ESTIMATE < 700)
})
