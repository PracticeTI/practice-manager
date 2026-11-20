import test from 'node:test'
import assert from 'node:assert/strict'

import {
    WEBSITE_FEATURE_FLAG_KEY,
    getDefaultDomainFeatureFlags,
    getDefaultWebsiteFeatureFlag,
    isWebsiteFeatureEnabled,
    normalizeDomainFeatureFlags,
} from '../src/lib/domainFeatureFlags.js'

const CLOUD = { PRACTICE_MANAGER_EDITION: 'cloud' }
const SOLO = { PRACTICE_MANAGER_EDITION: 'solo' }

test('the Website flag defaults on for hosted deployments', () => {
    assert.equal(getDefaultWebsiteFeatureFlag({}), true)
    assert.equal(getDefaultWebsiteFeatureFlag(CLOUD), true)
    assert.equal(getDefaultDomainFeatureFlags('default', CLOUD)[WEBSITE_FEATURE_FLAG_KEY], true)
})

test('the Website flag defaults off for every solo edition', () => {
    for (const edition of ['solo', 'solo-desktop', 'solo-docker']) {
        const env = { PRACTICE_MANAGER_EDITION: edition }
        assert.equal(getDefaultWebsiteFeatureFlag(env), false, edition)
        assert.equal(getDefaultDomainFeatureFlags('default', env)[WEBSITE_FEATURE_FLAG_KEY], false, edition)
    }
})

test('a stored Website value wins over the edition default', () => {
    assert.equal(normalizeDomainFeatureFlags({ websiteEnabled: false }, 'default', CLOUD)[WEBSITE_FEATURE_FLAG_KEY], false)
    assert.equal(normalizeDomainFeatureFlags({ websiteEnabled: 'false' }, 'default', CLOUD)[WEBSITE_FEATURE_FLAG_KEY], false)
    assert.equal(normalizeDomainFeatureFlags({ websiteEnabled: true }, 'default', SOLO)[WEBSITE_FEATURE_FLAG_KEY], true)
    assert.equal(normalizeDomainFeatureFlags({ websiteEnabled: 'true' }, 'default', SOLO)[WEBSITE_FEATURE_FLAG_KEY], true)
})

test('isWebsiteFeatureEnabled reads the flag off the stored record', () => {
    assert.equal(isWebsiteFeatureEnabled({ websiteEnabled: true }, 'default', SOLO), true)
    assert.equal(isWebsiteFeatureEnabled({ websiteEnabled: false }, 'default', CLOUD), false)
    assert.equal(isWebsiteFeatureEnabled({}, 'default', SOLO), false)
    assert.equal(isWebsiteFeatureEnabled({}, 'default', CLOUD), true)
})
