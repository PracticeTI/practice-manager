import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function CheckIcon({ color }) {
    return (
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill={color || '#22c55e'} />
            <path d="M6 10l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function CrossIcon({ color }) {
    return (
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill={color || '#f87171'} />
            <path d="M7 7l6 6M13 7l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

export default function FeatureComparisonBlock({
    blockId,
    slug = '',
    heading = '',
    eyebrow = '',
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionBg = styles.sectionBg || 'transparent'
    const eyebrowColor = styles.eyebrowColor || '#6366f1'
    const headingColor = styles.headingColor || '#111827'
    const labelColor = styles.labelColor || '#374151'
    const checkColor = styles.checkColor || '#22c55e'
    const crossColor = styles.crossColor || '#f87171'
    const dividerColor = styles.dividerColor || '#f3f4f6'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-2xl px-6">
                {eyebrow && (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: eyebrowColor }}>
                        {eyebrow}
                    </p>
                )}
                {heading && (
                    <h2 className="mb-8 text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                <ul className="flex flex-col divide-y" style={{ '--divide-color': dividerColor, borderColor: dividerColor }}>
                    {items.map((item, i) => (
                        <li key={i} className="flex items-center gap-3 py-3.5" style={{ borderColor: dividerColor }}>
                            {item.included
                                ? <CheckIcon color={checkColor} />
                                : <CrossIcon color={crossColor} />
                            }
                            <span className="text-sm sm:text-base" style={{ color: labelColor }}>
                                {item.label}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    )
}
