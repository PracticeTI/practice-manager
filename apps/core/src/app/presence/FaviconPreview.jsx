'use client'

import Image from 'next/image'
import { useState } from 'react'
import { pickBrandIconForSize } from '@/lib/brandingIcons'

const PREVIEW_SIZES = [16, 32, 64]

function basename(url) {
    return String(url || '').split('/').pop() || url
}

export default function FaviconPreview({ faviconUrl = '', icons = [], label = 'Favicon', title = '' }) {
    const [activeSize, setActiveSize] = useState(PREVIEW_SIZES[1])

    // A raster icon rendered larger than its intrinsic size goes soft, so pick the
    // smallest asset that still covers the display size (scalable sources always win).
    const sourceForSize = (size) => pickBrandIconForSize(icons, size)?.url || faviconUrl

    if (!faviconUrl) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                No favicon URL is currently available for this domain.
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-slate-200 p-4">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                {PREVIEW_SIZES.map((size) => {
                    const selected = size === activeSize
                    return (
                        <button
                            key={size}
                            type="button"
                            onClick={() => setActiveSize(size)}
                            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                            aria-pressed={selected}
                        >
                            {size}px
                        </button>
                    )
                })}
            </div>

            <p className="mt-3 text-xs text-slate-500 break-all">{sourceForSize(activeSize)}</p>
            <p className="mt-1 text-xs text-slate-500">Preview reflects how the icon renders in a browser tab at each size.</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                    <h3 className="text-sm font-semibold text-slate-900">Browser tab</h3>
                    <div className="mt-2 flex items-end rounded-t-lg border border-slate-300 bg-slate-200 px-3 pt-2">
                        <div className="flex max-w-[240px] items-center gap-2 rounded-t-md bg-white px-3 py-1.5 shadow-sm">
                            <Image
                                src={sourceForSize(activeSize)}
                                alt={`${label} favicon`}
                                width={activeSize}
                                height={activeSize}
                                unoptimized
                                className="shrink-0"
                            />
                            <span className="truncate text-xs text-slate-800">{title || label}</span>
                        </div>
                    </div>
                    <div className="rounded-b-lg border border-t-0 border-slate-300 bg-white px-3 py-4 text-xs text-slate-400">
                        Page content area
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-semibold text-slate-900">Size comparison</h3>
                    <div className="mt-2 flex items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        {PREVIEW_SIZES.map((size) => (
                            <div key={size} className="flex flex-col items-center gap-2">
                                <div className="flex h-16 w-16 items-end justify-center">
                                    <Image
                                        src={sourceForSize(size)}
                                        alt={`${label} favicon at ${size}px`}
                                        width={size}
                                        height={size}
                                        unoptimized
                                    />
                                </div>
                                <span className="text-[11px] text-slate-500">{size}px</span>
                                <span className="text-[10px] text-slate-400 break-all text-center">
                                    {basename(sourceForSize(size))}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
