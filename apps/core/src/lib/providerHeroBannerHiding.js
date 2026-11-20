// Removing site chrome that is not part of the provider's actual page.
//
// Practice sites open with cookie/consent walls, announcement strips, app-install prompts and
// chat launchers. Those are noise in a directory hero card, and they cover the header and hero
// content the card is meant to show. The same goes for the mobile nav toggle — a hamburger and,
// where the site prints one, its "Menu" label: interactive chrome that says nothing in a still.
//
// Hide, don't click. Clicking "Accept" is unreliable — many close controls are a bare ✕ with no
// text, and some trigger navigation — whereas hiding is deterministic and leaves the page's own
// state untouched. Hiding also fixes the case where a consent wall has locked page scroll.
//
// Three layers:
//   1. a stylesheet injected before page scripts run, so known vendors never paint at all
//   2. a sweep after load matching on id/class/aria-label, for the long tail
//   3. explicit per-host selectors from providerHeroSiteHideRules.js
//
// Precision matters more than recall here. Hiding a real header or hero block is much worse than
// leaving a banner in, and that is not hypothetical: on doability.com.au the word "banner" appears
// on `.banner-content-wrapper`, `.banner-title` and `.blue-banner`, all of which are REAL content.
// So the bare word "banner" is only ever acted on when the element is also demonstrably bar-shaped.
//
// Set PROVIDER_HERO_KEEP_CHROME=1 to disable layers 1 and 2 for comparison captures.
// PROVIDER_HERO_KEEP_BANNERS=1 is honoured as the older name for the same switch.

import { createHash } from 'node:crypto'
import { providerHeroHostname } from '@/lib/providerHeroPreview'
import { PROVIDER_HERO_SITE_HIDE_RULES } from '@/lib/providerHeroSiteHideRules'

/**
 * Names that are unambiguous enough to hide on the name alone. Each is either a consent/CMP
 * vendor, consent wording, or a chat-launcher vendor — none of which is real page content.
 */
const STRONG_PATTERNS = [
    // Consent wording
    'cookie-consent', 'cookieconsent', 'cookie-banner', 'cookiebanner', 'cookie-notice',
    'cookie-bar', 'cookiebar', 'cookiewall', 'cookie-wall', 'cookie-law', 'cookie-policy',
    'cookie-settings', 'cookie-disclaimer', 'consent-banner', 'consent-modal', 'consent-popup',
    'consent-bar', 'consent-manager', 'consent-notice',
    // Consent-management vendors
    'onetrust', 'cookiebot', 'cookieyes', 'klaro', 'osano', 'usercentrics', 'iubenda',
    'termly', 'quantcast', 'trustarc', 'borlabs', 'cookiefirst', 'civic-cookie',
    // Chat / support launchers
    'intercom', 'drift-frame', 'crisp-chat', 'tawk', 'tidio',
    // App-install prompts
    'smartbanner', 'smart-banner', 'app-install-banner',
]

/**
 * Names that are banner-ish but also occur on real content, so they are only hidden when the
 * element is also shaped like a bar: full width, thin, and free of media.
 *
 * The bare word "banner" is deliberately NOT here. Verified on live sites: `.banner-title` /
 * `.banner-subtitle` on myfootdr.com.au are the site's own hero copy ("Love your feet"), and
 * `.home-top-banner-wrapper` on doability.com.au is a hero config container. Both are full-width
 * and thin, so the shape guard does not separate them from a real announcement strip. Only
 * qualified names are trusted, and "top-banner" is excluded for the same reason.
 */
const BAR_PATTERNS = [
    'announcement', 'promo-bar', 'promo-banner', 'notice-bar', 'alert-bar', 'alert-banner',
    'banner--sticky', 'sticky-banner', 'header-message', 'topbar-message',
]

/**
 * Names for the mobile nav toggle — the hamburger icon and, where a site prints one, its "Menu"
 * label (usually the same element, which is why one rule covers both).
 *
 * Deliberately narrow: these are control names, not container names, so "mobile-menu" (the
 * drawer itself) is absent. Verified on live sites: every `nav__menu-toggler` on
 * everydayind.com.au is a labelled submenu item ("Early Childhood Support"), and liberator.net.au
 * has an Elementor menu container holding 70 links. Both are excluded by the guards in the sweep.
 */
