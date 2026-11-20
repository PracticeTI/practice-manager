'use client'

import { useEffect, useRef, useState } from 'react'

import {
    REPORT_BRANDED_PAGE_MARGIN_PX,
    REPORT_HEADER_LOGO_GAP_PX,
    REPORT_HEADER_LOGO_HEIGHT_PX,
    REPORT_HEADER_RULE_COLOR,
    REPORT_HEADER_RULE_SPACE_PX,
    REPORT_HEADER_RULE_WIDTH_PX,
    REPORT_HEADER_TEXT_COLOR,
    REPORT_HEADER_TEXT_SIZE_PX,
    REPORT_HEADER_TOP_PX,
    REPORT_PAGE_CSS,
    REPORT_PAGE_HEIGHT_PX,
    REPORT_PAGE_MARGIN_PX,
    REPORT_PAGE_SCOPE_CLASS,
    REPORT_PAGE_WIDTH_PX,
} from '@/lib/reportPageMetrics'
import { isNumberedSectionHeading, isReportPageBreakElement } from '@/lib/reportPageBreaks'

export const REPORT_A4_PAGE_WIDTH = REPORT_PAGE_WIDTH_PX
export const REPORT_A4_PAGE_HEIGHT = REPORT_PAGE_HEIGHT_PX
export const REPORT_A4_MARGIN = {
    top: REPORT_PAGE_MARGIN_PX,
    right: REPORT_PAGE_MARGIN_PX,
    bottom: REPORT_PAGE_MARGIN_PX,
    left: REPORT_PAGE_MARGIN_PX,
}

/**
 * The typography the paginator measures.
 *
 * It is a generated stylesheet, not a list of utility classes, because every value is computed:
 * a class name assembled at runtime (`mb-[${...}px]`) is invisible to Tailwind's scanner, so the
 * rule never reaches the page and the element silently keeps the reset. The numbers themselves come
 * from `reportPageMetrics` and are the same ones the DOCX writer puts in `word/styles.xml`.
 */
export const REPORT_TYPOGRAPHY_CLASSES = REPORT_PAGE_SCOPE_CLASS

function applyTypography(element) {
    element.className = REPORT_PAGE_SCOPE_CLASS
    return element
}

function ReportPageStyles() {
    return <style dangerouslySetInnerHTML={{ __html: REPORT_PAGE_CSS }} />
}

