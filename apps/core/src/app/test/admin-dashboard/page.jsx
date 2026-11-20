import Image from 'next/image'
import {
    Accessibility,
    BarChart3,
    Bell,
    BookOpen,
    Brain,
    Briefcase,
    Calendar,
    Check,
    ClipboardList,
    Contact,
    CreditCard,
    FileText,
    ListTodo,
    Mail,
    PackageSearch,
    Search,
    Sparkles,
    Stethoscope,
    User,
    UsersRound,
    Wrench,
} from 'lucide-react'
import { TOOL_CARD_ACCENTS } from '@/admin-ui/components/toolCardTheme'
import { PATIENT_DOCUMENT_TYPE_ACCENTS, PATIENT_DOCUMENT_TYPE_ICONS } from '@/admin-ui/components/patientDocumentTheme'
import { TASK_KIND_ACCENTS, TASK_KIND_ICONS } from '@/admin-ui/components/taskKindTheme'
import { TOOLS_DASHBOARD_SHORTCUTS } from '@/lib/adminToolsCards'
import { DEFAULT_DOMAIN_MODE } from '@/lib/domainMode'
import {
    buildDomainTemplateColorStyles,
    getContrastingTextColor,
    getDomainTemplateColors,
} from '@/lib/domainPageStyles'

export const metadata = {
    title: 'Admin Dashboard Sample',
    description: 'Static sample of the admin dashboard, populated with obviously fake data for documentation screenshots.',
    robots: {
        index: false,
        follow: false,
    },
}

/**
 * Deliberately fake dashboard content for documentation screenshots.
 *
 * The page follows the /admin dashboard's default card layout
 * (`DEFAULT_ADMIN_DASHBOARD_CARD_ORDER`), with Appointments promoted into the
 * featured row so its upcoming bookings are visible: the first three cards are
 * the wide "featured" row, the next five are the "compact" row, and the rest
 * are the mini tiles. It loads no API data and needs no session, so it can be
 * opened from the public /test surface and captured for docs/.
 */

const FUNDER_BADGES = {
    NDIS: 'border-[#6a2875] bg-[#6a2875] text-white',
    TAC: 'border-black bg-black text-white',
}

const SAMPLE_TASKS = [
    { key: 'task-1', kind: 'quotes', title: '3 quotes need review', patient: 'Test Patient Alpha' },
    { key: 'task-2', kind: 'report', title: 'Report ready to review', patient: 'Test Patient Bravo' },
    { key: 'task-3', kind: 'equipment', title: 'Equipment quote', patient: 'Test Patient Charlie' },
]

const SAMPLE_PATIENTS = [
    { name: 'Test Patient Alpha', updated: 'Updated 2h ago', funder: 'NDIS' },
    { name: 'Test Patient Bravo', updated: 'Updated 5h ago', funder: 'TAC' },
    { name: 'Test Patient Charlie', updated: 'Updated yesterday', funder: 'NDIS' },
]

const SAMPLE_DOCUMENTS = [
    { key: 'quotes:1', type: 'quotes', label: 'Quote', patient: 'Test Patient Alpha' },
    { key: 'agreements:1', type: 'agreements', label: 'Service agreement', patient: 'Test Patient Bravo' },
]

const SAMPLE_MESSAGES = [
    { from: 'Sample Supplier Co', subject: 'Quote attached', received: '2h ago', kind: 'quote' },
    { from: 'Sample Prospect', subject: 'Contact form', received: '1d ago', kind: 'contactForm' },
]

// Message kinds share the row glyph so the two inbox sources read apart at a glance:
// a document for a quote, a clipboard for a website contact-form submission.
const MESSAGE_KIND_BADGES = {
    quote: { icon: FileText, className: 'bg-sky-100 text-sky-700' },
    contactForm: { icon: ClipboardList, className: 'bg-violet-100 text-violet-700' },
}

const SAMPLE_APPOINTMENTS = [
    { key: 'appt-1', title: 'Initial assessment', patient: 'Test Patient Bravo', time: '9:30 AM', color: '#007AFF' },
    { key: 'appt-2', title: 'OT session', patient: 'Test Patient Alpha', time: '2:00 PM', color: '#34C759' },
    { key: 'appt-3', title: 'Equipment review', patient: 'Test Patient Charlie', time: '4:30 PM', color: '#FF9500' },
]

const SAMPLE_USAGE = {
    spent: '$8.42',
    caption: 'AI and API spend this month',
    budgetLabel: '$10.00 budget · 84% used',
    barClassName: 'w-[84%] bg-emerald-500',
}

const SAMPLE_SOURCING = [
    { name: 'Sample shower chair', summary: 'Waiting on quote • 2h ago' },
    { name: 'Sample transfer bench', summary: 'Quote received • 1d ago' },
]

