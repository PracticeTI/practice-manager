import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function isSafeHref(href) {
    if (!href) return false
    const s = String(href).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://') || s.startsWith('mailto:') || s.startsWith('tel:')
}

function CheckIcon({ color }) {
    return (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8l4 4 6-6" stroke={color || '#22c55e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function parseHexColor(hex) {
    if (typeof hex !== 'string') return null
    const value = hex.trim().replace('#', '')

    if (value.length === 3) {
        const r = parseInt(value[0] + value[0], 16)
        const g = parseInt(value[1] + value[1], 16)
        const b = parseInt(value[2] + value[2], 16)
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
        return { r, g, b }
    }

    if (value.length === 6) {
        const r = parseInt(value.slice(0, 2), 16)
        const g = parseInt(value.slice(2, 4), 16)
        const b = parseInt(value.slice(4, 6), 16)
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
        return { r, g, b }
    }

    return null
}

function getReadableTextColor(backgroundColor) {
    const rgb = parseHexColor(backgroundColor)
    if (!rgb) return '#111827'

    // Relative luminance approximation for choosing accessible text color.
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
    return luminance > 0.6 ? '#111827' : '#ffffff'
}

export default function PricingBlock({
    blockId,
    slug = '',
    heading = '',
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionId = resolveBlockAnchorId({ slug, blockId })

    const sectionBg = styles.sectionBg || 'transparent'
    const headingColor = styles.headingColor || '#111827'
    const cardBg = styles.cardBg || '#ffffff'
    const cardBorder = styles.cardBorder || '#e5e7eb'
    const highlightedBg = styles.highlightedBg || '#4f46e5'
    const highlightedBorder = styles.highlightedBorder || '#4f46e5'
    const nameColor = styles.nameColor || '#111827'
    const priceColor = styles.priceColor || '#111827'
    const periodColor = styles.periodColor || '#6b7280'
    const descriptionColor = styles.descriptionColor || '#6b7280'
    const featureColor = styles.featureColor || '#374151'
    const checkColor = styles.checkColor || '#22c55e'
    const ctaBg = styles.ctaBg || '#4f46e5'
    const ctaColor = styles.ctaTextColor || '#ffffff'
    const highlightedCtaBg = styles.highlightedCtaBg || '#ffffff'
    const highlightedCtaColor = styles.highlightedCtaTextColor || '#4f46e5'
    const highlightedTextColor = styles.highlightedTextColor || getReadableTextColor(highlightedBg)

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-7xl px-6">
                {heading && (
                    <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((plan, i) => {
                        const hl = plan.highlighted
                        return (
                            <div
                                key={i}
                                className="flex w-full flex-col gap-5 rounded-2xl border-2 p-8 shadow-sm transition"
                                style={{
                                    backgroundColor: hl ? highlightedBg : cardBg,
                                    borderColor: hl ? highlightedBorder : cardBorder
                                }}
                            >
                                <div>
                                    <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: hl ? highlightedTextColor : '#6b7280' }}>
                                        {plan.name}
                                    </p>
                                    <div className="mt-2 flex items-end gap-1">
                                        <span className="text-4xl font-extrabold" style={{ color: hl ? highlightedTextColor : priceColor }}>
                                            {plan.price}
                                        </span>
                                        {plan.period && (
                                            <span className="mb-1 text-sm" style={{ color: hl ? highlightedTextColor : periodColor }}>
                                                / {plan.period}
                                            </span>
                                        )}
                                    </div>
                                    {plan.description && (
                                        <p className="mt-2 text-sm" style={{ color: hl ? highlightedTextColor : descriptionColor }}>
                                            {plan.description}
                                        </p>
                                    )}
                                </div>
                                {plan.features && plan.features.length > 0 && (
                                    <ul className="flex flex-col gap-2">
                                        {plan.features.map((feat, j) => (
                                            <li key={j} className="flex items-center gap-2 text-sm" style={{ color: hl ? highlightedTextColor : featureColor }}>
                                                <CheckIcon color={hl ? highlightedTextColor : checkColor} />
                                                {feat}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {plan.ctaText && (
                                    <div className="mt-auto">
                                        {isSafeHref(plan.ctaHref) ? (
                                            <a
                                                href={plan.ctaHref}
                                                className="block w-full rounded-full py-3 text-center text-sm font-semibold shadow transition hover:opacity-90"
                                                style={{ backgroundColor: hl ? highlightedCtaBg : ctaBg, color: hl ? highlightedCtaColor : ctaColor }}
                                            >
                                                {plan.ctaText}
                                            </a>
                                        ) : (
                                            <span
                                                className="block w-full rounded-full py-3 text-center text-sm font-semibold"
                                                style={{ backgroundColor: hl ? highlightedCtaBg : ctaBg, color: hl ? highlightedCtaColor : ctaColor }}
                                            >
                                                {plan.ctaText}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}