const TOGGLE_PATTERNS = [
    'menu-toggle', 'menutoggle', 'nav-toggle', 'navtoggle', 'navbar-toggle', 'navbar-toggler',
    'hamburger', 'burger', 'menu-button', 'menu-btn', 'menu-trigger', 'nav-trigger',
    'menu-icon', 'menuicon', 'navicon', 'menu-opener', 'menu-burger', 'toggle-menu', 'toggle-nav',
]

/**
 * Header utility chrome: search, login/account and cart/basket controls.
 *
 * These are only ever hidden inside the site header, never in page content — verified on live
 * sites that every real instance (doability's `#search-content` and `#menu-cart-icon`,
 * everydayind's `.header__search-trigger` and `#search2`) sits in the header, while the near-miss
 * (myfootdr's `.social-media-account-links`) does not. That scoping is what keeps a hero search
 * form — the site's own main content, e.g. myfootdr's postcode lookup — intact.
 */
const UTILITY_TOKENS = [
    // Search
    'search-toggle', 'search-btn', 'search-button', 'search-icon', 'search-trigger', 'search-form',
    'search-bar', 'search-input', 'search-field', 'search-panel', 'search-box', 'search-content',
    'search-mobile', 'search-overlay', 'search-popup', 'search-widget', 'search-container',
    'search-wrapper', 'search-submit', 'search-open', 'site-search', 'header-search', 'nav-search',
    'menu-search', 'js-search',
    // Login / account
    'login-link', 'login-button', 'login-btn', 'login-icon', 'login-toggle', 'nav-login',
    'header-login', 'signin', 'sign-in', 'log-in', 'my-account', 'account-link', 'account-icon',
    'account-button', 'account-toggle', 'user-account',
    // Cart / basket
    'cart-icon', 'cart-link', 'cart-button', 'cart-btn', 'cart-toggle', 'cart-count', 'cart-panel',
    'mini-cart', 'view-cart', 'shopping-cart', 'header-cart', 'nav-cart', 'basket-icon',
    'basket-link', 'bag-icon',
]

/**
 * Floating overlays: accessibility widgets and chat/support launchers.
 *
 * These sit on top of the page and are never content, so removing them is safe — but position and
 * shape cannot be the test. scopeaust.org.au's chat is a `position: static` BrandEmbassy iframe,
 * so a "must be floating" guard would miss it. Vendor names plus a size cap are the test instead.
 */
const FLOATING_PATTERNS = [
    // Accessibility widgets. Monsido PageAssist is the awkward one: its classes are all `mon-`
    // prefixed (too generic to match) and its aria-label is empty, so only the element id
    // (`monsido-pageassist`) and its "PageAssist" text give it away.
    'userway', 'accessibe', 'audioeye', 'equalweb', 'reciteme', 'recite-me', 'siteimprove',
    'user1st', 'silktide', 'acsb', 'monsido', 'pageassist', 'pojo-accessibility',
    'accessibility-menu', 'accessibility-widget', 'accessibility-toolbar', 'accessibility-button',
    'accessibility-toggle', 'accessibility-icon', 'accessibility-link', 'a11y-widget', 'a11y-toolbar',
    // Chat / support launchers
    'brandembassy', 'intercom', 'drift-frame', 'drift-widget', 'crisp-chat', 'tawk', 'tidio',
    'zendesk', 'livechat', 'olark', 'freshchat', 'gorgias', 'kustomer', 'reamaze', 'chatwoot',
    'smartsupp', 'jivosite', 'purechat', 'helpscout', 'chat-widget', 'chat-launcher',
    'live-chat', 'customer-chat', 'hubspot-messages', 'fb-messenger', 'whatsapp',
]

/**
 * Vendor markup hidden via CSS before page scripts run. Kept to consent/CMP and chat vendors so
 * this can safely apply to every document without inspection.
 */
