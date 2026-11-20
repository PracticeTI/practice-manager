'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import PageContentArticle from '@/components/PageContentArticle'
import { getDomainPageStyles } from '@/lib/domainPageStyles'
import { getModePathPrefix, prefixPathWithDomainMode } from '@/lib/domainMode'

const CLOSE_ANIMATION_MS = 140
const HOMEPAGE_RETURN_TRANSITION_KEY = 'practice-home-return-transition'

export default function SlugPageReader({
    mode,
    label,
    categoryLabel,
    pageTitle,
    summaryParagraphs,
    bodyParagraphs,
    blocks = [],
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [isClosing, setIsClosing] = useState(false)
    const closeTimerRef = useRef(null)
    const pageStyles = getDomainPageStyles(mode)
    const modePathPrefix = getModePathPrefix(pathname, mode)
    const homeHref = prefixPathWithDomainMode('/', modePathPrefix)

    useEffect(() => {
        router.prefetch(homeHref)

        return () => {
            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current)
            }
        }
    }, [homeHref, router])

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            if (isClosing) return

            setIsClosing(true)
            window.sessionStorage.setItem(HOMEPAGE_RETURN_TRANSITION_KEY, '1')
            closeTimerRef.current = window.setTimeout(() => {
                router.push(homeHref)
            }, CLOSE_ANIMATION_MS)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [homeHref, isClosing, router])

    const handleBack = () => {
        if (isClosing) return

        setIsClosing(true)
        window.sessionStorage.setItem(HOMEPAGE_RETURN_TRANSITION_KEY, '1')
        closeTimerRef.current = window.setTimeout(() => {
            router.push(homeHref)
        }, CLOSE_ANIMATION_MS)
    }

    return (
        <div className={`${pageStyles.layout.page} ${pageStyles.detail.readerFrame} ${isClosing ? 'closed' : 'open'}`}>
            <main className={pageStyles.detail.container}>
                <div className={pageStyles.detail.readerHeader}>
                    <button
                        type="button"
                        onClick={handleBack}
                        className={pageStyles.detail.backButton}
                        aria-label={`Back to ${label}`}
                        title={`Back to ${label}`}
                        disabled={isClosing}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <p className={pageStyles.detail.categoryBadge}>
                        {categoryLabel}
                    </p>
                    <div className="w-8" aria-hidden="true" />
                </div>

                <div className={pageStyles.detail.content}>
                    <PageContentArticle
                        pageTitle={pageTitle}
                        summaryParagraphs={summaryParagraphs}
                        bodyParagraphs={bodyParagraphs}
                        blocks={blocks}
                        pageStyles={pageStyles}
                        pathPrefix={modePathPrefix}
                    />
                </div>
            </main>
        </div>
    )
}