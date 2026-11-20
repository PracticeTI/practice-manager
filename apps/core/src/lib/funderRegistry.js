/**
 * Built-in Funders seed data — the funding bodies and the published
 * documentation the platform relies on.
 *
 * This is the source of truth for funder *documentation URLs*: feature code
 * (e.g. `src/lib/ndisSupportCatalogue.js`) re-exports the values below instead of
 * hardcoding a link, and `src/lib/fundersStore.js` seeds the `funders` /
 * `funder_documents` tables from here the first time they are used. Seeding is
 * additive only — an admin edit or deletion is never overwritten.
 *
 * NDIS links were verified against ndis.gov.au on 29 Sep 2026. The NDIA
 * republishes its pricing schedules and support catalogue each financial year,
 * so `effective_period` is recorded on every dated document; refresh both the
 * URL and the period when a new schedule is published.
 *
 * Registration-group links come from the NDIS Quality and Safeguards Commission
 * (ndiscommission.gov.au), the scheme's regulator and a separate body from the
 * NDIA.
 *
 * TAC links were verified against tac.vic.gov.au on 13 Oct 2026. The Transport
 * Accident Commission republishes its fee schedules and service policies from
 * time to time (the occupational therapy fee schedule changed on 1 July 2026),
 * so `effective_period` is recorded on the dated documents; refresh the URL and
 * the period when a new schedule is published. The TAC site sits behind
 * Cloudflare, so automated link checks may report its pages as blocked.
 *
 * Deliberately free of Node-only imports (shared by the admin UI, the API routes
 * and `node --test`).
 */

/* --- Canonical NDIS links ------------------------------------------------- */

export const NDIS_WEBSITE_URL = 'https://www.ndis.gov.au'
export const NDIS_PRICING_ARRANGEMENTS_URL = 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements'
export const NDIS_SUPPORT_CATALOGUE_URL = 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/what-support-catalogue'
export const NDIS_PRICING_ARCHIVE_URL = 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing-archive'
export const NDIS_PAYMENTS_URL = 'https://www.ndis.gov.au/providers/pricing-and-payments/payments'

/** The current pricing schedule's financial year. Bump when the NDIA republishes. */
export const NDIS_PRICING_SCHEDULE_PERIOD = '2026-27'

export const NDIS_PRICING_SCHEDULE_2026_27_URL = 'https://www.ndis.gov.au/media/8841/download?attachment'
export const NDIS_PRICING_SCHEDULE_2026_27_DOCX_URL = 'https://www.ndis.gov.au/media/8842/download?attachment'
export const NDIS_SDA_PRICING_SCHEDULE_2026_27_URL = 'https://www.ndis.gov.au/media/8844/download?attachment'
export const NDIS_SUPPORT_CATALOGUE_2026_27_URL = 'https://www.ndis.gov.au/media/8038/download?attachment'

/**
 * The NDIS Quality and Safeguards Commission publishes the classes of support a
 * provider must be registered for. Verified 12 Oct 2026.
 */
export const NDIS_REGISTRATION_GROUPS_URL = 'https://www.ndiscommission.gov.au/provider-registration/apply-registration/registration-groups-or-classes-support'

/** Document keys other modules look up. Keep these stable. */
export const NDIS_PRICING_ARRANGEMENTS_DOCUMENT_KEY = 'pricing-arrangements'
export const NDIS_SUPPORT_CATALOGUE_DOCUMENT_KEY = 'support-catalogue'
export const NDIS_REGISTRATION_GROUPS_DOCUMENT_KEY = 'registration-groups'

/* --- Canonical TAC links --------------------------------------------------- */

export const TAC_WEBSITE_URL = 'https://www.tac.vic.gov.au'

/** The A–Z of approved fee schedules (how much the TAC pays per service). */
export const TAC_FEE_SCHEDULES_URL = 'https://www.tac.vic.gov.au/providers/invoicing-and-fees/fee-schedules'
export const TAC_OT_FEE_SCHEDULE_URL = 'https://www.tac.vic.gov.au/providers/invoicing-and-fees/fee-schedule/occupational-therapy-services'

