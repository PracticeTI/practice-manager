import Image from 'next/image'
import Link from 'next/link'
import { getPrivateDomainFieldMap } from '@/lib/domainExtension'

// Shared visual frame for the public Allied Health pages (/allied-health and its
// child directories). The treatment deliberately mirrors the operator's homepage
// (see src/app/allied-health/page.jsx) so the directories read as one maintained, authoritative
// resource rather than three unrelated pages:
//
//   * the same dark ".au / ABN" utility bar above the content
//   * the same radial-gradient page wash and max-w-6xl px-6 sm:px-10 lg:px-14 grid
//   * the same Georgia serif display headings and rounded, softly shadowed panels
//
// The directory operator's brand (lockup, contact address, ABN) comes from the private
// overlay's `alliedHealthBrand` descriptor. The open-source distribution declares none of
// it, so these pages render under the host's own brand.

export const SERIF_DISPLAY = { fontFamily: 'Georgia, Times New Roman, serif' }

export const ALLIED_HEALTH_SECTIONS = [
    { href: '/allied-health', label: 'Overview' },
    { href: '/allied-health/providers', label: 'Provider directory' },
    { href: '/allied-health/suppliers', label: 'Equipment suppliers' },
]

const ALLIED_HEALTH_BRAND = Object.values(getPrivateDomainFieldMap('alliedHealthBrand'))[0] || null

export const ALLIED_HEALTH_NAME = ALLIED_HEALTH_BRAND?.siteName || 'Allied health directory'
// Operator details are overlay-supplied; the unbranded build declares none, so
// pages that list them must drop the empty rows rather than print a blank value.
export const ALLIED_HEALTH_OPERATOR = ALLIED_HEALTH_BRAND?.siteName || ''
export const ALLIED_HEALTH_ENQUIRIES_EMAIL = ALLIED_HEALTH_BRAND?.enquiriesEmail || ''
export const ALLIED_HEALTH_ABN = ALLIED_HEALTH_BRAND?.abn || ''
export const ALLIED_HEALTH_ABN_NUMBER = ALLIED_HEALTH_ABN.replace(/^ABN\s*/i, '')
export const ALLIED_HEALTH_LOGO = ALLIED_HEALTH_BRAND?.logo || ''
export const ALLIED_HEALTH_HOME_HREF = ALLIED_HEALTH_BRAND?.homeHref || '/'

export const PAGE_WASH =
    'bg-[radial-gradient(circle_at_18%_12%,#dbeafe_0%,#eef2ff_34%,#f8fafc_64%,#ffffff_100%)]'
export const PANEL_SHADOW = 'shadow-[0_24px_80px_-52px_rgba(15,23,42,0.35)]'
export const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2'

/** Dark utility strip; identical copy and metrics to the homepage. */
export function AlliedHealthUtilityBar() {
    return (
        <aside className="w-full border-b border-slate-800 bg-slate-950 text-slate-100" aria-label="Australian business information">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-2 text-[11px] leading-4 sm:px-10 sm:text-xs lg:px-14">
                <p>.au is the new home for trusted Australian businesses</p>
                <p className="text-slate-300">{ALLIED_HEALTH_ABN} registered 2001</p>
            </div>
        </aside>
    )
}

/** Brand lockup plus the section switcher. */
export function AlliedHealthBrandBar({ currentPath = '' }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-slate-200 pb-5 pt-7">
            <Link
                href={ALLIED_HEALTH_HOME_HREF}
                className={`flex items-center gap-3 rounded-lg ${FOCUS_RING}`}
                aria-label={`${ALLIED_HEALTH_NAME} home`}
            >
                {ALLIED_HEALTH_LOGO && (
                    <Image src={ALLIED_HEALTH_LOGO} alt={ALLIED_HEALTH_NAME} width={180} height={48} className="h-9 w-auto" />
                )}
                <span className="hidden h-9 w-px bg-slate-200 sm:block" aria-hidden="true" />
                <span className="hidden text-xs font-semibold uppercase leading-4 tracking-[0.18em] text-slate-500 sm:block">
                    Allied health
                    <br />
                    directory
                </span>
            </Link>

            <nav aria-label="Allied health sections" className="flex flex-wrap items-center gap-1.5 text-sm">
                {ALLIED_HEALTH_SECTIONS.map((section) => {
                    const isCurrent = section.href === currentPath
                    return (
                        <Link
                            key={section.href}
                            href={section.href}
                            aria-current={isCurrent ? 'page' : undefined}
                            className={`rounded-full px-3.5 py-1.5 font-medium transition ${FOCUS_RING} ${isCurrent
                                    ? 'bg-slate-950 text-white'
                                    : 'border border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:text-slate-950'
                                }`}
                        >
                            {section.label}
                        </Link>
                    )
                })}
            </nav>
        </div>
    )
}

