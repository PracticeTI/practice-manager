import test from 'node:test'
import assert from 'node:assert/strict'
import {
    CONTACT_FIELD_LIMITS,
    buildContactSelect,
    cleanBoundedString,
    contactMatchesQuery,
    contactOrderExpression,
    isEmptyContact,
    isValidContactEmail,
    normalizeContactEmail,
    normalizeContactPatients,
    normalizeContactRow,
    normalizePatientIds,
    resolveContactFields,
    validateId,
} from '../src/lib/contacts.js'
import {
    buildContactMetrics,
    contactDisplayName,
    describeContactSummary,
    filterContacts,
} from '../src/lib/contactDisplay.js'

test('resolveContactFields trims and bounds each mutable field', () => {
    const { updates, errors } = resolveContactFields({
        name: '  Jane Doe  ',
        email: '  Jane@Example.COM ',
        phone: ' 0400 000 000 ',
        association: '  Northside Clinic ',
        role: 'Practice manager',
        notes: 'Prefers email.',
    })

    assert.deepEqual(errors, [])

    const fields = Object.fromEntries(updates.map((update) => [update.key, update.value]))
    assert.equal(fields.name, 'Jane Doe')
    // Emails are lower-cased so two spellings sort and search together.
    assert.equal(fields.email, 'jane@example.com')
    assert.equal(fields.phone, '0400 000 000')
    assert.equal(fields.association, 'Northside Clinic')
    assert.equal(fields.role, 'Practice manager')
    assert.equal(fields.notes, 'Prefers email.')
})

test('resolveContactFields only returns the keys that were provided', () => {
    const { updates, errors } = resolveContactFields({ phone: '123' })

    assert.deepEqual(errors, [])
    assert.deepEqual(updates, [{ key: 'phone', value: '123' }])
})

test('resolveContactFields rejects a malformed email but allows a blank one', () => {
    assert.equal(resolveContactFields({ email: 'not-an-email' }).errors[0], 'Enter a valid email address')
    assert.deepEqual(resolveContactFields({ email: '' }).errors, [])
    assert.deepEqual(resolveContactFields({ email: 'a@b.co' }).errors, [])
})

test('resolveContactFields rejects a non-object metadata value', () => {
    assert.equal(resolveContactFields({ metadata: 'nope' }).errors[0], 'metadata must be an object or null')
    assert.deepEqual(resolveContactFields({ metadata: null }).errors, [])
})

test('resolveContactFields normalises the patient links into a de-duplicated id list', () => {
    assert.deepEqual(
        resolveContactFields({ patient_ids: [4, 4, '7'] }).updates,
        [{ key: 'patient_ids', value: [4, 7] }]
    )
    // A plain multi-select submits the ids as one comma-separated string.
    assert.deepEqual(
        resolveContactFields({ patient_ids: '12, 3' }).updates,
        [{ key: 'patient_ids', value: [12, 3] }]
    )
    // Clearing the links keeps the contact but detaches it from every patient.
    assert.deepEqual(resolveContactFields({ patient_ids: [] }).updates, [{ key: 'patient_ids', value: [] }])
    assert.deepEqual(resolveContactFields({ patient_ids: '' }).updates, [{ key: 'patient_ids', value: [] }])
})

test('resolveContactFields rejects a patient link that is not a positive integer', () => {
    const { updates, errors } = resolveContactFields({ patient_ids: ['abc'] })

    assert.equal(errors[0], 'Select a valid patient')
    assert.deepEqual(updates, [])
})

test('normalizePatientIds tolerates numbers, strings and blanks', () => {
    assert.deepEqual(normalizePatientIds(null), { ids: [] })
    assert.deepEqual(normalizePatientIds(''), { ids: [] })
    assert.deepEqual(normalizePatientIds([3, '', null, undefined, '5']), { ids: [3, 5] })
    assert.equal(normalizePatientIds([0]).error, 'Select a valid patient')
})

test('resolveContactFields truncates values past the field limit', () => {
    const longName = 'x'.repeat(CONTACT_FIELD_LIMITS.name + 50)
    const { updates } = resolveContactFields({ name: longName })

    assert.equal(updates[0].value.length, CONTACT_FIELD_LIMITS.name)
    assert.equal(cleanBoundedString('  abcdef  ', 3), 'abc')
})

test('isValidContactEmail stays permissive enough for real addresses', () => {
    assert.equal(isValidContactEmail('first.last+tag@sub.example.com.au'), true)
    assert.equal(isValidContactEmail('missing-domain@example'), false)
    assert.equal(isValidContactEmail('spaces in@example.com'), false)
})

test('normalizeContactEmail lower-cases and bounds the address', () => {
    assert.equal(normalizeContactEmail('  MIXED@Case.COM '), 'mixed@case.com')
})

test('validateId accepts positive integers only', () => {
    assert.equal(validateId('12'), 12)
    assert.equal(validateId(12), 12)
    assert.equal(validateId('0'), null)
    assert.equal(validateId('-3'), null)
    assert.equal(validateId('abc'), null)
    assert.equal(validateId(null), null)
})

test('isEmptyContact needs a name or an email', () => {
    assert.equal(isEmptyContact({ name: '', email: '' }), true)
    assert.equal(isEmptyContact({ name: '   ', email: '' }), true)
    assert.equal(isEmptyContact({ name: '', email: 'a@b.co' }), false)
    assert.equal(isEmptyContact({ name: 'Jane' }), false)
})

