import test from 'node:test'
import assert from 'node:assert/strict'
import {
    SYNTHETIC_SIM_TARGET,
    buildSimulationOptions,
    defaultSimulationTarget,
    filterSimulationAdmins,
    isSimulationTargetChosen,
    resolveSimulationUsername,
} from '../src/lib/adminSimulationTargets.js'

const USERS = [
    { username: 'admin-a', domain: 'domain-a', email: 'admin-a@example.com' },
    { username: 'admin-b', domain: 'domain-b', email: 'admin-b@example.com' },
    { username: 'admin-b2', domain: 'Domain-B', email: null },
    { username: 'admin-c', domain: 'domain-c', email: null },
]

test('filters admins to the requested domain, case-insensitively', () => {
    const usernames = filterSimulationAdmins(USERS, 'domain-b').map((admin) => admin.username)

    assert.deepEqual(usernames, ['admin-b', 'admin-b2'])
})

test('returns no admins for an unknown or missing domain', () => {
    assert.deepEqual(filterSimulationAdmins(USERS, 'nope'), [])
    assert.deepEqual(filterSimulationAdmins(USERS, ''), [])
    assert.deepEqual(filterSimulationAdmins(null, 'domain-b'), [])
})

test('offers the synthetic identity plus each admin', () => {
    const options = buildSimulationOptions(filterSimulationAdmins(USERS, 'domain-b'), 'domain-b')

    assert.deepEqual(options.map((option) => option.value), ['', SYNTHETIC_SIM_TARGET, 'admin-b', 'admin-b2'])
    assert.equal(options[0].disabled, true)
    assert.match(options[1].label, /sim-admin-domain-b/)
    assert.match(options[2].label, /admin-b@example\.com/)
    assert.match(options[3].label, /no email/)
})

test('omits the placeholder when there is nothing to choose between', () => {
    const single = buildSimulationOptions(filterSimulationAdmins(USERS, 'domain-c'), 'domain-c')
    assert.deepEqual(single.map((option) => option.value), [SYNTHETIC_SIM_TARGET, 'admin-c'])

    const none = buildSimulationOptions([], 'example-domain')
    assert.deepEqual(none.map((option) => option.value), [SYNTHETIC_SIM_TARGET])
})

test('preselects a lone admin and requires a choice when there are several', () => {
    assert.equal(defaultSimulationTarget([{ username: 'traff' }]), 'traff')
    assert.equal(defaultSimulationTarget([{ username: 'a' }, { username: 'b' }]), '')
    assert.equal(defaultSimulationTarget([]), SYNTHETIC_SIM_TARGET)
    assert.equal(defaultSimulationTarget(null), SYNTHETIC_SIM_TARGET)
})

test('an unchosen target blocks starting a simulation', () => {
    assert.equal(isSimulationTargetChosen(''), false)
    assert.equal(isSimulationTargetChosen(null), false)
    assert.equal(isSimulationTargetChosen('admin-b'), true)
    assert.equal(isSimulationTargetChosen(SYNTHETIC_SIM_TARGET), true)
})

test('sends a username only for a real admin, so synthetic stays server-side', () => {
    assert.equal(resolveSimulationUsername('admin-b'), 'admin-b')
    assert.equal(resolveSimulationUsername(SYNTHETIC_SIM_TARGET), '')
    assert.equal(resolveSimulationUsername(''), '')
    assert.equal(resolveSimulationUsername(null), '')
})
