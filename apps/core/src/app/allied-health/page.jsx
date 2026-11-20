import Link from 'next/link'
import { buildAlliedHealthDirectoryMetadata } from '@/lib/alliedHealthMetadata'
import AlliedHealthPageShell, {
    ALLIED_HEALTH_ABN_NUMBER,
    ALLIED_HEALTH_ENQUIRIES_EMAIL,
    ALLIED_HEALTH_HOME_HREF,
    ALLIED_HEALTH_OPERATOR,
    AlliedHealthFactsPanel,
    AlliedHealthSectionHeading,
    FOCUS_RING,
    PANEL_SHADOW,
    SERIF_DISPLAY,
} from '@/components/AlliedHealthShell'

// Operator facts arrive from the private overlay; the unbranded build declares
// none, so drop blank rows instead of rendering an empty value.
function presentFacts(items) {
    return items.filter((item) => String(item.value || '').trim())
}

const directoryCards = [
    {
        title: 'Provider directory',
        eyebrow: 'Find clinicians',
        description:
            'Browse allied health professionals by specialty, service type, funding pathway, and location across Australia.',
        href: '/allied-health/providers',
        stat: '400+ profiles',
        action: 'Open provider directory',
        highlights: [
            'Filter by profession, service type and funding',
            'Compare service areas, wait times and care settings',
            'Save listings for your practice or referral team',
        ],
    },
    {
        title: 'Equipment supplier directory',
        eyebrow: 'Source essentials',
        description:
            'Compare suppliers for mobility, therapy, and assistive equipment with filters for delivery, funding, and product type.',
        href: '/allied-health/suppliers',
        stat: '200+ suppliers',
        action: 'Open supplier directory',
        highlights: [
            'Search mobility, therapy and assistive equipment',
            'Filter by product type, funding and delivery options',
            'Review catalogues and supplier service areas',
        ],
    },
    {
        title: 'Connected care platform',
        eyebrow: 'Operations suite',
        description:
            'A configurable practice and service platform built for intake, referrals, documentation, reporting, and team coordination.',
        href: ALLIED_HEALTH_HOME_HREF,
        stat: 'Integrated workflow',
        action: 'Review the platform',
        highlights: [
            'Client intake, referrals and service coordination',
            'Notes, reporting and care plan workflows',
            'Operational dashboards for service teams',
        ],
    },
]

const platformFeatures = [
    'Client intake and referrals',
    'Provider and service coordination',
    'Notes, reporting and care plans',
    'Operational dashboards and workflows',
]

const resourceNotes = [
    {
        title: 'How listings are compiled',
        body:
            'Directory entries are compiled from publicly published provider and supplier information. Each entry is reviewed before it is published, and entries are updated as new information becomes available.',
    },
    {
        title: 'Report an error or suggest a listing',
        body:
            'If a listing is out of date, or a service you know of is missing, contact the directory team with the directory name, the listing, and the correction required.',
        action: ALLIED_HEALTH_ENQUIRIES_EMAIL
            ? { label: ALLIED_HEALTH_ENQUIRIES_EMAIL, href: `mailto:${ALLIED_HEALTH_ENQUIRIES_EMAIL}` }
            : undefined,
    },
    {
        title: 'Disclaimer',
        body:
            'This directory is a general information resource about Australian services. It does not provide clinical advice or referrals, and inclusion of a provider or supplier is not an endorsement of that business.',
    },
]

export function generateMetadata() {
    return buildAlliedHealthDirectoryMetadata({
        path: '/allied-health',
        title: 'Allied Health Directory & Practice Platform',
        description:
            'Explore allied health providers, equipment suppliers, and a connected care operations platform built for modern service teams.',
    })
}

