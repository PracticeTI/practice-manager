// Per-site additions to the automatic banner rules.
//
// The generic rules in providerHeroBannerHiding.js deliberately only match names that are
// unambiguous (cookie/consent vendors) or bar-shaped elements with banner-ish names. That
// leaves a real gap: an in-flow strip with an arbitrary class name, e.g. doability.com.au's
// `.top-header-message` ("We are closed this Fri - Sat"), which is a full-width 30px bar with
// no dismiss control and no keyword in its name. Geometry alone cannot separate that from the
// site's own header (its sibling `.header-content` is only 48px tall), so it needs an explicit rule.
//
// Add a hostname here when a provider's site shows chrome the automatic rules miss, then
// re-approve that provider. Keys are bare hostnames (no "www.", lowercase).
//
// Selectors are hidden with display:none and are NOT shape-guarded — you are stating intent.

export const PROVIDER_HERO_SITE_HIDE_RULES = {
    'doability.com.au': ['.top-header-message'],
}
