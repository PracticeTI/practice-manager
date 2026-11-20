import test from 'node:test'
import assert from 'node:assert/strict'

import { isSoloEdition, resolveEdition } from '../src/lib/edition.js'

test('treats an unset or unknown edition as hosted', () => {
    // Hosted is the default so an existing deployment never changes behaviour by accident.
    assert.equal(resolveEdition({}), 'cloud')
    assert.equal(resolveEdition({ PRACTICE_MANAGER_EDITION: '' }), 'cloud')
    assert.equal(resolveEdition({ PRACTICE_MANAGER_EDITION: 'cloud' }), 'cloud')
    assert.equal(resolveEdition({ PRACTICE_MANAGER_EDITION: 'something-else' }), 'cloud')
})

test('recognises every solo spelling', () => {
    for (const value of ['solo', 'SOLO', ' solo ', 'solo-desktop', 'solo-docker']) {
        assert.equal(resolveEdition({ PRACTICE_MANAGER_EDITION: value }), 'solo', `${value} is solo`)
        assert.equal(isSoloEdition({ PRACTICE_MANAGER_EDITION: value }), true)
    }
})

test('isSoloEdition is false for hosted', () => {
    assert.equal(isSoloEdition({}), false)
})
