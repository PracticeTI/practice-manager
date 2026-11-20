import test from 'node:test'
import assert from 'node:assert/strict'

import {
    REPORT_PAGE_BREAK_MARKER,
    isNumberedSectionHeading,
    isReportPageBreak,
    stripReportPageBreaks,
} from '../src/lib/reportPageBreaks.js'

test('recognises page-break marker elements', () => {
    assert.equal(isReportPageBreak(REPORT_PAGE_BREAK_MARKER), true)
    assert.equal(isReportPageBreak('<div data-page-break="true"></div>'), true)
    assert.equal(isReportPageBreak('<hr data-page-break>'), true)
    assert.equal(isReportPageBreak('<div class="page-break"></div>'), false)
    assert.equal(isReportPageBreak('Page text'), false)
})

test('strips page-break markers without joining surrounding paragraphs', () => {
    const markdown = ['Cover', '', REPORT_PAGE_BREAK_MARKER, '', 'Body'].join('\n')
    assert.equal(stripReportPageBreaks(markdown), 'Cover\n\nBody')
})

test('recognises numbered report section headings', () => {
    assert.equal(isNumberedSectionHeading('1. Executive Summary'), true)
    assert.equal(isNumberedSectionHeading('12. Recommendations and Funding Rationale'), true)
    assert.equal(isNumberedSectionHeading('Executive Summary'), false)
    assert.equal(isNumberedSectionHeading('1.2 Transfers'), false)
})
