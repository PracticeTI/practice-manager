import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWordCoverParagraphXml, buildWordCoverRuleXml } from '../src/lib/reportCover.js'
import { buildCoverCssRules, REPORT_COVER_SCALE } from '../src/lib/reportPageMetrics.js'

test('the cover stylesheet sets every marked line in the reference palette', () => {
    const css = buildCoverCssRules()
    assert.match(css.join('\n'), /\[data-cover-line="eyebrow"\] \{[^}]*color: #3C5488/)
    assert.match(css.join('\n'), /\[data-cover-line="title"\] \{[^}]*font-size: 32px[^}]*color: #011A4C[^}]*text-align: center/)
    assert.match(css.join('\n'), /\[data-cover-line="name"\] \{[^}]*color: #000000/)
    assert.match(css.join('\n'), /\[data-cover-line="meta"\] \{[^}]*color: #595959/)
    assert.match(css.join('\n'), /\[data-cover-line="rule"\] \{[^}]*border-top: 2px solid #011A4C/)
})

test('the cover stylesheet centres the practice block and bolds the provider name', () => {
    const css = buildCoverCssRules('.report-template-surface').join('\n')
    assert.match(css, /\.report-template-surface \[data-cover-line="provider"\] \{[^}]*text-align: center/)
    assert.match(css, /\.report-template-surface \[data-cover-line="provider"\] strong \{[^}]*font-weight: 700/)
})

test('the Word cover title is Calibri 24pt navy and centred', () => {
    const xml = buildWordCoverParagraphXml('title', 'FUNCTIONAL CAPACITY<br>ASSESSMENT')
    assert.match(xml, /<w:jc w:val="center"\/>/)
    assert.match(xml, /w:ascii="Calibri"/)
    assert.match(xml, /<w:sz w:val="48"\/>/)
    assert.match(xml, /<w:color w:val="011A4C"\/>/)
    assert.match(xml, /FUNCTIONAL CAPACITY<\/w:t><\/w:r><w:r><w:br\/>/)
    assert.match(xml, /ASSESSMENT/)
})

test('the Word cover provider line keeps the bold name', () => {
    const xml = buildWordCoverParagraphXml('provider', '<strong>Kate O\u2019Callaghan</strong> \u00b7 Occupational Therapist')
    assert.match(xml, /<w:b\/><w:color w:val="000000"\/><w:sz w:val="22"\/>/)
    assert.match(xml, /<w:sz w:val="20"\/>[^]*Occupational Therapist/)
})

test('the Word cover rule is a full-width navy border on a hairline paragraph', () => {
    const xml = buildWordCoverRuleXml()
    assert.match(xml, /<w:bottom w:val="single" w:sz="12" w:space="0" w:color="011A4C"\/>/)
    assert.match(xml, new RegExp(`w:after="${Math.round(REPORT_COVER_SCALE.rule.afterPoints * 20)}"`))
})

test('an unknown cover line kind emits nothing', () => {
    assert.equal(buildWordCoverParagraphXml('unknown', 'Text'), '')
    assert.equal(buildWordCoverParagraphXml('', 'Text'), '')
})
