import test from 'node:test'
import assert from 'node:assert/strict'

import { buildReportHeaderXml } from '../src/lib/docxReportHeader.js'
import {
    REPORT_BRANDED_PAGE_MARGIN_TWIPS,
    REPORT_HEADER_RULE_COLOR,
    REPORT_HEADER_TEXT_COLOR,
    REPORT_PAGE_MARGIN_TWIPS,
} from '../src/lib/reportPageMetrics.js'

test('the header part carries the logo, the credential line and a bottom rule', () => {
    const xml = buildReportHeaderXml({
        logoRelationshipId: 'rIdHeaderLogo',
        logoExtent: { cx: 800000, cy: 274320 },
        altText: 'Practice logo',
        text: 'Kate O’Callaghan · Occupational Therapist · AHPRA registered',
    })

    assert.match(xml, /<w:hdr\b/)
    assert.match(xml, /<wp:extent cx="800000" cy="274320"\/>/)
    assert.match(xml, /r:embed="rIdHeaderLogo"/)
    assert.match(xml, /Kate O’Callaghan · Occupational Therapist · AHPRA registered/)
    assert.match(xml, new RegExp(`<w:bottom [^/]*w:color="${REPORT_HEADER_RULE_COLOR}"`))
    assert.match(xml, new RegExp(`<w:color w:val="${REPORT_HEADER_TEXT_COLOR}"`))
})

test('a text-only header keeps the rule and omits the drawing', () => {
    const xml = buildReportHeaderXml({ text: 'Acme OT' })
    assert.doesNotMatch(xml, /<w:drawing>/)
    assert.match(xml, /Acme OT/)
    assert.match(xml, /<w:bottom /)
})

test('a logo-only header still draws the rule', () => {
    const xml = buildReportHeaderXml({
        logoRelationshipId: 'rIdHeaderLogo',
        logoExtent: { cx: 800000, cy: 274320 },
    })
    assert.match(xml, /<w:drawing>/)
    assert.match(xml, /<w:bottom /)
})

test('the header text is escaped rather than injected as XML', () => {
    const xml = buildReportHeaderXml({ text: 'Smith & Sons <OT>' })
    assert.match(xml, /Smith &amp; Sons &lt;OT&gt;/)
    assert.doesNotMatch(xml, /Smith & Sons/)
})

test('the branded body margin clears the header and keeps the plain margin below it', () => {
    assert.ok(REPORT_BRANDED_PAGE_MARGIN_TWIPS > REPORT_PAGE_MARGIN_TWIPS)
})
