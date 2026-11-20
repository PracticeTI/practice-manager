import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import ScrollReveal from '@/components/ScrollReveal'
import FaqBlock from '@/components/FaqBlock'
import SinglePostBlock from '@/components/SinglePostBlock'
import ThreePanelFeatureBlock from '@/components/ThreePanelFeatureBlock'
import HeroBlock from '@/components/HeroBlock'
import TestimonialBlock from '@/components/TestimonialBlock'
import StatsBlock from '@/components/StatsBlock'
import LogoMarqueeBlock from '@/components/LogoMarqueeBlock'
import FeatureComparisonBlock from '@/components/FeatureComparisonBlock'
import StepsBlock from '@/components/StepsBlock'
import PricingBlock from '@/components/PricingBlock'
import BioProfileBlock from '@/components/BioProfileBlock'
import IconCardsBlock from '@/components/IconCardsBlock'
import ProofPointsBlock from '@/components/ProofPointsBlock'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'
import { prefixPathWithDomainMode } from '@/lib/domainMode'

const CARD_BODY_COLLAPSED_LINES = 3
const CARD_BODY_LINE_HEIGHT_PX = 1.625 * 16
const CARD_BODY_COLLAPSED_HEIGHT_PX = CARD_BODY_COLLAPSED_LINES * CARD_BODY_LINE_HEIGHT_PX

export default function PageContentArticle({
    pageTitle,
    summaryParagraphs = [],
    bodyParagraphs = [],
    blocks = [],
    pageStyles,
    renderBlock,
    paletteColors = {},
    scrollReveal = false,
    pathPrefix = ''
}) {
    return (
        <article className={pageStyles.detail.article}>
            {pageTitle ? <h1 className={pageStyles.detail.title}>{pageTitle}</h1> : null}

            {summaryParagraphs.length > 0 && (
                <div className={pageStyles.detail.summary}>
                    {summaryParagraphs.map((paragraph, index) => (
                        <p key={`summary-${index}`} className={pageStyles.detail.paragraph}>
                            {renderParagraphLines(paragraph, `summary-${index}`)}
                        </p>
                    ))}
                </div>
            )}

            {bodyParagraphs.length > 0 && (
                <div className={pageStyles.detail.body}>
                    {bodyParagraphs.map((paragraph, index) => (
                        <p key={`body-${index}`} className={pageStyles.detail.paragraph}>
                            {renderParagraphLines(paragraph, `body-${index}`)}
                        </p>
                    ))}
                </div>
            )}

            {blocks.length > 0 && (
                <div className={pageStyles.detail.body}>
                    {blocks.map((block, index) => {
                        const rendered = renderPageBlock(block, pageStyles, renderBlock, paletteColors, scrollReveal, pathPrefix)
                        if (!rendered) return null
                        // three_panel blocks manage ScrollReveal internally for each panel
                        if (block.type === 'three_panel') return rendered
                        return (
                            <ScrollReveal key={block.id} enabled={scrollReveal} delay={index * 80}>
                                {rendered}
                            </ScrollReveal>
                        )
                    })}
                </div>
            )}
        </article>
    )
}

function ExpandableCardsBody({ body, bodyId }) {
    const bodyRef = useRef(null)
    const [isExpanded, setIsExpanded] = useState(false)
    const [hasOverflow, setHasOverflow] = useState(false)

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setIsExpanded(false)
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [body])

    useEffect(() => {
        if (!body) return

        const measureOverflow = () => {
            const element = bodyRef.current
            if (!element) return
            setHasOverflow(element.scrollHeight > CARD_BODY_COLLAPSED_HEIGHT_PX + 1)
        }

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => {
                measureOverflow()
            })
            : null

        if (bodyRef.current) resizeObserver?.observe(bodyRef.current)

        const frameId = window.requestAnimationFrame(() => {
            measureOverflow()
        })
        window.addEventListener('resize', measureOverflow)

        return () => {
            window.cancelAnimationFrame(frameId)
            window.removeEventListener('resize', measureOverflow)
            resizeObserver?.disconnect()
        }
    }, [body])

    return (
        <>
            <div className="relative mt-2 flex-1">
                <div
                    id={bodyId}
                    ref={bodyRef}
                    className="overflow-hidden text-sm leading-relaxed text-gray-600 transition-[max-height] duration-300"
                    style={{
                        maxHeight: isExpanded ? 'none' : `${CARD_BODY_COLLAPSED_HEIGHT_PX}px`,
                        WebkitMaskImage: hasOverflow && !isExpanded
                            ? 'linear-gradient(to bottom, black 0%, black 72%, transparent 100%)'
                            : 'none',
                        maskImage: hasOverflow && !isExpanded
                            ? 'linear-gradient(to bottom, black 0%, black 72%, transparent 100%)'
                            : 'none'
                    }}
                >
                    {renderParagraphLines(body, `${bodyId}-visible`)}
                </div>
            </div>

            {hasOverflow ? (
                <button
                    type="button"
                    onClick={() => setIsExpanded((current) => !current)}
                    aria-controls={bodyId}
                    aria-expanded={isExpanded}
                    className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-sky-700 transition hover:text-sky-900"
                >
                    <span>{isExpanded ? 'Show less' : 'Show more'}</span>
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
            ) : null}

        </>
    )
}

