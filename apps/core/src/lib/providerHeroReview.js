// Review bookkeeping for the provider hero-card experiment.
//
// Two human decisions are remembered so a long list can be worked through in batches:
//   * approval    — recorded by the capture pipeline in index.json (an asset exists for the site)
//   * unreachable — recorded here, for sites whose screenshot will never be usable: dead domains,
//                   bot walls, or simply nothing worth showing
//
// Both live beside the approved assets under public/allied-health/provider-heroes/ so the whole
// review workflow is inspectable in one folder. Like the approval flow, this writes into the repo
// and so only works locally.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { providerHeroHostname } from '@/lib/providerHeroPreview'
import { PROVIDER_HERO_MANIFEST_FILE, PROVIDER_HERO_PUBLIC_DIR } from '@/lib/providerHeroScreenshot'

const UNREACHABLE_FILE = path.join(PROVIDER_HERO_PUBLIC_DIR, 'unreachable.json')

async function readJson(file, fallback) {
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch {
        // Missing or unreadable file — treat as empty rather than failing the page.
        return fallback
    }
}

/**
 * Approved captures as `{ [hostname]: assetUrl }`.
 *
 * Keyed by bare hostname rather than provider id so a card can resolve its image from the provider
 * record alone (`providerHeroHostname(website_url)`) — the same key the approval flow writes, with
 * no lookup table or state to keep in sync.
 */
export async function readApprovedHeroes() {
    const manifest = await readJson(PROVIDER_HERO_MANIFEST_FILE, { assets: {} })
    const heroes = {}

    for (const entry of Object.values(manifest.assets || {})) {
        const hostname = providerHeroHostname(entry?.websiteUrl)
        const url = typeof entry?.url === 'string' ? entry.url : ''
        if (hostname && url && !heroes[hostname]) heroes[hostname] = url
    }

    return heroes
}

/** Hostnames that already have an approved asset. */
export async function readApprovedHostnames() {
    return new Set(Object.keys(await readApprovedHeroes()))
}

/** The unreachable list, keyed by hostname. */
export async function readUnreachableSites() {
    const data = await readJson(UNREACHABLE_FILE, { sites: {} })
    return data.sites && typeof data.sites === 'object' ? data.sites : {}
}

async function writeUnreachableSites(sites) {
    await mkdir(PROVIDER_HERO_PUBLIC_DIR, { recursive: true })
    await writeFile(
        UNREACHABLE_FILE,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), sites }, null, 2)}\n`,
    )
}

export async function markProviderUnreachable(websiteUrl, { provider, providerId } = {}) {
    const hostname = providerHeroHostname(websiteUrl)
    if (!hostname) throw new Error('A valid website URL is required')

    const sites = await readUnreachableSites()
    sites[hostname] = {
        host: hostname,
        provider: String(provider || '').trim().slice(0, 200),
        providerId: providerId ?? null,
        websiteUrl: String(websiteUrl || '').trim(),
        markedAt: new Date().toISOString(),
    }

    await writeUnreachableSites(sites)
    return sites[hostname]
}

export async function unmarkProviderUnreachable(websiteUrl) {
    const hostname = providerHeroHostname(websiteUrl)
    if (!hostname) return false

    const sites = await readUnreachableSites()
    if (!(hostname in sites)) return false

    delete sites[hostname]
    await writeUnreachableSites(sites)
    return true
}

/** Only http(s) sites can be captured, so anything else is not reviewable. */
function isReviewable(provider) {
    const raw = String(provider?.website_url || '').trim()
    if (!raw || !providerHeroHostname(raw)) return false

    try {
        const { protocol } = new URL(raw)
        return protocol === 'https:' || protocol === 'http:'
    } catch {
        return false
    }
}

/**
 * The next `count` providers still needing review, in directory order.
 *
 * Anchored on the id of the previous batch's last provider rather than an offset count. That way
 * approving or marking a site unreachable mid-session cannot shift the window and make the walk
 * silently skip or repeat entries — the cursor follows a provider, not a position.
 */
export function selectReviewBatch({
    providers,
    approved = new Set(),
    unreachable = new Set(),
    after = '',
    count = 3,
}) {
    const ordered = (providers || []).filter(isReviewable)

    const isEligible = (provider) => {
        const hostname = providerHeroHostname(provider.website_url)
        return !approved.has(hostname) && !unreachable.has(hostname)
    }

    let from = 0
    if (after) {
        const index = ordered.findIndex((provider) => String(provider.id) === String(after))
        from = index >= 0 ? index + 1 : 0
    }

    const batch = []
    let remaining = 0

    for (let index = from; index < ordered.length; index += 1) {
        if (!isEligible(ordered[index])) continue
        if (batch.length < count) batch.push(ordered[index])
        else remaining += 1
    }

    return {
        batch,
        // Cursor for the next request. Empty when this was the final batch.
        after: batch.length > 0 ? String(batch[batch.length - 1].id) : '',
        remaining,
        hasMore: remaining > 0,
        eligibleTotal: batch.length + remaining,
        total: ordered.length,
    }
}

/**
 * The next `count` providers already marked unreachable, in directory order.
 *
 * The mirror of `selectReviewBatch`, for the view that lets a mark be undone. It walks the same full
 * ordered list and filters as it goes, so un-marking the cursor provider mid-session cannot make the
 * walk restart and repeat entries the reviewer has already looked at.
 *
 * A mark is keyed by hostname while the walk is keyed by provider id, so the two can drift:
 * unre-publishing a provider, or clearing its website, leaves a mark with nothing to attach to.
 * Those come back as `orphans` — they cannot be shown as cards, but they can still be cleared, and
 * without this they would be invisible and permanent.
 */
export function selectUnreachableBatch({
    providers,
    unreachable = new Set(),
    after = '',
    count = 3,
}) {
    const ordered = (providers || []).filter(isReviewable)
    const hostnameOf = (provider) => providerHeroHostname(provider.website_url)

    const markedHosts = new Set()
    for (const provider of ordered) {
        const hostname = hostnameOf(provider)
        if (hostname && unreachable.has(hostname)) markedHosts.add(hostname)
    }

    let from = 0
    if (after) {
        const index = ordered.findIndex((provider) => String(provider.id) === String(after))
        from = index >= 0 ? index + 1 : 0
    }

    const batch = []
    let remaining = 0

    for (let index = from; index < ordered.length; index += 1) {
        const hostname = hostnameOf(ordered[index])
        if (!hostname || !unreachable.has(hostname)) continue
        if (batch.length < count) batch.push(ordered[index])
        else remaining += 1
    }

    return {
        batch,
        after: batch.length > 0 ? String(batch[batch.length - 1].id) : '',
        remaining,
        hasMore: remaining > 0,
        eligibleTotal: batch.length + remaining,
        // Every mark still attached to a provider, which is the number the reviewer cares about.
        marked: markedHosts.size,
        orphans: Array.from(unreachable).filter((host) => !markedHosts.has(host)).sort(),
    }
}
