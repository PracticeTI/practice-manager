// Tests for the practice-wide task queue.
//
// The behaviour that matters: Tasks is the *same* review queue as a patient's
// Overview, only rolled up across patients — so a patient's entries must match
// what their own Overview shows, and the aggregation must not invent a second
// definition of "waiting on review".
//
// Run with: node --test test/patientTasks.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CONTACT_ENQUIRY_GROUP_KEY,
    buildContactEnquiryGroup,
    buildContactEnquiryHref,
    buildPatientTaskGroups,
    buildPatientTaskHref,
    flattenPatientTaskItems,
    isContactEnquiryGroup,
    summarizePatientTasks,
} from '../src/lib/patientTasks.js'
import {
    TASKS_PAGE_FEATURE_FLAG_KEY,
    getDefaultDomainFeatureFlags,
    isTasksPageFeatureEnabled,
    normalizeDomainFeatureFlags,
} from '../src/lib/domainFeatureFlags.js'

const workerDraftQuote = (overrides = {}) => ({
    id: 10,
    patient_id: 9,
    quote_number: 'QTE-0002',
    status: 'draft',
    external_source: 'quote-writer',
    created_at: '2026-10-13T04:08:10.000Z',
    ...overrides,
})

const unsourcedEquipment = (overrides = {}) => ({
    patientId: 9,
    patientName: 'Avery Sample',
    updatedAt: '2026-09-27T09:25:47.000Z',
    suggestions: [
        { equipmentType: 'Steam mop', sourcingStatus: 'unsourced' },
        { equipmentType: 'Knee brace and back support band' },
        { equipmentType: 'Lightweight vacuum cleaner', sourcingStatus: 'quote_received' },
    ],
    ...overrides,
})

const unreviewedReportJob = (overrides = {}) => ({
    id: 44,
    patientId: 9,
    patientName: 'Avery Sample',
    eventType: 'hsr_creator_enabled',
    status: 'completed',
    reviewedAt: null,
    completedAt: '2026-10-14T02:00:00.000Z',
    createdAt: '2026-10-14T01:00:00.000Z',
    ...overrides,
})

test('the Tasks dashboard defaults on for every domain', () => {
    for (const domainKey of ['default', 'example-domain', '', undefined]) {
        assert.equal(getDefaultDomainFeatureFlags(domainKey)[TASKS_PAGE_FEATURE_FLAG_KEY], true)
    }
})

test('isTasksPageFeatureEnabled reads the flag off the stored record', () => {
    assert.equal(isTasksPageFeatureEnabled({ tasksEnabled: true }, 'domain-a'), true)
    assert.equal(isTasksPageFeatureEnabled({ tasksEnabled: false }, 'domain-a'), false)
    assert.equal(isTasksPageFeatureEnabled({}, 'domain-a'), true)
    assert.equal(normalizeDomainFeatureFlags({ tasksEnabled: 'true' }, 'domain-a').tasksEnabled, true)
    // The Tools flag says nothing about Tasks.
    assert.equal(isTasksPageFeatureEnabled({ toolsEnabled: true }, 'domain-a'), true)
})

test('each patient that has something waiting becomes one group', () => {
    const groups = buildPatientTaskGroups({
        patients: [
            { id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true },
            { id: 21, patientName: 'Justin McAdam', equipmentSourcerEnabled: false },
            { id: 5, patientName: 'Grace Ellery', equipmentSourcerEnabled: true },
        ],
        quotes: [
            workerDraftQuote({ id: 12, patient_id: 9, quote_number: 'QTE-0002' }),
            workerDraftQuote({ id: 10, patient_id: 21, quote_number: 'QTE-0001', created_at: '2026-09-29T04:49:15.000Z' }),
        ],
        equipment: [unsourcedEquipment()],
    })

    // Patient 5 has nothing waiting, so they are not a group. Ids are normalised
    // to strings, so a numeric id from one source still groups with a string id
    // from another.
    assert.deepEqual(groups.map((group) => group.patientId), ['9', '21'])

    const lingHu = groups[0]
    assert.equal(lingHu.patientName, 'Avery Sample')
    assert.deepEqual(lingHu.items.map((item) => item.kind), ['quotes', 'equipment'])
    assert.equal(lingHu.total, 3)
    assert.equal(lingHu.items[1].title, '2 equipment suggestions to source')

    const justin = groups[1]
    assert.deepEqual(justin.items.map((item) => item.kind), ['quotes'])
    assert.equal(justin.total, 1)
})