export const BANNER_HIDE_CSS = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#cookieyes', '.cky-consent-container',
    '#klaro', '.klaro', '#osano-cm-window', '#usercentrics-root', '#usercentrics-cmp-ui',
    '.iubenda-cs-container', '#iubenda-cs-banner', '.termly-code-snippet-support',
    '.cc-window', '.cc-banner', '.cc-revoke', '#cookiescript_injected', '#cookiescript_badge',
    '.qc-cmp2-container', '#truste-consent-track', '#consent_blackbar', '.borlabs-cookie',
    '.cookiefirst-root', '#intercom-container', '.intercom-lightweight-app',
    '.drift-frame-controller', '.drift-frame-launcher', '#crisp-chatbox', '.crisp-client',
    '.tawk-min-container', '#tidio-chat', '.smartbanner', '.smart-banner', '#smartbanner',
    '[id*="cookie-consent"]', '[class*="cookie-consent"]', '[id*="cookie-banner"]',
    '[class*="cookie-banner"]', '[id*="cookie-notice"]', '[class*="cookie-notice"]',
    '[id*="cookiebar"]', '[class*="cookiebar"]', '[id*="cookiewall"]', '[class*="cookiewall"]',
    '[id*="consent-banner"]', '[class*="consent-banner"]', '[id*="consent-modal"]',
    '[class*="consent-modal"]', '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
].join(',') + '{display:none !important;visibility:hidden !important}'

/**
 * Script injected before page scripts, so consent vendors never paint.
 *
 * It also watches for late arrivals. Chat and accessibility widgets routinely inject themselves
 * several seconds after load — scopeaust.org.au's BrandEmbassy chat iframe arrives around 3-4s,
 * by which time the geometry-guarded sweep has already run — so a lightweight observer keeps
 * hiding them. This pass matches vendor names only, with no size or position guard, because vendor
 * markup is never page content and the element may not be laid out yet. Page landmarks are still
 * protected.
 */
export const BANNER_HIDE_DOCUMENT_SCRIPT = `(() => {
    const CSS = ${JSON.stringify(BANNER_HIDE_CSS)}
    const VENDOR = ${JSON.stringify(FLOATING_PATTERNS)}
    const A11Y_LABEL = /accessibility/i
    const CHAT_LABEL = /^(open |start )?(live |customer |online )?(chat|support)( with us| now| window| widget| launcher)?$/i
    const SKIP = ['HTML','BODY','MAIN','HEADER','SCRIPT','STYLE']
    let observer = null

    const installStyle = () => {
        if (!document.documentElement || document.getElementById('__ws-hero-hide')) return
        const style = document.createElement('style')
        style.id = '__ws-hero-hide'
        style.textContent = CSS
        document.documentElement.appendChild(style)
    }

    const hideIfMatch = (el) => {
        if (!el || el.nodeType !== 1) return
        if (SKIP.includes(el.tagName)) return
        if (el.hasAttribute('data-ws-hero-hidden')) return
        if (el.closest('[data-ws-hero-hidden]')) return
        if (el.querySelector('h1, main')) return

        const cls = typeof el.className === 'string' ? el.className : ''
        const aria = (el.getAttribute('aria-label') || '').trim()
        const norm = ((el.id || '') + ' ' + cls + ' ' + aria).toLowerCase().replace(/[^a-z0-9]+/g, '-')
        if (!VENDOR.some((p) => norm.includes(p)) && !A11Y_LABEL.test(aria) && !CHAT_LABEL.test(aria)) return

        el.style.setProperty('display', 'none', 'important')
        el.setAttribute('data-ws-hero-hidden', 'floating-late')
    }

    const sweep = (root) => {
        hideIfMatch(root)
        for (const el of root.querySelectorAll('*')) hideIfMatch(el)
    }

    const startObserver = () => {
        // documentElement is null while the injected script first runs, so this is retried from
        // the same DOMContentLoaded hook as the stylesheet. Observing null would throw.
        if (observer || !document.documentElement) return

        try {
            observer = new MutationObserver((records) => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        if (node.nodeType === 1) sweep(node)
                    }
                }
            })
            observer.observe(document.documentElement, { childList: true, subtree: true })
        } catch (error) {
            // Observation is best-effort; the server-side sweep still runs.
            observer = null
        }
    }

    const init = () => {
        installStyle()
        startObserver()
    }

    init()
    document.addEventListener('DOMContentLoaded', init, { once: true })
})()`

/**
 * Fingerprint of the current rules. Folded into the capture cache key so editing these rules
 * automatically re-captures, instead of serving an image hidden by the previous rule set.
 */
export const BANNER_RULES_FINGERPRINT = createHash('sha1')
    .update(JSON.stringify({ STRONG_PATTERNS, BAR_PATTERNS, TOGGLE_PATTERNS, UTILITY_TOKENS, FLOATING_PATTERNS, BANNER_HIDE_CSS, PROVIDER_HERO_SITE_HIDE_RULES }))
    .digest('hex')
    .slice(0, 10)

