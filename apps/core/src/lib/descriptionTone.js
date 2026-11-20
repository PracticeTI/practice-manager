// Directory descriptions are published as first-party copy: the directory states facts
// about a practice, it does not report what that practice's website said.
//
// The enrichment scripts read each practice's own site, and the model reliably carries that
// provenance into the prose ("The site says ...", "The site also lists ..."), which reads as
// second-hand and leaks the research process into published copy. The model is also prone to
// "X describes itself as Y" for self-descriptions.
//
// rewriteDescriptionTone() restates the same content in an authoritative third-person voice.
// It is pure text work, so the same function serves both the enrichment scripts (cleaning
// model output before it is written) and scripts/fix-provider-descriptions-tone.mjs (repairing
// records written before this rule existed).

// Every shape the model uses to credit its source: "the site", "their website", "this page",
// ... Both straight and typographic apostrophes appear in stored rows, hence the class.
const SITE_NOUN = "(?:the|this|our|their|its|the provider['\u2019]s|the practice['\u2019]s)\\s+"
    + '(?:web\\s?site|website|web\\s?page|webpage|site|page)'

// Verbs that need no restructuring: the clause that follows already has its own subject
// ("it is ...", "they provide ...", "services are delivered ..."), so deleting the
// attribution is enough.
const REPORTING_VERBS = '(?:states?|says?|notes?|reports?|indicates?|confirms?|advises?|claims?|shows?|explains?)'

// Verbs that introduce a bare list, which needs a subject supplied for it.
const LISTING_VERBS = '(?:lists?|offers?|includes?|features?|contains?|carries?|stocks?|sells?|supplies?|mentions?|highlights?|details?|records?|advertises?)'

// Marks a position where an attribution was removed, so the clause left behind can be
// re-capitalised only when it starts a sentence. Stripped before the text is returned.
const SENTINEL = '\uE000'

// Anything the rewriter could not restate. Presence means "do not publish this", never
// "publish it as-is" — see the callers.
const UNRESOLVED_RE = new RegExp(SITE_NOUN + '|according to\\s+' + SITE_NOUN + '|describes? itself', 'i')

const RULES = [
    // "The site says it helps every person belong and thrive and includes therapy services
    // such as ..." — a mission clause plus a list, which needs both halves re-anchored. The
    // list usually restates "therapy services such as", which the new framing already says.
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+)?${REPORTING_VERBS}\\s+(?:that\\s+)?it\\s+helps\\s+(.+?)\\s+and\\s+includes\\s+(.+)`, 'gi'),
        to: (match, purpose, list) => `Its purpose is to help ${purpose}, and its therapy services include ${list.replace(/^therapy services such as\s+/i, '')}`,
    },
    // "The site says they provide X and also states Y are available"
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+)?${REPORTING_VERBS}\\s+(?:that\\s+)?they\\s+provide\\s+(.+?)\\s+and\\s+also\\s+${REPORTING_VERBS}\\s+(.+?)\\s+are\\s+available`, 'gi'),
        to: 'They provide $1, and $2 are also available',
    },
    // "The site also lists allied health as part of a stay at ..." — the list item is the
    // subject of the sentence, so "Services include ..." would not read.
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+)?(?:lists?|mentions?|includes?)\\s+(.+?)\\s+as\\s+part\\s+of\\s+(.+)`, 'gi'),
        to: (match, subject, rest) => `${sentenceCase(subject)} is available as part of ${rest}`,
    },
    // "The site lists X, and mentions Y." — a list followed by a trailing aside.
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+)?lists?\\s+(.+?),\\s+and\\s+mentions?\\s+(.+?)\\.?$`, 'gi'),
        to: 'Services include $1, with $2 available.',
    },
    // Must precede the generic listing rule, which would otherwise produce
    // "Services include services including ...".
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+)?lists?\\s+services\\s+including\\s+`, 'gi'),
        to: 'Services include ',
    },
    // Self-descriptions: "My FootDr is a podiatry provider and describes itself as ..."
    { re: /\bdescribes? itself as\s+/gi, to: 'is ' },
    // "<site> lists/offers/includes X" → "Services [also] include X"
    {
        re: new RegExp(`${SITE_NOUN}\\s+(also\\s+|further\\s+)?${LISTING_VERBS}\\s+(?:that\\s+)?`, 'gi'),
        to: (match, also) => `Services ${also ? 'also ' : ''}include `,
    },
    // "<site> says/states (that) ..." — drop the framing, keep the clause.
    {
        re: new RegExp(`${SITE_NOUN}\\s+(?:also\\s+|further\\s+)?${REPORTING_VERBS}\\s+(?:that\\s+)?`, 'gi'),
        to: SENTINEL,
    },
    // "<site>'s X" → "X"
    { re: new RegExp(`${SITE_NOUN}['\u2019]s\\s+`, 'gi'), to: SENTINEL },
    // "According to the site, ..." / "As listed on their website, ..." — usually introduced
    // mid-sentence, so the boundary is a sentence end rather than the start of the string.
    {
        re: new RegExp(`(^|[.!?]\\s+)(?:according to|as (?:stated|listed|noted|described|shown) (?:on|in))\\s+${SITE_NOUN}\\s*,?\\s*`, 'gi'),
        to: `$1${SENTINEL}`,
    },
]

// Only applied once an attribution has actually been removed, so descriptions that were
// already first-party are never reworded.
const CLEANUP_RULES = [
    // "...delivered via telehealth, and that clients are connected with..." — the "that"
    // only existed to link the removed attribution.
    { re: /,\s*and that\s+/gi, to: ', and ' },
    // Dropping the attribution can leave a verbless noun phrase behind, as in "The page
    // states services in physiotherapy, ... via NDIS". "Services in X" is never a sentence.
    // Runs before re-capitalisation, so the boundary may still be the sentinel.
    { re: new RegExp(`(^|[.!?]\\s+|${SENTINEL})services in\\s+`, 'gi'), to: '$1Services include ' },
    // "The site lists services including X" also matches the generic listing rule above.
    { re: /\bServices include services including\b/gi, to: 'Services include' },
]

function sentenceCase(value) {
    const text = String(value || '').trim()
    return text ? text[0].toUpperCase() + text.slice(1) : text
}

/**
 * Restate a directory description in an authoritative third-person voice.
 *
 * @param {string} value
 * @returns {{ text: string, changed: boolean, unresolved: boolean }} `unresolved` is true when
 *   a source reference survived, i.e. the result must be reviewed rather than published.
 */
export function rewriteDescriptionTone(value) {
    const input = String(value ?? '').trim()
    if (!input) return { text: input, changed: false, unresolved: false }

    let text = input
    for (const rule of RULES) text = text.replace(rule.re, rule.to)

    if (text !== input) {
        for (const rule of CLEANUP_RULES) text = text.replace(rule.re, rule.to)
    }

    // A removed attribution can leave its clause starting a sentence in lower case.
    text = text
        .replace(new RegExp(`(^|[.!?]\\s+)${SENTINEL}([a-z])`, 'g'), (match, prefix, letter) => prefix + letter.toUpperCase())
        .replace(new RegExp(`([,;:]\\s+|\\band\\s+|\\bor\\s+)${SENTINEL}([a-z])`, 'g'), (match, prefix, letter) => prefix + letter)
        .replace(new RegExp(SENTINEL, 'g'), '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;])/g, '$1')
        .trim()

    return { text, changed: text !== input, unresolved: UNRESOLVED_RE.test(text) }
}

/** True when the text still credits a website/page rather than stating the fact. */
export function hasSourceAttribution(value) {
    return UNRESOLVED_RE.test(String(value ?? ''))
}