function createMeasureContainer(contentWidth) {
    const container = applyTypography(document.createElement('div'))
    container.style.position = 'absolute'
    container.style.visibility = 'hidden'
    container.style.pointerEvents = 'none'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${contentWidth}px`
    container.style.height = 'auto'
    container.style.overflow = 'visible'
    document.body.appendChild(container)
    return container
}

function waitForImages(container) {
    const images = Array.from(container.querySelectorAll('img'))
    if (images.length === 0) return Promise.resolve()

    return Promise.all(images.map((image) => {
        image.loading = 'eager'
        if (image.complete) return Promise.resolve()
        return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
        })
    }))
}

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
    ])
}

function nextFrame() {
    return withTimeout(new Promise((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
    }), 200)
}

function isHeading(node) {
    return node?.nodeType === 1 && /^H[1-6]$/.test(node.tagName)
}

/** A level-two numbered heading is a report section and starts a new page. */
function startsReportSection(node) {
    return node?.nodeType === 1
        && node.tagName === 'H2'
        && isNumberedSectionHeading(node.textContent)
}

/**
 * Turn a continuous HTML document into A4 pages.
 *
 * Blocks are measured inside a real page-width container so margins collapse the
 * same way they do in the final document. A block that would cross a page break
 * moves to the next page; a single block taller than a page is left intact and
 * allowed to grow its page rather than being clipped or split mid-element.
 */
async function paginateHtml(source, contentWidth, contentHeight) {
    const sourceNodes = Array.from(source.childNodes).filter((node) => (
        node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim())
    ))

    const page = createMeasureContainer(contentWidth)
    const pages = []

    const finishPage = () => {
        const html = page.innerHTML.trim()
        if (html) pages.push(html)
        page.innerHTML = ''
    }

    for (const node of sourceNodes) {
        if (isReportPageBreakElement(node)) {
            finishPage()
            continue
        }

        if (startsReportSection(node) && page.children.length > 0) {
            finishPage()
        }

        let clone = node
        if (node.nodeType !== 1) {
            clone = document.createElement('p')
            clone.textContent = node.textContent
        } else {
            clone = node.cloneNode(true)
        }

        page.appendChild(clone)

        if (page.scrollHeight <= contentHeight) {
            continue
        }

        if (page.children.length > 1) {
            page.removeChild(clone)
            finishPage()
            page.appendChild(clone)
            continue
        }

        // A single block taller than a full page. Keep it on its own page and let
        // the sheet grow; clipping would silently lose report content.
        finishPage()
    }

    finishPage()
    page.remove()

    // Avoid a heading stranded at the bottom of a page.
    const pageContainers = pages.map((html) => {
        const container = createMeasureContainer(contentWidth)
        container.innerHTML = html
        return container
    })

    // Both passes below move whole blocks between pages after the pages were measured, so a page can
    // end up taller than the content box - a heading pushed to the next page takes its own height and
    // spacing with it. Settle the layout before returning it: a page that still overflows hands its
    // last block forward, and a page that now ends on a heading hands that heading forward too.
    // Without this an 18-page preview laid out 1,096px of content on a 979px page, so the on-screen
    // page count was lower than the page Word would print.
    for (let pass = 0; pass < 5; pass += 1) {
        let changed = false

        for (let index = 0; index < pageContainers.length - 1; index += 1) {
            const current = pageContainers[index]
            const next = pageContainers[index + 1]
            let last = current.lastElementChild
            while (last && isHeading(last)) {
                next.prepend(last.cloneNode(true))
                current.removeChild(last)
                changed = true
                last = current.lastElementChild
            }
        }

        for (let index = 0; index < pageContainers.length; index += 1) {
            const current = pageContainers[index]
            // A lone oversized block is left on its own page and allowed to grow: clipping it would
            // silently lose report content.
            while (current.scrollHeight > contentHeight && current.children.length > 1) {
                let next = pageContainers[index + 1]
                if (!next) {
                    next = createMeasureContainer(contentWidth)
                    pageContainers.push(next)
                }
                next.prepend(current.lastElementChild)
                changed = true
            }
        }

        if (!changed) break
    }

    const normalizedPages = pageContainers
        .map((container) => {
            const html = container.innerHTML.trim()
            container.remove()
            return html
        })
        .filter(Boolean)

    return normalizedPages
}

function ReportPageHeader({ branding, margin }) {
    const [logoFailed, setLogoFailed] = useState(false)
    const showLogo = Boolean(branding.logoUrl) && !logoFailed
    const text = String(branding.text || '').trim()

    if (!showLogo && !text) return null

    return (
        <div
            className="pointer-events-none absolute flex flex-col items-center"
            style={{
                top: `${REPORT_HEADER_TOP_PX}px`,
                left: `${margin.left}px`,
                right: `${margin.right}px`,
            }}
        >
            {showLogo ? (
                <img
                    src={branding.logoUrl}
                    alt={branding.logoAlt || 'Practice logo'}
                    style={{
                        height: `${REPORT_HEADER_LOGO_HEIGHT_PX}px`,
                        width: 'auto',
                        objectFit: 'contain',
                    }}
                    onError={() => setLogoFailed(true)}
                />
            ) : null}
            {text ? (
                <p
                    style={{
                        margin: 0,
                        marginTop: showLogo ? `${REPORT_HEADER_LOGO_GAP_PX}px` : 0,
                        fontSize: `${REPORT_HEADER_TEXT_SIZE_PX}px`,
                        lineHeight: 1.4,
                        color: `#${REPORT_HEADER_TEXT_COLOR}`,
                    }}
                >
                    {text}
                </p>
            ) : null}
            <div
                style={{
                    width: '100%',
                    marginTop: `${REPORT_HEADER_RULE_SPACE_PX}px`,
                    borderTop: `${REPORT_HEADER_RULE_WIDTH_PX}px solid #${REPORT_HEADER_RULE_COLOR}`,
                }}
            />
        </div>
    )
}

