export const FCA_LANGUAGE_MANIFEST_VERSION = 2

// De-identified, section-scoped language stems used as optional style guidance.
export const FCA_LANGUAGE_MANIFEST = {
    version: FCA_LANGUAGE_MANIFEST_VERSION,
    sections: {
        'executive-summary': [
            {
                id: 'executive-summary-1',
                tags: ['ndis', 'funding-rationale'],
                text: 'This assessment identifies enduring disability-related functional impacts that require ongoing, structured support across personal care, domestic tasks, community participation, and safety management.',
            },
            {
                id: 'executive-summary-2',
                tags: ['support-needs'],
                text: 'Recommended supports are linked to observed functional impact and foreseeable risk, and are presented on the basis that they are reasonable and necessary in relation to the participant\'s disability.',
            },
        ],
        'referral-purpose': [
            {
                id: 'referral-purpose-1',
                tags: ['ndis', 'plan-review'],
                text: 'This Functional Capacity Assessment (FCA) has been prepared to describe the participant\'s current functional performance, support requirements, and disability-related barriers in everyday contexts.',
            },
            {
                id: 'referral-purpose-2',
                tags: ['funding-rationale'],
                text: 'The report provides evidence to inform reasonable and necessary supports, with recommendations linked to observed functional impact and foreseeable risk.',
            },
        ],
        'participant-context': [
            {
                id: 'participant-context-1',
                tags: ['family', 'community'],
                text: 'The participant\'s social context, living arrangement, and available informal supports materially influence day-to-day safety, participation, and service sustainability.',
            },
            {
                id: 'participant-context-2',
                tags: ['participation'],
                text: 'Current participation is best understood by considering both functional capacity and environmental constraints across home and community settings.',
            },
        ],
        'medical-background': [
            {
                id: 'medical-background-1',
                tags: ['neurological', 'complex-needs'],
                text: 'Historical and current clinical information indicates persistent disability-related impacts that are chronic in nature and require ongoing multidisciplinary management.',
            },
            {
                id: 'medical-background-2',
                tags: ['stability'],
                text: 'Functional presentation is variable and may fluctuate with pain, fatigue, emotional regulation, and health status; therefore, support planning should account for non-linear performance.',
            },
        ],
        'current-functioning': [
            {
                id: 'current-functioning-1',
                tags: ['mobility', 'communication'],
                text: 'Observed functioning reflects combined motor, cognitive, and communication limitations that reduce independent task completion and increase reliance on supervised support.',
            },
            {
                id: 'current-functioning-2',
                tags: ['fatigue', 'safety'],
                text: 'Capacity declines across prolonged activity and complex environments, with increased error risk, reduced safety awareness, and greater assistance requirements over time.',
            },
        ],
        'adl-personal-care': [
            {
                id: 'adl-personal-care-1',
                tags: ['adl', 'self-care'],
                text: 'Performance in personal care tasks remains support-dependent due to physical limitations, reduced sequencing, and variable tolerance to routine care demands.',
            },
            {
                id: 'adl-personal-care-2',
                tags: ['manual-handling'],
                text: 'Care routines require consistent staff skill and safe handling procedures to reduce risk of injury, escalation, and task abandonment.',
            },
        ],
        'domestic-community': [
            {
                id: 'domestic-community-1',
                tags: ['domestic', 'participation'],
                text: 'Domestic and community participation is achievable only when support is structured, predictable, and responsive to fluctuating presentation.',
            },
            {
                id: 'domestic-community-2',
                tags: ['transport', 'supervision'],
                text: 'Community access requires supervision and active risk management, particularly during transitions, transport tasks, and high-stimulation settings.',
            },
        ],
        'assistive-technology': [
            {
                id: 'assistive-technology-1',
                tags: ['equipment', 'access'],
                text: 'Assistive technology is required to maintain safety, preserve functional participation, and reduce avoidable reliance on higher-intensity human support where appropriate.',
            },
            {
                id: 'assistive-technology-2',
                tags: ['manual-handling', 'risk-reduction'],
                text: 'Equipment recommendations should be linked directly to manual-handling risk, transfer safety, pressure management, and tolerance for personal care routines.',
            },
        ],
        'risk-safeguarding': [
            {
                id: 'risk-safeguarding-1',
                tags: ['risk', 'behaviour'],
                text: 'The current risk profile includes foreseeable incidents related to mobility, behavioural escalation, communication barriers, and reduced insight under stress.',
            },
            {
                id: 'risk-safeguarding-2',
                tags: ['supervision', 'safety'],
                text: 'Sustained safeguarding requires consistent staffing, clear de-escalation pathways, and environment-specific mitigation strategies.',
            },
        ],
        'standardised-assessment-summary': [
            {
                id: 'assessment-summary-1',
                tags: ['whodas', 'scoring'],
                text: 'Where standardised tools are used, results should be interpreted alongside direct observation and collateral evidence rather than as stand-alone indicators.',
            },
            {
                id: 'assessment-summary-2',
                tags: ['triangulation'],
                text: 'Interpretation should triangulate quantitative scores with qualitative functional impact and support burden in real-world tasks.',
            },
        ],
        'goals-outcomes': [
            {
                id: 'goals-outcomes-1',
                tags: ['goal-alignment'],
                text: 'Goals are most meaningful when they translate into measurable participation outcomes supported by practical, routine-level interventions.',
            },
            {
                id: 'goals-outcomes-2',
                tags: ['capacity-building'],
                text: 'Outcome framing should distinguish capacity-building opportunities from ongoing support requirements that are unlikely to be fully remediated.',
            },
        ],
        'recommendations-funding': [
            {
                id: 'recommendations-funding-1',
                tags: ['funding-rationale'],
                text: 'Recommendations are linked to disability-related impairment, functional impact, and the level of support required to achieve safe and consistent daily functioning.',
            },
            {
                id: 'recommendations-funding-2',
                tags: ['reasonable-and-necessary'],
                text: 'Each requested support should be justified in terms of risk reduction, participation enablement, and sustainability of care arrangements.',
            },
        ],
        'rationale-conclusion': [
            {
                id: 'rationale-conclusion-1',
                tags: ['summary'],
                text: 'Overall evidence indicates enduring and substantial functional limitations with ongoing requirement for coordinated funded supports.',
            },
            {
                id: 'rationale-conclusion-2',
                tags: ['review-cycle'],
                text: 'A structured review cycle is recommended to monitor changes in function, support tolerance, and effectiveness of interventions over time.',
            },
        ],
    },
}