/**
 * Layers 1 and 2 are skipped so a capture can be compared against the raw page. Layer 3 is
 * explicit intent and always applies. PROVIDER_HERO_KEEP_BANNERS is honoured as the older name
 * for the same switch.
 */
export function isChromeHidingEnabled() {
    const raw = String(process.env.PROVIDER_HERO_KEEP_CHROME || process.env.PROVIDER_HERO_KEEP_BANNERS || '').trim()
    return raw !== '1'
}

export function hostnameOf(value) {
    return providerHeroHostname(value)
}

export function siteHideRulesFor(value) {
    return PROVIDER_HERO_SITE_HIDE_RULES[hostnameOf(value)] || []
}

/**
 * Build the post-load sweep, scoped to one site's hostname.
 *
 * Returns the number of elements hidden, so a capture can be logged/diagnosed.
 */
export function buildBannerSweepExpression(websiteUrl) {
    const strong = STRONG_PATTERNS
    const bar = BAR_PATTERNS
    const toggle = TOGGLE_PATTERNS
    const utility = UTILITY_TOKENS
    const floating = FLOATING_PATTERNS
    const siteSelectors = siteHideRulesFor(websiteUrl)

    return `(() => {
        const STRONG = ${JSON.stringify(strong)}
        const BAR = ${JSON.stringify(bar)}
        const TOGGLE = ${JSON.stringify(toggle)}
        const UTILITY = ${JSON.stringify(utility)}
        const FLOATING = ${JSON.stringify(floating)}
        const SITE = ${JSON.stringify(siteSelectors)}
        // NAV is NOT skipped: some sites mark the toggle itself up as a <nav>
        // (myfootdr.com.au uses <nav id="mobile-nav-toggle">for the "Menu" label), so NAV is
        // excluded per-rule rather than globally.
        const SKIP_TAGS = ['HTML','BODY','MAIN','HEADER','FOOTER','SCRIPT','STYLE']
        // Accepts "Menu", "Open menu", "Open website menu", "Menu Toggle", "Close menu".
        const MENU_LABEL = /^(open |close |toggle |show |hide )*(mobile |main |website |site )*(menu|nav|navigation)( toggle| button| trigger)?$/i
        // Utility labels. Written without escape sequences so they survive the template literal.
        const SEARCH_LABEL = /^(open |toggle |show )?(site |header |menu |the )?search( panel| form| field| input| bar| icon| button| trigger| toggle)?$/i
        const LOGIN_LABEL = /^(log in|log out|sign in|sign up|my account|account|login|logout|register)( link| button| icon)?$/i
        const CART_LABEL = /^(my |view |shopping |mini )?(cart|basket|bag)( icon| button| link| toggle)?( \([0-9]+\))?$/i        // Accessibility widgets label themselves "Accessibility Menu" or similar. Only ever matched
        // against aria-label, not body text — otherwise prose mentioning accessibility would match.
        const A11Y_LABEL = /accessibility/i
        // "Chat with us", "Live chat", "Customer Chat", "Open support".
        const CHAT_LABEL = /^(open |start )?(live |customer |online )?(chat|support)( with us| now| window| widget| launcher)?$/i        // Header chrome only. Page content is off limits — a hero search form is the site's own
        // main content, not chrome.
        const HEADER_SCOPE = 'header, [role="banner"], nav, [class*="header"], [id*="header"], [class*="navbar"], [id*="navbar"], [class*="topbar"], [id*="topbar"], [class*="top-bar"]'
        const vw = innerWidth
        const vh = innerHeight
        let hidden = 0

        const hide = (el, why) => {
            el.style.setProperty('display', 'none', 'important')
            el.setAttribute('data-ws-hero-hidden', why)
            hidden++
        }

        // Never hide something that holds the page's own landmark content.
        const holdsContent = (el) => Boolean(el.querySelector('h1, main'))

        if (SITE.length > 0) {
            for (const selector of SITE) {
                for (const el of document.querySelectorAll(selector)) {
                    if (SKIP_TAGS.includes(el.tagName)) continue
                    hide(el, 'site-rule')
                }
            }
        }

        for (const el of document.querySelectorAll('body *')) {
            if (SKIP_TAGS.includes(el.tagName)) continue
            if (el.hasAttribute('data-ws-hero-hidden')) continue

            const cls = typeof el.className === 'string' ? el.className : ''
            const sig = ((el.id || '') + ' ' + cls + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase()
            // Separator-insensitive form, so BEM style names still match the token lists
            // ("header__search" -> "header-search", "nav__menu-toggler" -> "nav-menu-toggler").
            const norm = sig.replace(/[^a-z0-9]+/g, '-')
            // Strip symbols (☰, ×) so "☰ Menu" normalises to "menu". A toggle label is often a bare
            // <a>☰ Menu</a> with no id, class or aria-label, so label is computed before the bail —
            // otherwise those are skipped without ever reaching the toggle rule.
            const label = (el.innerText || '').replace(/[^a-z\\s]/gi, ' ').replace(/\\s+/g, ' ').trim().toLowerCase()
            if (!sig.trim() && !label) continue

            const rect = el.getBoundingClientRect()
            // Only chrome inside the captured viewport matters. This keeps a closed nav drawer
            // parked off-screen (doability.com.au) from being gutted for no visible gain.
            if (rect.width <= 0 || rect.height <= 0) continue
            if (rect.right <= 0 || rect.left >= vw || rect.bottom <= 0 || rect.top >= vh) continue

            if (STRONG.some((p) => sig.includes(p))) {
                if (el.tagName === 'NAV') continue
                if (holdsContent(el)) continue
                if (rect.height > vh * 0.7) continue
                hide(el, 'consent')
                continue
            }

            if (BAR.some((p) => sig.includes(p))) {
                if (el.tagName === 'NAV') continue
                if (holdsContent(el)) continue
                // Bar shape: full width, thin, and carrying no media — the signal that separates an
                // announcement strip from a hero or product banner.
                if (rect.width < vw * 0.9) continue
                if (rect.height > vh * 0.25) continue
                if (el.querySelector('img, picture, video')) continue
                hide(el, 'bar')
                continue
            }

            // Header utility chrome: search / login / cart. Scoped to the header so page content is
            // never touched — a hero search form is the site's own content, not chrome.
            const aria = (el.getAttribute('aria-label') || '').trim()
            const utilityMatch =
                UTILITY.some((t) => norm.includes(t)) ||
                SEARCH_LABEL.test(aria) || SEARCH_LABEL.test(label) ||
                LOGIN_LABEL.test(aria) || LOGIN_LABEL.test(label) ||
                CART_LABEL.test(aria) || CART_LABEL.test(label)
            if (
                utilityMatch &&
                !el.closest('main') &&
                el.closest(HEADER_SCOPE) &&
                !holdsContent(el) &&
                rect.height <= vh * 0.25
            ) {
                hide(el, 'utility')
                continue
            }

            // Floating overlays: accessibility widgets and chat launchers. Deliberately no
            // position requirement — scopeaust.org.au's chat iframe is position:static — so the
            // test is name/label plus a size cap that excludes any real content block.
            const floatingMatch =
                FLOATING.some((p) => norm.includes(p)) ||
                A11Y_LABEL.test(aria) ||
                CHAT_LABEL.test(aria) || CHAT_LABEL.test(label)
            if (
                floatingMatch &&
                !holdsContent(el) &&
                rect.width <= vw * 0.6 &&
                rect.height <= vh * 0.3
            ) {
                hide(el, 'floating')
                continue
            }

            const toggleName = TOGGLE.some((p) => norm.includes(p))
            const toggleAria = MENU_LABEL.test(aria)
            const toggleLabel = MENU_LABEL.test(label)
            if (!toggleName && !toggleAria && !toggleLabel) continue

            if (holdsContent(el)) continue
            // A real toggle carries at most one label link; a nav drawer carries many links and
            // usually a <nav>/<ul>. This is what keeps liberator.net.au's 70-link Elementor menu
            // container — and everydayind.com.au's labelled .nav__menu-toggler items — intact.
            if (el.querySelectorAll('a').length > 1) continue
            if (el.querySelector('nav, ul')) continue
            if (rect.height > vh * 0.25) continue
            // If it does show text, that text must read as a menu control.
            if (label && !toggleLabel) continue
            hide(el, 'nav-toggle')
        }

        // A hidden consent wall usually leaves the page scroll-locked behind it.
        if (hidden > 0) {
            if (document.documentElement) document.documentElement.style.setProperty('overflow', 'auto', 'important')
            if (document.body) document.body.style.setProperty('overflow', 'auto', 'important')
        }

        return hidden
    })()`
}
