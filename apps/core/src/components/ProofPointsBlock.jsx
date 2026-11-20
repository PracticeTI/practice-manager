'use client'

import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function ProofPointCard({ item, cardBg, cardBorder, headingColor, bodyColor, accentColor }) {
    return (
        <div
            className="flex min-h-[10rem] w-56 shrink-0 flex-col gap-2 rounded-2xl border p-4 shadow-sm sm:min-h-0 sm:w-72 sm:p-6"
            style={{ backgroundColor: cardBg || '#ffffff', borderColor: cardBorder || '#e5e7eb' }}
        >
            {accentColor && (
                <div className="h-1 w-8 rounded-full mb-1" style={{ backgroundColor: accentColor }} />
            )}
            <p className="text-sm font-semibold leading-snug" style={{ color: headingColor || '#111827' }}>
                {item.heading}
            </p>
            {item.body && (
                <p className="text-sm leading-relaxed" style={{ color: bodyColor || '#6b7280' }}>
                    {item.body}
                </p>
            )}
        </div>
    )
}

function MarqueeRow({ items, reverse, cardBg, cardBorder, headingColor, bodyColor, accentColor }) {
    const id = `proof-marquee-${reverse ? 'r' : 'f'}`
    return (
        <>
            <style>{`
                @keyframes ${id} {
                    0% { transform: translateX(${reverse ? '-50%' : '0%'}); }
                    100% { transform: translateX(${reverse ? '0%' : '-50%'}); }
                }
                .${id} { animation: ${id} 40s linear infinite; }
            `}</style>
            <div className="overflow-hidden" style={{ maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)' }}>
                <div className={`flex gap-4 ${id}`} style={{ width: 'max-content' }}>
                    {[...items, ...items].map((item, i) => (
                        <ProofPointCard
                            key={i}
                            item={item}
                            cardBg={cardBg}
                            cardBorder={cardBorder}
                            headingColor={headingColor}
                            bodyColor={bodyColor}
                            accentColor={accentColor}
                        />
                    ))}
                </div>
            </div>
        </>
    )
}

export default function ProofPointsBlock({
    blockId,
    slug = '',
    heading = '',
    reverse = false,
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionBg = styles.sectionBg || 'transparent'
    const headingColor = styles.headingColor || '#111827'
    const cardBg = styles.cardBg || '#ffffff'
    const cardBorder = styles.cardBorder || '#e5e7eb'
    const itemHeadingColor = styles.itemHeadingColor || '#111827'
    const bodyColor = styles.bodyColor || '#6b7280'
    const accentColor = styles.accentColor || '#6366f1'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen overflow-hidden py-16" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 xl:px-10">
                {heading && (
                    <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
            </div>
            <MarqueeRow
                items={items}
                reverse={reverse}
                cardBg={cardBg}
                cardBorder={cardBorder}
                headingColor={itemHeadingColor}
                bodyColor={bodyColor}
                accentColor={accentColor}
            />
        </section>
    )
}
