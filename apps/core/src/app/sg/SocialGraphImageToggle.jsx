'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'

export default function SocialGraphImageToggle({ options = [] }) {
    const safeOptions = useMemo(() => {
        return (Array.isArray(options) ? options : []).filter((item) => {
            const imageUrl = String(item?.imageUrl || '').trim()
            const label = String(item?.label || '').trim()
            return Boolean(imageUrl) && Boolean(label)
        })
    }, [options])

    const [activeId, setActiveId] = useState(safeOptions[0]?.id || '')
    const active = safeOptions.find((item) => item.id === activeId) || safeOptions[0] || null

    if (!active) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                No social image URL is currently available for this domain.
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-slate-200 p-4">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                {safeOptions.map((item) => {
                    const selected = item.id === active.id
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveId(item.id)}
                            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                            aria-pressed={selected}
                        >
                            {item.label}
                        </button>
                    )
                })}
            </div>

            <p className="mt-3 text-xs text-slate-500 break-all">{active.imageUrl}</p>
            <p className="mt-1 text-xs text-slate-500">Preview frame: 600 x 315 (half-size display of social share format)</p>
            <div className="mt-3 mx-auto w-full max-w-[600px] aspect-[1200/630] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <Image
                    src={active.imageUrl}
                    alt={active.alt || `${active.label} preview`}
                    width={1200}
                    height={630}
                    unoptimized
                    className="h-full w-full object-contain"
                />
            </div>
        </div>
    )
}
