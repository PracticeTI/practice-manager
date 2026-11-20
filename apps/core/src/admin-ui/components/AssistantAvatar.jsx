'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
    getCachedAssistantIconUrl,
    getCachedWorkerIconUrl,
    resolveAssistantIconUrl,
    resolveWorkerIconUrl,
} from '@/lib/assistantClient'

/**
 * The domain's own artwork for the AI surfaces.
 *
 * `artwork` picks the file: 'assistant' → `assistant.png` (the face the assistant
 * launcher wears), 'worker' → `worker.png` (the mark worn by the surfaces that group
 * worker-written content). Both are found by convention under `public/allied-health/`,
 * either per domain (`domains/<domain>/`) or shared per practice type (`OT`, `physio`,
 * `speech`), so a domain adopts one by dropping the file in and needs no registry entry.
 *
 * A domain with no artwork falls back to the generic sparkle — unless `sparkleFallback` is
 * false, in which case nothing renders. That is what a caller wants when a generic glyph
 * would say the wrong thing and the surrounding layout already carries the meaning.
 *
 * `iconClassName` sizes the fallback glyph, `imageClassName` the artwork — the
 * logo reads best inset inside the dark chips the assistant is rendered in.
 */
export default function AssistantAvatar({
    domainKey = '',
    artwork = 'assistant',
    sparkleFallback = true,
    iconClassName = 'h-4 w-4',
    imageClassName = 'h-6 w-6',
}) {
    const resolveIconUrl = artwork === 'worker' ? resolveWorkerIconUrl : resolveAssistantIconUrl
    const readCachedIconUrl = artwork === 'worker' ? getCachedWorkerIconUrl : getCachedAssistantIconUrl

    // Already probed this session? Start with the resolved URL so a remount
    // (every admin page renders its own header) does not flash the fallback.
    const [iconUrl, setIconUrl] = useState(() => readCachedIconUrl(domainKey))

    useEffect(() => {
        let cancelled = false

        resolveIconUrl(domainKey).then((url) => {
            if (!cancelled && url) setIconUrl(url)
        })

        return () => {
            cancelled = true
        }
    }, [domainKey, resolveIconUrl])

    if (!iconUrl) {
        return sparkleFallback ? <Sparkles className={iconClassName} aria-hidden="true" /> : null
    }

    // Plain <img>: a small local PNG that has to fit whatever box the caller
    // hands it (`next/image` warns when a class resizes a sized image).
    return <img src={iconUrl} alt="" aria-hidden="true" className={`${imageClassName} object-contain`} />
}