/** Provider registration, and the occupational therapy Access Registry. */
export const TAC_REGISTRATION_URL = 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/register-with-the-tac'
export const TAC_OT_REGISTRATION_URL = 'https://www.tac.vic.gov.au/providers/working-with-the-tac/register-with-the-tac/occupational-therapy'

/** Clinical and policy sources the practice reports against. */
export const TAC_CLINICAL_FRAMEWORK_URL = 'https://www.tac.vic.gov.au/providers/type/content/clinical-framework'
export const TAC_ALLIED_HEALTH_POLICY_URL = 'https://www.tac.vic.gov.au/providers/type/treating-a-client/allied-health-policy'
export const TAC_OUTCOME_MEASURES_URL = 'https://www.tac.vic.gov.au/providers/working-with-the-tac/outcome-measures'

/** The Act behind the scheme, on the Victorian legislation site. */
export const TAC_LEGISLATION_URL = 'https://www.legislation.vic.gov.au/in-force/acts/transport-accident-act-1986'

/** The financial year the current fee schedules apply to. Bump when the TAC republishes. */
export const TAC_FEE_SCHEDULE_PERIOD = '2026-27'

/** Document keys other modules look up. Keep these stable. */
export const TAC_FEE_SCHEDULES_DOCUMENT_KEY = 'fee-schedules'
export const TAC_OT_FEE_SCHEDULE_DOCUMENT_KEY = 'occupational-therapy-fee-schedule'
export const TAC_REGISTRATION_DOCUMENT_KEY = 'provider-registration'
export const TAC_OT_REGISTRATION_DOCUMENT_KEY = 'occupational-therapy-registration'
export const TAC_CLINICAL_FRAMEWORK_DOCUMENT_KEY = 'clinical-framework'
export const TAC_ALLIED_HEALTH_POLICY_DOCUMENT_KEY = 'allied-health-policy'
export const TAC_LEGISLATION_DOCUMENT_KEY = 'transport-accident-act-1986'

/**
 * The funders that ship with the platform. Each funder carries a `documents`
 * array; keys are stable slugs so a feature can resolve a link by key.
 */
