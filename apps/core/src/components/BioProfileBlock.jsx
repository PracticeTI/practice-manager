import Image from 'next/image'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function isSafeHref(href) {
    if (!href) return false
    const s = String(href).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://') || s.startsWith('mailto:') || s.startsWith('tel:')
}

function isSafeImageSrc(src) {
    if (!src) return false
    const s = String(src).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')
}

export default function BioProfileBlock({
    blockId,
    slug = '',
    imageUrl = '',
    imageAlt = '',
    eyebrow = '',
    heading = '',
    body = '',
    ctaText = '',
    ctaHref = '',
    imagePosition = 'left',
    styles = {}
}) {
    const sectionBg = styles.sectionBg || 'transparent'
    const eyebrowColor = styles.eyebrowColor || '#6366f1'
    const headingColor = styles.headingColor || '#111827'
    const bodyColor = styles.bodyColor || '#374151'
    const ctaBg = styles.ctaBg || '#6366f1'
    const ctaTextColor = styles.ctaTextColor || '#ffffff'
    const imageBg = styles.imageBg || '#e5e7eb'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    const hasImage = isSafeImageSrc(imageUrl)
    const imageOnRight = imagePosition === 'right'

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-5xl px-6">
                <div className={`flex flex-col items-center gap-10 md:flex-row ${imageOnRight ? 'md:flex-row-reverse' : ''}`}>
                    {/* Image */}
                    <div className="flex w-full shrink-0 justify-center md:w-auto">
                        {hasImage ? (
                            <Image
                                src={imageUrl}
                                alt={imageAlt || heading}
                                unoptimized
                                width={320}
                                height={320}
                                className="h-64 w-64 rounded-2xl object-cover shadow-lg sm:h-80 sm:w-80"
                            />
                        ) : (
                            <div
                                className="flex h-64 w-64 items-center justify-center rounded-2xl text-4xl sm:h-80 sm:w-80"
                                style={{ backgroundColor: imageBg }}
                            >
                                👤
                            </div>
                        )}
                    </div>
                    {/* Content */}
                    <div className="flex flex-col gap-4">
                        {eyebrow && (
                            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: eyebrowColor }}>
                                {eyebrow}
                            </p>
                        )}
                        {heading && (
                            <h2 className="text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                                {heading}
                            </h2>
                        )}
                        {body && (
                            <p className="text-base leading-relaxed" style={{ color: bodyColor }}>
                                {body}
                            </p>
                        )}
                        {ctaText && (
                            <div className="mt-2">
                                {isSafeHref(ctaHref) ? (
                                    <a
                                        href={ctaHref}
                                        className="inline-flex items-center rounded-full px-6 py-3 text-sm font-semibold shadow transition hover:opacity-90"
                                        style={{ backgroundColor: ctaBg, color: ctaTextColor }}
                                    >
                                        {ctaText}
                                    </a>
                                ) : (
                                    <span
                                        className="inline-flex items-center rounded-full px-6 py-3 text-sm font-semibold"
                                        style={{ backgroundColor: ctaBg, color: ctaTextColor }}
                                    >
                                        {ctaText}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    )
}
