/**
 * NDIS support catalogue & price limits (curated subset).
 *
 * Source of truth (official NDIS documentation, retrieved 28 Sep 2026):
 *   - Pricing arrangements .... https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements
 *   - Support catalogue 2026-27 https://www.ndis.gov.au/media/8038/download?attachment  (XLSX)
 *   - Pricing schedule 2026-27 . https://www.ndis.gov.au/media/8841/download?attachment  (PDF)
 *
 * The full catalogue has ~980 support items. This module carries only the items an
 * occupational therapy practice quotes in day-to-day work (therapist hourly
 * supports) plus the registration groups whose items are quoted rather than
 * price-limited. It is deliberately free of Node-only imports so both the API
 * routes and the admin UI can use it.
 *
 * IMPORTANT: the NDIS publishes a new catalogue each financial year and price
 * limits change. `NDIS_CATALOGUE_PERIOD` / the effective dates below must be
 * refreshed when that happens, and stored quotes keep the limit that applied
 * when they were prepared.
 */

export const NDIS_CATALOGUE_PERIOD = '2026-27'

/** First date the catalogue's price limits apply (catalogue "Start date" column). */
export const NDIS_CATALOGUE_EFFECTIVE_FROM = '2026-07-01'

/** The pricing determination behind the 2026-27 prices was published 24 Sep 2026. */
export const NDIS_PRICING_SCHEDULE_PUBLISHED = '2026-09-24'

// These two links now live on the NDIS Funder record (see `funderRegistry.js`)
// so the catalogue page and the Funders admin entity can never drift apart.
export {
    NDIS_PRICING_ARRANGEMENTS_URL,
    NDIS_SUPPORT_CATALOGUE_URL,
} from './funderRegistry.js'

/** Shown wherever a price limit is displayed, so the figure is never presented as "our price". */
export const NDIS_PRICE_LIMIT_NOTE = `Maximum prices from the NDIS pricing schedule ${NDIS_CATALOGUE_PERIOD}, effective ${NDIS_CATALOGUE_EFFECTIVE_FROM}. The limits only bind NDIA-managed and plan-managed participants — an NDIS provider cannot charge more than the limit for those participants.`

/** The three price columns the NDIS publishes for every support item. */
export const NDIS_PRICING_REGIONS = [
    { value: 'national', label: 'National', description: 'Standard metropolitan and regional rates.' },
    { value: 'remote', label: 'Remote', description: 'Remote area loading (1.4 × national).' },
    { value: 'very_remote', label: 'Very remote', description: 'Very remote area loading (1.5 × national).' },
]

export const NDIS_PRICING_REGION_VALUES = NDIS_PRICING_REGIONS.map((region) => region.value)

export const DEFAULT_NDIS_PRICING_REGION = 'national'

/** Unit codes used by the catalogue. */
export const NDIS_SUPPORT_UNITS = {
    H: { label: 'Hour', plural: 'Hours' },
    E: { label: 'Each', plural: 'Each' },
    D: { label: 'Day', plural: 'Days' },
    WK: { label: 'Week', plural: 'Weeks' },
    KM: { label: 'Kilometre', plural: 'Kilometres' },
}

export function getNdisSupportUnit(code) {
    const key = String(code || '').trim().toUpperCase()
    return NDIS_SUPPORT_UNITS[key] || { label: key || 'Unit', plural: key || 'Units' }
}

/**
 * Registration groups whose supports are individually quoted instead of being
 * capped by a price limit ("Quote = Yes" in the support catalogue). These are the
 * supports where an OT typically writes the quote: assistive technology, home
 * modifications, prosthetics, vehicle modifications and SDA.
 */
export const NDIS_QUOTE_REQUIRED_REGISTRATION_GROUPS = [
    { number: '0103', name: 'Assistive Products For Personal Care And Safety' },
    { number: '0105', name: 'Personal Mobility Equipment' },
    { number: '0107', name: 'Daily Personal Activities' },
    { number: '0108', name: 'Assistance With Travel/Transport Arrangements' },
    { number: '0109', name: 'Vehicle Modifications' },
    { number: '0111', name: 'Home Modification Design And Construction' },
    { number: '0112', name: 'Assistive Equipment For Recreation' },
    { number: '0115', name: 'Assistance With Daily Life Tasks In A Group Or Shared Living Arrangement' },
    { number: '0120', name: 'Household Tasks' },
    { number: '0123', name: 'Assistive Products For Household Tasks' },
    { number: '0129', name: 'Specialised Driver Training' },
    { number: '0130', name: 'Assistance Animals' },
    { number: '0131', name: 'Specialised Disability Accommodation' },
    { number: '0135', name: 'Customised Prosthetics (includes Orthotics)' },
]

