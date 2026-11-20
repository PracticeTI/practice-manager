/**
 * Private domain extension layer.
 *
 * The public distribution ships only the unbranded default domain. Private
 * domain experiences are supplied by an optional overlay mounted at `src/private`
 * (a git submodule of the private repo);
 * `scripts/sync-private-overlay.mjs` copies the overlay into place and generates
 * [`privateDomains.js`](./privateDomains.js), which this module reads.
 *
 * When the overlay is absent the generated module is an empty stub, so every
 * helper here returns an empty value and the app behaves as if those domains
 * were never configured. Nothing in the public tree imports private code directly.
 *
 * A private domain descriptor has this shape:
 *
 * @typedef {object} PrivateDomain
 * @property {string} key - Domain mode identifier (also the path prefix).
 * @property {string} label - Human-readable display name.
 * @property {string} description - Shown in the admin domain picker.
 * @property {string[]} [hostnames] - Hosts that resolve to this domain (suffix matched).
 * @property {string[]} [hostLabels] - Hostname labels that hint at this domain (e.g. `dev.brand.example`).
 * @property {string} [canonicalOrigin] - Preferred origin for metadata/sitemap.
 * @property {string} [siteDescription] - Default meta description.
 * @property {string} [ogAsset] - Public path to the default Open Graph image.
 * @property {boolean} [thumbnailBackedOg] - Use the thumbnail-backed OG renderer.
 * @property {boolean} [exactRoute] - Host requests rewrite to `/<key>` instead of keeping the path.
 * @property {boolean} [sharedRoot] - Host is a shared root domain, so paths are never prefixed.
 * @property {boolean} [devOrigin] - Include in `allowedDevOrigins`.
 * @property {object} [brandingIcons] - Brand icon set (see lib/brandingIcons.js).
 * @property {object} [seoPreset] - Domain SEO defaults (see lib/domainSettings.js).
 * @property {string[]} [featureFlags] - Feature flags this domain belongs to.
 * @property {boolean} [defaultDomain] - Select this domain as the default in overlay builds.
 * @property {boolean} [defaultContentDomain] - Select this domain as the fallback content scope.
 * @property {string} [agentCardArtwork] - Public path to the artwork worn by the
 *   domain's general patient-agent cards (see `getPrivateDomainAgentCardArtwork`).
 * @property {string} [fcaBuilderHeroArtwork] - Public path to the background artwork of the
 *   domain's FCA Builder hero card (see `getPrivateDomainFcaBuilderArtwork`); the
 *   `fcaBuilderHero` trait is what makes that card render.
 */

import { PRIVATE_DOMAINS, PRIVATE_PUBLIC_API_ROUTES } from './privateDomains.js'

/** @type {PrivateDomain[]} */
const DOMAINS = Array.isArray(PRIVATE_DOMAINS) ? PRIVATE_DOMAINS.filter(Boolean) : []

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

/** Every private domain descriptor, in declaration order. */
export function getPrivateDomains() {
  return DOMAINS
}

/** Domain mode identifiers contributed by the private overlay. */
export function getPrivateDomainModes() {
  return DOMAINS.map((domain) => normalize(domain.key)).filter(Boolean)
}

/** Default mode selected by the private overlay, if it defines one. */
export function getPrivateDefaultDomainMode() {
  const domain = DOMAINS.find((entry) => entry.defaultDomain)
  return normalize(domain?.key)
}

/** Default content scope selected by the private overlay, if it defines one. */
export function getPrivateDefaultContentDomain() {
  const domain = DOMAINS.find((entry) => entry.defaultContentDomain)
  return normalize(domain?.key)
}

/** True when the private overlay contributed at least one domain. */
export function hasPrivateDomains() {
  return DOMAINS.length > 0
}

/** Hostname → domain mode entries contributed by the overlay. */
export function getPrivateHostnameMap() {
  const map = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (!mode) continue
    for (const host of domain.hostnames || []) {
      const normalizedHost = normalize(host)
      if (normalizedHost) map[normalizedHost] = mode
    }
  }
  return map
}

/** Hostname-label hints contributed by the overlay (e.g. `brand` in `dev.brand.example`). */
export function getPrivateHostLabelHints() {
  const hints = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (!mode) continue
    for (const label of domain.hostLabels || []) {
      const normalizedLabel = normalize(label)
      if (normalizedLabel) hints[normalizedLabel] = mode
    }
  }
  return hints
}

/** Display labels for private domain modes. */
export function getPrivateDomainLabels() {
  const labels = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode) labels[mode] = domain.label || mode
  }
  return labels
}

/** Admin domain picker definitions for private domains. */
export function getPrivateDomainDefinitions() {
  return DOMAINS.map((domain) => ({
    key: normalize(domain.key),
    name: domain.label || normalize(domain.key),
    description: domain.description || '',
  })).filter((entry) => entry.key)
}

/** Domains whose host requests rewrite to `/<key>` (the scoped landing route). */
export function getPrivateExactRouteDomains() {
  return new Set(
    DOMAINS.filter((domain) => domain.exactRoute).map((domain) => normalize(domain.key)).filter(Boolean)
  )
}