test('every entry deep-links to the patient tab that holds the work', () => {
    const [group] = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        quotes: [workerDraftQuote()],
        equipment: [unsourcedEquipment()],
        reportJobs: [unreviewedReportJob()],
    })

    const [quotes, equipment, report] = group.items
    assert.equal(quotes.href, '/admin/patients?patientId=9&tab=quotes')
    assert.equal(equipment.href, '/admin/patients?patientId=9&tab=equipment')
    assert.equal(report.href, '/admin/patients?patientId=9&tab=report')
    assert.equal(quotes.patientName, 'Avery Sample')
    // The queue's own key is the kind, so it is qualified per patient for lists
    // that flatten everyone together.
    assert.equal(quotes.key, '9:quotes')
    assert.equal(equipment.key, '9:equipment')
    assert.equal(report.key, '9:report')

    assert.equal(buildPatientTaskHref(9), '/admin/patients?patientId=9')
    assert.equal(buildPatientTaskHref('9', 'quotes'), '/admin/patients?patientId=9&tab=quotes')
    assert.equal(buildPatientTaskHref(''), '/admin/patients')
})

test('a report nobody has opened is a group of its own', () => {
    // No quote, no equipment suggestion: the practice-wide Tasks list has to see the
    // report even though nothing else about the patient is outstanding.
    const [group] = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: false }],
        reportJobs: [unreviewedReportJob()],
    })

    assert.equal(group.patientId, '9')
    assert.equal(group.patientName, 'Avery Sample')
    assert.deepEqual(group.items.map((item) => item.kind), ['report'])
    assert.equal(group.total, 1)
    assert.equal(group.oldestCreatedAt, '2026-10-14T02:00:00.000Z')
})

test('a report a person has opened, and a run still in flight, stay out of the queue', () => {
    assert.deepEqual(buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: false }],
        reportJobs: [unreviewedReportJob({ reviewedAt: '2026-10-14T03:00:00.000Z' })],
    }), [])

    assert.deepEqual(buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: false }],
        reportJobs: [unreviewedReportJob({ status: 'queued', reviewedAt: null })],
    }), [])
})

test('equipment entries are dropped for a patient whose Equipment Sourcer is off', () => {
    const [group] = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: false }],
        quotes: [workerDraftQuote()],
        equipment: [unsourcedEquipment()],
    })

    // The tab only exists while the worker is on, so the entry must not link
    // somewhere unreachable — the same rule the patient Overview applies.
    assert.deepEqual(group.items.map((item) => item.kind), ['quotes'])

    // A patient with nothing left to show is not a group at all.
    const onlyEquipment = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: false }],
        equipment: [unsourcedEquipment()],
    })
    assert.deepEqual(onlyEquipment, [])
})

test('quotes a person has already actioned, and sourced equipment, stay out of the queue', () => {
    const groups = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        quotes: [
            workerDraftQuote({ id: 12, status: 'sent' }),
            { id: 13, patient_id: 9, status: 'draft', quote_number: 'QTE-0009' },
        ],
        equipment: [unsourcedEquipment({
            suggestions: [{ equipmentType: 'Hoist', sourcingStatus: 'quote_requested' }],
        })],
    })

    assert.deepEqual(groups, [])
})

