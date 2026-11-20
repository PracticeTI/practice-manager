'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function AvatarInitials({ name, bgColor }) {
    const initials = name
        ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
        : '?'
    return (
        <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: bgColor || '#6366f1' }}
        >
            {initials}
        </div>
    )
}

function TestimonialCard({ item, cardBg, cardBorder, textColor, accentColor, nameColor }) {
    return (
        <div
            className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl border p-6 shadow-sm"
            style={{ backgroundColor: cardBg || '#ffffff', borderColor: cardBorder || '#e5e7eb' }}
        >
            <p className="text-sm leading-relaxed" style={{ color: textColor || '#374151' }}>
                &ldquo;{item.quote}&rdquo;
            </p>
            <div className="mt-auto flex items-center gap-3">
                {item.avatarUrl ? (
                    <Image src={item.avatarUrl} alt={item.author} unoptimized width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                    <AvatarInitials name={item.author} bgColor={accentColor} />
                )}
                <div>
                    <p className="text-sm font-semibold" style={{ color: nameColor || '#111827' }}>{item.author}</p>
                    {(item.role || item.company) && (
                        <p className="text-xs" style={{ color: textColor || '#6b7280' }}>
                            {[item.role, item.company].filter(Boolean).join(', ')}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

function MarqueeRow({ items, reverse, cardBg, cardBorder, textColor, accentColor, nameColor }) {
    const id = `testimonial-marquee-${reverse ? 'r' : 'f'}`
    return (
        <>
            <style>{`
                @keyframes ${id} {
                    0% { transform: translateX(${reverse ? '-50%' : '0%'}); }
                    100% { transform: translateX(${reverse ? '0%' : '-50%'}); }
                }
                .${id} { animation: ${id} 40s linear infinite; }
            `}</style>
            <div className="overflow-hidden">
                <div className={`flex gap-4 ${id}`} style={{ width: 'max-content' }}>
                    {[...items, ...items].map((item, i) => (
                        <TestimonialCard
                            key={i}
                            item={item}
                            cardBg={cardBg}
                            cardBorder={cardBorder}
                            textColor={textColor}
                            accentColor={accentColor}
                            nameColor={nameColor}
                        />
                    ))}
                </div>
            </div>
        </>
    )
}

function CarouselView({ items, cardBg, cardBorder, textColor, accentColor, nameColor, dotActive, dotInactive }) {
    const [index, setIndex] = useState(0)
    const touchStartX = useRef(null)

    function prev() { setIndex((i) => (i - 1 + items.length) % items.length) }
    function next() { setIndex((i) => (i + 1) % items.length) }

    function onTouchStart(e) { touchStartX.current = e.touches[0].clientX }
    function onTouchEnd(e) {
        if (touchStartX.current === null) return
        const delta = touchStartX.current - e.changedTouches[0].clientX
        if (Math.abs(delta) > 28) { delta > 0 ? next() : prev() }
        touchStartX.current = null
    }

    return (
        <div className="relative" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="flex justify-center">
                <div className="w-full max-w-lg">
                    <TestimonialCard
                        item={items[index]}
                        cardBg={cardBg}
                        cardBorder={cardBorder}
                        textColor={textColor}
                        accentColor={accentColor}
                        nameColor={nameColor}
                    />
                </div>
            </div>
            <div className="mt-6 flex items-center justify-center gap-4">
                <button onClick={prev} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Previous">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="flex gap-2">
                    {items.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => setIndex(i)}
                            className="h-2 w-2 rounded-full transition-all"
                            style={{ backgroundColor: i === index ? (dotActive || '#6366f1') : (dotInactive || '#d1d5db') }}
                            aria-label={`Go to testimonial ${i + 1}`}
                        />
                    ))}
                </div>
                <button onClick={next} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Next">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
            </div>
        </div>
    )
}

function GridView({ items, cardBg, cardBorder, textColor, accentColor, nameColor }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => (
                <TestimonialCard
                    key={i}
                    item={item}
                    cardBg={cardBg}
                    cardBorder={cardBorder}
                    textColor={textColor}
                    accentColor={accentColor}
                    nameColor={nameColor}
                />
            ))}
        </div>
    )
}

export default function TestimonialBlock({
    blockId,
    slug = '',
    heading = '',
    variant = 'marquee',
    items = [],
    styles = {}
}) {
    if (items.length === 0) return null

    const sectionBg = styles.sectionBg || 'transparent'
    const headingColor = styles.headingColor || '#111827'
    const cardBg = styles.cardBg || '#ffffff'
    const cardBorder = styles.cardBorder || '#e5e7eb'
    const textColor = styles.textColor || '#374151'
    const accentColor = styles.accentColor || '#6366f1'
    const nameColor = styles.nameColor || '#111827'
    const dotActive = styles.dotActive || accentColor
    const dotInactive = styles.dotInactive || '#d1d5db'

    const half = Math.ceil(items.length / 2)
    const row1 = items.slice(0, half)
    const row2 = items.slice(half)
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="w-full overflow-hidden py-16" style={{ backgroundColor: sectionBg }}>
            <div className="mx-auto max-w-7xl px-6">
                {heading && (
                    <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl" style={{ color: headingColor }}>
                        {heading}
                    </h2>
                )}
                {variant === 'marquee' && (
                    <div className="flex flex-col gap-4">
                        <MarqueeRow items={row1.length ? row1 : items} reverse={false} cardBg={cardBg} cardBorder={cardBorder} textColor={textColor} accentColor={accentColor} nameColor={nameColor} />
                        {row2.length > 0 && (
                            <MarqueeRow items={row2} reverse={true} cardBg={cardBg} cardBorder={cardBorder} textColor={textColor} accentColor={accentColor} nameColor={nameColor} />
                        )}
                    </div>
                )}
                {variant === 'carousel' && (
                    <CarouselView items={items} cardBg={cardBg} cardBorder={cardBorder} textColor={textColor} accentColor={accentColor} nameColor={nameColor} dotActive={dotActive} dotInactive={dotInactive} />
                )}
                {variant === 'grid' && (
                    <GridView items={items} cardBg={cardBg} cardBorder={cardBorder} textColor={textColor} accentColor={accentColor} nameColor={nameColor} />
                )}
            </div>
        </section>
    )
}