/** Domains treated as shared roots, so their paths are never rewritten with a prefix. */
export function getPrivateSharedRootDomains() {
  return new Set(
    DOMAINS.filter((domain) => domain.sharedRoot).map((domain) => normalize(domain.key)).filter(Boolean)
  )
}

/**
 * Domains that redirect their own `/<key>` path to `/`, so the branded host serves the
 * landing page at the root instead of the prefixed route.
 */
export function getPrivateRootRedirectDomains() {
  return new Set(
    DOMAINS.filter((domain) => domain.redirectRootPath).map((domain) => normalize(domain.key)).filter(Boolean)
  )
}

/** Extra `allowedDevOrigins` entries for local development. */
export function getPrivateDevOrigins() {
  return DOMAINS
    .filter((domain) => domain.devOrigin !== false)
    .flatMap((domain) => [normalize(domain.key), ...(domain.hostLabels || []).map(normalize)])
    .filter(Boolean)
}

/** Brand icon sets keyed by domain mode. */
export function getPrivateBrandIconSets() {
  const sets = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.brandingIcons) sets[mode] = domain.brandingIcons
  }
  return sets
}

/** Domain SEO presets keyed by domain mode. */
export function getPrivateSeoPresets() {
  const presets = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.seoPreset) presets[mode] = domain.seoPreset
  }
  return presets
}

/** Canonical origin per private domain mode. */
export function getPrivateCanonicalOrigins() {
  const origins = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.canonicalOrigin) origins[mode] = domain.canonicalOrigin
  }
  return origins
}

/** Default site description per private domain mode. */
export function getPrivateSiteDescriptions() {
  const descriptions = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.siteDescription) descriptions[mode] = domain.siteDescription
  }
  return descriptions
}

/** Public Open Graph asset path per private domain mode. */
export function getPrivateOgAssets() {
  const assets = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.ogAsset) assets[mode] = domain.ogAsset
  }
  return assets
}

/** `system_settings` key holding each private domain's hero thumbnail, keyed by mode. */
export function getPrivateOgThumbnailStateKeys() {
  const keys = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.ogThumbnailStateKey) keys[mode] = domain.ogThumbnailStateKey
  }
  return keys
}

/** Default contact-form recipient per private domain mode. */
export function getPrivateDomainContactRecipients() {
  const recipients = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    const recipient = normalize(domain.contactRecipient)
    if (mode && recipient) recipients[mode] = recipient
  }
  return recipients
}

/** Static sitemap paths per private domain mode. */
export function getPrivateSitemapPaths() {
  const paths = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && Array.isArray(domain.sitemapPaths) && domain.sitemapPaths.length > 0) {
      paths[mode] = domain.sitemapPaths
    }
  }
  return paths
}

/**
 * Domain modes that own a private homepage template scope (their own hero banner and
 * thumbnail settings) instead of falling back to the shared practice scope.
 */
export function getPrivateHomepageScopes() {
  return DOMAINS
    .filter((domain) => domain.homepageScope)
    .map((domain) => normalize(domain.key))
    .filter(Boolean)
}

/** True when the private descriptor for `mode` declares the named trait. */
export function hasPrivateDomainTrait(mode, trait) {
  const normalizedMode = normalize(mode)
  if (!normalizedMode || !trait) return false
  const domain = DOMAINS.find((entry) => normalize(entry.key) === normalizedMode)
  return Array.isArray(domain?.traits) && domain.traits.includes(trait)
}

/**
 * Map of `{ [domainKey]: descriptor[field] }` for every private domain that declares
 * `field`. Generic escape hatch for per-domain data tables (mail identities, booking
 * defaults, artwork, and so on) so core modules never hardcode a customer domain.
 */
export function getPrivateDomainFieldMap(field) {
  const map = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain[field] != null) map[mode] = domain[field]
  }
  return map
}

/**
 * Brand lockup a private domain wants in the admin header in place of the open-source
 * Practice Manager mark, e.g.
 * `{ src: '/brand/brand-mark.png', alt: 'Brand Practice Manager' }`.
 * Returns null for the default domain, which keeps the core mark.
 *
 * @param {string} mode
 * @returns {{ src: string, alt?: string }|null}
 */
export function getPrivateDomainBrandMark(mode) {
  const normalizedMode = normalize(mode)
  if (!normalizedMode) return null
  const domain = DOMAINS.find((entry) => normalize(entry.key) === normalizedMode)
  const brandMark = domain?.brandMark
  if (!brandMark || typeof brandMark.src !== 'string' || !brandMark.src) return null
  return {
    src: brandMark.src,
    alt: String(brandMark.alt || '').trim(),
    width: Number(brandMark.width) || 0,
    height: Number(brandMark.height) || 0,
  }
}

/**
 * Decorative artwork for a private domain's general patient-agent cards (the
 * Transcript Summariser, Equipment Sourcer and Billing cards in the patient modal).
 * Paired with the `generalAgentHelperStyle` trait, which is what switches those cards
 * to the image-backed helper layout. Returns '' when the domain declares none, so the
 * cards keep the plain domain-tinted background.
 *
 * @param {string} mode
 * @returns {string}
 */
