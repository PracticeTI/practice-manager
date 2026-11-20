import Image from 'next/image'

function resolveDomainAssetPath(src, domain) {
    const normalizedSrc = String(src || '').trim()
    if (!normalizedSrc) return ''
    if (normalizedSrc.startsWith('/') || /^https?:\/\//i.test(normalizedSrc)) return normalizedSrc

    const normalizedDomain = String(domain || '').trim().replace(/^\/+|\/+$/g, '')
    return normalizedDomain ? `/${normalizedDomain}/${normalizedSrc}` : `/${normalizedSrc}`
}

export default function MediaCard({ title, copy, imageSrc = '', imageAlt = '', domain = '' }) {
    const resolvedImageSrc = resolveDomainAssetPath(imageSrc, domain)

    return (
        <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/85 shadow-[0_20px_60px_-56px_rgba(15,23,42,0.5)]">
            {resolvedImageSrc && (
                <div className="absolute inset-y-0 right-4 my-auto h-28 w-28 overflow-hidden rounded-xl bg-slate-100">
                    <Image
                        src={resolvedImageSrc}
                        alt={imageAlt || title}
                        width={112}
                        height={112}
                        className="h-full w-full object-cover"
                    />
                </div>
            )}
            <div className={`p-5 ${resolvedImageSrc ? 'min-h-36 pr-36' : ''}`}>
                <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-700">{copy}</p>
            </div>
        </article>
    )
}