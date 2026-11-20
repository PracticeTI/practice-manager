import test from 'node:test'
import assert from 'node:assert/strict'

import {
    extractHtmlTableLayout,
    isHtmlTableHeaderRow,
    resolveWordTableWidths,
    wrapWordTableXml,
} from '../src/lib/docxTableLayout.js'

test('wraps Word tables with compact explicit spacing', () => {
    const tableXml = '<w:tbl><w:tr/></w:tbl>'
    const spacerXml = '<w:p><w:pPr><w:spacing w:after="120" w:line="1" w:lineRule="exact"/></w:pPr></w:p>'

    assert.equal(
        wrapWordTableXml(tableXml),
        `${spacerXml}${tableXml}${spacerXml}`
    )
})

test('preserves HTML table and colgroup percentage widths', () => {
    const html = '<table style="width: 99.9%"><colgroup><col style="width: 90.1%"><col style="width: 9.9%"></colgroup><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'
    const layout = extractHtmlTableLayout(html)
    const widths = resolveWordTableWidths({ columnCount: 2, ...layout })

    assert.equal(layout.tableWidthPercentage, 99.9)
    assert.deepEqual(layout.columnPercentages, [90.1, 9.9])
    assert.equal(widths.tableWidth, 9351)
    assert.deepEqual(widths.columnWidths, [8425, 926])
})

test('recognizes rows inside thead after editor serialization', () => {
    const html = '<table><thead><tr><td>Name</td></tr></thead><tbody><tr><td>Value</td></tr></tbody></table>'
    const rowMatches = Array.from(html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi))

    assert.equal(isHtmlTableHeaderRow(html, rowMatches[0].index), true)
    assert.equal(isHtmlTableHeaderRow(html, rowMatches[1].index), false)
})