export const BUILT_IN_FUNDER_SEEDS = [
    {
        key: 'ndis',
        name: 'NDIS',
        full_name: 'National Disability Insurance Scheme',
        description: 'Australia\'s national scheme for funding disability supports. The platform bills and reports NDIS work against the published pricing schedules, support catalogue and practice standards.',
        jurisdiction: 'Australia',
        website_url: NDIS_WEBSITE_URL,
        status: 'published',
        sort_order: 0,
        metadata: {
            scheme: 'ndis',
            aliases: ['National Disability Insurance Scheme', 'NDIA', 'National Disability Insurance Agency'],
        },
        documents: [
            // --- Pricing & payments ---
            {
                key: NDIS_PRICING_ARRANGEMENTS_DOCUMENT_KEY,
                title: 'NDIS pricing arrangements',
                url: NDIS_PRICING_ARRANGEMENTS_URL,
                category: 'pricing',
                doc_type: 'link',
                description: 'The landing page for the current pricing schedules, price limits and claiming guidance.',
                is_primary: true,
                position: 0,
            },
            {
                key: 'pricing-schedule-2026-27',
                title: `NDIS pricing schedule ${NDIS_PRICING_SCHEDULE_PERIOD}`,
                url: NDIS_PRICING_SCHEDULE_2026_27_URL,
                category: 'pricing',
                doc_type: 'file',
                description: 'Maximum prices for all supports, effective 24 September 2026. The price limits quoted to participants come from here.',
                effective_period: NDIS_PRICING_SCHEDULE_PERIOD,
                position: 1,
            },
            {
                key: 'pricing-schedule-2026-27-docx',
                title: `NDIS pricing schedule ${NDIS_PRICING_SCHEDULE_PERIOD} (editable)`,
                url: NDIS_PRICING_SCHEDULE_2026_27_DOCX_URL,
                category: 'pricing',
                doc_type: 'file',
                description: 'The same pricing schedule as an editable document for planning and quoting.',
                effective_period: NDIS_PRICING_SCHEDULE_PERIOD,
                position: 2,
            },
            {
                key: 'sda-pricing-schedule-2026-27',
                title: `Pricing schedule for specialist disability accommodation ${NDIS_PRICING_SCHEDULE_PERIOD}`,
                url: NDIS_SDA_PRICING_SCHEDULE_2026_27_URL,
                category: 'pricing',
                doc_type: 'file',
                description: 'SDA maximum prices for the current financial year.',
                effective_period: NDIS_PRICING_SCHEDULE_PERIOD,
                position: 3,
            },
            {
                key: 'sda-pricing-arrangements',
                title: 'SDA pricing arrangements',
                url: 'https://www.ndis.gov.au/providers/home-and-living-providers/specialist-disability-accommodation-sda-tools/specialist-disability-accommodation-sda-pricing-arrangements',
                category: 'pricing',
                doc_type: 'link',
                description: 'Summary of the prices that apply to specialist disability accommodation.',
                position: 4,
            },
            {
                key: 'disability-support-worker-cost-model',
                title: 'Disability support worker cost model',
                url: 'https://www.ndis.gov.au/media/8724/download?attachment',
                category: 'pricing',
                doc_type: 'file',
                description: 'The NDIA model for the cost of delivering a billable hour of support.',
                effective_period: NDIS_PRICING_SCHEDULE_PERIOD,
                position: 5,
            },
            {
                key: 'pricing-arrangements-2025-26',
                title: 'Pricing arrangements and price limits 2025-26',
                url: 'https://www.ndis.gov.au/media/8096/download?attachment',
                category: 'pricing',
                doc_type: 'file',
                description: 'The superseded pricing arrangements, kept for quoting work prepared before 1 July 2026.',
                effective_period: '2025-26',
                position: 6,
            },
            {
                key: 'payments',
                title: 'Payments to providers',
                url: NDIS_PAYMENTS_URL,
                category: 'pricing',
                doc_type: 'link',
                description: 'How provider claims are made, paid and reconciled.',
                position: 7,
            },
            {
                key: 'annual-pricing-review',
                title: 'What is the annual pricing review',
                url: 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/what-annual-pricing-review-apr',
                category: 'pricing',
                doc_type: 'link',
                description: 'How the NDIA reviews and sets prices each year.',
                position: 8,
            },
            {
                key: 'how-we-make-pricing-recommendations',
                title: 'How we make pricing recommendations',
                url: 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/how-we-make-pricing-recommendations',
                category: 'pricing',
                doc_type: 'link',
                description: 'The method behind the annual price determination.',
                position: 9,
            },

            // --- Support catalogue ---
            {
                key: NDIS_SUPPORT_CATALOGUE_DOCUMENT_KEY,
                title: 'What is the support catalogue',
                url: NDIS_SUPPORT_CATALOGUE_URL,
                category: 'catalogue',
                doc_type: 'link',
                description: 'Explains the support catalogue: the support items, their codes and units.',
                position: 0,
            },
            {
                key: 'support-catalogue-2026-27',
                title: `Support catalogue ${NDIS_PRICING_SCHEDULE_PERIOD}`,
                url: NDIS_SUPPORT_CATALOGUE_2026_27_URL,
                category: 'catalogue',
                doc_type: 'file',
                description: 'The support item numbers, names, units and registration groups the quote lines are drawn from.',
                effective_period: NDIS_PRICING_SCHEDULE_PERIOD,
                position: 1,
            },
            {
                key: 'pricing-archive',
                title: 'Pricing archive',
                url: NDIS_PRICING_ARCHIVE_URL,
                category: 'catalogue',
                doc_type: 'link',
                description: 'Superseded pricing arrangements, catalogues and schedules by financial year.',
                position: 2,
            },

            // --- Registration & audits ---
            {
                key: NDIS_REGISTRATION_GROUPS_DOCUMENT_KEY,
                title: 'Registration groups or classes of support',
                url: NDIS_REGISTRATION_GROUPS_URL,
                category: 'registration',
                doc_type: 'link',
                description: 'The classes of support a provider must be registered for, published by the NDIS Quality and Safeguards Commission.',
                position: 0,
            },

            // --- Guidance & resources ---
            {
                key: 'at-home-modifications-consumables-code-guide',
                title: 'Assistive technology, home modifications and consumables code guide',
                url: 'https://www.ndis.gov.au/media/8093/download?attachment',
                category: 'guidance',
                doc_type: 'file',
                description: 'The most widely used assistive technology, home modification and consumable supports.',
                effective_period: '2025-26',
                position: 0,
            },
            {
                key: 'bereavement-addendum',
                title: 'NDIS bereavement addendum',
                url: 'https://www.ndis.gov.au/media/7728/download?attachment',
                category: 'guidance',
                doc_type: 'file',
                description: 'Supports that may be claimed after a participant has died.',
                effective_period: '2025-26',
                position: 1,
            },
            {
                key: 'working-as-a-provider',
                title: 'Working as a provider',
                url: 'https://www.ndis.gov.au/providers/working-provider',
                category: 'guidance',
                doc_type: 'link',
                description: 'Registration, obligations and day-to-day requirements for NDIS providers.',
                position: 2,
            },
            {
                key: 'working-with-participants',
                title: 'Working with participants',
                url: 'https://www.ndis.gov.au/providers/working-participants',
                category: 'guidance',
                doc_type: 'link',
                description: 'Service agreements, consent and participant-facing obligations.',
                position: 3,
            },
            {
                key: 'support-budgets',
                title: 'What are NDIS support budgets',
                url: 'https://www.ndis.gov.au/participants/using-your-funding/ndis-support-budgets/what-are-ndis-support-budgets',
                category: 'guidance',
                doc_type: 'link',
                description: 'How a participant plan is divided into budgets, and which supports fall in each.',
                position: 4,
            },
            {
                key: 'specialist-disability-accommodation',
                title: 'What is specialist disability accommodation',
                url: 'https://www.ndis.gov.au/participants/home-and-living/types-home-and-living-supports/what-specialist-disability-accommodation-sda',
                category: 'guidance',
                doc_type: 'link',
                description: 'Participant-facing overview of SDA.',
                position: 5,
            },
            {
                key: 'our-guidelines',
                title: 'Our guidelines',
                url: 'https://www.ndis.gov.au/understanding-ndis/about-ndis/our-guidelines',
                category: 'guidance',
                doc_type: 'link',
                description: 'How the NDIA applies the legislation when making decisions.',
                position: 6,
            },
            {
                key: 'publications',
                title: 'NDIS publications',
                url: 'https://www.ndis.gov.au/publications',
                category: 'guidance',
                doc_type: 'link',
                description: 'Reports, strategies and corporate publications.',
                position: 7,
            },
            {
                key: 'data-and-research',
                title: 'NDIS data and research',
                url: 'https://dataresearch.ndis.gov.au/',
                category: 'guidance',
                doc_type: 'link',
                description: 'Datasets and research published by the NDIA.',
                position: 8,
            },

            // --- Policy & legislation ---
            {
                key: 'ndis-laws',
                title: 'NDIS laws',
                url: 'https://www.ndis.gov.au/ndis-laws',
                category: 'policy',
                doc_type: 'link',
                description: 'The Act and the rules that govern the scheme.',
                position: 0,
            },
            {
                key: 'securing-ndis-future-generations',
                title: 'Securing the NDIS for future generations',
                url: 'https://www.ndis.gov.au/ndis-laws/securing-ndis-future-generations',
                category: 'policy',
                doc_type: 'link',
                description: 'The 2026 legislative reform that changes which supports are funded.',
                position: 1,
            },
            {
                key: 'policies-rules-and-legal',
                title: 'Policies, rules and legal',
                url: 'https://www.ndis.gov.au/policies-rules-and-legal',
                category: 'policy',
                doc_type: 'link',
                description: 'Operational policy, rules, notices and legal guidance.',
                position: 2,
            },
        ],
    },
    {
        key: 'tac',
        name: 'TAC',
        full_name: 'Transport Accident Commission',
        description: 'Victoria\'s no-fault transport accident scheme. The platform assesses, reports and bills occupational therapy for people injured on Victorian roads against the TAC\'s published fee schedules, service policies and reporting requirements.',
        jurisdiction: 'Victoria, Australia',
        website_url: TAC_WEBSITE_URL,
        status: 'published',
        sort_order: 10,
        metadata: {
            scheme: 'tac',
            aliases: ['Transport Accident Commission', 'TAC Victoria'],
        },
        documents: [
            // --- Fees & payments ---
            {
                key: TAC_FEE_SCHEDULES_DOCUMENT_KEY,
                title: 'TAC fee schedules',
                url: TAC_FEE_SCHEDULES_URL,
                category: 'pricing',
                doc_type: 'link',
                description: 'The approved fee schedules: how much the TAC pays for each treatment and service, listed by profession.',
                is_primary: true,
                position: 0,
            },
            {
                key: TAC_OT_FEE_SCHEDULE_DOCUMENT_KEY,
                title: 'Occupational therapy fees',
                url: TAC_OT_FEE_SCHEDULE_URL,
                category: 'pricing',
                doc_type: 'link',
                description: 'OT item codes and maximum payment rates, including the higher OT Access Registry rates, effective 1 July 2026.',
                effective_period: TAC_FEE_SCHEDULE_PERIOD,
                position: 1,
            },
            {
                key: 'hand-therapy-fee-schedule',
                title: 'Hand therapy fees',
                url: 'https://www.tac.vic.gov.au/providers/invoicing-and-fees/fee-schedule/hand-therapy',
                category: 'pricing',
                doc_type: 'link',
                description: 'The fee schedule an occupational therapist or physiotherapist uses when delivering hand therapy to TAC clients.',
                effective_period: TAC_FEE_SCHEDULE_PERIOD,
                position: 2,
            },
            {
                key: 'telehealth-fee-schedule',
                title: 'Telehealth fees for allied health providers',
                url: 'https://www.tac.vic.gov.au/providers/invoicing-and-fees/fee-schedule/telehealth-allied-health-providers',
                category: 'pricing',
                doc_type: 'link',
                description: 'The TAC\'s rates for allied health services delivered by telehealth.',
                position: 3,
            },
            {
                key: 'how-to-invoice-the-tac',
                title: 'How to invoice the TAC',
                url: 'https://www.tac.vic.gov.au/providers/working-with-the-tac/how-to-invoice-the-tac',
                category: 'pricing',
                doc_type: 'link',
                description: 'The details a valid tax invoice must carry so the practice is paid promptly and accurately.',
                position: 4,
            },
            {
                key: 'hicaps-digital',
                title: 'HICAPS Digital claims',
                url: 'https://www.tac.vic.gov.au/providers/resources/hicaps',
                category: 'pricing',
                doc_type: 'link',
                description: 'Invoice the TAC at the time of service for next-business-day payment.',
                position: 5,
            },
            {
                key: 'getting-paid',
                title: 'Getting paid',
                url: 'https://www.tac.vic.gov.au/providers/working-with-the-tac/getting-paid',
                category: 'pricing',
                doc_type: 'link',
                description: 'Payment methods, bank details and when payments are made.',
                position: 6,
            },
            {
                key: 'what-we-can-pay-for',
                title: 'What we can pay for',
                url: 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/what-we-can-pay-for',
                category: 'pricing',
                doc_type: 'link',
                description: 'The treatments and services the TAC will fund, and when approval is required.',
                position: 7,
            },
            {
                key: 'what-we-cannot-pay-for',
                title: 'What we cannot pay for',
                url: 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/what-we-cannot-pay-for',
                category: 'pricing',
                doc_type: 'link',
                description: 'Treatments and services that fall outside TAC funding.',
                position: 8,
            },

            // --- Registration & audits ---
            {
                key: TAC_REGISTRATION_DOCUMENT_KEY,
                title: 'Register with the TAC',
                url: TAC_REGISTRATION_URL,
                category: 'registration',
                doc_type: 'link',
                description: 'How health and service providers register to treat TAC clients.',
                position: 0,
            },
            {
                key: TAC_OT_REGISTRATION_DOCUMENT_KEY,
                title: 'Occupational therapy registration (OT Access Registry)',
                url: TAC_OT_REGISTRATION_URL,
                category: 'registration',
                doc_type: 'link',
                description: 'The OT Access Registry requirements: referral acceptance, service delivery timeframes and rates.',
                position: 1,
            },
            {
                key: 'ot-access-registry-form',
                title: 'Occupational Therapy Access Registry form',
                url: 'https://www.tac.vic.gov.au/providers/documents-and-forms/basic-forms/otar/occupational-therapy-access-registry-form',
                category: 'registration',
                doc_type: 'link',
                description: 'The form an occupational therapist submits to join the OT Access Registry.',
                position: 2,
            },
            {
                key: 'register-as-an-ot-with-the-tac',
                title: 'Register as an OT with the TAC',
                url: 'https://www.tac.vic.gov.au/providers/type/occupational-therapist/treating-a-client/register-as-an-ot-with-the-tac',
                category: 'registration',
                doc_type: 'link',
                description: 'AHPRA registration, OT service expectations and the registry terms of registration.',
                position: 3,
            },
            {
                key: 'quality-and-safety',
                title: 'Quality and safety',
                url: 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/quality-and-safety',
                category: 'registration',
                doc_type: 'link',
                description: 'The TAC\'s provider quality, safeguarding and child-safety expectations.',
                position: 4,
            },
            {
                key: 'essentials-for-tac-providers',
                title: 'Essentials for TAC providers',
                url: 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/essentials-for-tac-providers',
                category: 'registration',
                doc_type: 'link',
                description: 'The onboarding overview for providers new to the scheme.',
                position: 5,
            },
            {
                key: 'clinical-panel',
                title: 'TAC Clinical Panel',
                url: 'https://www.tac.vic.gov.au/providers/resources/clinical-panel',
                category: 'registration',
                doc_type: 'link',
                description: 'The panel that conducts clinical reviews and provides specialist advice.',
                position: 6,
            },

            // --- Clinical standards ---
            {
                key: TAC_CLINICAL_FRAMEWORK_DOCUMENT_KEY,
                title: 'Clinical Framework for the Delivery of Health Services',
                url: TAC_CLINICAL_FRAMEWORK_URL,
                category: 'standards',
                doc_type: 'link',
                description: 'The five principles every treatment must follow to be funded.',
                position: 0,
            },
            {
                key: TAC_ALLIED_HEALTH_POLICY_DOCUMENT_KEY,
                title: 'Allied health policy',
                url: TAC_ALLIED_HEALTH_POLICY_URL,
                category: 'standards',
                doc_type: 'link',
                description: 'How allied health treatment is expected to be delivered and reported.',
                position: 1,
            },
            {
                key: 'allied-health-services-guidelines',
                title: 'Allied health services guidelines',
                url: 'https://www.tac.vic.gov.au/providers/working-with-tac-clients/guidelines/allied-health-services',
                category: 'standards',
                doc_type: 'link',
                description: 'The guidelines behind the allied health policy, including the hand therapy requirements.',
                position: 2,
            },
            {
                key: 'occupational-therapy-policy',
                title: 'Occupational therapy policy',
                url: 'https://www.tac.vic.gov.au/clients/how-we-can-help/treatments-and-services/policies/allied-health-services',
                category: 'standards',
                doc_type: 'link',
                description: 'The participant-facing OT policy the practice delivers against.',
                position: 3,
            },
            {
                key: 'outcome-measures',
                title: 'Outcome measures',
                url: TAC_OUTCOME_MEASURES_URL,
                category: 'standards',
                doc_type: 'link',
                description: 'The validated measures used to demonstrate the effectiveness of treatment.',
                position: 4,
            },
            {
                key: 'medical-and-rehabilitation-equipment-policy',
                title: 'Medical and rehabilitation equipment policy',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/medical-and-rehabilitation-equipment-policy',
                category: 'standards',
                doc_type: 'link',
                description: 'What equipment the TAC will fund, and the approval pathway for it.',
                position: 5,
            },
            {
                key: 'definition-of-severe-injury',
                title: 'Definition of severe injury',
                url: 'https://www.tac.vic.gov.au/clients/how-we-can-help/treatments-and-services/policies/supporting/definition-of-severe-injury',
                category: 'standards',
                doc_type: 'link',
                description: 'The statutory definition that decides eligibility for treatment beyond active recovery.',
                position: 6,
            },

            // --- Policy & legislation ---
            {
                key: TAC_LEGISLATION_DOCUMENT_KEY,
                title: 'Transport Accident Act 1986',
                url: TAC_LEGISLATION_URL,
                category: 'policy',
                doc_type: 'link',
                description: 'The Act that establishes the TAC and sets out what it can pay for.',
                position: 0,
            },
            {
                key: 'certificate-of-capacity',
                title: 'Certificate of Capacity',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/certificate-of-capacity',
                category: 'policy',
                doc_type: 'link',
                description: 'The communication tool used in the return-to-work process.',
                position: 1,
            },
            {
                key: 'returning-to-work',
                title: 'Returning to work',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/returning-to-work',
                category: 'policy',
                doc_type: 'link',
                description: 'How treatment supports a client staying at or returning to work.',
                position: 2,
            },
            {
                key: 'medical-assessments-and-examinations',
                title: 'Medical assessments and examinations',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/medical-assessments-and-examinations',
                category: 'policy',
                doc_type: 'link',
                description: 'How the TAC commissions independent medical examinations and assessments.',
                position: 3,
            },
            {
                key: 'network-pain-management-programs',
                title: 'Network pain management programs',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/network-pain-management-programs',
                category: 'policy',
                doc_type: 'link',
                description: 'The TAC-funded multidisciplinary pain programs clients can be referred to.',
                position: 4,
            },
            {
                key: 'supported-accommodation-policy',
                title: 'Supported accommodation policy',
                url: 'https://www.tac.vic.gov.au/providers/type/accommodation/treating-a-client/supported-accommodation-policy',
                category: 'policy',
                doc_type: 'link',
                description: 'The policy behind housing and support for clients with a severe injury.',
                position: 5,
            },

            // --- Guidance & resources ---
            {
                key: 'working-with-the-tac',
                title: 'Working with the TAC',
                url: 'https://www.tac.vic.gov.au/providers/working-with-the-tac',
                category: 'guidance',
                doc_type: 'link',
                description: 'The provider hub: requirements, approvals, invoicing and resources.',
                position: 0,
            },
            {
                key: 'how-to-seek-tac-approval',
                title: 'How to seek TAC approval',
                url: 'https://www.tac.vic.gov.au/providers/type/working-with-the-tac/how-to-seek-tac-approval',
                category: 'guidance',
                doc_type: 'link',
                description: 'When and how to ask the TAC to approve treatment or services.',
                position: 1,
            },
            {
                key: 'tac-myplan',
                title: 'TAC MyPlan',
                url: 'https://www.tac.vic.gov.au/providers/type/treating-a-client/tac-myplan',
                category: 'guidance',
                doc_type: 'link',
                description: 'The client plan the TAC uses to coordinate support.',
                position: 2,
            },
            {
                key: 'achieving-outcomes',
                title: 'Achieving outcomes',
                url: 'https://www.tac.vic.gov.au/providers/type/occupational-therapist/achieving-outcomes',
                category: 'guidance',
                doc_type: 'link',
                description: 'How the TAC measures and supports improved client outcomes.',
                position: 3,
            },
            {
                key: 'telehealth',
                title: 'Telehealth',
                url: 'https://www.tac.vic.gov.au/providers/resources/telehealth',
                category: 'guidance',
                doc_type: 'link',
                description: 'What the TAC will and will not pay for when a service is delivered by video.',
                position: 4,
            },
            {
                key: 'guidelines',
                title: 'Guidelines',
                url: 'https://www.tac.vic.gov.au/providers/working-with-tac-clients/guidelines',
                category: 'guidance',
                doc_type: 'link',
                description: 'The guidelines index for providers working with TAC clients.',
                position: 5,
            },
            {
                key: 'locate-a-provider',
                title: 'Find a TAC provider',
                url: 'https://www.tac.vic.gov.au/search/locate-provider',
                category: 'guidance',
                doc_type: 'link',
                description: 'Public directory of registered TAC health providers.',
                position: 6,
            },
            {
                key: 'about-the-tac',
                title: 'About the TAC',
                url: 'https://www.tac.vic.gov.au/about-the-tac',
                category: 'guidance',
                doc_type: 'link',
                description: 'Who the TAC is and what it does.',
                position: 7,
            },

            // --- Forms & reports ---
            {
                key: 'documents-and-forms',
                title: 'Documents and forms',
                url: 'https://www.tac.vic.gov.au/providers/documents-and-forms',
                category: 'forms',
                doc_type: 'link',
                description: 'The A–Z of TAC provider forms and report templates.',
                position: 0,
            },
            {
                key: 'allied-health-treatment-and-recovery-plan',
                title: 'Allied Health Treatment and Recovery Plan',
                url: 'https://www.tac.vic.gov.au/providers/documents-and-forms/basic-forms/allied-health-treatment-and-recovery-plan/allied-health-treatment-and-recovery-plan',
                category: 'forms',
                doc_type: 'link',
                description: 'The standard allied health treatment and recovery plan form.',
                position: 1,
            },
            {
                key: 'allied-health-treatment-and-recovery-plan-notes',
                title: 'Allied Health Treatment and Recovery Plan notes',
                url: 'https://www.tac.vic.gov.au/providers/documents-and-forms/basic-forms/allied-health-treatment-and-recovery-plan/allied-health-treatment-and-recovery-plan-notes',
                category: 'forms',
                doc_type: 'link',
                description: 'Guidance for completing the allied health treatment and recovery plan.',
                position: 2,
            },
            {
                key: 'occupational-therapy-service-plan-review',
                title: 'Occupational therapy service plan review form',
                url: 'https://www.tac.vic.gov.au/providers/documents-and-forms/basic-forms/occupational-therapy-service-plan-review',
                category: 'forms',
                doc_type: 'link',
                description: 'The form used to review OT intervention and seek approval for further support.',
                position: 3,
            },
            {
                key: 'health-and-service-provider-registration-form',
                title: 'Health and service provider registration form',
                url: 'https://www.tac.vic.gov.au/providers/working-with-the-tac/register-with-the-tac/health-and-service-providers-registration/health-and-service-provider-registration-form',
                category: 'forms',
                doc_type: 'link',
                description: 'The online registration form for health and service providers.',
                position: 4,
            },

            // --- Reference ---
            {
                key: 'tac-website',
                title: 'TAC website',
                url: TAC_WEBSITE_URL,
                category: 'reference',
                doc_type: 'link',
                description: 'The Transport Accident Commission\'s public website.',
                position: 0,
            },
            {
                key: 'fees',
                title: 'Fees',
                url: 'https://www.tac.vic.gov.au/providers/invoicing-and-fees',
                category: 'reference',
                doc_type: 'link',
                description: 'Invoicing the TAC and the fees paid to health service providers.',
                position: 1,
            },
            {
                key: 'for-providers',
                title: 'For providers',
                url: 'https://www.tac.vic.gov.au/providers',
                category: 'reference',
                doc_type: 'link',
                description: 'The provider landing page.',
                position: 2,
            },
            {
                key: 'contact-the-tac',
                title: 'Contact the TAC',
                url: 'https://www.tac.vic.gov.au/contact',
                category: 'reference',
                doc_type: 'link',
                description: 'Phone, email and postal contact details.',
                position: 3,
            },
        ],
    },
]

/** Look up a built-in funder seed by key (case-insensitive). */
export function getBuiltInFunderSeed(funderKey) {
    const key = String(funderKey || '').trim().toLowerCase()
    if (!key) return null
    return BUILT_IN_FUNDER_SEEDS.find((funder) => funder.key === key) || null
}

/** The built-in document seeds for a funder key. */
export function getBuiltInFunderDocumentSeeds(funderKey) {
    return getBuiltInFunderSeed(funderKey)?.documents || []
}