test('groups are ordered by how long their oldest entry has waited', () => {
    const groups = buildPatientTaskGroups({
        patients: [
            { id: 8, patientName: 'Jack Patel' },
            { id: 21, patientName: 'Justin McAdam' },
            { id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true },
        ],
        quotes: [
            workerDraftQuote({ id: 14, patient_id: 8, created_at: '2026-10-13T06:07:28.000Z' }),
            workerDraftQuote({ id: 10, patient_id: 21, created_at: '2026-09-29T04:49:15.000Z' }),
        ],
        equipment: [unsourcedEquipment({ updatedAt: '2026-09-27T09:25:47.000Z' })],
    })

    assert.deepEqual(groups.map((group) => group.patientId), ['9', '21', '8'])
    assert.equal(groups[0].oldestCreatedAt, '2026-09-27T09:25:47.000Z')
})

test('the suggestions table has no per-item date, so the row age ages the entry', () => {
    const [group] = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        equipment: [unsourcedEquipment()],
    })

    const [equipment] = group.items
    assert.equal(equipment.oldestCreatedAt, '2026-09-27T09:25:47.000Z')
    assert.equal(group.oldestCreatedAt, '2026-09-27T09:25:47.000Z')
})

test('a worker record for a patient the patient list did not carry is still grouped', () => {
    const groups = buildPatientTaskGroups({
        patients: [],
        quotes: [workerDraftQuote({ patient_id: 42 })],
    })

    assert.deepEqual(groups.map((group) => group.patientId), ['42'])
    // With no name from the patient list, the page falls back to the id.
    assert.equal(groups[0].patientName, '')
})

test('equipment needs a patient row to confirm the Equipment tab exists', () => {
    // The tab only exists while the Equipment Sourcer is switched on, and a patient
    // the list did not carry has no metadata to confirm that with.
    const groups = buildPatientTaskGroups({
        patients: [],
        equipment: [unsourcedEquipment({ patientId: 43, patientName: 'Robin Golding' })],
    })

    assert.deepEqual(groups, [])
})

test('the flattened list keeps the group order and honours the limit', () => {
    const groups = buildPatientTaskGroups({
        patients: [
            { id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true },
            { id: 21, patientName: 'Justin McAdam' },
        ],
        quotes: [workerDraftQuote({ id: 10, patient_id: 21, quote_number: 'QTE-0001', created_at: '2026-09-29T04:49:15.000Z' })],
        equipment: [unsourcedEquipment()],
    })

    assert.deepEqual(
        flattenPatientTaskItems(groups).map((item) => item.key),
        ['9:equipment', '21:quotes']
    )
    assert.deepEqual(
        flattenPatientTaskItems(groups, 1).map((item) => item.key),
        ['9:equipment']
    )
    assert.deepEqual(flattenPatientTaskItems(groups, 0), [])
})

test('the summary counts items and patients for the header sentence', () => {
    const groups = buildPatientTaskGroups({
        patients: [
            { id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true },
            { id: 21, patientName: 'Justin McAdam' },
        ],
        quotes: [workerDraftQuote({ id: 10, patient_id: 21, quote_number: 'QTE-0001' })],
        equipment: [unsourcedEquipment()],
    })

    const summary = summarizePatientTasks(groups)
    assert.equal(summary.patientCount, 2)
    assert.equal(summary.itemCount, 2)
    assert.equal(summary.total, 3)
    assert.equal(summary.summaryText, '3 items across 2 patients are on your list.')

    const empty = summarizePatientTasks([])
    assert.equal(empty.total, 0)
    assert.equal(empty.summaryText, 'Nothing from your agents is on your list.')

    assert.equal(
        summarizePatientTasks([{ total: 1, items: [{}] }]).summaryText,
        '1 item across 1 patient is on your list.'
    )
})

test('the queue tolerates junk input instead of throwing', () => {
    assert.deepEqual(buildPatientTaskGroups(), [])
    assert.deepEqual(buildPatientTaskGroups({ patients: null, quotes: 'nope', equipment: 7, reportJobs: 'nope' }), [])
    assert.deepEqual(buildPatientTaskGroups({ patients: [null, {}, { id: 4 }] }), [])
    assert.deepEqual(buildPatientTaskGroups({ reportJobs: [null, {}, { id: 1 }] }), [])
    assert.deepEqual(flattenPatientTaskItems(null), [])
    assert.equal(summarizePatientTasks(null).total, 0)
})

