import { resolveBlockAnchorId } from '@/lib/blockAnchors'

export default function StepsBlock({
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
    const stepNumberBg = styles.stepNumberBg || '#6366f1'
    const stepNumberColor = styles.stepNumberColor || '#ffffff'
    const titleColor = styles.titleColor || '#111827'
    const bodyColor = styles.bodyColor || '#6b7280'
    const connectorColor = styles.connectorColor || '#e5e7eb'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-5xl px-6">
                {eyebrow && (
                    <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest" style={{ color: eyebrowColor }}>
                        {eyebrow}
                    </p>
                )}
                {heading && (
                    <h2 className="mb-12 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                <ol className="relative flex flex-col gap-10 md:flex-row md:gap-0">
                    {items.map((item, i) => {
                        const isLast = i === items.length - 1
                        return (
                            <li key={i} className="relative flex flex-1 flex-col items-center text-center">
                                {/* Connector line between steps */}
                                {!isLast && (
                                    <div
                                        className="absolute left-1/2 top-6 hidden h-px w-full -translate-y-1/2 translate-x-1/2 md:block"
                                        style={{ backgroundColor: connectorColor, zIndex: 0 }}
                                    />
                                )}
                                <div
                                    className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold shadow"
                                    style={{ backgroundColor: stepNumberBg, color: stepNumberColor }}
                                >
                                    {i + 1}
                                </div>
                                <div className="mt-4 flex flex-col gap-1 px-4">
                                    {item.title && (
                                        <h3 className="text-base font-semibold sm:text-lg" style={{ color: titleColor }}>
                                            {item.title}
                                        </h3>
                                    )}
                                    {item.body && (
                                        <p className="text-sm" style={{ color: bodyColor }}>
                                            {item.body}
                                        </p>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ol>
            </div>
        </section>
    )
}