export default function A4PagedReport({
    html = '',
    className = '',
    margin = REPORT_A4_MARGIN,
    pageWidth = REPORT_A4_PAGE_WIDTH,
    pageHeight = REPORT_A4_PAGE_HEIGHT,
    branding = null,
    emptyMessage = 'No report content.',
}) {
    const sourceRef = useRef(null)
    const [pages, setPages] = useState([])
    const [isPaginating, setIsPaginating] = useState(true)

    // A branded header reserves the top of every page, so the body starts at the branded margin
    // instead of the plain one. Without branding the layout is unchanged.
    const activeBranding = branding && (branding.logoUrl || branding.text) ? branding : null
    const brandingKey = activeBranding ? `${activeBranding.logoUrl || ''}|${activeBranding.text || ''}` : ''
    const contentTop = activeBranding ? REPORT_BRANDED_PAGE_MARGIN_PX : margin.top
    const contentWidth = Math.max(1, pageWidth - margin.left - margin.right)
    const contentHeight = Math.max(1, pageHeight - contentTop - margin.bottom)

    useEffect(() => {
        let cancelled = false

        async function paginate() {
            const source = sourceRef.current
            if (!source) return

            setIsPaginating(true)

            source.replaceChildren()
            const content = applyTypography(document.createElement('div'))
            content.style.width = `${contentWidth}px`
            content.innerHTML = String(html || '')

            // The document body may still open with the practice logo lifted from the Word
            // template. When the running header draws that logo, the body copy would repeat it.
            if (brandingKey) {
                content.querySelectorAll('img.template-header-image').forEach((image) => image.remove())
            }

            source.appendChild(content)

            try {
                await withTimeout(document.fonts?.ready, 1500)
                await withTimeout(waitForImages(content), 2500)
                await nextFrame()
            } catch {
                // Font and image timing is best effort; measure with what rendered.
            }

            if (cancelled) return

            let nextPages = []
            try {
                nextPages = await paginateHtml(content, contentWidth, contentHeight)
            } catch (error) {
                console.error('Could not paginate the report', error)
            } finally {
                if (!cancelled) setIsPaginating(false)
            }
            if (cancelled) return
            setPages(nextPages)
        }

        paginate()
        return () => {
            cancelled = true
        }
    }, [html, contentWidth, contentHeight, brandingKey])

    return (
        <>
            <ReportPageStyles />
            <div
                ref={sourceRef}
                aria-hidden="true"
                className="invisible pointer-events-none absolute -left-[10000px] top-0 h-auto overflow-visible"
            />

            <div className={`w-full overflow-x-auto bg-stone-200/70 px-4 py-6 print:overflow-visible print:bg-white print:p-0 ${className}`}>
                {isPaginating && pages.length === 0 ? (
                    <div className="mx-auto flex h-40 max-w-[794px] items-center justify-center rounded-sm bg-white text-sm text-stone-400 shadow-sm">
                        Laying out A4 pages…
                    </div>
                ) : null}

                {!isPaginating && pages.length === 0 ? (
                    <div className="mx-auto flex h-40 max-w-[794px] items-center justify-center rounded-sm bg-white text-sm text-stone-400 shadow-sm">
                        {emptyMessage}
                    </div>
                ) : null}

                <div className="mx-auto flex w-max min-w-full flex-col items-center gap-8">
                    {pages.map((pageHtml, index) => (
                        <article
                            key={`${index}-${pageHtml.length}`}
                            className="relative shrink-0 bg-white shadow-[0_2px_10px_rgba(28,25,23,0.18)] print:break-after-page print:shadow-none"
                            style={{ width: `${pageWidth}px`, minHeight: `${pageHeight}px` }}
                            aria-label={`Page ${index + 1} of ${pages.length}`}
                        >
                            <div
                                className={REPORT_TYPOGRAPHY_CLASSES}
                                style={{
                                    paddingTop: `${contentTop}px`,
                                    paddingRight: `${margin.right}px`,
                                    paddingBottom: `${margin.bottom}px`,
                                    paddingLeft: `${margin.left}px`,
                                }}
                                dangerouslySetInnerHTML={{ __html: pageHtml }}
                            />
                            {activeBranding ? <ReportPageHeader branding={activeBranding} margin={margin} /> : null}
                            <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[11px] tabular-nums text-stone-400">
                                Page {index + 1} of {pages.length}
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </>
    )
}
