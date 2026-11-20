import { resolveBlockAnchorId } from '@/lib/blockAnchors'

export default function StatsBlock({
    blockId,
    slug = '',
    heading = '',
    variant = 'row',
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionBg = styles.sectionBg || 'transparent'
    const headingColor = styles.headingColor || '#111827'
    const valueColor = styles.valueColor || '#111827'
    const labelColor = styles.labelColor || '#6b7280'
    const dividerColor = styles.dividerColor || '#e5e7eb'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    const isRow = variant === 'row'

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-6xl px-6">
                {heading && (
                    <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                <div className={isRow ? 'flex flex-wrap justify-center gap-8 sm:gap-12' : 'flex flex-col items-center gap-10'}>
                    {items.map((item, i) => (
                        <div
                            key={i}
                            className={`flex flex-col gap-1 ${isRow ? 'min-w-[8rem] flex-1 basis-36 items-center text-center' : 'items-center text-center'}`}
                        >
                            {isRow && i > 0 && (
                                <div
                                    className="absolute left-0 top-1/2 hidden h-10 w-px -translate-y-1/2 sm:block"
                                    style={{ backgroundColor: dividerColor }}
                                />
                            )}
                            <span className="text-4xl font-extrabold tracking-tight sm:text-5xl" style={{ color: valueColor }}>
                                {item.prefix}{item.value}{item.suffix}
                            </span>
                            {item.label && (
                                <span className="text-sm font-medium uppercase tracking-wide" style={{ color: labelColor }}>
                                    {item.label}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
