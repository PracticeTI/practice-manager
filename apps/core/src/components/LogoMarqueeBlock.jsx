'use client'

import Image from 'next/image'
import { useRef, useEffect, useState } from 'react'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

function isSafeHref(href) {
    if (!href) return false
    const s = String(href).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')
}

function isSafeImageSrc(src) {
    if (!src) return false
    const s = String(src).trim()
    return s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')
}

export default function LogoMarqueeBlock({
    blockId,
    slug = '',
    heading = '',
    items = [],
    styles = {}
}) {
    const sectionBg = styles.sectionBg || 'transparent'
    const headingColor = styles.headingColor || '#9ca3af'
    const logoOpacity = styles.logoOpacity || '0.6'

    const displayed = [...items, ...items]
    const trackRef = useRef(null)
    const [translatePx, setTranslatePx] = useState(null)
    const sectionId = resolveBlockAnchorId({ slug, blockId })

    useEffect(() => {
        if (items.length === 0) {
            return undefined
        }

        const measure = () => {
            if (!trackRef.current) return
            const children = trackRef.current.children
            const half = Math.floor(children.length / 2)
            if (half > 0 && children[half]) {
                setTranslatePx(children[half].offsetLeft)
            }
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [items])

    if (items.length === 0) return null

    const keyframes = translatePx != null
        ? `@keyframes logo-marquee { 0% { transform: translateX(0px); } 100% { transform: translateX(-${translatePx}px); } } .logo-marquee-track { animation: logo-marquee 30s linear infinite; }`
        : `@keyframes logo-marquee { 0% { transform: translateX(0%); } 100% { transform: translateX(-50%); } } .logo-marquee-track { animation: logo-marquee 30s linear infinite; }`

    return (
        <section id={sectionId} className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen py-12" style={{ backgroundColor: sectionBg }}>
            <style>{keyframes}</style>
            {heading && (
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 xl:px-10">
                    <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest" style={{ color: headingColor }}>
                        {heading}
                    </p>
                </div>
            )}
            <div className="overflow-hidden" style={{ maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)' }}>
                <div ref={trackRef} className="logo-marquee-track flex gap-10 sm:gap-16" style={{ width: 'max-content' }}>
                    {displayed.map((item, i) => (
                        <div key={i} className="flex shrink-0 items-center" style={{ opacity: logoOpacity }}>
                            {isSafeHref(item.href) ? (
                                <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">
                                    {isSafeImageSrc(item.filePath) ? (
                                        <Image src={item.filePath} alt={item.name} unoptimized width={160} height={40} className="h-8 max-w-[8rem] object-contain sm:h-10" />
                                    ) : isSafeImageSrc(item.imageUrl) ? (
                                        <Image src={item.imageUrl} alt={item.name} unoptimized width={160} height={40} className="h-8 max-w-[8rem] object-contain sm:h-10" />
                                    ) : (
                                        <span className="whitespace-nowrap text-base font-bold text-gray-500 sm:text-lg">{item.name}</span>
                                    )}
                                </a>
                            ) : (
                                <>
                                    {isSafeImageSrc(item.filePath) ? (
                                        <Image src={item.filePath} alt={item.name} unoptimized width={160} height={40} className="h-8 max-w-[8rem] object-contain sm:h-10" />
                                    ) : isSafeImageSrc(item.imageUrl) ? (
                                        <Image src={item.imageUrl} alt={item.name} unoptimized width={160} height={40} className="h-8 max-w-[8rem] object-contain sm:h-10" />
                                    ) : (
                                        <span className="whitespace-nowrap text-base font-bold text-gray-500 sm:text-lg">{item.name}</span>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
