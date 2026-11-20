'use client'

import Image from 'next/image'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function isSafeImageSrc(src) {
    if (!src) return false
    const s = String(src).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')
}

const COLS_CLASS = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4'
}

function CardBody({ body }) {
    return (
        <div className="text-sm leading-relaxed" style={{ color: body.color }}>
            {body.text}
        </div>
    )
}

export default function IconCardsBlock({
    blockId,
    slug = '',
    heading = '',
    eyebrow = '',
    columns = 3,
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionBg = styles.sectionBg || 'transparent'
    const eyebrowColor = styles.eyebrowColor || '#6366f1'
    const headingColor = styles.headingColor || '#111827'
    const cardBg = styles.cardBg || '#ffffff'
    const cardBorder = styles.cardBorder || '#e5e7eb'
    const iconBg = styles.iconBg || '#ede9fe'
    const titleColor = styles.titleColor || '#111827'
    const bodyColor = styles.bodyColor || '#6b7280'
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    const colsClass = COLS_CLASS[columns] || COLS_CLASS[3]

    return (
        <section id={sectionId} className="w-full py-14" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-6xl px-6">
                {eyebrow && (
                    <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest" style={{ color: eyebrowColor }}>
                        {eyebrow}
                    </p>
                )}
                {heading && (
                    <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                <div className={`grid grid-cols-1 gap-6 ${colsClass}`}>
                    {items.map((item, i) => (
                        <div
                            key={i}
                            className="flex flex-col gap-4 rounded-2xl border p-6 shadow-sm"
                            style={{ backgroundColor: cardBg, borderColor: cardBorder }}
                        >
                            <div
                                className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                                style={{ backgroundColor: iconBg }}
                            >
                                {isSafeImageSrc(item.icon) ? (
                                    <Image src={item.icon} alt="" unoptimized width={28} height={28} className="h-7 w-7 object-contain" />
                                ) : (
                                    <span role="img" aria-hidden="true">{item.icon || '✦'}</span>
                                )}
                            </div>
                            {item.title && (
                                <h3 className="text-base font-semibold" style={{ color: titleColor }}>
                                    {item.title}
                                </h3>
                            )}
                            {item.body && (
                                <CardBody
                                    body={{ text: item.body, color: bodyColor }}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