function CardsContentItem({ item, index, blockId, cardsArticleClass, cardsEyebrowClass, showBackground }) {
    const resolvedPost = item?.resolvedPost || null
    const eyebrow = String(item?.eyebrow || '').trim()
    const title = String(item?.title || resolvedPost?.title || '').trim()
    const body = String(item?.body || resolvedPost?.summary || '').trim()
    const bodyId = useId()

    return (
        <article
            key={`${blockId}-card-${index}`}
            className={cardsArticleClass}
            style={{ backgroundColor: showBackground ? 'white' : 'transparent' }}
        >
            {eyebrow ? (
                <p className={cardsEyebrowClass}>
                    {eyebrow}
                </p>
            ) : null}
            {title ? (
                <h4 className="text-base font-semibold text-gray-900 leading-snug">{title}</h4>
            ) : null}
            {body ? (
                <ExpandableCardsBody body={body} bodyId={bodyId || `${blockId}-card-${index}-body`} />
            ) : null}
        </article>
    )
}

function CardsBlock({ block, cardItems, cardsArticleClass, cardsEyebrowClass }) {
    const columns = Math.min(4, Math.max(1, Number(block.columns) || 2))
    const gridClass = columns === 1
        ? 'grid grid-cols-1 gap-5'
        : columns === 3
            ? 'grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'
            : columns === 4
                ? 'grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4'
                : 'grid grid-cols-1 gap-5 sm:grid-cols-2'
    const showBackground = block?.showBackground !== false
    const sectionId = resolveBlockAnchorId({ slug: block?.slug, blockId: block?.id })

    return (
        <section key={block.id} id={sectionId} className="space-y-4">
            {block.heading ? (
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{block.heading}</h3>
            ) : null}

            <div className="sm:hidden space-y-3">
                {cardItems.map((item, index) => (
                    <CardsContentItem
                        key={`${block.id}-mobile-card-${index}`}
                        item={item}
                        index={index}
                        blockId={block.id}
                        cardsArticleClass={cardsArticleClass}
                        cardsEyebrowClass={cardsEyebrowClass}
                        showBackground={showBackground}
                    />
                ))}
            </div>

            <div className={`${gridClass} hidden sm:grid`}>
                {cardItems.map((item, index) => (
                    <CardsContentItem
                        key={`${block.id}-desktop-card-${index}`}
                        item={item}
                        index={index}
                        blockId={block.id}
                        cardsArticleClass={cardsArticleClass}
                        cardsEyebrowClass={cardsEyebrowClass}
                        showBackground={showBackground}
                    />
                ))}
            </div>
        </section>
    )
}

