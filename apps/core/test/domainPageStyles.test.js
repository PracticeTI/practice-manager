import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_DOMAIN_TEMPLATE_COLORS,
    getContrastingTextColor,
    getDomainTemplateColors,
} from '../src/lib/domainPageStyles.js'

test('the default domain palette comes from the Practice Manager logo', () => {
    const colors = getDomainTemplateColors({ colors: null }, 'default')
    const brand = DEFAULT_DOMAIN_TEMPLATE_COLORS.default

    assert.equal(colors.color1, brand.color1)
    assert.equal(colors.color2, brand.color2)
    // Deep navy "Practice" and bright cyan "Manager".
    assert.equal(colors.color2, '#00216b')
    assert.equal(colors.color1, '#04bdfd')
})

test('a bright brand colour takes dark text, not white', () => {
    assert.equal(getContrastingTextColor('#04bdfd'), '#0f172a')
    assert.equal(getContrastingTextColor('#10b981'), '#0f172a')
})

test('a deep brand colour keeps white text', () => {
    assert.equal(getContrastingTextColor('#2563eb'), '#ffffff')
    assert.equal(getContrastingTextColor('#00216b'), '#ffffff')
})
