import { headers } from 'next/headers'
import { getDomainLabel, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { getDomainSeoSettings, resolveCanonicalOrigin, resolveDomainOgImage, toAbsoluteUrl } from '@/lib/siteMetadata'
import { resolveBrandAppleIconUrl, resolveBrandIconCandidates, resolveBrandIconUrl, resolveBrandMaskIcon } from '@/lib/brandingIcons'
import SocialGraphImageToggle from '../sg/SocialGraphImageToggle'
import FaviconPreview from './FaviconPreview'
import CrawlerFilesPanel from './CrawlerFilesPanel'
import CrawlerPageViewPanel from './CrawlerPageViewPanel'

function boolLabel(value) {
    return value ? 'true' : 'false'
}

function previewRow(label, rawValue, resolvedValue) {
    return (
        <tr key={label} className="border-b border-slate-200 last:border-b-0">
            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 align-top w-52">{label}</th>
            <td className="px-4 py-3 text-sm text-slate-700 align-top">
                <code className="break-all">{String(rawValue || '') || '(empty)'}</code>
            </td>
            <td className="px-4 py-3 text-sm text-slate-900 align-top">
                <code className="break-all">{String(resolvedValue || '') || '(empty)'}</code>
            </td>
        </tr>
    )
}

export async function generateMetadata() {
    const headerStore = await headers()
    const mode = resolveDomainModeFromHeaders(headerStore)
    const label = getDomainLabel(mode)

    return {
        title: `${label} Web Presence`,
        description: `Web presence, social graph, and branding metadata for ${label}`,
        robots: { index: false, follow: false },
    }
}

export default async function WebPresencePage() {
    const headerStore = await headers()
    const mode = resolveDomainModeFromHeaders(headerStore)
    const label = getDomainLabel(mode)
    const seo = await getDomainSeoSettings(mode)
    const canonicalOrigin = await resolveCanonicalOrigin({ mode, headerStore })
    const hostHeader = headerStore.get('x-forwarded-host') || headerStore.get('host') || 'unknown'

    const resolvedOgImage = resolveDomainOgImage({ mode, origin: canonicalOrigin, configuredImageUrl: seo.ogImageUrl })
    const configuredTwitterImage = toAbsoluteUrl(canonicalOrigin, seo.twitterImageUrl)
    const resolvedTwitterImage = configuredTwitterImage || resolvedOgImage

    const title = seo.metaTitle || label
    const description = seo.metaDescription || ''
    const ogTitle = seo.ogTitle || title
    const ogDescription = seo.ogDescription || description
    const twitterTitle = seo.twitterTitle || ogTitle
    const twitterDescription = seo.twitterDescription || ogDescription

    // Favicon metadata is declared in the root layout rather than in domain SEO settings.
    const faviconUrl = resolveBrandIconUrl(mode)
    const appleIconUrl = resolveBrandAppleIconUrl(mode)
    const faviconIcons = resolveBrandIconCandidates(mode)
    const maskIcon = resolveBrandMaskIcon(mode)
    const manifestUrl = `/api/branding/manifest?mode=${mode}`

    const imageOptions = [
        {
            id: 'open-graph',
            label: 'Open Graph',
            imageUrl: resolvedOgImage,
            alt: `${label} Open Graph preview`,
        },
        {
            id: 'twitter',
            label: 'Twitter',
            imageUrl: resolvedTwitterImage,
            alt: `${label} Twitter preview`,
        },
    ]

    return (
        <main className="mx-auto w-full max-w-6xl px-5 py-10 md:px-8">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
                    <h1 className="text-2xl font-semibold text-slate-900">Web Presence</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Preview how this domain presents itself across search, social, and browser surfaces.
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                        Active domain: <span className="font-medium text-slate-900">{label}</span> ({mode})
                    </p>
                    <p className="mt-1 text-xs text-slate-500 break-all">Host header: {hostHeader}</p>
                    <p className="mt-1 text-xs text-slate-500 break-all">Canonical origin: {canonicalOrigin}</p>
                </div>

                <div className="p-6">
                    <h2 className="text-lg font-semibold text-slate-900">Open Graph Preview</h2>
                    <p className="mt-1 text-sm text-slate-600">Switch between Open Graph and Twitter image outputs for this domain.</p>
                    <div className="mt-3">
                        <SocialGraphImageToggle options={imageOptions} />
                    </div>

                    <h2 className="mt-8 text-lg font-semibold text-slate-900">Favicon Preview</h2>
                    <p className="mt-1 text-sm text-slate-600">Favicon served from this domain&apos;s brand icon assets (falling back to the branding icon route) and referenced in the root layout metadata.</p>
                    <div className="mt-3">
                        <FaviconPreview faviconUrl={faviconUrl} icons={faviconIcons} label={label} title={title} />
                    </div>

                    <h2 className="mt-8 text-lg font-semibold text-slate-900">Resolved Metadata</h2>
                    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                        <table className="min-w-full border-collapse bg-white">
                            <thead className="bg-slate-100 text-slate-700 text-sm">
                                <tr>
                                    <th className="px-4 py-3 text-left font-semibold">Field</th>
                                    <th className="px-4 py-3 text-left font-semibold">Configured</th>
                                    <th className="px-4 py-3 text-left font-semibold">Effective</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewRow('siteName', seo.siteName, seo.siteName || label)}
                                {previewRow('metaTitle', seo.metaTitle, title)}
                                {previewRow('metaDescription', seo.metaDescription, description)}
                                {previewRow('ogTitle', seo.ogTitle, ogTitle)}
                                {previewRow('ogDescription', seo.ogDescription, ogDescription)}
                                {previewRow('ogImageUrl', seo.ogImageUrl, resolvedOgImage)}
                                {previewRow('twitterCard', seo.twitterCard, seo.twitterCard)}
                                {previewRow('twitterTitle', seo.twitterTitle, twitterTitle)}
                                {previewRow('twitterDescription', seo.twitterDescription, twitterDescription)}
                                {previewRow('twitterImageUrl', seo.twitterImageUrl, resolvedTwitterImage)}
                                {previewRow('favicon', '', faviconUrl)}
                                {previewRow('appleTouchIcon', '', appleIconUrl)}
                                {previewRow('maskIcon (pinned tabs)', '', maskIcon?.url || '—')}
                                {previewRow('manifest', '', manifestUrl)}
                                {previewRow('robotsIndex', boolLabel(seo.robotsIndex), boolLabel(seo.robotsIndex))}
                                {previewRow('robotsFollow', boolLabel(seo.robotsFollow), boolLabel(seo.robotsFollow))}
                            </tbody>
                        </table>
                    </div>

                    <CrawlerFilesPanel mode={mode} canonicalOrigin={canonicalOrigin} hostHeader={hostHeader} />

                    <CrawlerPageViewPanel canonicalOrigin={canonicalOrigin} hostHeader={hostHeader} />
                </div>
            </div>
        </main>
    )
}