function renderPageBlock(block, pageStyles, renderBlock, paletteColors = {}, scrollReveal = false, pathPrefix = '') {
    if (!block?.id) return null

    const blockStyles = pageStyles?.blocks || {}
    const eyebrowTextClass = blockStyles.eyebrowText || 'text-xs font-semibold uppercase tracking-[0.22em] text-sky-600'
    const ctaButtonClass = blockStyles.ctaButton || 'inline-flex items-center rounded-full bg-sky-400 px-5 py-3 text-sm font-medium text-sky-950 transition hover:bg-sky-500'
    const ctaSecondaryClass = blockStyles.ctaSecondary || 'inline-flex items-center justify-center text-sm font-semibold underline decoration-2 underline-offset-4 transition hover:opacity-80'
    const cardsArticleClass = blockStyles.cardsArticle || 'flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'
    const cardsEyebrowClass = blockStyles.cardsEyebrow || 'mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-sky-600'

    if (typeof renderBlock === 'function') {
        const customBlock = renderBlock(block, pageStyles)
        if (customBlock !== undefined) return customBlock
    }

    switch (block.type) {
        case 'eyebrow':
            return block.text ? (
                <p key={block.id} className={eyebrowTextClass}>
                    {block.text}
                </p>
            ) : null
        case 'heading': {
            const HeadingTag = getHeadingTag(block.level)
            return (
                <HeadingTag key={block.id} className={getHeadingClass(block.level)}>
                    {block.text}
                </HeadingTag>
            )
        }
        case 'paragraph':
            return (
                <div key={block.id} className="space-y-4">
                    {splitBlockParagraphs(block.text).map((paragraph, index) => (
                        <p key={`${block.id}-${index}`} className={pageStyles.detail.paragraph}>
                            {renderParagraphLines(paragraph, `${block.id}-${index}`)}
                        </p>
                    ))}
                </div>
            )
        case 'image':
            return isSafeImageSrc(block.src) ? (
                <figure key={block.id} className="space-y-3">
                    <Image
                        src={block.src}
                        alt={block.alt || ''}
                        unoptimized
                        width={1600}
                        height={900}
                        className="h-auto w-full rounded-2xl border border-black/5 object-cover shadow-sm"
                    />
                    {block.caption ? (
                        <figcaption className="text-sm text-gray-500">{block.caption}</figcaption>
                    ) : null}
                </figure>
            ) : null
        case 'quote':
            return (
                <figure key={block.id} className="border-l-4 border-amber-300 pl-4 py-1 space-y-2">
                    <blockquote className="text-lg italic text-gray-800">{block.quote}</blockquote>
                    {block.attribution ? (
                        <figcaption className="text-sm text-gray-500">{block.attribution}</figcaption>
                    ) : null}
                </figure>
            )
        case 'single_post':
            return block.resolvedPost ? (
                <SinglePostBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    eyebrow={block.title || block.eyebrow || block.resolvedPost?.title}
                    heading={block.heading || block.resolvedPost?.heading}
                    post={block.resolvedPost}
                />
            ) : null
        case 'cta':
            return isSafeHref(prefixPathWithDomainMode(block.href, pathPrefix)) ? (
                <div key={block.id}>
                    <a
                        href={prefixPathWithDomainMode(block.href, pathPrefix)}
                        className={ctaButtonClass}
                    >
                        {block.text || 'Learn more'}
                    </a>
                </div>
            ) : null
        case 'contact': {
            const title = String(block.title || '').trim()
            const heading = String(block.heading || '').trim()
            const description = String(block.description || '').trim()
            const primaryText = String(block.ctaText || '').trim()
            const primaryHref = String(block.ctaHref || '').trim()
            const secondaryText = String(block.secondaryCtaText || '').trim()
            const secondaryHref = String(block.secondaryCtaHref || '').trim()
            const primaryResolvedHref = prefixPathWithDomainMode(primaryHref, pathPrefix)
            const secondaryResolvedHref = prefixPathWithDomainMode(secondaryHref, pathPrefix)
            const showPrimary = Boolean(primaryText) && isSafeHref(primaryResolvedHref)
            const showSecondary = Boolean(secondaryText) && isSafeHref(secondaryResolvedHref)

            if (!title && !heading && !description && !showPrimary && !showSecondary) return null

            return (
                <section key={block.id} className="mx-auto w-full max-w-xl space-y-3 text-center">
                    {title ? <p className={eyebrowTextClass}>{title}</p> : null}
                    {heading ? <h3 className="text-2xl font-semibold text-gray-900">{heading}</h3> : null}
                    {description ? <p className={`${pageStyles.detail.paragraph} mx-auto`}>{description}</p> : null}
                    {(showPrimary || showSecondary) ? (
                        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:items-center">
                            {showPrimary ? (
                                <a href={primaryResolvedHref} className={ctaButtonClass}>
                                    {primaryText}
                                </a>
                            ) : null}
                            {showSecondary ? (
                                <a href={secondaryResolvedHref} className={ctaSecondaryClass}>
                                    {secondaryText}
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            )
        }
        case 'three_panel': {
            const items = Array.isArray(block.items) ? block.items.filter((item) => {
                const eyebrow = String(item?.eyebrow || '').trim()
                const heading = String(item?.heading || '').trim()
                const body = String(item?.body || '').trim()
                return eyebrow || heading || body
            }) : []

            return (
                <ThreePanelFeatureBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    title={block.title || block.eyebrow}
                    heading={block.heading}
                    eyebrow={block.eyebrow}
                    introPost={block.resolvedIntroPost}
                    items={items}
                    blockStyles={blockStyles}
                    paletteColors={paletteColors}
                    scrollReveal={scrollReveal}
                    autoAdvancePanels={block.autoAdvancePanels}
                    autoAdvanceIntervalMs={block.autoAdvanceIntervalMs}
                    headingBackgroundColor={block.headingBackgroundColor}
                />
            )
        }
        case 'divider':
            return <div key={block.id} className="h-2 sm:h-3" aria-hidden="true" />
        case 'faq': {
            const faqItems = Array.isArray(block.items) ? block.items.filter((item) => {
                return String(item?.question || '').trim() || String(item?.answer || '').trim()
            }) : []

            if (faqItems.length === 0) return null

            return (
                <FaqBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    items={faqItems}
                />
            )
        }
        case 'cards': {
            const cardItems = Array.isArray(block.items) ? block.items.filter((item) => {
                return String(item?.title || '').trim() || String(item?.body || '').trim() || item?.postId || item?.postSlug || item?.resolvedPost
            }) : []

            if (cardItems.length === 0) return null

            return (
                <CardsBlock
                    block={block}
                    cardItems={cardItems}
                    cardsArticleClass={cardsArticleClass}
                    cardsEyebrowClass={cardsEyebrowClass}
                />
            )
        }
        case 'hero':
            return (
                <HeroBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    headline={block.headline}
                    subheadline={block.subheadline}
                    ctaText={block.ctaText}
                    ctaHref={prefixPathWithDomainMode(block.ctaHref, pathPrefix)}
                    backgroundType={block.backgroundType}
                    backgroundValue={block.backgroundValue}
                    imageUrl={block.imageUrl}
                    textAlign={block.textAlign}
                    styles={block.styles}
                    paletteColors={paletteColors}
                />
            )
        case 'testimonials':
            return (
                <TestimonialBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    variant={block.variant}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'stats':
            return (
                <StatsBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    variant={block.variant}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'logo_marquee':
            return (
                <LogoMarqueeBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'proof_points':
            return (
                <ProofPointsBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    reverse={block.reverse}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'feature_comparison':
            return (
                <FeatureComparisonBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    eyebrow={block.eyebrow}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'steps':
            return (
                <StepsBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    eyebrow={block.eyebrow}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'pricing':
            return (
                <PricingBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    items={block.items}
                    styles={block.styles}
                />
            )
        case 'bio_profile':
            return (
                <BioProfileBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    imageUrl={block.imageUrl}
                    imageAlt={block.imageAlt}
                    eyebrow={block.eyebrow}
                    heading={block.heading}
                    body={block.body}
                    ctaText={block.ctaText}
                    ctaHref={block.ctaHref}
                    imagePosition={block.imagePosition}
                    styles={block.styles}
                />
            )
        case 'icon_cards':
            return (
                <IconCardsBlock
                    key={block.id}
                    blockId={block.id}
                    slug={block.slug}
                    heading={block.heading}
                    eyebrow={block.eyebrow}
                    columns={block.columns}
                    items={block.items}
                    styles={block.styles}
                />
            )
        default:
            return null
    }
}

function splitBlockParagraphs(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
}

function renderParagraphLines(value, keyPrefix) {
    const lines = String(value || '').replace(/\r\n/g, '\n').split('\n')

    return lines.map((line, index) => {
        const lineKey = `${keyPrefix}-line-${index}`

        if (index === 0) return line
        return [<br key={`${lineKey}-break`} />, line]
    })
}

function getHeadingTag(level) {
    if (level === 3) return 'h3'
    if (level === 4) return 'h4'
    return 'h2'
}

function getHeadingClass(level) {
    if (level === 4) return 'text-lg font-semibold text-gray-900'
    if (level === 3) return 'text-xl font-semibold text-gray-900'
    return 'text-2xl font-semibold text-gray-900'
}

function isSafeHref(value) {
    const trimmed = String(value || '').trim()
    if (!trimmed) return false
    if (trimmed.startsWith('/')) return true
    return /^(https?:|mailto:|tel:)/i.test(trimmed)
}

function isSafeImageSrc(value) {
    const trimmed = String(value || '').trim()
    if (!trimmed) return false
    if (trimmed.startsWith('/')) return true
    return /^https?:/i.test(trimmed)
}