export function getPrivateDomainAgentCardArtwork(mode) {
  const normalizedMode = normalize(mode)
  if (!normalizedMode) return ''
  const domain = DOMAINS.find((entry) => normalize(entry.key) === normalizedMode)
  return String(domain?.agentCardArtwork || '').trim()
}

/**
 * Background artwork for a private domain's FCA Builder hero card. Paired with the
 * `fcaBuilderHero` trait, which is what promotes the FCA Builder from a grid card to
 * that hero. Falls back to the domain's FCA report artwork, since both surfaces depict
 * the same report. Returns '' when the domain declares neither.
 *
 * @param {string} mode
 * @returns {string}
 */
export function getPrivateDomainFcaBuilderArtwork(mode) {
  const normalizedMode = normalize(mode)
  if (!normalizedMode) return ''
  const domain = DOMAINS.find((entry) => normalize(entry.key) === normalizedMode)
  return String(domain?.fcaBuilderHeroArtwork || domain?.reportArtwork || '').trim()
}

/** Private domain modes that declare a truthy `field`. */
export function getPrivateDomainModesWithFlag(field) {
  return DOMAINS.filter((domain) => domain[field]).map((domain) => normalize(domain.key)).filter(Boolean)
}

/**
 * Domain that owns a content type, e.g. a private `smart_page` type. Returns null when the
 * type belongs to the shared core.
 */
export function getPrivateContentTypeOwner(type) {
  const normalizedType = normalize(type)
  if (!normalizedType) return null
  for (const domain of DOMAINS) {
    const owned = (domain.ownedContentTypes || []).map(normalize)
    if (owned.includes(normalizedType)) return normalize(domain.key)
  }
  return null
}

/**
 * Default designer palette per private homepage scope, e.g. `{ brand: 'midnight-signal' }`.
 */
export function getPrivateHomepageDefaultPalettes() {
  const palettes = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    if (mode && domain.homepageDefaultPalette) palettes[mode] = domain.homepageDefaultPalette
  }
  return palettes
}

/**
 * Shared outbound mail domain for per-domain sender mailboxes (`<domain>.contact@…`).
 * Declared once by the private overlay; the public build falls back to a neutral,
 * non-deliverable example domain so no customer infrastructure is baked into the source.
 */
export function getPrivateMailDomain() {
  const declared = DOMAINS.map((domain) => domain.mailDomain).find(Boolean)
  return declared ? String(declared).trim() : ''
}

/**
 * Settings endpoint that stores a homepage scope's hero banner or thumbnail.
 *
 * Scopes use a `/<scope>-hero-banner` naming convention. Private homepage scopes
 * ship their own routes; the unbranded public default has a core route.
 *
 * @param {'banner'|'thumbnail'} kind
 * @param {string} scope
 * @returns {string}
 */
export function getHomepageHeroSettingsEndpoint(kind, scope) {
  const suffix = kind === 'thumbnail' ? 'hero-thumbnail' : 'hero-banner'
  const resolvedScope = getPrivateHomepageScopes().includes(normalize(scope)) ? normalize(scope) : 'default'
  return `/api/settings/${resolvedScope}-${suffix}`
}

/**
 * Footer credit for the first private domain that declares one, e.g.
 * `{ name: 'Example', href: 'https://example.com' }`. Returns null in the public build.
 */
export function getPrivateFooterBrand() {
  const domain = DOMAINS.find((entry) => entry.footerBrand?.name && entry.footerBrand?.href)
  return domain ? { name: domain.footerBrand.name, href: domain.footerBrand.href } : null
}

/**
 * `/api` routes the extension layer ships and declares reachable without a session.
 * Merged into the API gate's allowlist, so an overlay route stays public without the
 * core naming it. Each handler still authorizes its own caller.
 *
 * @returns {{ path: string, methods: string[] }[]}
 */
export function getPrivatePublicApiRoutes() {
  const declared = Array.isArray(PRIVATE_PUBLIC_API_ROUTES) ? PRIVATE_PUBLIC_API_ROUTES : []
  return declared.reduce((routes, entry) => {
    const path = String(entry?.path || '').trim()
    const methods = Array.isArray(entry?.methods)
      ? entry.methods.map((method) => String(method || '').trim().toUpperCase()).filter(Boolean)
      : []
    if (path.startsWith('/api/') && methods.length) routes.push({ path, methods })
    return routes
  }, [])
}

/** Domain modes that render Open Graph images from a stored thumbnail. */
export function getPrivateThumbnailBackedOgModes() {
  return new Set(
    DOMAINS.filter((domain) => domain.thumbnailBackedOg).map((domain) => normalize(domain.key)).filter(Boolean)
  )
}

/** Feature-flag buckets that include private domains, keyed by flag name. */
export function getPrivateFeatureFlagDomains() {
  const flags = {}
  for (const domain of DOMAINS) {
    const mode = normalize(domain.key)
    for (const flag of domain.featureFlags || []) {
      const normalizedFlag = String(flag || '').trim()
      if (!normalizedFlag) continue
      flags[normalizedFlag] = [...(flags[normalizedFlag] || []), mode]
    }
  }
  return flags
}
