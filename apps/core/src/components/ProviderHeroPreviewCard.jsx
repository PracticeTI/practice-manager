'use client'

import { useEffect, useRef, useState } from 'react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { PROVIDER_HERO_ASPECT_RATIO, PROVIDER_HERO_VIEWPORT } from '@/lib/providerHeroPreview'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2'

function hostnameOf(value) {
    try {
        return new URL(value).hostname.replace(/^www\./, '')
    } catch {
        return String(value || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
}

/**
 * Hero-card experiment: shows a provider's live mobile above-the-fold screenshot
 * next to a link to the full site.
 *
 * The screenshot is produced on demand by /api/allied-health/provider-screenshot and
 * cached, and a cold capture takes a few seconds — hence the skeleton and error states
 * so a slow or uncapturable site degrades into a readable card instead of a broken image.
 *
 * `mobileUserAgent` is the host's saved capture preference, read on the server and passed in so
 * the button reflects it on first paint rather than after a round trip.
 *
 * `unreachable` seeds the mark for the same reason: these cards are shown by the unreachable review
 * view, where the state must be right before anything is clicked.
 */
export default function ProviderHeroPreviewCard({
    provider,
    mobileUserAgent = false,
    unreachable: initiallyUnreachable = false,
}) {
    const [status, setStatus] = useState('loading')
    const [version, setVersion] = useState(0)
    const [review, setReview] = useState('idle')
    const [sessionId, setSessionId] = useState('')
    const [reviewError, setReviewError] = useState('')
    const [approved, setApproved] = useState(false)
    const [approving, setApproving] = useState(false)
    const [approveError, setApproveError] = useState('')
    const [assetUrl, setAssetUrl] = useState('')
    const [unreachable, setUnreachable] = useState(initiallyUnreachable)
    const [markingUnreachable, setMarkingUnreachable] = useState(false)
    const [unreachableError, setUnreachableError] = useState('')
    const [mobileUa, setMobileUa] = useState(mobileUserAgent)
    const [savingMobileUa, setSavingMobileUa] = useState(false)
    const [mobileUaError, setMobileUaError] = useState('')

    const websiteUrl = provider.website_url
    // The viewport height is part of the URL so changing the capture size busts the browser
    // cache as well as the server cache, instead of serving a stale differently-sized image.
    const screenshotSrc = `/api/allied-health/provider-screenshot?url=${encodeURIComponent(websiteUrl)}&h=${PROVIDER_HERO_VIEWPORT.height}&v=${version}`
    const professions = Array.isArray(provider.professions) ? provider.professions.join(', ') : ''
    const hostname = hostnameOf(websiteUrl)

    // Starting a review waits for the cards already capturing to finish before Chrome
    // restarts into headed mode, which can take several seconds — so say so.
    const panelTitle =
        review === 'starting'
            ? 'Opening the review window…'
            : review === 'capturing'
                ? 'Capturing…'
                : review === 'open'
                    ? 'Review window is open'
                    : 'Could not open the review window'

    const panelHint =
        review === 'starting'
            ? 'Waiting for the other cards to finish capturing, then Chrome opens.'
            : review === 'open' && !reviewError
                ? 'Close any cookie banners or popups in the Chrome window, then capture that view.'
                : ''

    // Approval only makes sense once a real image is on screen, and not while a review is open.
    const canApprove = status === 'ready' && review === 'idle'

    const badge = unreachable
        ? { label: 'Unreachable', className: 'border-rose-200 bg-rose-50 text-rose-700' }
        : approved
            ? { label: 'Approved', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
            : mobileUa
                ? { label: 'Mobile UA', className: 'border-sky-200 bg-sky-50 text-sky-700' }
                : { label: 'Mobile', className: 'border-slate-200 bg-slate-50 text-slate-500' }

    const postJson = async (path, payload) => {
        const token = await getOrCreateAdminTokenForLocalhost()
        const response = await fetch(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'The request failed')
        }
        return data
    }

    const callSessionApi = (payload) => postJson('/api/allied-health/provider-capture-session', payload)

    // The mark and a successful approval contradict each other, so approving retires the mark — a
    // site that captured cleanly is not unreachable. Failing to clear it must not fail the approval.
    const clearUnreachableMark = async () => {
        try {
            await postJson('/api/allied-health/provider-unreachable', {
                action: 'unmark',
                url: websiteUrl,
            })
            setUnreachable(false)
        } catch (error) {
            setUnreachableError(`Approved, but the unreachable mark could not be cleared: ${error.message}`)
        }
    }

    const approveScreenshot = async () => {
        setApproving(true)
        setApproveError('')
        try {
            const result = await postJson('/api/allied-health/provider-screenshot', {
                url: websiteUrl,
                provider: provider.provider,
                providerId: provider.id,
            })
            setApproved(true)
            setAssetUrl(String(result?.assetUrl || ''))
            if (unreachable) await clearUnreachableMark()
        } catch (error) {
            setApproveError(error.message)
        } finally {
            setApproving(false)
        }
    }

    // A toggle rather than a one-way action — mis-clicks are easy and the mark persists to
    // unreachable.json, which feeds the batch filter.
    const toggleUnreachable = async () => {
        const next = !unreachable
        setMarkingUnreachable(true)
        setUnreachableError('')
        try {
            await postJson('/api/allied-health/provider-unreachable', {
                action: next ? 'mark' : 'unmark',
                url: websiteUrl,
                provider: provider.provider,
                providerId: provider.id,
            })
            setUnreachable(next)
        } catch (error) {
            setUnreachableError(error.message)
        } finally {
            setMarkingUnreachable(false)
        }
    }

    // Some hosts decide their markup from the user agent alone and serve a desktop layout at 390px,
    // so no amount of viewport emulation fixes them. Flipping this records the host in
    // ua-overrides.json, which changes the capture cache key — hence the forced reload below.
    const toggleMobileUa = async () => {
        const next = !mobileUa
        setSavingMobileUa(true)
        setMobileUaError('')
        try {
            await postJson('/api/allied-health/provider-ua-override', {
                enabled: next,
                url: websiteUrl,
                provider: provider.provider,
                providerId: provider.id,
            })
            setMobileUa(next)
            // The cached image belongs to the other user-agent mode, so refetch rather than
            // leaving a screenshot on screen that no longer matches the setting.
            setStatus('loading')
            setVersion(Date.now())
        } catch (error) {
            setMobileUaError(error.message)
        } finally {
            setSavingMobileUa(false)
        }
    }

    const startReview = async () => {
        setReview('starting')
        setReviewError('')
        try {
            const data = await callSessionApi({ action: 'start', url: websiteUrl })
            setSessionId(data.sessionId)
            setReview('open')
        } catch (error) {
            setReview('idle')
            setReviewError(error.message)
        }
    }

    const commitReview = async () => {
        setReview('capturing')
        setReviewError('')
        try {
            const data = await callSessionApi({
                action: 'capture',
                sessionId,
                provider: provider.provider,
                providerId: provider.id,
            })
            setSessionId('')
            setReview('idle')
            setApproved(true)
            setAssetUrl(String(data?.assetUrl || ''))
            // New cache-busting version so the browser refetches the reviewed capture.
            setStatus('loading')
            setVersion(Date.now())
        } catch (error) {
            setReview('open')
            setReviewError(error.message)
        }
    }

    const cancelReview = async () => {
        setReview('capturing')
        try {
            await callSessionApi({ action: 'cancel', sessionId })
        } catch {
            // The window may already be gone; either way the session is over.
        }
        setSessionId('')
        setReview('idle')
    }

    const imageRef = useRef(null)

    // The card is server-rendered, so the browser starts fetching the screenshot before
    // hydration attaches onLoad. A cached capture can finish first, and the event then
    // never fires — leaving the skeleton up forever. Re-check the element on mount.
    useEffect(() => {
        const node = imageRef.current
        if (!node?.complete) return
        setStatus(node.naturalWidth > 0 ? 'ready' : 'error')
    }, [screenshotSrc])

    return (
        <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] transition hover:-translate-y-1 hover:border-slate-300">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-950" title={provider.provider}>
                        {provider.provider}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500" title={professions}>
                        {professions || 'Allied health provider'}
                    </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.className}`}>
                    {badge.label}
                </span>
            </div>

            <a
                href={websiteUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${provider.provider} website`}
                style={{ aspectRatio: PROVIDER_HERO_ASPECT_RATIO }}
                className={`relative block w-full overflow-hidden bg-slate-100 ${FOCUS_RING}`}
            >
                {status !== 'error' && (
                    // Captures are rendered edge-to-edge at the phone aspect ratio so every
                    // card in the row is the same height.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        key={screenshotSrc}
                        ref={imageRef}
                        src={screenshotSrc}
                        alt={`Mobile above-the-fold preview of ${provider.provider}`}
                        onLoad={() => setStatus('ready')}
                        onError={() => setStatus('error')}
                        className={`h-full w-full object-cover object-top transition-opacity duration-500 ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
                    />
                )}

                {status === 'loading' && (
                    <div aria-hidden="true" className="absolute inset-0 flex flex-col gap-3 bg-slate-100 p-5">
                        <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200" />
                        <div className="h-40 w-full animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
                        <p className="mt-auto text-xs text-slate-500">Capturing mobile view…</p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-center">
                        <p className="text-sm font-semibold text-slate-700">Preview unavailable</p>
                        <p className="text-xs text-slate-500">
                            This site could not be captured. The link still opens the full website.
                        </p>
                    </div>
                )}
            </a>

            {(review === 'starting' || review === 'open' || review === 'capturing' || reviewError) && (
                <div className="border-t border-amber-200 bg-amber-50 px-5 py-4">
                    <p className="text-xs font-semibold text-amber-900">{panelTitle}</p>

                    {panelHint ? <p className="mt-1 text-xs leading-5 text-amber-800">{panelHint}</p> : null}

                    {reviewError ? <p className="mt-1 text-xs leading-5 text-red-700">{reviewError}</p> : null}

                    {review === 'starting' ? null : (
                        <div className="mt-3 flex items-center gap-2">
                            {review === 'idle' ? (
                                <button
                                    type="button"
                                    onClick={startReview}
                                    className={`rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 ${FOCUS_RING}`}
                                >
                                    Try again
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={commitReview}
                                        disabled={review === 'capturing'}
                                        className={`rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 ${FOCUS_RING}`}
                                    >
                                        Capture screenshot
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelReview}
                                        disabled={review === 'capturing'}
                                        className={`rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 ${FOCUS_RING}`}
                                    >
                                        Cancel
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {assetUrl && review === 'idle' ? (
                <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-3">
                    <p className="text-xs font-semibold text-emerald-900">Saved for later use</p>
                    <a
                        href={assetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`mt-0.5 block break-all font-mono text-[11px] leading-5 text-emerald-800 underline underline-offset-2 hover:text-emerald-950 ${FOCUS_RING}`}
                    >
                        {assetUrl}
                    </a>
                </div>
            ) : null}

            <div className="mt-auto border-t border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-500">{hostname}</span>
                    <a
                        href={websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`shrink-0 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 ${FOCUS_RING}`}
                    >
                        Visit website
                    </a>
                </div>

                {approveError ? <p className="mt-2 text-xs leading-5 text-red-700">{approveError}</p> : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canApprove ? (
                        <button
                            type="button"
                            onClick={approveScreenshot}
                            disabled={approving}
                            title="Save this screenshot to public/allied-health/provider-heroes/ without opening a browser window"
                            className={`rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            {approving ? 'Saving…' : approved ? 'Approve again' : 'Approve'}
                        </button>
                    ) : null}

                    {review === 'idle' || review === 'starting' ? (
                        <button
                            type="button"
                            onClick={startReview}
                            disabled={review === 'starting'}
                            title="Open this site in a Chrome window so you can dismiss popups before capturing"
                            className={`rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            {review === 'starting' ? 'Opening…' : 'Review in Chrome'}
                        </button>
                    ) : null}

                    {review === 'idle' ? (
                        <button
                            type="button"
                            onClick={toggleUnreachable}
                            disabled={markingUnreachable}
                            title="Exclude this site from future review batches"
                            className={`rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${FOCUS_RING} ${unreachable
                                ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-700'
                                }`}
                        >
                            {markingUnreachable ? 'Saving…' : unreachable ? 'Undo unreachable' : 'Mark unreachable'}
                        </button>
                    ) : null}
                    {review === 'idle' ? (
                        <button
                            type="button"
                            onClick={toggleMobileUa}
                            disabled={savingMobileUa}
                            title="Capture this site with an Android user agent, for hosts that serve a desktop layout at phone widths"
                            className={`rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${FOCUS_RING} ${mobileUa
                                ? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
                                : 'border-slate-300 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-700'
                                }`}
                        >
                            {savingMobileUa ? 'Saving…' : mobileUa ? 'Undo mobile UA' : 'Mobile UA'}
                        </button>
                    ) : null}
                </div>

                {mobileUaError ? <p className="mt-2 text-xs leading-5 text-red-700">{mobileUaError}</p> : null}

                {mobileUa ? (
                    <p className="mt-2 text-xs leading-5 text-sky-700">
                        Captured with a mobile user agent, because this host serves a desktop layout at phone
                        widths. Review in Chrome uses it too.
                    </p>
                ) : null}

                {unreachableError ? <p className="mt-2 text-xs leading-5 text-red-700">{unreachableError}</p> : null}

                {unreachable ? (
                    <p className="mt-2 text-xs leading-5 text-rose-700">
                        Excluded from future batches. Use Next batch to move on, or Undo to put it back in the queue.
                    </p>
                ) : null}
            </div>
        </article>
    )
}
