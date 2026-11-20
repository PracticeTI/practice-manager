import test from 'node:test'
import assert from 'node:assert/strict'
import { extractIntakeGoals, padGoalsForEditing, splitGoalList } from '../src/admin-ui/components/fcaIntakeGoals.js'

// Verbatim `metadata.sploseAnswers.ndis_goals` value from patient 21
// (domain-a): one paragraph using "1. ... 2. ..." markers, with the first
// goal carrying no marker at all.
const INTAKE_GOALS_BLOB = 'I want to manage any pain I may have and maintain comfortable joint range of movement and breathing. 2.     I would like to continue to attend community activities that allow for social engagement and participation in meaningful activities and attending appointments    3.    I would like to maintain my health and well being overall 4. I would like to remain living independently in my home for as long as practicable and continue living with my wife 5.  I would like to continue to safely and independently participate in meaningful activities in the home, maintaining my self care and domestic activities.  6. I would like to safely and independently be able to mobilise in a variety of settings in the home and in the community.  7.    I would like to ensure that I remain comfortable in my bed and chair and continue to transfer as independently as possible 8.    I would like to continue to work on my speech, safe swallowing techniques, eating techniques, remove risks of choking and build on my communication skills. 9. : I would like to explore some short term accommodation options'

test('splits a numbered intake goals paragraph into individual goals', () => {
    const goals = splitGoalList(INTAKE_GOALS_BLOB)

    assert.equal(goals.length, 9)
    assert.equal(goals[0], 'I want to manage any pain I may have and maintain comfortable joint range of movement and breathing.')
    assert.equal(goals[2], 'I would like to maintain my health and well being overall')
    // The dangling ":" after marker 9 must not survive into the goal text.
    assert.equal(goals[8], 'I would like to explore some short term accommodation options')
    assert.ok(!goals.some((goal) => /^\d/.test(goal)), 'goal text keeps no leading marker')
})

test('splits newline, bullet, semicolon and array shapes', () => {
    assert.deepEqual(splitGoalList('- Walk to the letterbox\n- Prepare simple meals'), [
        'Walk to the letterbox',
        'Prepare simple meals',
    ])
    assert.deepEqual(splitGoalList('Attend hydrotherapy; Return to bushwalking'), [
        'Attend hydrotherapy',
        'Return to bushwalking',
    ])
    assert.deepEqual(splitGoalList(['Improve sleep', 'Improve sleep', '']), ['Improve sleep'])
})

test('keeps decimals and ignores blank answers', () => {
    assert.deepEqual(splitGoalList('Track NDIS 2.0 plan progress'), ['Track NDIS 2.0 plan progress'])
    assert.deepEqual(splitGoalList(''), [])
    assert.deepEqual(splitGoalList('   '), [])
    assert.deepEqual(splitGoalList(null), [])
})

test('reads goals from the intake answers projected onto the patient record', () => {
    const patient = {
        patient_name: 'Justin McAdam',
        metadata: {
            sploseAnswers: { ndis_goals: INTAKE_GOALS_BLOB, patient_full_name: 'Justin McAdam' },
        },
    }

    const goals = extractIntakeGoals(patient)
    assert.equal(goals.length, 9)
    assert.equal(goals[1], 'I would like to continue to attend community activities that allow for social engagement and participation in meaningful activities and attending appointments')
})

test('reads goals from the labelled answer and the Splose export field', () => {
    const labelled = extractIntakeGoals({
        metadata: { sploseLabelledAnswers: { 'What are their NDIS Goals?': '1. Keep gardening 2. See grandchildren weekly' } },
    })
    assert.deepEqual(labelled, ['Keep gardening', 'See grandchildren weekly'])

    const exported = extractIntakeGoals({
        metadata: { splosePatient: { ndis_goals: 'Stay independent at home' } },
    })
    assert.deepEqual(exported, ['Stay independent at home'])
})

test('returns an empty list when no intake goals answer exists', () => {
    assert.deepEqual(extractIntakeGoals({ metadata: { sploseAnswers: { address: 'Ballarat' } } }), [])
    assert.deepEqual(extractIntakeGoals(null), [])
    assert.deepEqual(extractIntakeGoals({}), [])
})

test('pads the goal list to the three inputs the step renders', () => {
    assert.deepEqual(padGoalsForEditing(['Only one goal']), ['Only one goal', '', ''])
    assert.deepEqual(padGoalsForEditing(['a', 'b', 'c', 'd']).length, 4)
    assert.deepEqual(padGoalsForEditing(null), ['', '', ''])
})