function Breadcrumbs({ trail = [] }) {
    if (trail.length === 0) return null

    return (
        <nav aria-label="Breadcrumb" className="mt-6 text-xs font-medium text-slate-500">
            <ol className="flex flex-wrap items-center gap-2">
                {trail.map((crumb, index) => {
                    const isLast = index === trail.length - 1
                    return (
                        <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                            {crumb.href && !isLast ? (
                                <Link href={crumb.href} className={`rounded underline-offset-4 hover:text-slate-900 hover:underline ${FOCUS_RING}`}>
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className={isLast ? 'text-slate-700' : undefined} aria-current={isLast ? 'page' : undefined}>
                                    {crumb.label}
                                </span>
                            )}
                            {!isLast && (
                                <span aria-hidden="true" className="text-slate-300">
                                    /
                                </span>
                            )}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

/** Key-facts panel shown alongside the page title, in the government-briefing style. */
export function AlliedHealthFactsPanel({ heading = 'Resource details', items = [], note = '' }) {
    if (items.length === 0 && !note) return null

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80">
            <p className="border-b border-slate-200 bg-white/70 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                {heading}
            </p>
            <dl className="divide-y divide-slate-200">
                {items.map((item) => (
                    <div key={item.label} className="flex gap-4 px-5 py-3">
                        <dt className="w-28 shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</dt>
                        <dd className="text-sm font-medium text-slate-800">{item.value}</dd>
                    </div>
                ))}
            </dl>
            {note ? <p className="border-t border-slate-200 bg-white/70 px-5 py-3 text-xs leading-5 text-slate-500">{note}</p> : null}
        </div>
    )
}

/** Grey section label + serif heading used by every content block below the hero. */
export function AlliedHealthSectionHeading({ eyebrow, title, summary = '', id }) {
    return (
        <div className="max-w-3xl">
            {eyebrow ? (
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">{eyebrow}</p>
            ) : null}
            <h2 id={id} className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl" style={SERIF_DISPLAY}>
                {title}
            </h2>
            {summary ? <p className="mt-4 text-base leading-8 text-slate-600">{summary}</p> : null}
        </div>
    )
}

/** Breadcrumbs + the hero title panel. Shared by the hub page and both directories. */
export function AlliedHealthPageHero({ eyebrow = '', title, summary = '', trail = [], facts = null, factsNote = '', action = null }) {
    return (
        <>
            <Breadcrumbs trail={trail} />

            <header className={`mt-5 rounded-[2rem] border border-slate-200/80 bg-white/85 p-6 backdrop-blur-sm sm:p-9 ${PANEL_SHADOW}`}>
                <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
                    <div>
                        {eyebrow ? (
                            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">{eyebrow}</p>
                        ) : null}
                        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-[2.75rem]" style={SERIF_DISPLAY}>
                            {title}
                        </h1>
                        {summary ? <p className="mt-5 max-w-2xl text-base leading-8 text-slate-700">{summary}</p> : null}
                        {action ? <div className="mt-7">{action}</div> : null}
                    </div>
                    <AlliedHealthFactsPanel items={facts || []} note={factsNote} />
                </div>
            </header>
        </>
    )
}

/**
 * Full public frame: utility bar, page wash, brand bar and hero, wrapping the
 * hub page content. Child directory pages compose the exported pieces instead so
 * their result grids keep their own wider, admin-safe layouts.
 */
export default function AlliedHealthPageShell({
    currentPath = '',
    eyebrow = '',
    title,
    summary = '',
    trail = [],
    facts = null,
    factsNote = '',
    action = null,
    children,
}) {
    return (
        <>
            <AlliedHealthUtilityBar />
            <main className={`min-h-screen ${PAGE_WASH} text-slate-900`}>
                <div className="mx-auto w-full max-w-6xl px-6 pb-20 sm:px-10 lg:px-14">
                    <AlliedHealthBrandBar currentPath={currentPath} />
                    <AlliedHealthPageHero
                        eyebrow={eyebrow}
                        title={title}
                        summary={summary}
                        trail={trail}
                        facts={facts}
                        factsNote={factsNote}
                        action={action}
                    />
                    {children}
                </div>
            </main>
        </>
    )
}
