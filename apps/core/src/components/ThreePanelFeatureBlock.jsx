'use client'

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { buildThreePanelDynamicStyles, withAlpha } from '@/lib/domainPageStyles'
import ScrollReveal from '@/components/ScrollReveal'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

const THREE_PANEL_SAMPLE_ITEMS = [
    {
        eyebrow: 'Win More Business',
        heading: 'Build a repeatable sales engine that drives predictable revenue.',
        body: 'Map, fix, and standardize the sales process so your team knows what to do at every stage.',
        body2: 'Analyze feedback from won and lost deals and turn it into actionable insights to refine your sales approach.',
        body3: '',
        body4: ''
    },
    {
        eyebrow: 'Build Systems That Scale',
        heading: 'Streamline operations and automate workflows so your team delivers more with less effort.',
        body: 'Design and implement automations to handle repetitive tasks, reduce errors, and free teams to focus on higher-value work.',
        body2: '',
        body3: '',
        body4: ''
    },
    {
        eyebrow: 'Hire And Retain The Right People',
        heading: 'Attract, onboard, and motivate the right talent to grow your business faster.',
        body: 'Fix broken hiring processes to consistently attract better candidates and fill roles quickly.',
        body2: '',
        body3: '',
        body4: ''
    }
]

export default function ThreePanelFeatureBlock({
    blockId,
    title,
    heading,
    eyebrow,
    introPost,
    items = [],
    blockStyles = {},
    paletteColors = {},
    scrollReveal = false,
    autoAdvancePanels = false,
    autoAdvanceIntervalMs = 5200,
    headingBackgroundColor = 'color1',
    slug = '',
}) {
    const headerRefs = useRef([])
    const cardRefs = useRef([])
    const [headerMinHeight, setHeaderMinHeight] = useState(null)
    const [cardMinHeight, setCardMinHeight] = useState(null)
    const panelItems = Array.isArray(items) && items.length > 0 ? items : THREE_PANEL_SAMPLE_ITEMS
    const introEyebrow = String(title || eyebrow || '').trim()
    const introTitle = String(heading || introPost?.heading || introPost?.title || '').trim()
    const introSummary = String(introPost?.summary || '').trim()
    const hasIntro = Boolean(introTitle)

    const dynamicThreePanelStyles = useMemo(
        () => (paletteColors && Object.keys(paletteColors).length > 0 ? buildThreePanelDynamicStyles(paletteColors, headingBackgroundColor) : null),
        [paletteColors, headingBackgroundColor]
    )

    const introEyebrowClass = blockStyles.threePanelIntroEyebrow || 'text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-sky-600'
    const articleClass = blockStyles.threePanelArticle || 'flex h-full min-h-[28rem] flex-col overflow-hidden rounded-[30px] border border-slate-200/90 bg-white shadow-[0_12px_22px_-18px_rgba(15,23,42,0.2),0_20px_36px_-26px_rgba(37,99,235,0.18)] md:shadow-[0_22px_40px_-22px_rgba(15,23,42,0.3),0_36px_72px_-34px_rgba(37,99,235,0.34)]'
    const headerClass = blockStyles.threePanelHeader || 'grid grid-rows-[1.25rem_1fr] border-b px-6 py-6 sm:grid-rows-[1.35rem_1fr] sm:px-7 sm:py-7'
    const headerEyebrowClass = blockStyles.threePanelHeaderEyebrow || 'flex items-start text-[0.72rem] font-semibold uppercase tracking-[0.18em]'
    const pagerButtonClass = blockStyles.threePanelPagerButton || 'inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold shadow-[0_10px_24px_-14px_rgba(2,132,199,0.85)] transition-all enabled:hover:shadow-[0_14px_26px_-14px_rgba(3,105,161,0.9)] enabled:focus-visible:outline-none enabled:focus-visible:ring-2 disabled:cursor-not-allowed disabled:shadow-none'
    const pagerCountClass = blockStyles.threePanelPagerCount || 'text-sm font-semibold tracking-[0.08em]'
    const bodyBackgroundClass = blockStyles.threePanelBodyBackground || 'bg-white'

    const sectionId = resolveBlockAnchorId({ slug, blockId })
    useLayoutEffect(() => {
        const measureHeaders = () => {
            const heights = headerRefs.current
                .map((node) => node?.offsetHeight || 0)
                .filter((value) => value > 0)

            if (heights.length === 0) {
                setHeaderMinHeight(null)
                return
            }

            const nextHeight = Math.ceil(Math.max(...heights))
            setHeaderMinHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight))
        }

        measureHeaders()

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measureHeaders)
            return () => window.removeEventListener('resize', measureHeaders)
        }

        const observer = new ResizeObserver(() => {
            measureHeaders()
        })

        headerRefs.current.forEach((node) => {
            if (node) observer.observe(node)
        })

        window.addEventListener('resize', measureHeaders)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', measureHeaders)
        }
    }, [panelItems])

    useLayoutEffect(() => {
        const measureCards = () => {
            const heights = cardRefs.current
                .map((node) => node?.offsetHeight || 0)
                .filter((value) => value > 0)

            if (heights.length === 0) {
                setCardMinHeight(null)
                return
            }

            const tallest = Math.ceil(Math.max(...heights))
            setCardMinHeight((currentHeight) => (currentHeight === tallest ? currentHeight : tallest))
        }

        measureCards()

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measureCards)
            return () => window.removeEventListener('resize', measureCards)
        }

        const observer = new ResizeObserver(() => {
            measureCards()
        })

        cardRefs.current.forEach((node) => {
            if (node) observer.observe(node)
        })

        window.addEventListener('resize', measureCards)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', measureCards)
        }
    }, [panelItems, headerMinHeight])

    return (
        <section id={sectionId} className="overflow-visible">
            {hasIntro ? (
                <ScrollReveal enabled={scrollReveal} delay={0}>
                    <div className="mb-6 px-1 py-1 sm:px-2">
                        <div className="space-y-4">
                            {introEyebrow ? (
                                <p className={introEyebrowClass}>
                                    {introEyebrow}
                                </p>
                            ) : null}
                            {introTitle ? (
                                <h3 className="text-2xl font-semibold leading-tight text-slate-950">{introTitle}</h3>
                            ) : null}
                            {introSummary ? (
                                <p className="max-w-4xl text-sm leading-7 text-slate-600 sm:text-[0.95rem] lg:text-base">
                                    {renderParagraphLines(introSummary, `${blockId}-intro-summary`)}
                                </p>
                            ) : null}
                        </div>
                    </div>
                </ScrollReveal>
            ) : null}
            <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen px-4 sm:px-6 lg:px-8 xl:px-10">
                <div className="mx-auto max-w-7xl">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-4 lg:gap-6 2xl:gap-8">
                        {panelItems.map((item, index) => {
                            const sampleItem = THREE_PANEL_SAMPLE_ITEMS[index] || {}
                            const eyebrow = String(item?.eyebrow || '').trim() || sampleItem.eyebrow || ''
                            const heading = String(item?.heading || '').trim() || sampleItem.heading || ''
                            const body = String(item?.body || '').trim() || sampleItem.body || ''
                            const body2 = String(item?.body2 || '').trim() || sampleItem.body2 || ''
                            const body3 = String(item?.body3 || '').trim() || sampleItem.body3 || ''
                            const body4 = String(item?.body4 || '').trim() || sampleItem.body4 || ''

                            return (
                                <ScrollReveal
                                    key={`${blockId}-panel-${index}`}
                                    enabled={scrollReveal}
                                    delay={index * 100}
                                    className="h-full"
                                >
                                    <article
                                        ref={(node) => {
                                            cardRefs.current[index] = node
                                        }}
                                        style={cardMinHeight ? { minHeight: `${cardMinHeight}px` } : undefined}
                                        className={articleClass}
                                    >
                                        <div
                                            ref={(node) => {
                                                headerRefs.current[index] = node
                                            }}
                                            style={{
                                                minHeight: headerMinHeight ? `${headerMinHeight}px` : undefined,
                                                ...(dynamicThreePanelStyles?.headerStyle || {})
                                            }}
                                            className={headerClass}
                                        >
                                            {eyebrow ? (
                                                <p className={headerEyebrowClass} style={dynamicThreePanelStyles ? { color: dynamicThreePanelStyles.headerEyebrowColor } : undefined}>
                                                    {eyebrow}
                                                </p>
                                            ) : <div aria-hidden="true" />}
                                            {heading ? (
                                                <div className="flex items-center">
                                                    <h3 className="max-w-[16ch] pt-4 text-[1.72rem] font-semibold leading-[1.06] sm:max-w-[18ch] sm:text-[1.9rem] lg:max-w-[20ch] xl:max-w-none" style={dynamicThreePanelStyles ? { color: dynamicThreePanelStyles.headerStyle.color } : { color: 'white' }}>
                                                        {renderParagraphLines(heading, `${blockId}-panel-heading-${index}`)}
                                                    </h3>
                                                </div>
                                            ) : null}
                                        </div>
                                        {body || body2 || body3 || body4 ? (
                                            <div className="flex flex-1 px-6 py-6 sm:px-7 sm:py-7" style={dynamicThreePanelStyles?.bodyStyle || { backgroundColor: 'white' }}>
                                                <PanelBodySlider
                                                    blockId={blockId}
                                                    index={index}
                                                    body={body}
                                                    body2={body2}
                                                    body3={body3}
                                                    body4={body4}
                                                    pagerButtonClass={pagerButtonClass}
                                                    pagerCountClass={pagerCountClass}
                                                    dynamicStyles={dynamicThreePanelStyles}
                                                    autoAdvance={Boolean(autoAdvancePanels)}
                                                    autoAdvanceIntervalMs={autoAdvanceIntervalMs}
                                                />
                                            </div>
                                        ) : null}
                                    </article>
                                </ScrollReveal>
                            )
                        })}
                    </div>
                </div>
            </div>
        </section>
    )
}