const QUOTE_REQUIRED_GROUP_NUMBERS = new Set(
    NDIS_QUOTE_REQUIRED_REGISTRATION_GROUPS.map((group) => group.number)
)

// ---------------------------------------------------------------------------
// Support items
// ---------------------------------------------------------------------------

/**
 * Tuple layout keeps the table readable:
 *   [number, name, registrationGroupNumber, registrationGroupName,
 *    supportCategoryNumber, supportCategoryName, unit, quoteRequired,
 *    national, remote, veryRemote]
 *
 * Prices are the published maximums, in dollars, exclusive of GST (NDIS supports
 * are GST-free for participants).
 */
const SUPPORT_ITEM_ROWS = [
    // --- Occupational therapy therapy/training supports (Category 15 - Improved Daily Living Skills) ---
    ['15_617_0128_1_3', 'Therapy - Occupational Therapist - Direct Service', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0128_1_3_NF', 'Therapy - Occupational Therapist - Non-Face-to-Face', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0128_1_3_TH', 'Therapy - Occupational Therapist - Telehealth', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0128_1_3_RR', 'Therapy - Occupational Therapist - NDIA Requested Reports', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0128_1_3_CA', 'Therapy - Occupational Therapist - Cancellation', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0128_1_3_PT', 'Therapy - Occupational Therapist - Provider Travel', '0128', 'Therapeutic Supports', '15', 'Improved Daily Living Skills', 'H', false, 97, 135.80, 145.50],
    ['15_617_0118_1_3', 'ECI Professional - Occupational Therapist - Direct Service', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0118_1_3_NF', 'ECI Professional - Occupational Therapist - Non-Face-to-Face', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0118_1_3_TH', 'ECI Professional - Occupational Therapist - Telehealth', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0118_1_3_RR', 'ECI Professional - Occupational Therapist - NDIA Requested Reports', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0118_1_3_CA', 'ECI Professional - Occupational Therapist - Cancellation', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 193.99, 271.59, 290.99],
    ['15_617_0118_1_3_PT', 'ECI Professional - Occupational Therapist - Provider Travel', '0118', 'Early Intervention Supports For Early Childhood', '15', 'Improved Daily Living Skills', 'H', false, 97, 135.80, 145.50],
    // --- Same supports claimed under the other support categories a plan can fund them from ---
    ['01_661_0128_1_3', 'Therapy - Occupational Therapist - Direct Service', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_661_0128_1_3_NF', 'Therapy - Occupational Therapist - Non-Face-to-Face', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_661_0128_1_3_TH', 'Therapy - Occupational Therapist - Telehealth', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_661_0128_1_3_RR', 'Therapy - Occupational Therapist - NDIA Requested Reports', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_661_0128_1_3_CA', 'Therapy - Occupational Therapist - Cancellation', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_661_0128_1_3_PT', 'Therapy - Occupational Therapist - Provider Travel', '0128', 'Therapeutic Supports', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 97, 135.80, 145.50],
    ['01_650_0118_1_3', 'ECI Professional - Occupational Therapist - Direct Service', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_650_0118_1_3_NF', 'ECI Professional - Occupational Therapist - Non-Face-to-Face', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_650_0118_1_3_TH', 'ECI Professional - Occupational Therapist - Telehealth', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_650_0118_1_3_RR', 'ECI Professional - Occupational Therapist - NDIA Requested Reports', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_650_0118_1_3_CA', 'ECI Professional - Occupational Therapist - Cancellation', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 193.99, 271.59, 290.99],
    ['01_650_0118_1_3_PT', 'ECI Professional - Occupational Therapist - Provider Travel', '0118', 'Early Intervention Supports For Early Childhood', '1', 'Assistance with Daily Life (Includes SIL)', 'H', false, 97, 135.80, 145.50],
    ['10_617_0128_5_3', 'Employment Therapy - Occupational Therapist - Direct Service', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 193.99, 271.59, 290.99],
    ['10_617_0128_5_3_NF', 'Employment Therapy - Occupational Therapist - Non-Face-to-Face', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 193.99, 271.59, 290.99],
    ['10_617_0128_5_3_TH', 'Employment Therapy - Occupational Therapist - Telehealth', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 193.99, 271.59, 290.99],
    ['10_617_0128_5_3_RR', 'Employment Therapy - Occupational Therapist - NDIA Requested Reports', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 193.99, 271.59, 290.99],
    ['10_617_0128_5_3_CA', 'Employment Therapy - Occupational Therapist - Cancellation', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 193.99, 271.59, 290.99],
    ['10_617_0128_5_3_PT', 'Employment Therapy - Occupational Therapist - Provider Travel', '0128', 'Therapeutic Supports', '10', 'Finding and Keeping a Job', 'H', false, 97, 135.80, 145.50],

    // --- Supports that are quoted, not price-limited (price shown as 0 = negotiated) ---
    ['05_122306139_0105_1_2', 'Wheelchair - Powered - With Powered Standing Mechanism', '0105', 'Personal Mobility Equipment', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_122306191_0105_1_2', 'Wheelchair - Powered - All Terrain/Heavy Duty Base (WITHOUT Seating)', '0105', 'Personal Mobility Equipment', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_501200308_0105_1_2', 'Repairs and Maintenance - Wheeled Mobility Major', '0105', 'Personal Mobility Equipment', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_061800121_0135_1_2', 'Prosthesis - Upper Limb (Including Powered)', '0135', 'Customised Prosthetics (includes Orthotics)', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_062409121_0135_1_2', 'Prosthesis - Transtibial or Lower', '0135', 'Customised Prosthetics (includes Orthotics)', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_121227121_0109_1_2', 'Vehicle Modification - Chassis/Body work - For Wheelchair Passenger', '0109', 'Vehicle Modifications', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_121805111_0112_1_2', 'Bicycle - Adapted FOR Hand Propulsion', '0112', 'Assistive Equipment For Recreation', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_241303121_0123_1_2', 'Environmental Control (Ecu)/ Safety-Related Products', '0123', 'Assistive Products For Household Tasks', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['05_900101111_0130_1_2', 'Assistance Animal - Dog Guide', '0130', 'Assistance Animals', '5', 'Assistive Technology', 'E', true, 0, 0, 0],
    ['03_040000111_0103_1_1', 'Disability-Related Health Consumables - High Cost', '0103', 'Assistive Products For Personal Care And Safety', '3', 'Consumables', 'E', true, 0, 0, 0],
    ['06_123615401_0111_2_2', 'HM - Ceiling Hoist', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182488377_0111_2_2', 'HM - Bathroom/Toilet - Structural work', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182488378_0111_2_2', 'HM - Kitchen or Laundry - Structural Work', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_183018405_0111_2_2', 'HM - Ramp - Structural', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182490112_0111_2_2', 'HM - Building Works Project Management', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182495121_0111_2_2', 'CHM - Deposit', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182495221_0111_2_2', 'CHM - Progress Stage', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
    ['06_182495321_0111_2_2', 'CHM - Practical Completion', '0111', 'Home Modification Design And Construction', '6', 'Home Modifications', 'E', true, 0, 0, 0],
]

export const NDIS_SUPPORT_ITEMS = SUPPORT_ITEM_ROWS.map((row) => ({
    number: row[0],
    name: row[1],
    registrationGroupNumber: row[2],
    registrationGroupName: row[3],
    supportCategoryNumber: row[4],
    supportCategoryName: row[5],
    unit: row[6],
    quoteRequired: row[7],
    priceLimits: {
        national: row[8],
        remote: row[9],
        very_remote: row[10],
    },
}))

const SUPPORT_ITEM_BY_NUMBER = new Map(
    NDIS_SUPPORT_ITEMS.map((item) => [item.number.toUpperCase(), item])
)

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function normalizeSupportItemNumber(value) {
    return String(value === undefined || value === null ? '' : value).trim().toUpperCase()
}

/** Exact lookup by NDIS support item number. */
export function getNdisSupportItem(itemNumber) {
    const key = normalizeSupportItemNumber(itemNumber)
    return key ? SUPPORT_ITEM_BY_NUMBER.get(key) || null : null
}

/**
 * The UI renders catalogue choices as "<number> — <name>" (a datalist option), but
 * users also paste or type a bare number. Resolve either form back to the item,
 * and return null when the text is a custom (non-catalogue) line.
 */
export function resolveNdisSupportItemSelection(value) {
    const text = String(value === undefined || value === null ? '' : value).trim()
    if (!text) return null

    const direct = getNdisSupportItem(text)
    if (direct) return direct

    const candidate = text.split('—')[0].split(' - ')[0].trim()
    return getNdisSupportItem(candidate) || null
}

/** Catalogue entry formatted the way the picker's datalist expects. */
export function formatNdisSupportItemOption(item) {
    return `${item.number} — ${item.name}`
}

/**
 * Case-insensitive search across item number, item name and registration group.
 * Used by the quote line picker so a therapist can search "OT" or "therapy".
 */
export function searchNdisSupportItems(query, { limit = 40 } = {}) {
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return NDIS_SUPPORT_ITEMS.slice(0, limit)

    const matches = NDIS_SUPPORT_ITEMS.filter((item) => (
        item.number.toLowerCase().includes(needle)
        || item.name.toLowerCase().includes(needle)
        || item.registrationGroupNumber.includes(needle)
        || item.registrationGroupName.toLowerCase().includes(needle)
    ))

    return typeof limit === 'number' ? matches.slice(0, limit) : matches
}

/** The published maximum for one item in one region, or null for quote-based items. */
export function getNdisPriceLimit(itemNumber, region = DEFAULT_NDIS_PRICING_REGION) {
    const item = getNdisSupportItem(itemNumber)
    if (!item) return null

    const key = NDIS_PRICING_REGION_VALUES.includes(region) ? region : DEFAULT_NDIS_PRICING_REGION
    const limit = item.priceLimits[key]
    return typeof limit === 'number' && limit > 0 ? limit : null
}

/** Currency-formatted price limit, or a short label for quote-based supports. */
export function formatNdisPriceLimit(itemNumber, region = DEFAULT_NDIS_PRICING_REGION) {
    const limit = getNdisPriceLimit(itemNumber, region)
    if (limit === null) return 'Quote required'
    return `$${limit.toFixed(2)}`
}

/**
 * True when the support is quoted rather than price-limited. Checks the item's own
 * "Quote" flag, and falls back to the registration group list so a custom line
 * whose number belongs to a quoted group is still flagged.
 */
export function isNdisQuoteRequired(itemNumber) {
    const item = getNdisSupportItem(itemNumber)
    if (item) return item.quoteRequired

    const key = normalizeSupportItemNumber(itemNumber)
    const parts = key.split('_')
    const groupNumber = parts.find((part) => /^\d{4}$/.test(part))
    return Boolean(groupNumber && QUOTE_REQUIRED_GROUP_NUMBERS.has(groupNumber))
}

export function normalizeNdisPricingRegion(value) {
    const key = String(value || '').trim().toLowerCase()
    return NDIS_PRICING_REGION_VALUES.includes(key) ? key : DEFAULT_NDIS_PRICING_REGION
}

/**
 * Everything the quote line form needs for one catalogue selection: identity,
 * unit, whether a quote is required, and the price limit for the chosen region.
 * Returns null when the number is not in the curated catalogue, so the caller can
 * keep the user's free-text line item.
 */
export function buildNdisQuoteLine({ itemNumber, region = DEFAULT_NDIS_PRICING_REGION } = {}) {
    const item = getNdisSupportItem(itemNumber)
    if (!item) return null

    const priceRegion = normalizeNdisPricingRegion(region)
    return {
        ndis_support_item_number: item.number,
        ndis_support_item_name: item.name,
        registration_group_number: item.registrationGroupNumber,
        registration_group_name: item.registrationGroupName,
        support_category_number: item.supportCategoryNumber,
        support_category_name: item.supportCategoryName,
        unit: item.unit,
        quote_required: item.quoteRequired,
        price_limit: getNdisPriceLimit(item.number, priceRegion),
    }
}
