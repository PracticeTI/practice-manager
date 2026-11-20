import test from 'node:test'
import assert from 'node:assert/strict'
import { __testOnly } from '../src/jobs/reportWorker.js'

const BORDER_STYLE = 'border-top: 0.5pt solid #1E2850; border-left: 0.5pt solid #1E2850; border-bottom: 0.5pt solid #1E2850; border-right: 0.5pt solid #1E2850'

test('dynamic OTF10 rows replace blank template rows and retain table borders', () => {
    const templateContent = [
        '<table><thead><tr><th>Task</th><th>Frequency</th></tr></thead><tbody>',
        `<tr><td style="${BORDER_STYLE}"><p> </p></td><td style="${BORDER_STYLE}"><p> hrs per </p></td></tr>`,
        '{{funded_support_rows}}',
        '</tbody></table>',
    ].join('\n')
    const fundedSupportRows = __testOnly.tableRows(
        [{ task: 'Domestic cleaning', frequency: 'Weekly' }],
        ['task', 'frequency']
    )

    const report = __testOnly.buildReportFromTemplate({
        templateContent,
        generatedReportMarkdown: '',
        variableMap: { funded_support_rows: fundedSupportRows },
    })

    assert.ok(!report.includes('hrs per'))
    assert.equal((report.match(/<tbody>[\s\S]*?<tr>/g) || []).length, 1)
    assert.match(report, /<td style="border-top: 0\.5pt solid #1E2850;[^>]+"><p>Domestic cleaning<\/p><\/td>/)
    assert.match(report, /<td style="border-top: 0\.5pt solid #1E2850;[^>]+"><p>Weekly<\/p><\/td>/)
})

test('OTF10 patient fields come from Patient Intake Data', () => {
    const variableMap = __testOnly.buildOtf10VariableMap({
        patientMetadata: {
            sploseAnswers: {
                date_of_birth: '1955-10-01',
                claim_or_reference_number: '88/10682',
                accident_date_if_tac: '1988-01-01',
            },
            sploseLabelledAnswers: {
                'Date of birth': 'label fallback DOB',
                'NDIS number/ TAC Claim Number/Work Cover Reference Number': 'label fallback claim',
                'Accident date (if TAC)': 'label fallback accident date',
            },
        },
    })

    const report = __testOnly.buildReportFromTemplate({
        templateContent: '{{date_of_birth}} | {{claim_number}} | {{accident_date}}',
        generatedReportMarkdown: '',
        variableMap,
    })

    assert.equal(report, '1955-10-01 | 88/10682 | 1988-01-01')
})

test('OTF10 patient fields fall back to exact Patient Intake Data labels', () => {
    const variableMap = __testOnly.buildOtf10VariableMap({
        patientMetadata: {
            sploseLabelledAnswers: {
                'Date of birth': '1990-03-15',
                'NDIS number/ TAC Claim Number/Work Cover Reference Number': 'NDIS-123',
                'Accident date (if TAC)': '2024-05-20',
            },
        },
    })

    assert.equal(variableMap.date_of_birth, '1990-03-15')
    assert.equal(variableMap.claim_number, 'NDIS-123')
    assert.equal(variableMap.accident_date, '2024-05-20')
})

test('OTF10 provider defaults come from domain report settings', () => {
    const variableMap = __testOnly.buildOtf10VariableMap({
        patientMetadata: {
            providerDetails: 'Legacy patient provider',
            daysHoursAvailable: 'Legacy patient hours',
        },
        reportConfig: {
            providerDetails: 'Example Occupational Therapy\nPhone: 03 9000 0000',
            daysHoursAvailable: 'Monday-Friday, 9:00 am-5:00 pm',
        },
    })

    assert.equal(variableMap.provider_details, 'Example Occupational Therapy\nPhone: 03 9000 0000')
    assert.equal(variableMap.days_hours_available, 'Monday-Friday, 9:00 am-5:00 pm')
})

