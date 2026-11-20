'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const REVEAL_SELECTOR = [
    'main > header',
    'main > section',
    'main > article',
    'main > div > section',
    'main > div > article',
    'section[data-scroll-reveal]',
    'article[data-scroll-reveal]'
].join(', ')

export default function GlobalPageMotion() {
    const pathname = usePathname()

    useEffect(() => {
        const path = String(pathname || '').toLowerCase()
        const isAdminRoute = path.startsWith('/admin') || path.startsWith('/login')

        if (isAdminRoute) {
            document.body.classList.remove('global-page-fade-in')
            return undefined
        }

        document.body.classList.add('global-page-fade-in')

        const markRevealTargets = () => {
            const nodes = document.querySelectorAll(REVEAL_SELECTOR)
            nodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) return
                if (node.closest('[data-no-global-reveal="true"]')) return
                node.classList.add('global-scroll-reveal')
            })
        }

        markRevealTargets()

        if (!('IntersectionObserver' in window)) {
            document.querySelectorAll('.global-scroll-reveal').forEach((node) => {
                node.classList.add('global-scroll-reveal-visible')
            })
            return undefined
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('global-scroll-reveal-visible')
                        observer.unobserve(entry.target)
                    }
                })
            },
            {
                rootMargin: '0px 0px -10% 0px',
                threshold: 0.12,
            }
        )

        const observeTargets = () => {
            document.querySelectorAll('.global-scroll-reveal:not(.global-scroll-reveal-visible)').forEach((node) => {
                observer.observe(node)
            })
        }

        observeTargets()

        const mutationObserver = new MutationObserver(() => {
            markRevealTargets()
            observeTargets()
        })

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        })

        return () => {
            mutationObserver.disconnect()
            observer.disconnect()
            document.body.classList.remove('global-page-fade-in')
            document.querySelectorAll('.global-scroll-reveal').forEach((node) => {
                node.classList.remove('global-scroll-reveal', 'global-scroll-reveal-visible')
            })
        }
    }, [pathname])

    return null
}