test('contactMatchesQuery searches every identifying field', () => {
    const row = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '0400 000 000',
        association: 'Northside Clinic',
        role: 'Practice manager',
        notes: 'Prefers email',
        patients: [{ id: 3, name: 'Olivia Hart' }],
    }

    assert.equal(contactMatchesQuery(row, ''), true)
    assert.equal(contactMatchesQuery(row, 'jane'), true)
    assert.equal(contactMatchesQuery(row, 'NORTHSIDE'), true)
    assert.equal(contactMatchesQuery(row, '0400'), true)
    assert.equal(contactMatchesQuery(row, 'manager'), true)
    // A linked patient's name is searchable from the directory.
    assert.equal(contactMatchesQuery(row, 'olivia'), true)
    assert.equal(contactMatchesQuery(row, 'missing'), false)
})

test('normalizeContactRow defaults missing string fields and parses metadata', () => {
    const row = normalizeContactRow({ id: 1, name: null, email: undefined, metadata: '{"source":"import"}' })

    assert.equal(row.name, '')
    assert.equal(row.email, '')
    assert.deepEqual(row.metadata, { source: 'import' })
    assert.deepEqual(row.patients, [])
})

test('normalizeContactPatients cleans, de-duplicates and names the linked patients', () => {
    assert.deepEqual(
        normalizeContactPatients([
            { id: '5', name: '  Olivia Hart ' },
            { id: 5, name: 'Olivia Hart' },
            { id: 6, name: '' },
            { id: null, name: 'Nobody' },
        ]),
        [
            { id: 5, name: 'Olivia Hart' },
            // A nameless record still renders as something.
            { id: 6, name: 'Patient #6' },
        ]
    )
    assert.deepEqual(normalizeContactPatients(undefined), [])
})

test('normalizeContactRow carries every linked patient through, not just the first', () => {
    const row = normalizeContactRow({
        id: 1,
        name: 'Michael Hedgley',
        patients: [
            { id: 1, name: 'Olivia Hart' },
            { id: 7, name: 'Sarah Chen' },
        ],
    })

    assert.deepEqual(row.patients.map((patient) => patient.name), ['Olivia Hart', 'Sarah Chen'])
})

test('buildContactSelect and contactOrderExpression stay in sync with the row shape', () => {
    const select = buildContactSelect()
    assert.match(select, /FROM contacts c/)
    ;['c.name', 'c.email', 'c.phone', 'c.association', 'c.role', 'c.notes'].forEach((column) => {
        assert.ok(select.includes(column), `expected select to include ${column}`)
    })
    assert.match(contactOrderExpression(), /LOWER/)

    // Patients are only aggregated when the patients table is known to exist, so
    // a domain without one still lists its contacts.
    assert.ok(!select.includes('patients'))
    const withPatients = buildContactSelect({ includePatient: true })
    assert.match(withPatients, /contact_patients/)
    assert.match(withPatients, /AS patients/)
})

test('contactDisplayName falls back to the email for an unnamed contact', () => {
    assert.equal(contactDisplayName({ name: 'Jane', email: 'jane@example.com' }), 'Jane')
    assert.equal(contactDisplayName({ name: '', email: 'jane@example.com' }), 'jane@example.com')
    assert.equal(contactDisplayName({}), 'Unnamed contact')
})

test('describeContactSummary lists association, then patients, then contact details', () => {
    assert.equal(
        describeContactSummary({ role: 'Manager', association: 'Northside Clinic', email: 'jane@example.com', phone: '0400' }),
        'Manager · Northside Clinic • jane@example.com • 0400'
    )
    assert.equal(
        describeContactSummary({ patients: [{ id: 1, name: 'Olivia Hart' }], email: 'jane@example.com' }),
        'Patient: Olivia Hart • jane@example.com'
    )
    // A support coordinator usually serves more than one patient.
    assert.equal(
        describeContactSummary({ patients: [{ id: 1, name: 'Olivia Hart' }, { id: 2, name: 'Sarah Chen' }] }),
        'Patients: Olivia Hart, Sarah Chen'
    )
    assert.equal(describeContactSummary({ email: 'jane@example.com' }), 'jane@example.com')
    assert.equal(describeContactSummary({}), 'No details yet')
})

test('buildContactMetrics counts reachable contacts and distinct associations', () => {
    const metrics = buildContactMetrics([
        { email: 'a@b.co', phone: '1', association: 'Northside' },
        { email: '', phone: '', association: 'northside' },
        { email: 'c@d.co', association: '  ' },
        { patients: [{ id: 1, name: 'Olivia Hart' }] },
    ])

    assert.equal(metrics.total, 4)
    assert.equal(metrics.withEmail, 2)
    assert.equal(metrics.withPhone, 1)
    assert.equal(metrics.withPatient, 1)
    // Associations are compared case-insensitively.
    assert.equal(metrics.associations.size, 1)
})

test('filterContacts narrows the list without mutating it', () => {
    const rows = [{ name: 'Jane' }, { name: 'Bob' }]
    const filtered = filterContacts(rows, 'jane')

    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].name, 'Jane')
    assert.equal(rows.length, 2)
})
