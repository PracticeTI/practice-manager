'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import ProviderHeroPreviewCard from '@/components/ProviderHeroPreviewCard'
import ProviderUnreachableOrphans from '@/components/ProviderUnreachableOrphans'
import { resolveAdminAuthToken } from '@/lib/clientAdminAuth'
import { PROVIDER_HERO_VIEWPORT } from '@/lib/providerHeroPreview'

// The tool answers on both /settings/hero-review and its canonical /admin/settings/hero-review (see
// `src/app/settings/hero-review/page.jsx`), so links are built from the path actually in use.
// Hard-coding one of them would hop the reviewer between the two URLs on every "Next batch".
const FALLBACK_BASE_PATH = '/settings/hero-review'

function useReviewBasePath() {
    const pathname = usePathname()
    const trimmed = typeof pathname === 'string' ? pathname.replace(/\/+$/, '') : ''
    return trimmed || FALLBACK_BASE_PATH
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2'
const SECONDARY_BUTTON = `admin-btn px-3 py-2 text-xs font-medium ${FOCUS_RING}`
const PRIMARY_BUTTON = `rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-700 ${FOCUS_RING}`

/**
 * Superadmin provider hero review (see `src/app/admin/settings/hero-review/page.jsx`).
 *
 * This is admin tooling rather than a page of the operator's directory, so the view draws only the
 * review content and uses the admin card and button styles — the banner and header come from the
 * page. Links are built from the current pathname because the page answers on two URLs.
 *
 * The batch comes from the superadmin-only `/api/allied-health/provider-review-batch` rather than
 * from a server component, so nothing internal is serialized into the page before the gate runs —
 * an unauthenticated fetch of this URL gets the shell and no provider data.
 *
 * `key` on the batch resets its state when the cursor or view changes, so a navigation back to a
 * loading state needs no setState inside an effect.
 */
export default function HeroReviewView() {
    const searchParams = useSearchParams()
    // Cursor: the id of the previous batch's last provider.
    const after = searchParams.get('after') || ''
    // The queue and the unreachable list are the same batch walk over different filters, so they
    // share this page and its cursor rather than duplicating the card plumbing.
    const showUnreachable = searchParams.get('show') === 'unreachable'
    const basePath = useReviewBasePath()

    return (
        <div className="space-y-6">
            <header className="admin-card p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {showUnreachable ? 'Unreachable sites' : 'Provider card experiment'}
                </p>
                <h1 className="mt-2 text-2xl font-bold text-gray-900">
                    {showUnreachable
                        ? 'Sites you marked as unreachable.'
                        : 'A mobile-first view of three provider websites.'}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                    {showUnreachable
                        ? 'These were taken out of the review queue. Undo the mark on any that should go back in — a site that has come back up, or one marked too hastily.'
                        : 'Each card shows the provider\u2019s live mobile above-the-fold view next to a link to the full website. Work through them a batch at a time; approved and unreachable sites drop out of later batches.'}
                </p>
            </header>

            <HeroReviewBatch
                key={`${showUnreachable ? 'unreachable' : 'queue'}|${after}`}
                after={after}
                basePath={basePath}
                showUnreachable={showUnreachable}
            />

            <section className="admin-card p-6" aria-label="About this tool">
                <h2 className="text-sm font-semibold text-gray-900">About this tool</h2>
                <div className="mt-3 space-y-3">
                    <p className="text-xs leading-6 text-slate-500">
                        Captures are rendered locally at a {PROVIDER_HERO_VIEWPORT.width}&times;{PROVIDER_HERO_VIEWPORT.height}{' '}
                        mobile viewport and cached for seven days. A first-time capture takes a few seconds, so cards show a
                        loading state until the screenshot is ready. Use{' '}
                        <span className="font-semibold text-slate-700">Review in Chrome</span> to open a site in a Chrome window
                        and close any cookie banners or popups yourself, then capture that exact view. The browser profile is
                        shared and persistent, so a banner you dismiss stays dismissed for later automatic captures too.
                        Review needs a local Chrome, so it is unavailable in production.
                    </p>

                    <p className="text-xs leading-6 text-slate-500">
                        If the automatic capture already looks right, <span className="font-semibold text-slate-700">Approve</span>{' '}
                        saves the image that is on screen, with no browser window to tidy up. Either way the approved image is
                        written to{' '}
                        <span className="font-mono text-[11px] text-slate-700">public/allied-health/provider-heroes/</span> as{' '}
                        <span className="font-mono text-[11px] text-slate-700">&lt;hostname&gt;.png</span>, with an{' '}
                        <span className="font-mono text-[11px] text-slate-700">index.json</span> manifest recording the provider
                        it belongs to. Those files are committed assets, so an approved image can be reused by the directory
                        without re-capturing.
                    </p>

                    <p className="text-xs leading-6 text-slate-500">
                        A few hosts ignore the viewport and pick their markup from the user agent alone, so they
                        serve a desktop layout at phone widths no matter how the viewport is emulated — any Wix
                        site does. <span className="font-semibold text-slate-700">Mobile UA</span> captures that one
                        host with an Android user agent instead. It is per-host on purpose: a user agent that
                        disagrees with the rest of the browser fingerprint is what draws 403s from WAFs that
                        cross-check it, so it stays off everywhere it is not needed. The choice is recorded in{' '}
                        <span className="font-mono text-[11px] text-slate-700">ua-overrides.json</span>, is part of
                        the capture cache key, and the button toggles, so switching it back re-captures the site the
                        way it was before. <span className="font-semibold text-slate-700">Review in Chrome</span>{' '}
                        opens the same user agent the automatic capture would use.
                    </p>

                    <p className="text-xs leading-6 text-slate-500">
                        Batches walk the directory in name order and skip anything already approved or marked unreachable, so
                        you can work through the list without repeats. The cursor is the last provider of the batch, which
                        means approving something mid-session cannot shift the window and make the walk skip an entry. Sites
                        marked unreachable are recorded in{' '}
                        <span className="font-mono text-[11px] text-slate-700">unreachable.json</span> next to the assets, and
                        the button toggles, so a mis-click is easy to undo.
                    </p>

                    <p className="text-xs leading-6 text-slate-500">
                        Marks also drop a site out of every later batch, so{' '}
                        <span className="font-semibold text-slate-700">Review marked unreachable</span> shows them the same
                        way, three at a time, with the same cursor and the same cards &mdash; {' '}
                        <span className="font-semibold text-slate-700">Undo unreachable</span> puts a site straight back in
                        the queue. {' '}
                        <span className="font-semibold text-slate-700">Approve</span> also retires the mark on its own,
                        since a site that captured cleanly is not unreachable, and that keeps a provider from being filed as
                        both. A mark whose provider has since been unpublished or had its website cleared has no card to
                        show, so those are listed separately at the foot of that view and can be cleared there.
                    </p>

                    <p className="text-xs leading-6 text-slate-500">
                        Cookie walls, announcement strips, chat launchers, accessibility widgets, the mobile nav toggle and
                        header search / login / cart controls are hidden before the screenshot is taken, so they do not mask
                        the header and hero content. A hamburger and its &ldquo;Menu&rdquo; label are usually the same element,
                        so one rule covers both. Utility controls are only removed inside the site header, because a hero
                        search form is the site&rsquo;s own content rather than chrome. Consent vendors are matched by name,
                        and banner-named elements are only hidden when they are also bar-shaped, because
                        &ldquo;banner&rdquo; is real content on some sites. Chat and accessibility widgets often load several
                        seconds after the page, so a watcher keeps hiding them as they appear. A site whose strip slips
                        through can be added by hand in{' '}
                        <span className="font-mono text-[11px] text-slate-700">src/lib/providerHeroSiteHideRules.js</span>,
                        after which that provider just needs re-approving. Set{' '}
                        <span className="font-mono text-[11px] text-slate-700">PROVIDER_HERO_KEEP_CHROME=1</span> to capture
                        the raw page instead.
                    </p>
                </div>
            </section>
        </div>
    )
}

function HeroReviewBatch({ after, basePath, showUnreachable }) {
    const [state, setState] = useState({ status: 'loading', data: null, error: '' })
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        let cancelled = false

        async function load() {
            // Awaited first so nothing is set synchronously from the effect body.
            const token = await resolveAdminAuthToken()
            if (cancelled) return

            const query = new URLSearchParams()
            if (after) query.set('after', after)
            if (showUnreachable) query.set('show', 'unreachable')

            try {
                const response = await fetch(`/api/allied-health/provider-review-batch?${query}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: 'no-store',
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok || !data?.success) {
                    throw new Error(data?.error || `Could not load the batch (HTTP ${response.status})`)
                }
                if (!cancelled) setState({ status: 'ready', data, error: '' })
            } catch (caught) {
                if (!cancelled) setState({ status: 'error', data: null, error: caught.message })
            }
        }

        load()
        return () => { cancelled = true }
    }, [after, showUnreachable, attempt])

    if (state.status === 'loading') {
        return (
            <div role="status" className="admin-card px-5 py-4 text-xs text-gray-500">
                Loading the next batch&hellip;
            </div>
        )
    }

    if (state.status === 'error') {
        return (
            <div role="alert" className="admin-card border-red-200 bg-red-50 px-5 py-4">
                <p className="text-xs font-semibold text-red-900">The review batch could not be loaded.</p>
                <p className="mt-1 text-xs leading-5 text-red-700">{state.error}</p>
                <button type="button" onClick={() => setAttempt((count) => count + 1)} className={`mt-3 ${SECONDARY_BUTTON}`}>
                    Try again
                </button>
            </div>
        )
    }

    const { data } = state
    const unreachablePath = `${basePath}?show=unreachable`
    const nextHref = showUnreachable
        ? `${unreachablePath}&after=${data.after}`
        : `${basePath}?after=${data.after}`

    return (
        <>
            <div className="admin-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                {showUnreachable ? (
                    <p className="text-xs leading-5 text-slate-600">
                        <span className="font-semibold text-rose-700">{data.marked}</span>
                        {' '}site{data.marked === 1 ? '' : 's'} marked unreachable
                        {data.remaining > 0 ? ` · ${data.remaining} after this batch` : null}
                    </p>
                ) : (
                    <p className="text-xs leading-5 text-slate-600">
                        <span className="font-semibold text-slate-900">{data.eligibleTotal}</span>
                        {' '}of {data.total} providers still to review
                        {data.markCount > 0 ? (
                            <>
                                {' · '}
                                <Link
                                    href={unreachablePath}
                                    className={`font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 ${FOCUS_RING}`}
                                >
                                    Review {data.markCount} marked unreachable
                                </Link>
                            </>
                        ) : null}
                        {data.remaining > 0 ? ` · ${data.remaining} after this batch` : null}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    {after ? (
                        <Link href={showUnreachable ? unreachablePath : basePath} className={SECONDARY_BUTTON}>
                            Start over
                        </Link>
                    ) : null}

                    {showUnreachable ? (
                        <Link href={basePath} className={SECONDARY_BUTTON}>
                            Back to review queue
                        </Link>
                    ) : null}

                    {data.hasMore ? (
                        <Link href={nextHref} className={PRIMARY_BUTTON}>
                            Next batch
                        </Link>
                    ) : (
                        <span className="rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-400">
                            Next batch
                        </span>
                    )}
                </div>
            </div>

            {data.cards.length > 0 ? (
                <section
                    aria-label={showUnreachable ? 'Unreachable provider websites' : 'Provider website previews for this batch'}
                    className="grid items-start gap-6 lg:grid-cols-3"
                >
                    {data.cards.map(({ provider, unreachable, mobileUserAgent }) => (
                        <ProviderHeroPreviewCard
                            key={provider.id}
                            provider={provider}
                            unreachable={unreachable}
                            mobileUserAgent={mobileUserAgent}
                        />
                    ))}
                </section>
            ) : (
                <p className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-sm text-gray-600">
                    {showUnreachable
                        ? 'Nothing is marked unreachable.'
                        : data.total === 0
                            ? 'Add published providers with website addresses to populate this experiment.'
                            : 'Every provider with a website has been approved or marked unreachable.'}
                    {!showUnreachable && data.markCount > 0 ? (
                        <>
                            {' '}
                            <Link
                                href={unreachablePath}
                                className={`font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 ${FOCUS_RING}`}
                            >
                                Review the {data.markCount} marked unreachable
                            </Link>
                            {' '}to give any of them another go.
                        </>
                    ) : null}
                </p>
            )}

            {showUnreachable ? <ProviderUnreachableOrphans entries={data.orphans} /> : null}
        </>
    )
}
