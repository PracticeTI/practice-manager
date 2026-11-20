'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Wraps children in a container that plays a fade-up CSS animation when the
 * element enters the viewport.  Uses a CSS @keyframes animation (not a CSS
 * transition) so the effect plays reliably even for elements that are in the
 * viewport on first load — CSS animations are self-contained keyframe sequences
 * that don't depend on the browser having separately painted a previous state.
 *
 * When `enabled` is false it renders children with no wrapper or animation.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.enabled=true]
 * @param {string}  [props.className]
 * @param {number}  [props.delay=0]        Animation delay in milliseconds.
 * @param {number}  [props.threshold=0.08] IntersectionObserver threshold.
 */
export default function ScrollReveal({ children, enabled = true, className = '', delay = 0, threshold = 0.08 }) {
    const ref = useRef(null)
    const [revealed, setRevealed] = useState(false)

    useEffect(() => {
        if (!enabled) return

        const el = ref.current
        if (!el) return

        if (!('IntersectionObserver' in window)) {
            const timeoutId = window.setTimeout(() => {
                setRevealed(true)
            }, 0)
            return () => window.clearTimeout(timeoutId)
            return
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setRevealed(true)
                    observer.disconnect()
                }
            },
            { threshold }
        )

        observer.observe(el)
        return () => observer.disconnect()
    }, [enabled, threshold])

    if (!enabled) return <>{children}</>

    return (
        <div
            ref={ref}
            className={`${revealed ? 'scroll-reveal-animate' : 'scroll-reveal-hidden'} ${className}`}
            style={revealed && delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
        >
            {children}
        </div>
    )
}