// The mini tiles, with Billing leading the row.
const MINI_CARDS = [
    { key: 'billing', title: 'Billing', icon: CreditCard },
    { key: 'contacts', title: 'Contacts', icon: Contact },
    { key: 'cases', title: 'Cases', icon: Briefcase },
    { key: 'providers', title: 'Providers', icon: Stethoscope },
    { key: 'equipment', title: 'Suppliers', icon: Accessibility },
    { key: 'forms', title: 'Forms', icon: ClipboardList },
    { key: 'assistant', title: 'Assistant', icon: Brain },
    { key: 'reports', title: 'Reports', icon: FileText },
]

// Deep navy (#00216b) and bright cyan (#04bdfd) are the two colours in the
// Practice Manager lockup, so the page wash and its published colour variables
// use them rather than the generic default-domain blue.
const SAMPLE_TEMPLATE_COLORS = {
    color1: '#04bdfd',
    color2: '#00216b',
    color3: '#dff4ff',
    backgroundColor: '#f4fafe',
    infoColor: '#04bdfd',
}

const SAMPLE_BACKGROUND_IMAGE = [
    'radial-gradient(circle at 4% -8%, rgba(4, 189, 253, 0.22), transparent 44%)',
    'radial-gradient(circle at 96% -4%, rgba(0, 33, 107, 0.18), transparent 42%)',
    'linear-gradient(180deg, #eefaff 0%, #f7fcff 52%, #f4fafe 100%)',
].join(', ')

const FEATURED_CARD_CLASSES = 'relative flex min-h-[260px] flex-col rounded-xl border border-slate-200/90 bg-white p-6 text-left ring-1 ring-slate-100 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset] transition-all duration-200 lg:col-span-2'
const COMPACT_CARD_CLASSES = 'relative flex h-[220px] flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 text-left ring-1 ring-slate-100 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset]'
const MINI_CARD_CLASSES = 'relative flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-4 text-center ring-1 ring-slate-100 sm:min-h-[96px] lg:aspect-[4/3] lg:min-h-0 lg:gap-1.5 lg:px-3 lg:py-3'

function ChevronButton() {
    return (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
    )
}

function FundBadge({ label }) {
    if (!label) return null

    return (
        <span className="ml-auto flex w-12 shrink-0 justify-center">
            <span className={`inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase ${FUNDER_BADGES[label]}`}>
                {label}
            </span>
        </span>
    )
}