const websiteEnquiry = (overrides = {}) => ({
    id: 44,
    name: 'Mary Mary',
    email: 'mary@mary.com',
    subject: 'Website Enquiry',
    message: 'Just testing out this contact form in the test system.',
    createdAt: '2026-11-11T04:35:28.701Z',
    ...overrides,
})

test('a website enquiry is the practice\'s group, not a patient\'s', () => {
    const groups = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        quotes: [workerDraftQuote()],
        enquiries: [websiteEnquiry()],
    })

    assert.equal(groups.length, 2)
    const enquiryGroup = groups.find(isContactEnquiryGroup)
    assert.equal(enquiryGroup.groupKey, CONTACT_ENQUIRY_GROUP_KEY)
    assert.equal(enquiryGroup.patientId, null)
    assert.equal(enquiryGroup.patientName, 'Website enquiries')
    assert.equal(enquiryGroup.total, 1)
    assert.equal(enquiryGroup.oldestCreatedAt, '2026-11-11T04:35:28.701Z')

    const [item] = enquiryGroup.items
    assert.equal(item.kind, 'enquiries')
    assert.equal(item.key, 'website-enquiries:44')
    assert.equal(item.title, 'Website Enquiry')
    assert.match(item.detail, /Mary Mary <mary@mary.com>/)
    assert.equal(item.patientName, 'Mary Mary')
    assert.equal(item.actionLabel, 'Open enquiry')
    assert.equal(item.href, '/admin/messages/44?direction=outbound')
    assert.equal(item.oldestCreatedAt, '2026-11-11T04:35:28.701Z')
})

test('the queue is ordered by how long the oldest entry has waited, enquiries included', () => {
    const groups = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        equipment: [unsourcedEquipment({ updatedAt: '2026-09-27T09:25:47.000Z' })],
        enquiries: [websiteEnquiry(), websiteEnquiry({ id: 45, createdAt: '2026-09-20T00:00:00.000Z' })],
    })

    assert.deepEqual(groups.map((group) => group.groupKey || group.patientId), ['website-enquiries', '9'])
    assert.equal(groups[0].total, 2)
})

test('the summary names website enquiries without counting them as patients', () => {
    const groups = buildPatientTaskGroups({
        patients: [{ id: 9, patientName: 'Avery Sample', equipmentSourcerEnabled: true }],
        quotes: [workerDraftQuote()],
        enquiries: [websiteEnquiry()],
    })

    const summary = summarizePatientTasks(groups)
    assert.equal(summary.patientCount, 1)
    assert.equal(summary.enquiryCount, 1)
    assert.equal(summary.total, 2)
    assert.equal(
        summary.summaryText,
        '1 item across 1 patient is on your list. 1 website enquiry is on your list.'
    )

    const onlyEnquiries = summarizePatientTasks(buildPatientTaskGroups({
        enquiries: [websiteEnquiry(), websiteEnquiry({ id: 45 })],
    }))
    assert.equal(onlyEnquiries.patientCount, 0)
    assert.equal(onlyEnquiries.summaryText, '2 website enquiries are on your list.')
})

test('an enquiry without a subject is still a usable row', () => {
    const [group] = buildPatientTaskGroups({ enquiries: [websiteEnquiry({ subject: '', message: '' })] })
    const [item] = group.items
    assert.equal(item.title, 'Enquiry from Mary Mary')
    assert.match(item.detail, /Submitted through the website contact form\./)

    assert.equal(buildContactEnquiryGroup([]), null)
    assert.equal(buildContactEnquiryGroup([{ subject: 'No id' }]), null)
    assert.equal(buildContactEnquiryHref(''), '/admin/messages?direction=outbound')
    assert.equal(buildContactEnquiryHref(44), '/admin/messages/44?direction=outbound')
})