export default function AlliedHealthLandingPage() {
    return (
        <AlliedHealthPageShell
            currentPath="/allied-health"
            eyebrow="Australian allied health resource"
            title="Find allied health providers and equipment suppliers."
            summary="A maintained Australian directory of allied health providers and equipment suppliers, paired with the connected care platform practices use for intake, documentation, and reporting."
            trail={[{ label: 'Home', href: '/' }, { label: 'Allied health' }]}
            facts={presentFacts([
                { label: 'Coverage', value: 'Australia-wide' },
                { label: 'Directories', value: 'Providers and equipment suppliers' },
                { label: 'Maintained by', value: ALLIED_HEALTH_OPERATOR },
                { label: 'Enquiries', value: ALLIED_HEALTH_ENQUIRIES_EMAIL },
            ])}
            factsNote="Listings are compiled from publicly published provider and supplier information and reviewed before publication."
        >
            <section aria-labelledby="directories-heading" className="mt-14">
                <AlliedHealthSectionHeading
                    id="directories-heading"
                    eyebrow="Directories"
                    title="Choose the directory you need"
                    summary="Each directory is maintained separately so entries stay accurate for the service being listed."
                />

                <div className="mt-8 grid gap-6 lg:grid-cols-3">
                    {directoryCards.map((card) => (
                        <Link
                            key={card.title}
                            href={card.href}
                            className={`group flex flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white transition hover:-translate-y-1 hover:border-slate-300 ${PANEL_SHADOW} ${FOCUS_RING}`}
                        >
                            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-6 py-3">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.eyebrow}</span>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {card.stat}
                                </span>
                            </div>

                            <div className="flex flex-1 flex-col p-6">
                                <h3 className="text-xl font-semibold text-slate-950" style={SERIF_DISPLAY}>
                                    {card.title}
                                </h3>
                                <p className="mt-3 text-sm leading-7 text-slate-600">{card.description}</p>

                                <ul className="mt-5 flex-1 space-y-2 border-t border-slate-100 pt-5">
                                    {card.highlights.map((highlight) => (
                                        <li key={highlight} className="flex gap-3 text-sm leading-6 text-slate-700">
                                            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                            <span>{highlight}</span>
                                        </li>
                                    ))}
                                </ul>

                                <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 text-sm font-semibold text-slate-950">
                                    <span>{card.action}</span>
                                    <span aria-hidden="true" className="transition group-hover:translate-x-0.5">
                                        →
                                    </span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </section>

            <section aria-labelledby="platform-heading" className="mt-14">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-9">
                    <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
                        <div>
                            <AlliedHealthSectionHeading
                                id="platform-heading"
                                eyebrow="Practice platform"
                                title="A single operational layer for modern allied health services."
                                summary="Designed to support the full service journey from initial enquiry to referral, assessment, documentation, and operational reporting. It centralises the work behind each provider, supplier, and care interaction."
                            />

                            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                                {platformFeatures.map((feature, index) => (
                                    <li key={feature} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                                        <span aria-hidden="true" className="mt-0.5 text-xs font-semibold tabular-nums text-slate-400">
                                            {String(index + 1).padStart(2, '0')}
                                        </span>
                                        <span className="text-sm font-medium leading-6 text-slate-700">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <Link
                                href={ALLIED_HEALTH_HOME_HREF}
                                className={`mt-8 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 ${FOCUS_RING}`}
                            >
                                Explore the platform
                                <span aria-hidden="true">→</span>
                            </Link>
                        </div>

                        <div className="overflow-hidden rounded-[1.5rem] border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-6 text-white shadow-[0_24px_80px_-45px_rgba(15,23,42,0.9)]">
                            <div className="mb-5 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Care management</p>
                                    <h3 className="mt-2 text-2xl font-semibold" style={SERIF_DISPLAY}>
                                        Operations overview
                                    </h3>
                                </div>
                                <div className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-medium text-emerald-200">Live</div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                    <div className="mb-4 flex items-center justify-between text-sm text-slate-300">
                                        <span>Intake funnel</span>
                                        <span>72%</span>
                                    </div>
                                    <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                                        <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-sky-400 to-emerald-400" />
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-3">
                                    {[
                                        ['Sessions', '184'],
                                        ['Referrals', '41'],
                                        ['Reports', '23'],
                                    ].map(([label, value]) => (
                                        <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <div className="text-xs uppercase tracking-[0.16em] text-slate-300">{label}</div>
                                            <div className="mt-3 text-2xl font-semibold">{value}</div>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/20 p-4">
                                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                                        Visual placeholder
                                    </div>
                                    <div className="h-28 rounded-xl border border-dashed border-white/15 bg-gradient-to-br from-white/5 via-white/0 to-white/0" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section aria-labelledby="about-heading" className="mt-14">
                <AlliedHealthSectionHeading
                    id="about-heading"
                    eyebrow="About this resource"
                    title="How this directory is maintained"
                />

                <div className="mt-8 grid gap-6 lg:grid-cols-3">
                    {resourceNotes.map((note) => (
                        <div key={note.title} className="flex flex-col rounded-[1.5rem] border border-slate-200 bg-white/85 p-6">
                            <h3 className="text-lg font-semibold text-slate-950">{note.title}</h3>
                            <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">{note.body}</p>
                            {note.action ? (
                                <a
                                    href={note.action.href}
                                    className={`mt-5 inline-flex w-fit items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-500 ${FOCUS_RING}`}
                                >
                                    {note.action.label}
                                </a>
                            ) : null}
                        </div>
                    ))}
                </div>

                <div className="mt-8">
                    <AlliedHealthFactsPanel
                        heading="Contact and governance"
                        items={presentFacts([
                            { label: 'Operator', value: ALLIED_HEALTH_OPERATOR },
                            { label: 'ABN', value: ALLIED_HEALTH_ABN_NUMBER },
                            { label: 'Enquiries', value: ALLIED_HEALTH_ENQUIRIES_EMAIL },
                            { label: 'Coverage', value: 'Australian allied health services' },
                        ])}
                    />
                </div>
            </section>
        </AlliedHealthPageShell>
    )
}