test('templates render the practice name instead of the domain key', () => {
    const variableMap = __testOnly.buildTemplateVariableMap({
        patientName: 'Justin McAdam',
        domain: 'example',
        practiceName: 'Example Practice',
        notes: '',
        jobId: '86',
        additionalContext: '',
    })

    assert.equal(variableMap.practice_name, 'Example Practice')
    assert.equal(variableMap.practice, 'Example Practice')
    // The domain key stays available for templates that need the key itself.
    assert.equal(variableMap.domain, 'example')

    const report = __testOnly.buildReportFromTemplate({
        templateContent: '**Participant:** {{patient_name}} **Date:** {{report_date}} **Practice:** {{practice_name}}\n\n{{generated_report_body}}',
        generatedReportMarkdown: 'Body text.',
        variableMap,
    })

    assert.match(report, /\*\*Practice:\*\* Example Practice/)
    assert.doesNotMatch(report, /Domain:/)
    assert.doesNotMatch(report, /example/)
})

test('FCA template output removes draft scaffolding and duplicate generated title', () => {
    const report = __testOnly.removeFcaTemplateScaffolding([
        '# Functional Capacity Assessment (NDIS)',
        '',
        '## Clinical Draft Notice',
        'This report is a clinical draft and requires review.',
        '',
        '## Generated Report Body',
        '# Functional Capacity Assessment (Draft)',
        '',
        'Participant: Justin McAdam',
        'Practice: Example Practice',
        '',
        '## 1. Executive Summary',
        '',
        'Recommendation.',
    ].join('\n'))

    assert.match(report, /^# Functional Capacity Assessment \(NDIS\)/)
    assert.match(report, /## 1\. Executive Summary/)
    assert.match(report, /Recommendation\./)
    assert.doesNotMatch(report, /Clinical Draft Notice|Generated Report Body|Functional Capacity Assessment \(Draft\)/)
    assert.doesNotMatch(report, /Participant: Justin McAdam/)
    assert.doesNotMatch(report, /Practice: Example Practice/)
})

test('the practice name falls back to the domain key when none is supplied', () => {
    const variableMap = __testOnly.buildTemplateVariableMap({
        patientName: 'Justin McAdam',
        domain: 'example',
        notes: '',
        jobId: '86',
        additionalContext: '',
    })

    assert.equal(variableMap.practice_name, 'example')
})

test('FCA cover tokens come from the identity block and report settings', () => {
    const variableMap = __testOnly.buildTemplateVariableMap({
        patientName: 'Justin McAdam',
        domain: 'example',
        practiceName: 'Example Practice',
        notes: '',
        jobId: '86',
        additionalContext: '',
        identity: {
            ndisNumber: '431874971',
            dateOfBirth: '1961-10-28',
            address: '29 Alderford Dr',
        },
        reportConfig: {
            providerDetails: 'Kate O’Callaghan\nExample Practice\nkate@example.com',
        },
    })

    assert.equal(variableMap.ndis_number, '431874971')
    assert.equal(variableMap.provider_name, 'Kate O’Callaghan')
    assert.equal(variableMap.provider_contact, 'Example Practice · kate@example.com')
    assert.equal(variableMap.provider_details, 'Kate O’Callaghan · Example Practice · kate@example.com')
})

test('the cover page drops optional tokens that have no value', () => {
    const variableMap = __testOnly.buildTemplateVariableMap({
        patientName: 'Justin McAdam',
        domain: 'example',
        practiceName: 'Example Practice',
        notes: '',
        jobId: '86',
        additionalContext: '',
    })

    const report = __testOnly.buildReportFromTemplate({
        templateContent: 'NDIS participant number {{ndis_number}}\n\n<div data-page-break></div>\n\n{{generated_report_body}}',
        generatedReportMarkdown: 'Body text.',
        variableMap,
    })

    assert.doesNotMatch(report, /{{ndis_number}}/)
    assert.match(report, /<div data-page-break><\/div>/)
})
