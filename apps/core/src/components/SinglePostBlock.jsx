'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

const MOBILE_BREAKPOINT_PX = 768

export default function SinglePostBlock({ blockId, slug = '', eyebrow, heading, post }) {
    const title = String(post?.title || '').trim()
    const resolvedHeading = String(heading || post?.heading || post?.title || '').trim()
    const summary = String(post?.summary || '').trim()
    const fullSummaryRef = useRef(null)
    const collapsedSummaryRef = useRef(null)
    const summaryId = useId()
    const [isExpanded, setIsExpanded] = useState(false)
    const [hasMobileOverflow, setHasMobileOverflow] = useState(false)
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    useEffect(() => {
        if (!summary) return

        const measureOverflow = () => {
            if (window.innerWidth >= MOBILE_BREAKPOINT_PX) {
                setHasMobileOverflow(false)
                return
            }

            const fullHeight = fullSummaryRef.current?.scrollHeight || 0
            const collapsedHeight = collapsedSummaryRef.current?.clientHeight || 0
            setHasMobileOverflow(fullHeight - collapsedHeight > 1)
        }

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => {
                measureOverflow()
            })
            : null

        if (fullSummaryRef.current) resizeObserver?.observe(fullSummaryRef.current)
        if (collapsedSummaryRef.current) resizeObserver?.observe(collapsedSummaryRef.current)

        const frameId = window.requestAnimationFrame(() => {
            measureOverflow()
        })
        window.addEventListener('resize', measureOverflow)

        return () => {
            window.cancelAnimationFrame(frameId)
            window.removeEventListener('resize', measureOverflow)
            resizeObserver?.disconnect()
        }
    }, [summary])

    if (!resolvedHeading) return null

    return (
        <section key={blockId} id={sectionId} className="relative box-border w-full min-w-full rounded-[28px] border border-gray-200 bg-white px-6 py-6 shadow-sm sm:px-7 lg:mx-auto lg:max-w-[68rem]">
            <div className="space-y-4">
                {eyebrow ? (
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-sky-600">
                        {eyebrow}
                    </p>
                ) : null}

                <div className="space-y-3">
                    <h3 className="text-2xl font-semibold leading-tight text-gray-900">{resolvedHeading}</h3>
                    {summary ? (
                        <>
                            <div className="relative md:hidden">
                                <div
                                    id={summaryId}
                                    className={`max-w-4xl overflow-hidden text-sm leading-7 text-gray-600 sm:text-[0.95rem] ${isExpanded ? '' : 'max-h-[7rem]'}`}
                                >
                                    <p>{renderParagraphLines(summary, `${blockId}-summary-mobile`)}</p>
                                </div>
                                {hasMobileOverflow && !isExpanded ? (
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white via-white/90 to-transparent" />
                                ) : null}
                            </div>

                            {hasMobileOverflow ? (
                                <div className="md:hidden">
                                    <button
                                        type="button"
                                        onClick={() => setIsExpanded((current) => !current)}
                                        aria-controls={summaryId}
                                        aria-expanded={isExpanded}
                                        className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-900"
                                    >
                                        <span>{isExpanded ? 'Read less' : 'Read more'}</span>
                                        <svg
                                            className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.75"
                                            aria-hidden="true"
                                        >
                                            <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                </div>
                            ) : null}

                            <p className="hidden max-w-4xl text-sm leading-7 text-gray-600 sm:text-[0.95rem] md:block">
                                {renderParagraphLines(summary, `${blockId}-summary-desktop`)}
                            </p>
                        </>
                    ) : null}
                </div>
            </div>

            {summary ? (
                <div aria-hidden="true" className="pointer-events-none absolute left-6 right-6 top-6 -z-10 opacity-0 sm:left-7 sm:right-7">
                    <div ref={fullSummaryRef} className="max-w-4xl text-sm leading-7 text-gray-600 sm:text-[0.95rem]">
                        {renderParagraphLines(summary, `${blockId}-summary-full-measure`)}
                    </div>
                    <div ref={collapsedSummaryRef} className="mt-2 max-h-[7rem] max-w-4xl overflow-hidden text-sm leading-7 text-gray-600 sm:text-[0.95rem]">
                        {renderParagraphLines(summary, `${blockId}-summary-collapsed-measure`)}
                    </div>
                </div>
            ) : null}
        </section>
    )
}

function renderParagraphLines(value, keyPrefix) {
    const lines = String(value || '').replace(/\r\n/g, '\n').split('\n')

    return lines.map((line, index) => {
        const lineKey = `${keyPrefix}-line-${index}`

        if (index === 0) return line
        return [<br key={`${lineKey}-break`} />, line]
    })
}