function PanelBodySlider({ blockId, index, body, body2, body3, body4, pagerButtonClass, pagerCountClass, dynamicStyles, autoAdvance = false, autoAdvanceIntervalMs = 5200 }) {
    const bodyOptions = [body, body2, body3, body4].filter(Boolean)
    const [activeSlide, setActiveSlide] = useState(0)
    const touchStartX = useRef(null)

    useEffect(() => {
        if (!autoAdvance || bodyOptions.length < 2) return

        const safeInterval = Math.max(1800, Number(autoAdvanceIntervalMs) || 5200)
        const intervalId = window.setInterval(() => {
            setActiveSlide((prev) => (prev === bodyOptions.length - 1 ? 0 : prev + 1))
        }, safeInterval)

        return () => window.clearInterval(intervalId)
    }, [autoAdvance, autoAdvanceIntervalMs, bodyOptions.length])

    const handleTouchStart = (event) => {
        touchStartX.current = event.touches?.[0]?.clientX ?? null
    }

    const handleTouchEnd = (event) => {
        if (bodyOptions.length < 2 || touchStartX.current === null) return
        const endX = event.changedTouches?.[0]?.clientX ?? null
        if (endX === null) return

        const deltaX = endX - touchStartX.current
        touchStartX.current = null

        if (Math.abs(deltaX) < 28) return
        if (deltaX < 0) {
            setActiveSlide((prev) => Math.min(prev + 1, bodyOptions.length - 1))
            return
        }
        setActiveSlide((prev) => Math.max(prev - 1, 0))
    }

    const canGoPrev = bodyOptions.length > 1
    const canGoNext = bodyOptions.length > 1

    const goPrev = () => {
        setActiveSlide((prev) => (prev === 0 ? bodyOptions.length - 1 : prev - 1))
    }

    const goNext = () => {
        setActiveSlide((prev) => (prev === bodyOptions.length - 1 ? 0 : prev + 1))
    }

    if (bodyOptions.length === 0) return null

    return (
        <div
            className="flex h-full w-full flex-col"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            <div className="relative w-full flex-1 overflow-hidden">
                <div
                    className="flex h-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ transform: `translateX(-${activeSlide * 100}%)` }}
                >
                    {bodyOptions.map((slideBody, slideIndex) => (
                        <div key={`${blockId}-panel-body-slide-${index}-${slideIndex}`} className="w-full shrink-0">
                            <p className="max-w-[30ch] text-[1rem] font-medium leading-[1.3] text-slate-900 sm:max-w-[34ch] sm:text-[1.08rem] lg:max-w-[38ch] xl:max-w-none">
                                {renderParagraphLines(slideBody, `${blockId}-panel-body-${index}-${slideIndex}`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
            {bodyOptions.length > 1 ? (
                <div className="mt-auto pt-5">
                    <div className="mt-5 flex items-center justify-between gap-3" aria-label={`Panel ${index + 1} body text navigation`}>
                        <button
                            type="button"
                            className={pagerButtonClass}
                            onClick={goPrev}
                            disabled={!canGoPrev}
                            style={dynamicStyles ? {
                                backgroundColor: dynamicStyles.pagerButtonBg,
                                color: dynamicStyles.pagerButtonText,
                                borderColor: dynamicStyles.pagerButtonBg,
                                opacity: canGoPrev ? 1 : 0.5,
                                cursor: canGoPrev ? 'pointer' : 'not-allowed'
                            } : undefined}
                            aria-label="Show previous body text"
                        >
                            <span aria-hidden="true">&#8249;</span>
                        </button>
                        <p className={pagerCountClass} style={dynamicStyles ? { color: dynamicStyles.pagerCountColor } : undefined} aria-live="polite">
                            {activeSlide + 1} / {bodyOptions.length}
                        </p>
                        <button
                            type="button"
                            className={pagerButtonClass}
                            onClick={goNext}
                            disabled={!canGoNext}
                            style={dynamicStyles ? {
                                backgroundColor: dynamicStyles.pagerButtonBg,
                                color: dynamicStyles.pagerButtonText,
                                borderColor: dynamicStyles.pagerButtonBg,
                                opacity: canGoNext ? 1 : 0.5,
                                cursor: canGoNext ? 'pointer' : 'not-allowed'
                            } : undefined}
                            aria-label="Show next body text"
                        >
                            <span aria-hidden="true">&#8250;</span>
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
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