function CardHeading({ icon: Icon, title, description, variant }) {
    const isFeatured = variant === 'featured'

    return (
        <div className="flex items-start justify-between gap-3">
            <div>
                <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-gray-900">
                    {Icon && <Icon className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />}
                    <span>{title}</span>
                </h3>
                {isFeatured && <p className="mt-2 text-sm text-gray-600">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <span className={isFeatured
                    ? 'inline-flex items-center justify-center text-xs font-medium text-gray-600'
                    : 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600'
                }>
                    {isFeatured && <span>Open</span>}
                    <ChevronButton />
                </span>
            </div>
        </div>
    )
}

function RecentLabel({ children }) {
    return <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</p>
}

function StandardRow({ primary, secondary, funder, icon: Icon, iconClassName }) {
    return (
        <div className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <span className="flex min-w-0 items-center gap-2">
                {Icon && (
                    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${iconClassName || 'bg-gray-100 text-gray-600'}`}>
                        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    </span>
                )}
                <span className="min-w-0 flex-1 font-medium text-gray-900">{primary}</span>
                <FundBadge label={funder} />
            </span>
            {secondary && <span className="mt-1 block text-xs text-gray-500">{secondary}</span>}
        </div>
    )
}

function DenseRow({ primary, secondary, icon: Icon, iconClassName, dismissible = false }) {
    return (
        <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-gray-200 px-2.5 py-2 text-gray-700">
                {Icon && (
                    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${iconClassName || 'bg-gray-100 text-gray-600'}`}>
                        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4 text-gray-900">{primary}</span>
                {secondary && <span className="max-w-[45%] shrink-0 truncate text-[11px] leading-4 text-gray-500">{secondary}</span>}
            </div>
            {dismissible && (
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
            )}
        </div>
    )
}

function DocumentTile({ typeKey, label, patient }) {
    const type = PATIENT_DOCUMENT_TYPE_ACCENTS[typeKey]
    const DocIcon = PATIENT_DOCUMENT_TYPE_ICONS[typeKey]

    return (
        <div
            title={`${patient} — ${label}`}
            className="flex aspect-[5/7] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.6)]"
        >
            <span className={`flex h-8 shrink-0 items-center justify-center ${type?.band || 'bg-slate-600'}`}>
                {DocIcon && <DocIcon className="h-4 w-4 text-white" strokeWidth={2} aria-hidden="true" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                <span className="line-clamp-2 text-xs font-semibold leading-tight text-gray-900">{patient}</span>
                <span className={`mt-auto line-clamp-2 break-words text-[10px] font-semibold uppercase leading-tight tracking-wide ${type?.label || 'text-gray-500'}`}>
                    {label}
                </span>
            </span>
        </div>
    )
}

function FeaturedCard({ icon, title, description, label, children }) {
    return (
        <div className={FEATURED_CARD_CLASSES}>
            <CardHeading icon={icon} title={title} description={description} variant="featured" />
            <div className="mt-4 flex-1">
                <RecentLabel>{label}</RecentLabel>
                <div className="mt-2 space-y-2">{children}</div>
            </div>
        </div>
    )
}

function CompactCard({ icon, title, label, children, columns = false }) {
    return (
        <div className={COMPACT_CARD_CLASSES}>
            <CardHeading icon={icon} title={title} variant="compact" />
            <div className="mt-3 flex-1">
                <RecentLabel>{label}</RecentLabel>
                <div className={columns ? 'mt-2 grid grid-cols-2 content-start gap-2' : 'mt-2 space-y-2'}>{children}</div>
            </div>
        </div>
    )
}

function MiniCard({ icon: Icon, title }) {
    return (
        <div className={MINI_CARD_CLASSES}>
            <span className="absolute right-3 top-3 flex items-center">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500">
                    <ChevronButton />
                </span>
            </span>
            <div className="relative flex w-full flex-col items-center justify-center gap-2 text-center">
                {Icon && <Icon className="h-6 w-6 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />}
                <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-gray-900">{title}</h3>
            </div>
        </div>
    )
}

/**
 * Appointments in the wide featured slot. The rows keep the iOS "Upcoming"
 * widget treatment — colour bars, secondary greys and tabular times — while the
 * card itself carries the dashboard's featured chrome and the plain calendar
 * icon in its heading.
 */
function AppointmentsCard() {
    return (
        <div className={FEATURED_CARD_CLASSES}>
            <CardHeading
                icon={Calendar}
                title="Appointments"
                description="Review and import appointments from the practice management system."
                variant="featured"
            />

            <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <RecentLabel>UPCOMING</RecentLabel>
                <div className="mt-2 flex min-h-0 flex-1 flex-col">
                    {SAMPLE_APPOINTMENTS.map((event, index) => (
                        <div
                            key={event.key}
                            className={`flex min-h-0 flex-1 items-center gap-3 ${index > 0 ? 'border-t border-[#e5e5ea]' : ''}`}
                        >
                            <span
                                className="h-7 w-[3px] shrink-0 rounded-full"
                                style={{ backgroundColor: event.color }}
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold leading-tight tracking-tight text-gray-900">
                                    {event.title}
                                </span>
                                <span className="block truncate text-xs leading-tight text-[#8e8e93]">{event.patient}</span>
                            </span>
                            <span className="shrink-0 text-xs font-medium tabular-nums text-[#8e8e93]">{event.time}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default function AdminDashboardSamplePage() {
    // The Practice Manager lockup runs deep navy into cyan, so the sample's page
    // wash (and the colour variables it publishes) uses that pair rather than the
    // generic default blue the domain template starts from.
    const templateColors = getDomainTemplateColors({ colors: SAMPLE_TEMPLATE_COLORS }, DEFAULT_DOMAIN_MODE)
    const domainColorStyles = {
        ...buildDomainTemplateColorStyles(templateColors),
        '--domain-color-1-contrast': getContrastingTextColor(templateColors.color1),
    }

    return (
        <div className="relative min-h-screen overflow-x-clip" style={domainColorStyles}>
            {/* Keeps the dev-server route indicator out of documentation screenshots;
                there is no portal element in a production build. */}
            <style>{'nextjs-portal { display: none !important; }'}</style>
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 z-0"
                style={{
                    backgroundColor: templateColors.backgroundColor,
                    backgroundImage: SAMPLE_BACKGROUND_IMAGE,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100vw 100vh',
                }}
            />
            <div className="relative z-10">
                <header className="border-b border-gray-200 bg-white shadow-sm">
                    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
                        <div className="flex min-w-0 items-center gap-8">
                            <Image
                                src="/branding/practice-manager-logo.png"
                                alt="Practice Manager"
                                width={2025}
                                height={554}
                                className="h-10 w-auto"
                                style={{ width: 'auto' }}
                                priority
                            />
                        </div>

                        <div className="flex justify-center">
                            <div className="relative hidden sm:block">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                                <span
                                    aria-label="Search practice"
                                    className="block h-[34px] w-40 rounded-lg border border-gray-200/80 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 shadow-md lg:w-64"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-6">
                            <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500">
                                <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                                <span className="absolute right-0 top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-bold leading-none text-white">
                                    2
                                </span>
                            </span>
                            <div className="flex items-center border-l border-gray-200 pl-6">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500">
                                    <User className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                                </span>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
                        <FeaturedCard
                            icon={ListTodo}
                            title="Tasks"
                            description="Suggestions based on practice activity."
                            label="ON YOUR LIST"
                        >
                            {SAMPLE_TASKS.map((task) => {
                                const TaskIcon = TASK_KIND_ICONS[task.kind]

                                return (
                                    <DenseRow
                                        key={task.key}
                                        primary={task.title}
                                        secondary={task.patient}
                                        icon={TaskIcon}
                                        iconClassName={TASK_KIND_ACCENTS[task.kind]}
                                        dismissible
                                    />
                                )
                            })}
                        </FeaturedCard>

                        <FeaturedCard
                            icon={UsersRound}
                            title="Patients"
                            description="Manage patient intake data and notes."
                            label="Recently Updated"
                        >
                            {SAMPLE_PATIENTS.map((patient) => (
                                <StandardRow
                                    key={patient.name}
                                    primary={patient.name}
                                    secondary={patient.updated}
                                    funder={patient.funder}
                                />
                            ))}
                        </FeaturedCard>

                        <AppointmentsCard />
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
                        <CompactCard icon={BookOpen} title="Docs" label="RECENT DOCUMENTS">
                            <div className="grid grid-cols-2 content-start gap-2">
                                {SAMPLE_DOCUMENTS.map((document) => (
                                    <DocumentTile
                                        key={document.key}
                                        typeKey={document.type}
                                        label={document.label}
                                        patient={document.patient}
                                    />
                                ))}
                            </div>
                        </CompactCard>

                        <CompactCard icon={Mail} title="Messages" label="RECENT MESSAGES">
                            {SAMPLE_MESSAGES.map((message) => {
                                const kind = MESSAGE_KIND_BADGES[message.kind]

                                return (
                                    <StandardRow
                                        key={message.subject}
                                        primary={message.from}
                                        secondary={`${message.subject} • ${message.received}`}
                                        icon={kind?.icon}
                                        iconClassName={kind?.className}
                                    />
                                )
                            })}
                        </CompactCard>

                        <CompactCard icon={Wrench} title="Tools" label="SHORTCUTS" columns>
                            {TOOLS_DASHBOARD_SHORTCUTS.map((shortcut) => {
                                const accent = TOOL_CARD_ACCENTS[shortcut.key]

                                return (
                                    <div
                                        key={shortcut.key}
                                        className={`block truncate rounded-md border border-gray-200 bg-gradient-to-r px-2 py-2 text-sm font-medium text-gray-900 ${accent.band} to-white`}
                                    >
                                        {shortcut.primary}
                                    </div>
                                )
                            })}
                        </CompactCard>

                        <CompactCard icon={PackageSearch} title="Sourcing" label="IN PROGRESS">
                            {SAMPLE_SOURCING.map((item) => (
                                <StandardRow
                                    key={item.name}
                                    primary={item.name}
                                    secondary={item.summary}
                                />
                            ))}
                        </CompactCard>

                        <CompactCard icon={BarChart3} title="Usage" label="THIS MONTH">
                            <div className="rounded-md border border-gray-200 px-3 py-2">
                                <span className="block text-2xl font-bold tracking-tight text-gray-900">{SAMPLE_USAGE.spent}</span>
                                <span className="mt-0.5 block text-xs text-gray-500">{SAMPLE_USAGE.caption}</span>
                            </div>
                            <div className="rounded-md border border-gray-200 px-3 py-2">
                                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    {SAMPLE_USAGE.budgetLabel}
                                </span>
                                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                                    <span className={`block h-1.5 rounded-full ${SAMPLE_USAGE.barClassName}`} />
                                </span>
                            </div>
                        </CompactCard>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-9">
                        {MINI_CARDS.map((card) => (
                            <MiniCard key={card.key} icon={card.icon} title={card.title} />
                        ))}
                    </div>
                </main>
            </div>

            {/* The Admin header's floating Assistant launcher: a light cyan gradient
                disc carrying the Practice Manager navy sparkle. The gradient keeps the
                control light against the pale page wash while the navy glyph gives it
                far more definition than white-on-cyan did. */}
            <button
                type="button"
                title="Assistant"
                aria-label="Open AI Assistant"
                className="fixed bottom-5 right-5 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-white via-[#dff4ff] to-[#a9e4ff] text-[#00216b] shadow-[0_6px_18px_-6px_rgba(0,33,107,0.45)] ring-1 ring-[#00216b]/12 transition-all hover:scale-105 hover:via-[#d2efff] hover:to-[#93ddff] hover:shadow-[0_10px_22px_-6px_rgba(0,33,107,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00216b] focus-visible:ring-offset-2"
            >
                <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
        </div>
    )
}
