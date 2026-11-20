'use client'

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

function getReadableTextColor(color, dark = '#0f172a', light = '#ffffff') {
    const normalized = String(color || '').trim().replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return dark

    const red = Number.parseInt(normalized.slice(0, 2), 16)
    const green = Number.parseInt(normalized.slice(2, 4), 16)
    const blue = Number.parseInt(normalized.slice(4, 6), 16)
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
    return luminance > 0.62 ? dark : light
}

export default function HeroBlock({
    blockId,
    slug = '',
    headline = '',
    subheadline = '',
    ctaText = '',
    ctaHref = '',
    backgroundType = 'color',
    backgroundValue = '',
    imageUrl = '',
    textAlign = 'center',
    styles = {},
    paletteColors = {}
}) {
    const heroPrimaryColor = String(paletteColors?.color1 || '').trim() || '#ffffff'
    const heroSecondaryColor = String(paletteColors?.color2 || '').trim() || '#1e3a8a'
    const heroAccentColor = String(paletteColors?.color3 || '').trim() || '#7c3aed'

    const bgStyle = {}

    if (backgroundType === 'image' && isSafeImageSrc(imageUrl)) {
        bgStyle.backgroundImage = `url(${imageUrl})`
        bgStyle.backgroundSize = 'cover'
        bgStyle.backgroundPosition = 'center'
    } else if (backgroundType === 'gradient' && backgroundValue) {
        bgStyle.backgroundImage = backgroundValue
    } else if (backgroundType === 'color' && backgroundValue) {
        bgStyle.backgroundColor = backgroundValue
    } else {
        bgStyle.backgroundImage = `linear-gradient(135deg, ${heroPrimaryColor} 0%, ${heroAccentColor} 100%)`
    }

    if (styles.backgroundColor && backgroundType === 'color') {
        bgStyle.backgroundColor = styles.backgroundColor
    }

    const textAlignClass = textAlign === 'left' ? 'text-left items-start' : textAlign === 'right' ? 'text-right items-end' : 'text-center items-center'

    const headlineColor = styles.headlineColor || '#ffffff'
    const subheadlineColor = styles.subheadlineColor || 'rgba(255,255,255,0.85)'
    const ctaBgColor = styles.ctaBgColor || heroPrimaryColor
    const ctaTextColor = styles.ctaTextColor || getReadableTextColor(ctaBgColor)
    const overlayColor = styles.overlayColor || null
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="relative w-full overflow-hidden lg:max-w-4xl lg:mx-auto" style={bgStyle}>
            {overlayColor && (
                <div className="absolute inset-0" style={{ backgroundColor: overlayColor }} />
            )}
            <div className={`relative z-10 mx-auto flex max-w-4xl flex-col gap-6 px-6 py-20 sm:py-28 ${textAlignClass}`}>
                {headline && (
                    <h2
                        className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
                        style={{ color: headlineColor }}
                    >
                        {headline}
                    </h2>
                )}
                {subheadline && (
                    <p
                        className="max-w-2xl text-lg sm:text-xl"
                        style={{ color: subheadlineColor }}
                    >
                        {subheadline}
                    </p>
                )}
                {ctaText && isSafeHref(ctaHref) && (
                    <div>
                        <a
                            href={ctaHref}
                            className="inline-flex items-center rounded-full px-7 py-3.5 text-base font-semibold shadow-lg transition hover:opacity-90"
                            style={{ backgroundColor: ctaBgColor, color: ctaTextColor }}
                        >
                            {ctaText}
                        </a>
                    </div>
                )}
                {ctaText && !isSafeHref(ctaHref) && (
                    <div>
                        <span
                            className="inline-flex items-center rounded-full px-7 py-3.5 text-base font-semibold shadow-lg"
                            style={{ backgroundColor: ctaBgColor, color: ctaTextColor }}
                        >
                            {ctaText}
                        </span>
                    </div>
                )}
            </div>
        </section>
    )
}
