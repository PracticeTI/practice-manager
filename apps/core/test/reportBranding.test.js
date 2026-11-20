import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildReportBranding,
    resolveReportConfig,
    resolveReportHeaderLogoUrl,
    resolveReportHeaderText,
} from '../src/lib/reportBranding.js'

test('reads the header configuration from every shape the callers hold', () => {
    const config = { reportHeaderText: 'Line' }
    assert.equal(resolveReportConfig({ config }), config)
    assert.equal(resolveReportConfig({ settings: { config } }), config)
    assert.equal(resolveReportConfig({ settings: { settings: { config } } }), config)
    assert.deepEqual(resolveReportConfig({}), {})
    assert.deepEqual(resolveReportConfig({ settings: null }), {})
})

test('prefers the configured header line over the provider details fallback', () => {
    assert.equal(
        resolveReportHeaderText({
            reportHeaderText: "Kate O'Callaghan · Occupational Therapist · AHPRA registered",
            providerDetails: "Kate O'Callaghan\nAcme OT",
        }),
        "Kate O'Callaghan · Occupational Therapist · AHPRA registered"
    )
})

test('falls back to the first Provider details line, then the practice name', () => {
    assert.equal(resolveReportHeaderText({ providerDetails: "\nKate O'Callaghan\nAcme OT" }), "Kate O'Callaghan")
    assert.equal(resolveReportHeaderText({}, 'Acme OT'), 'Acme OT')
    assert.equal(resolveReportHeaderText({}), '')
})

test('uses the domain logo unless the practice overrides it', () => {
    assert.equal(resolveReportHeaderLogoUrl({ domain: 'domain-a' }), '/domain-a/logo.png')
    assert.equal(
        resolveReportHeaderLogoUrl({ domain: 'domain-a', config: { reportHeaderLogoUrl: '/custom/logo.png' } }),
        '/custom/logo.png'
    )
    assert.equal(resolveReportHeaderLogoUrl({}), '')
})

test('an absolute origin gives the review page a fetchable logo URL', () => {
    assert.equal(
        resolveReportHeaderLogoUrl({ domain: 'domain-a', logoOrigin: 'https://www.example.com/' }),
        'https://www.example.com/domain-a/logo.png'
    )
})

test('branding is null only when there is neither a logo nor a line', () => {
    assert.equal(buildReportBranding({}), null)
    assert.deepEqual(buildReportBranding({ domain: 'domain-a' }), {
        logoUrl: '/domain-a/logo.png',
        text: '',
    })
    assert.deepEqual(
        buildReportBranding({
            domain: 'domain-a',
            settings: { settings: { config: { reportHeaderText: 'Kate O’Callaghan · Occupational Therapist' } } },
            practiceName: 'Acme OT',
        }),
        {
            logoUrl: '/domain-a/logo.png',
            text: 'Kate O’Callaghan · Occupational Therapist',
        }
    )
})
