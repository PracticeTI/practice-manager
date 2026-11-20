'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Accessibility, BarChart3, BookOpen, Brain, Briefcase, CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardList, Contact, CreditCard, Files, FileText, GripVertical, ListTodo, Mail, MessageSquare, NotebookPen, PackageSearch, Pencil, RotateCcw, Stethoscope, UsersRound, Wrench, X } from 'lucide-react'
import DatabaseSetupModal from '@/admin-ui/components/DatabaseSetupModal'
import SetupRequiredModal from '@/admin-ui/components/SetupRequiredModal'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { TOOL_CARD_ACCENTS, TOOL_CARD_ICONS } from '@/admin-ui/components/toolCardTheme'
import { PATIENT_DOCUMENT_TYPE_ACCENTS, PATIENT_DOCUMENT_TYPE_ICONS } from '@/admin-ui/components/patientDocumentTheme'
import { TASK_KIND_ACCENTS, TASK_KIND_ICONS } from '@/admin-ui/components/taskKindTheme'
import ContentModal from '@/admin-ui/components/ContentModal'
import { clearAdminSession, getAdminAuthHeaders, getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getAdminDomainMode } from '@/lib/adminActiveDomain'
import {
  getDefaultDomainFeatureFlags,
  getDefaultDomainFeatureSettings,
  normalizeDomainFeatureFlags,
} from '@/lib/domainFeatureFlags'
import { DEFAULT_DISPLAY_POLICY, normalizeDisplayPolicy, shouldShowPracticeContent } from '@/lib/displayPolicy'
import {
  ADMIN_BUILTIN_QUICK_ACTIONS,
  getDefaultAdminQuickActionsConfig,
  normalizeAdminQuickActionsConfig,
} from '@/lib/adminQuickActions'
import { filterRecentContentUpdates } from '@/lib/adminDashboardUtils'
import {
  SYNTHETIC_SIM_TARGET,
  buildSimulationOptions,
  defaultSimulationTarget,
  filterSimulationAdmins,
  isSimulationTargetChosen,
  resolveSimulationUsername,
} from '@/lib/adminSimulationTargets'
import { PROVIDER_HERO_ASPECT_RATIO } from '@/lib/providerHeroPreview'
import {
  DEFAULT_ADMIN_DASHBOARD_CARD_ORDER,
  isSameVisibleCardOrder,
  normalizeAdminDashboardCardOrder,
} from '@/lib/adminDashboardCardOrder'
import { TOOLS_DASHBOARD_SHORTCUTS } from '@/lib/adminToolsCards'
import { getMostRecentReportPerPatient } from '@/lib/reportListUtils'
import { isNdisFcaReportType } from '@/lib/reportTypeSelection'
import { hasPrivateDomainTrait } from '@/lib/domainExtension'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'
import { getAdminRoleLabel } from '@/lib/adminRoles'
import { REPORT_TYPE_ARTWORK_ASPECT_RATIO, resolveReportTypeArtwork } from '@/lib/reportTypeArtwork'
import { normalizePracticeType } from '@/lib/practiceTypes'
import {
  buildCaseMetrics,
  describeCaseSummary,
  selectCaseAttentionItems,
} from '@/lib/patientCaseDisplay'
import { describeAppointmentSummary } from '@/lib/appointmentDisplay'
import { describeFormSummary } from '@/lib/formDisplay'
import { describeNoteSummary } from '@/lib/noteDisplay'
import { contactDisplayName } from '@/lib/contactDisplay'
import {
  PATIENT_DOCUMENT_TYPES,
  PATIENT_DOCUMENT_TYPE_BY_KEY,
  buildPatientDocumentsHref,
  selectRecentDocuments,
} from '@/lib/patientDocumentTypes'
import { buildPatientFilesHref, describeFileOwner, formatFileSize } from '@/lib/fileDisplay'

// The Docs card shows the newest document of each patient document type — up to two
// rows, so one busy type (typically quotes) cannot fill the card. Each type is read with
// a small window rather than its full page list: enough rows to find the newest, without
// pulling the whole document index onto the dashboard. Rows deep-link into the matching
// sub-tab on the Docs page, which the shared registry also describes.
const DOCS_CARD_SOURCE_LIMIT = 20
const DOCS_CARD_ITEM_LIMIT = 2

// A Contacts card row is just a name, so the card previews more of them than the
// other data cards: the large card shows all six, the medium card shows four.
const CONTACTS_CARD_ITEM_LIMIT = 6
const CONTACTS_CARD_COMPACT_ITEM_LIMIT = 4

// The Suppliers card previews two suppliers in the medium card rather than the one
// the other data cards show, so a second recently changed supplier stays in reach
// without opening the directory.
const SUPPLIERS_CARD_COMPACT_ITEM_LIMIT = 2

// The Tasks card previews five rows rather than the three the other data cards
// show, read from the practice-wide queue rather than from a per-patient page.
// The rows render in the dense style (see `denseItemRows`) so the longer preview
// still fits the card height the three-row cards set.
const DASHBOARD_TASK_PREVIEW_LIMIT = 5

// The Files card previews the practice's newest uploads, across patients and
// practice-level files. Four rows matches the other data cards' preview height.
const DASHBOARD_FILES_PREVIEW_LIMIT = 4

// Bumped to v11 with the Reports card agent artwork: a v10 payload has no
// `recentReports[].reportAgent`, so a still-warm cache would keep rendering the
// report preview text instead of the agent's report background.
// Bumped to v10 with the Tasks card's five-row preview: a v9 payload carries only
// three `recentTaskItems`, so a still-warm cache would show a short preview.
// Bumped to v9 with the Tasks card: a v8 payload has no `recentTaskItems` or
// `tasksEnabled`, and the payload only ever sets a card flag to true, so a
// still-warm cache would hide the card.
// Bumped to v8 with the Docs card's recent documents: a v7 payload has no
// `recentDocuments`, so a still-warm cache would render the Docs card empty.
// Bumped to v7 with the Tools card: a v6 payload has no `toolsEnabled`, and the
// payload only ever sets a card flag to true, so a still-warm cache would hide
// the card.
// Bumped to v6 with the Analysis card: a v5 payload has no `analysisCardEnabled`, and the
// payload only ever sets a card flag to true, so a still-warm cache would hide the card.
// Bumped to v5 with the Docs card: a v4 payload has no `docsCardEnabled`, and the
// payload only ever sets a card flag to true, so a still-warm cache would hide the card.
// Bumped to v4 with the Funders, Contacts and Activities cards: a v3 payload has
// no `recentContacts` or `recentAuditActivities`, so a still-warm cache would
// render those two cards empty.
// Bumped to v3 with the Providers card spotlight: a v2 payload has no
// `providerSpotlight`, so a still-warm cache would render the card empty.
// Bumped to v14 with the Files card: a v13 payload has no `recentFiles` or
// `filesEnabled`, and the payload only ever sets a card flag to true, so a
// still-warm cache would hide the card.
// Bumped to v13 with the environment setup prompt: a v12 payload has no
// `databaseConfigured`, so a warm cache would skip the missing-database check.
// Bumped to v12 with the per-admin dashboard layout: the card order is no longer
// a domain-wide setting, so the cache key now includes the admin's username and
// a v11 entry could otherwise show another admin's order.
const ADMIN_DASHBOARD_CACHE_KEY = 'admin_dashboard_cache_v14'
const ADMIN_DASHBOARD_SNAPSHOT_KEY = 'admin_dashboard_snapshot_v1'
const ADMIN_TOOLS_VISIBLE_STORAGE_KEY = 'admin_tools_visible_v1'
const ADMIN_DASHBOARD_CACHE_TTL_MS = 2 * 60 * 1000
// The domain *default* layout lives in the domain's `adminDashboardCardOrder`
// setting and is edited on /domains. The drag-and-drop editor on /admin writes a
// user-level override for the signed-in admin through this endpoint instead.
const ADMIN_DASHBOARD_LAYOUT_ENDPOINT = '/api/admin/dashboard-layout'

// Number of panels the second dashboard row holds at desktop widths
// (`lg:grid-cols-5`). Panels beyond this count land on row 3+ and use the
// smaller mini card style automatically.
const COMPACT_ROW_CAPACITY = 5

// Roughly the height of the mini card's shortcut menu (four destinations plus
// padding). The menu flips above the icon when the card sits too close to the
// bottom of the window to show it below.
const TOOLS_SHORTCUT_MENU_MIN_HEIGHT = 152

const PATIENT_FUNDER_BADGES = {
  NDIS: 'border-[#6a2875] bg-[#6a2875] text-white',
  TAC: 'border-black bg-black text-white',
}

const CASE_ATTENTION_BADGES = {
  danger: 'border-red-600 bg-red-600 text-white',
  warning: 'border-amber-500 bg-amber-500 text-white',
}

function getPatientFundingLabel(patient) {
  const metadata = patient?.metadata && typeof patient.metadata === 'object' ? patient.metadata : {}
  const labelledAnswers = metadata.sploseLabelledAnswers && typeof metadata.sploseLabelledAnswers === 'object'
    ? metadata.sploseLabelledAnswers
    : {}
  const answers = metadata.sploseAnswers && typeof metadata.sploseAnswers === 'object'
    ? metadata.sploseAnswers
    : {}
  const fundingEntry = Object.entries(labelledAnswers).find(([label]) => {
    const normalizedLabel = String(label || '').trim().toLowerCase()
    return normalizedLabel.includes('funding source') || normalizedLabel.includes('funder')
  })
  const fundingName = String(
    fundingEntry?.[1]
    || answers.funding_source_or_referral_type
    || answers.funding_source
    || ''
  ).trim().toUpperCase()

  return fundingName.includes('NDIS') ? 'NDIS' : fundingName.includes('TAC') ? 'TAC' : ''
}

function getPatientFunderBadge(patient) {
  const label = getPatientFundingLabel(patient)
  return label ? { label, className: PATIENT_FUNDER_BADGES[label] } : null
}

// Which AI worker produced the patient's report. The Reports card keys its artwork
// off the report type, and a report row that never recorded one (an imported record, or a
// job queued before the type was written) still has the patient behind it — so the card
// shows that agent's report background instead of falling back to the text tile.
// A saved agent switch is an explicit statement, so it wins; funding only decides which
// worker is on by default, which is how a never-saved record still resolves (`reporting`
// is NDIS-only, see `isAgentActiveForPatient` in src/app/admin/patients/page.jsx).
function getPatientReportAgentKey(patient) {
  const metadata = patient?.metadata && typeof patient.metadata === 'object' ? patient.metadata : {}
  const agents = [metadata.patientAgents, metadata.agents].find((value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  )) || {}

  if (agents.reporting === true) return 'reporting'
  if (agents.hsrCreator === true) return 'hsrCreator'

  const fundingLabel = getPatientFundingLabel(patient)
  if (fundingLabel === 'NDIS') return 'reporting'
  if (fundingLabel === 'TAC') return 'hsrCreator'

  return ''
}

// Fisher-Yates over a copy. The Providers card shows a random sample of provider
// websites per refresh, so the pick order must not depend on the alphabetical
// directory order the API returns.
function shuffleItems(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = current
  }
  return copy
}

/**
 * One provider website capture, used in the large (featured) Providers card.
 *
 * The approved captures are 3:4 mobile screenshots, so the tile keeps that aspect
 * ratio — the same box the provider directory uses — and the provider name rides
 * along the bottom edge as a gradient overlay so the image can stay edge to edge.
 * A capture whose file has since been removed hides the tile instead of leaving a
 * broken frame.
 */
function ProviderSiteTile({ item }) {
  const [failed, setFailed] = useState(false)
  if (failed || !item.heroUrl) return null
  return (
    <a
      href={item.href}
      title={item.name}
      className="group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
      style={{ aspectRatio: PROVIDER_HERO_ASPECT_RATIO }}
    >
      <Image
        src={item.heroUrl}
        alt={`Website preview of ${item.name}`}
        fill
        sizes="(min-width: 1024px) 9vw, 40vw"
        className="object-cover object-top"
        onError={() => setFailed(true)}
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent px-3 pb-2.5 pt-8">
        <span className="block truncate text-xs font-semibold text-white">{item.name}</span>
        {item.geography ? (
          <span className="block truncate text-[11px] text-white/75">{item.geography}</span>
        ) : null}
      </span>
    </a>
  )
}

/**
 * One provider website capture with its details beside it, used in the medium
 * (compact) Providers card. Everything the card has to say sits in the column to the
 * right of the capture, because the compact card is only ~220px tall and an overlay
 * would cover most of it.
 *
 * The tile is deliberately the same size as a compact Docs card page: half the card
 * content width less half the 8px grid gap, at that tile's 5:7 portrait ratio, so the
 * two cards show equally sized previews. It also borrows the Docs tile's lifted
 * treatment (soft shadow, hover border) instead of sitting flat on the card.
 *
 * That 5:7 frame is taller and narrower than the 3:4 capture, so `object-cover` trims
 * the sides of the screenshot while `object-top` keeps the site header in frame.
 */
function ProviderSiteFeature({ item }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex h-full gap-3">
      <a
        href={item.href}
        title={item.name}
        className="relative block aspect-[5/7] w-[calc(50%-0.25rem)] shrink-0 self-start overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-[0_8px_16px_-12px_rgba(15,23,42,0.6)] transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
      >
        {failed || !item.heroUrl ? (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">No preview</span>
        ) : (
          <Image
            src={item.heroUrl}
            alt={`Website preview of ${item.name}`}
            fill
            sizes="85px"
            className="object-cover object-top"
            onError={() => setFailed(true)}
          />
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col">
        <a href={item.href} className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900 hover:text-slate-950">{item.name}</a>
        {item.geography ? <p className="mt-0.5 truncate text-xs text-gray-500">{item.geography}</p> : null}
        {item.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600">{item.description}</p> : null}
      </div>
    </div>
  )
}

/**
 * One report shown as its report type's artwork — the FCA Builder cover for an NDIS
 * Functional Capacity Assessment, the OTF10 preview for a Home Services Review. The
 * large (featured) and medium (compact) Reports cards use these instead of the text
 * rows, so the card answers "what kind of report is this" at a glance.
 *
 * The patient name rides along the bottom edge as a gradient overlay (the same
 * treatment as the provider captures) so the artwork stays edge to edge, with the
 * report type name on the line beneath it. A report type with no artwork, or an
 * artwork file that has since been removed, falls back to the old text tile rather
 * than leaving a broken frame.
 */
function ReportTypeTile({ item }) {
  const [failed, setFailed] = useState(false)

  if (!item.artwork || failed) {
    return (
      <a
        href={item.href}
        className="block rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 font-medium text-gray-900">{item.primary}</span>
          {item.badge && (
            <span className="ml-auto flex w-12 shrink-0 justify-center">
              <span className={`inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase ${item.badge.className}`}>
                {item.badge.label}
              </span>
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-gray-500 line-clamp-2">{item.secondary}</span>
      </a>
    )
  }

  return (
    <a
      href={item.href}
      title={`${item.primary} — ${item.artwork.label}`}
      className="group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
      style={{ aspectRatio: REPORT_TYPE_ARTWORK_ASPECT_RATIO }}
    >
      <Image
        src={item.artwork.src}
        alt={item.artwork.alt}
        fill
        sizes="(min-width: 1024px) 14vw, 45vw"
        className="object-cover object-top"
        onError={() => setFailed(true)}
      />
      {/* No funder badge on the artwork style: the report type is already legible
          from the cover itself, so the chip would only repeat it. The text
          fallback tile below still carries the badge. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent px-3 pb-2.5 pt-8">
        <span className="block truncate text-xs font-semibold text-white">{item.primary}</span>
        <span className="block truncate text-[11px] text-white/75">{item.artwork.label}</span>
      </span>
    </a>
  )
}

/**
 * One patient document on the Docs card, drawn as a portrait page rather than a text
 * row: a solid band in the document type's colour wearing its glyph, and beneath it the
 * patient name with the document type printed at the foot of the page. The vertical
 * shape is what makes the card read as a couple of documents at a glance instead of two
 * form fields.
 *
 * The type sits in its own coloured label rather than beside the name, because the
 * medium card is only ~220px tall and narrow — stacking them keeps both legible where a
 * single line would truncate the name to a few characters. The label wraps rather than
 * truncating too: the compact tile gives it ~73px, which the longest type name
 * ("Service agreement") needs two lines to fit, and `line-clamp-2` caps it there.
 *
 * `detailed` adds faint rules under the name for the larger card, where there is room
 * for them; they stand in for the page's body text and stop the tall page looking empty.
 */
function DocumentTypeTile({ item, detailed = false }) {
  const DocIcon = item.icon

  return (
    <a
      href={item.href}
      title={`${item.primary} — ${item.secondary}`}
      className="group flex aspect-[5/7] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.6)] transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
    >
      <span className={`flex h-8 shrink-0 items-center justify-center ${item.bandClassName || 'bg-slate-600'}`}>
        {DocIcon && <DocIcon className="h-4 w-4 text-white" strokeWidth={2} aria-hidden="true" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <span className="line-clamp-2 text-xs font-semibold leading-tight text-gray-900">{item.primary}</span>
        {detailed && (
          // Faint rules standing in for the page's body text. Any that do not fit the
          // page are clipped, so the document reads as full whatever width it is given.
          <span className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => (
              <span
                key={line}
                className={`h-0.5 shrink-0 rounded-full bg-slate-200/80 ${line % 5 === 4 ? 'w-2/3' : line % 3 === 2 ? 'w-11/12' : 'w-full'}`}
              />
            ))}
          </span>
        )}
        <span className={`mt-auto line-clamp-2 break-words text-[10px] font-semibold uppercase leading-tight tracking-wide ${item.labelClassName || 'text-gray-500'}`}>
          {item.secondary}
        </span>
      </span>
    </a>
  )
}

function hasConfiguredAiProvider(status) {
  const providers = Array.isArray(status?.providers) ? status.providers : []
  if (providers.length > 0) return providers.some((provider) => provider?.configured === true)
  return status?.configured === true
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showDbSetup, setShowDbSetup] = useState(false)
  const [setupDismissed, setSetupDismissed] = useState(false)
  const [openAiStatus, setOpenAiStatus] = useState(null)
  const [databaseConfigured, setDatabaseConfigured] = useState(null)
  const [aiProviderConfigured, setAiProviderConfigured] = useState(null)
  const [backendOnline, setBackendOnline] = useState(null)
  const [showBackendOfflineWarning, setShowBackendOfflineWarning] = useState(false)
  const [showContentModal, setShowContentModal] = useState(false)
  const [selectedContentItem, setSelectedContentItem] = useState(null)
  const [selectedContentType, setSelectedContentType] = useState(null)
  const [showAiUsageModal, setShowAiUsageModal] = useState(false)
  const [recentActivity, setRecentActivity] = useState([])
  const [recentContentUpdates, setRecentContentUpdates] = useState([])
  const [recentEquipmentUpdates, setRecentEquipmentUpdates] = useState([])
  const [providerSpotlight, setProviderSpotlight] = useState([])
  const [recentPatientUpdates, setRecentPatientUpdates] = useState([])
  const [recentBillingUpdates, setRecentBillingUpdates] = useState([])
  const [recentAnalyses, setRecentAnalyses] = useState([])
  const [recentChatUpdates, setRecentChatUpdates] = useState([])
  const [recentEmailUpdates, setRecentEmailUpdates] = useState([])
  const [recentReports, setRecentReports] = useState([])
  const [recentCases, setRecentCases] = useState([])
  const [recentAppointments, setRecentAppointments] = useState([])
  const [recentForms, setRecentForms] = useState([])
  const [recentNotes, setRecentNotes] = useState([])
  const [recentContacts, setRecentContacts] = useState([])
  const [recentDocuments, setRecentDocuments] = useState([])
  const [recentSourcingItems, setRecentSourcingItems] = useState([])
  const [recentTaskItems, setRecentTaskItems] = useState([])
  const [recentFiles, setRecentFiles] = useState([])
  // The Tasks card dismisses one row at a time; while a dismissal is in flight every
  // check button on the card is disabled so a second click cannot land on the row
  // that has just moved up into its place.
  const [taskPreviewDismissing, setTaskPreviewDismissing] = useState(false)
  const [messagesEnabled, setMessagesEnabled] = useState(false)
  // The Allied Health directories are gated per domain. Defaults: ON for the OT
  // domains, OFF for everyone else (see src/lib/domainFeatureFlags.js).
  const [suppliersCardEnabled, setSuppliersCardEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).suppliersEnabled)
  const [providersCardEnabled, setProvidersCardEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).providersEnabled)
  // The Tools dashboard is opt-in per domain; the Tools card links to /admin/tools.
  const [toolsPageEnabled, setToolsPageEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).toolsEnabled)
  // The Tasks dashboard is opt-in per domain too; the Tasks card links to /admin/tasks.
  const [tasksPageEnabled, setTasksPageEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).tasksEnabled)
  // The Files dashboard is opt-in per domain and off by default; the Files card
  // links to /admin/files and previews the practice's newest uploads.
  const [filesPageEnabled, setFilesPageEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).filesEnabled)
  const [recentActivityLoading, setRecentActivityLoading] = useState(false)
  // Temporary UX toggle: keep first stats card row hidden on /admin.
  // Set to true to restore the Posts/Pages/Media cards.
  const showTopStatsRow = false
  const router = useRouter()
  const [showVersionBadge, setShowVersionBadge] = useState(false)
  const [activeDomainMode, setActiveDomainMode] = useState(() => getAdminDomainMode())
  const [displayPolicy, setDisplayPolicy] = useState(DEFAULT_DISPLAY_POLICY)
  const [quickActionsConfig, setQuickActionsConfig] = useState(getDefaultAdminQuickActionsConfig())
  const [quickActionsEnabled, setQuickActionsEnabled] = useState(() => getDefaultDomainFeatureFlags(getAdminDomainMode()).quickActionsEnabled)
  const [homePageBlockEditorEnabled, setHomePageBlockEditorEnabled] = useState(false)
  const [recentUpdatesEnabled, setRecentUpdatesEnabled] = useState(true)
  const [patientsEnabled, setPatientsEnabled] = useState(false)
  const [reportsCardEnabled, setReportsCardEnabled] = useState(false)
  const [casesCardEnabled, setCasesCardEnabled] = useState(false)
  const [appointmentsCardEnabled, setAppointmentsCardEnabled] = useState(false)
  const [formsCardEnabled, setFormsCardEnabled] = useState(false)
  const [notesCardEnabled, setNotesCardEnabled] = useState(false)
  const [docsCardEnabled, setDocsCardEnabled] = useState(false)
  const [analysisCardEnabled, setAnalysisCardEnabled] = useState(false)
  const [patientBillingEnabled, setPatientBillingEnabled] = useState(false)
  const [aiUsageEnabled, setAiUsageEnabled] = useState(false)
  const [aiUsageSummary, setAiUsageSummary] = useState(null)
  const [chatsEnabled, setChatsEnabled] = useState(false)
  const [assistantEnabled, setAssistantEnabled] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null)
  const [refreshTicker, setRefreshTicker] = useState(() => Math.floor(Date.now() / 1000) * 1000)
  const [dashboardCardOrder, setDashboardCardOrder] = useState([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
  // The domain's default order. "Reset" in the layout editor returns the draft
  // here, and it is what an admin sees until they save a personal override.
  const [dashboardDomainCardOrder, setDashboardDomainCardOrder] = useState([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
  const [layoutEditing, setLayoutEditing] = useState(false)
  const [layoutDraftOrder, setLayoutDraftOrder] = useState([])
  const [layoutDraggingKey, setLayoutDraggingKey] = useState('')
  const [layoutDropTarget, setLayoutDropTarget] = useState(null)
  const [layoutSaving, setLayoutSaving] = useState(false)
  const [layoutStatus, setLayoutStatus] = useState(null)
  const [practiceType, setPracticeType] = useState('general')
  const [showFcaQuickMenu, setShowFcaQuickMenu] = useState(false)
  const [toolsShortcutMenuCardKey, setToolsShortcutMenuCardKey] = useState(null)
  const [toolsShortcutMenuPlacement, setToolsShortcutMenuPlacement] = useState('down')
  const [adminToolsVisible, setAdminToolsVisible] = useState(false)
  const [showAuthTestMenu, setShowAuthTestMenu] = useState(false)
  const [showAuthTestModal, setShowAuthTestModal] = useState(false)
  const [authTestScenario, setAuthTestScenario] = useState('current-session')
  const [authTestDomain, setAuthTestDomain] = useState('')
  const [authTestToken, setAuthTestToken] = useState('')
  const [authTestLoading, setAuthTestLoading] = useState(false)
  const [authTestError, setAuthTestError] = useState('')
  const [authTestResult, setAuthTestResult] = useState(null)
  const [authTestTableResult, setAuthTestTableResult] = useState(null)
  // Which admin to impersonate in the auth-test scenario, remembered per domain.
  const [authTestSimUsers, setAuthTestSimUsers] = useState([])
  const [authTestSimTargetByDomain, setAuthTestSimTargetByDomain] = useState({})
  const fcaQuickMenuRef = useRef(null)
  const toolsShortcutMenuRef = useRef(null)
  const dashboardCardRefs = useRef(new Map())
  const currentAdminUser = getCurrentUser()
  const isSuperAdminUser = currentAdminUser?.role === 'superadmin'
  const authTestSimDomain = String(authTestDomain || currentAdminUser?.domain || '').trim().toLowerCase()

  const authTestSimAdmins = useMemo(
    () => filterSimulationAdmins(authTestSimUsers, authTestSimDomain),
    [authTestSimUsers, authTestSimDomain]
  )

  const authTestSimOptions = useMemo(
    () => buildSimulationOptions(authTestSimAdmins, authTestSimDomain),
    [authTestSimAdmins, authTestSimDomain]
  )

  const authTestSimTarget = Object.prototype.hasOwnProperty.call(authTestSimTargetByDomain, authTestSimDomain)
    ? authTestSimTargetByDomain[authTestSimDomain]
    : defaultSimulationTarget(authTestSimAdmins)

  const setAuthTestSimTarget = (value) => {
    setAuthTestSimTargetByDomain((prev) => ({ ...prev, [authTestSimDomain]: value }))
  }

  useEffect(() => {
    if (!showAuthTestModal || !isSuperAdminUser) return undefined

    let cancelled = false

    async function loadAuthTestSimAdmins() {
      try {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) return

        const response = await fetch('/api/auth/users', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        if (!cancelled) setAuthTestSimUsers(Array.isArray(data?.users) ? data.users : [])
      } catch {
        // The picker falls back to the synthetic identity when the list is unavailable.
      }
    }

    loadAuthTestSimAdmins()
    return () => { cancelled = true }
  }, [showAuthTestModal, isSuperAdminUser])

  const getDashboardCacheKey = () => {
    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    const username = String(currentUser?.username || '').trim().toLowerCase() || 'anonymous'
    // The card order is per-admin, so two admins of the same domain must not share
    // a cached payload.
    return `${ADMIN_DASHBOARD_CACHE_KEY}:${activeDomainMode}:${scopedDomainKey || 'all'}:${username}`
  }

  const getDashboardSnapshotScope = () => {
    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    return `${activeDomainMode}:${scopedDomainKey || 'all'}`
  }

  // Domain whose settings apply to this dashboard: a domain-scoped admin is
  // pinned to their own domain, a superadmin follows the hostname.
  const getDashboardDomainKey = () => {
    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    return scopedDomainKey || activeDomainMode
  }

  const applyDashboardPayload = (payload = {}) => {
    setBackendOnline(typeof payload.backendOnline === 'boolean' ? payload.backendOnline : null)
    setOpenAiStatus(payload.openAiStatus ?? null)
    setDatabaseConfigured(typeof payload.databaseConfigured === 'boolean' ? payload.databaseConfigured : null)
    setAiProviderConfigured(payload.openAiStatus ? hasConfiguredAiProvider(payload.openAiStatus) : null)
    setDisplayPolicy(normalizeDisplayPolicy(payload.displayPolicy))
    setQuickActionsConfig(normalizeAdminQuickActionsConfig(payload.quickActionsConfig))
    setHomePageBlockEditorEnabled(payload.homePageBlockEditorEnabled === true)
    setRecentUpdatesEnabled(payload.recentUpdatesEnabled !== false)
    setPatientsEnabled(payload.patientsEnabled === true)
    setReportsCardEnabled(payload.patientsEnabled === true && payload.reportsCardEnabled !== false)
    setCasesCardEnabled(payload.patientsEnabled === true && payload.casesCardEnabled !== false)
    setAppointmentsCardEnabled(payload.patientsEnabled === true && payload.appointmentsCardEnabled !== false)
    setFormsCardEnabled(payload.patientsEnabled === true && payload.formsCardEnabled !== false)
    setNotesCardEnabled(payload.patientsEnabled === true && payload.notesCardEnabled !== false)
    setDocsCardEnabled(payload.patientsEnabled === true && payload.docsCardEnabled !== false)
    setAnalysisCardEnabled(payload.patientsEnabled === true && payload.analysisCardEnabled !== false)
    setPatientBillingEnabled(payload.patientBillingEnabled === true)
    setAiUsageEnabled(payload.aiUsageEnabled === true)
    setAiUsageSummary(payload.aiUsageSummary ?? null)
    setChatsEnabled(payload.chatsEnabled === true)
    setAssistantEnabled(payload.assistantEnabled === true)
    setMessagesEnabled(payload.messagesEnabled === true)
    // A cached/snapshot payload written before the flags existed has no value for
    // them, so fall back to the domain defaults instead of hiding the cards.
    const directoryFlags = normalizeDomainFeatureFlags(payload, getDashboardDomainKey())
    setSuppliersCardEnabled(directoryFlags.suppliersEnabled)
    setProvidersCardEnabled(directoryFlags.providersEnabled)
    setQuickActionsEnabled(directoryFlags.quickActionsEnabled)
    setToolsPageEnabled(directoryFlags.toolsEnabled)
    setTasksPageEnabled(directoryFlags.tasksEnabled)
    setFilesPageEnabled(directoryFlags.filesEnabled)
    // The card order is per-admin and the server snapshot is shared per domain
    // scope, so a cached payload never decides it: `loadDomainSettings` resolves
    // the caller's order, and `hydrateDashboardFromCache` reapplies the local one.
    setRecentActivity(Array.isArray(payload.recentActivity) ? payload.recentActivity : [])
    setRecentContentUpdates(filterRecentContentUpdates(payload.recentContentUpdates))
    setRecentEquipmentUpdates(Array.isArray(payload.recentEquipmentUpdates) ? payload.recentEquipmentUpdates : [])
    setProviderSpotlight(Array.isArray(payload.providerSpotlight) ? payload.providerSpotlight : [])
    setRecentPatientUpdates(Array.isArray(payload.recentPatientUpdates) ? payload.recentPatientUpdates : [])
    setRecentBillingUpdates(Array.isArray(payload.recentBillingUpdates) ? payload.recentBillingUpdates : [])
    setRecentAnalyses(Array.isArray(payload.recentAnalyses) ? payload.recentAnalyses : [])
    setRecentChatUpdates(Array.isArray(payload.recentChatUpdates) ? payload.recentChatUpdates : [])
    setRecentEmailUpdates(Array.isArray(payload.recentEmailUpdates) ? payload.recentEmailUpdates : [])
    setRecentReports(Array.isArray(payload.recentReports) ? payload.recentReports : [])
    setRecentCases(Array.isArray(payload.recentCases) ? payload.recentCases : [])
    setRecentAppointments(Array.isArray(payload.recentAppointments) ? payload.recentAppointments : [])
    setRecentForms(Array.isArray(payload.recentForms) ? payload.recentForms : [])
    setRecentNotes(Array.isArray(payload.recentNotes) ? payload.recentNotes : [])
    setRecentContacts(Array.isArray(payload.recentContacts) ? payload.recentContacts : [])
    setRecentDocuments(Array.isArray(payload.recentDocuments) ? payload.recentDocuments : [])
    setRecentSourcingItems(Array.isArray(payload.recentSourcingItems) ? payload.recentSourcingItems : [])
    setRecentTaskItems(Array.isArray(payload.recentTaskItems) ? payload.recentTaskItems : [])
    setRecentFiles(Array.isArray(payload.recentFiles) ? payload.recentFiles : [])
  }

  const openAuthTestModal = () => {
    if (typeof window === 'undefined') return

    const currentToken = window.localStorage.getItem('adminToken') || ''
    const user = getCurrentUser()
    setAuthTestDomain(user?.domain || '')
    setAuthTestScenario('current-session')
    setAuthTestToken(currentToken)
    setAuthTestError('')
    setAuthTestResult(null)
    setAuthTestTableResult(null)
    setShowAuthTestMenu(false)
    setShowAuthTestModal(true)
  }

  const verifyAuthToken = async (tokenOverride) => {
    const token = String(tokenOverride || authTestToken || '').trim()
    if (!token) {
      setAuthTestError('Add a token before running the authorization check.')
      return
    }

    setAuthTestLoading(true)
    setAuthTestError('')

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => ({}))
      const normalized = { ok: response.ok, status: response.status, payload }
      setAuthTestResult(normalized)

      if (!response.ok) {
        setAuthTestError(payload?.error || 'Token verification failed.')
      }
    } catch (error) {
      setAuthTestError(error?.message || 'Unable to verify the token.')
    } finally {
      setAuthTestLoading(false)
    }
  }

  const runAuthTableAccessCheck = async (tokenOverride) => {
    const token = String(tokenOverride || authTestToken || '').trim()
    if (!token) {
      setAuthTestError('Add a token before checking table access.')
      return
    }

    const domain = String(authTestDomain || currentAdminUser?.domain || '').trim().toLowerCase()
    setAuthTestLoading(true)
    setAuthTestError('')

    try {
      const response = await fetch('/api/admin/auth/domain-audit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          domain,
          tables: [
            'patient_analysis',
            'patient_analysis_jobs',
            'patient_reports',
            'patient_billing_jobs',
            'patient_transcriptions',
            'billing',
            'chats',
            'outbound_messages',
          ],
        }),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => ({}))
      setAuthTestTableResult({ ok: response.ok, status: response.status, payload })

      if (!response.ok) {
        setAuthTestError(payload?.error || 'Table access audit failed.')
      }
    } catch (error) {
      setAuthTestError(error?.message || 'Unable to check table access.')
    } finally {
      setAuthTestLoading(false)
    }
  }

  const simulateAuthTestAdmin = async () => {
    if (typeof window === 'undefined') return

    const currentToken = window.localStorage.getItem('adminToken') || ''
    if (!currentToken) {
      setAuthTestError('No active admin session found. Log in before simulating a role.')
      return
    }

    const domain = String(authTestDomain || currentAdminUser?.domain || '').trim()
    if (!domain) {
      setAuthTestError('Add a domain before simulating an admin role.')
      return
    }

    if (!isSimulationTargetChosen(authTestSimTarget)) {
      setAuthTestError('Choose which admin to simulate.')
      return
    }

    setAuthTestLoading(true)
    setAuthTestError('')

    try {
      const response = await fetch('/api/auth/simulate-admin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          domain,
          username: resolveSimulationUsername(authTestSimTarget) || undefined,
        }),
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setAuthTestError(payload?.error || 'Failed to simulate admin access.')
        return
      }

      setAuthTestScenario('admin-domain')
      setAuthTestToken(payload.token || '')
      setAuthTestResult(null)
      setAuthTestTableResult(null)
      setAuthTestError('')
    } catch (error) {
      setAuthTestError(error?.message || 'Failed to simulate admin access.')
    } finally {
      setAuthTestLoading(false)
    }
  }

  const hydrateDashboardFromSnapshot = async () => {
    try {
      const token = window.localStorage.getItem('adminToken')
      if (!token) return false

      const query = new URLSearchParams({
        mode: activeDomainMode,
        scope: getDashboardSnapshotScope(),
      })
      const response = await fetch(`/api/admin/dashboard/snapshot?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      if (!response.ok) return false

      const data = await response.json().catch(() => ({}))
      const snapshot = data?.snapshot && typeof data.snapshot === 'object' ? data.snapshot : null
      const payload = snapshot?.payload && typeof snapshot.payload === 'object' ? snapshot.payload : null
      if (!snapshot || !payload) return false

      const refreshedAt = Number(snapshot?.refreshedAt ?? snapshot?.cachedAt ?? Date.now())
      setLastRefreshedAt(Number.isFinite(refreshedAt) ? refreshedAt : Date.now())
      applyDashboardPayload(payload)
      return true
    } catch {
      return false
    }
  }

  const hydrateDashboardFromCache = () => {
    if (typeof window === 'undefined') return false

    const cacheKey = getDashboardCacheKey()

    try {
      const rawCache = window.sessionStorage.getItem(cacheKey)
      if (!rawCache) return false

      const parsedCache = JSON.parse(rawCache)
      const cachedAt = Number(parsedCache?.cachedAt ?? parsedCache?.timestamp ?? 0)
      const refreshedAt = Number(parsedCache?.refreshedAt ?? parsedCache?.cachedAt ?? parsedCache?.timestamp ?? 0)

      if (!cachedAt || (Date.now() - cachedAt) > ADMIN_DASHBOARD_CACHE_TTL_MS) {
        window.sessionStorage.removeItem(cacheKey)
        return false
      }

      setLastRefreshedAt(refreshedAt || null)

      const payload = parsedCache?.payload || {}
      applyDashboardPayload(payload)
      // This cache is scoped to the admin's username, so its order is the
      // caller's own — unlike the domain-shared server snapshot.
      setDashboardCardOrder(normalizeAdminDashboardCardOrder(payload.dashboardCardOrder))

      return true
    } catch {
      return false
    }
  }

  const persistDashboardCache = (cachePayload) => {
    if (typeof window === 'undefined') return

    try {
      const cachedAt = refreshTicker
      const refreshedAt = Number(cachePayload?.refreshedAt ?? cachedAt)
      window.sessionStorage.setItem(
        getDashboardCacheKey(),
        JSON.stringify({
          cachedAt,
          refreshedAt,
          payload: cachePayload,
        })
      )
      setLastRefreshedAt(refreshedAt)
    } catch {
      // Ignore storage write failures (private mode/quota/etc).
    }

    void persistDashboardSnapshot(cachePayload)
  }

  const persistDashboardSnapshot = async (cachePayload) => {
    try {
      const token = window.localStorage.getItem('adminToken')
      if (!token) return false

      // The snapshot is keyed by domain scope and shared by every admin of that
      // domain, so the caller's personal card order must not be written into it.
      const { dashboardCardOrder: _personalCardOrder, ...sharedPayload } = cachePayload || {}

      const response = await fetch('/api/admin/dashboard/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scope: getDashboardSnapshotScope(),
          snapshot: {
            cachedAt: refreshTicker,
            refreshedAt: Number(cachePayload?.refreshedAt ?? refreshTicker),
            payload: sharedPayload,
          },
        }),
      })

      return response.ok
    } catch {
      return false
    }
  }

  useEffect(() => {
    document.title = 'Admin'
  }, [])

  useEffect(() => {
    if (!lastRefreshedAt) return

    const intervalId = window.setInterval(() => {
      setRefreshTicker((prev) => prev + 1)
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [lastRefreshedAt])

  // Admin tools menu visibility is controlled by a switch on /admin/settings
  // (Management card). The persisted preference is read after mount, deferred to a
  // task, so reading localStorage during render can neither cause a hydration
  // mismatch nor a cascading render from a synchronous setState in the effect.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(ADMIN_TOOLS_VISIBLE_STORAGE_KEY)
        setAdminToolsVisible(stored === '1')
      } catch {
        // ignore storage access errors
      }
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAdmin() {
      hydrateDashboardFromCache()

      const token = await getOrCreateAdminTokenForLocalhost()
      const isDebug = new URLSearchParams(window.location.search).has('debug')

      if (cancelled) {
        return
      }

      const badgeTimeoutId = window.setTimeout(() => {
        setShowVersionBadge(process.env.NODE_ENV === 'development' || isDebug)
      }, 0)

      if (!token) {
        router.push('/login')
        return
      }

      const currentUser = getCurrentUser()

      void hydrateDashboardFromSnapshot()

      setIsAuthenticated(true)
      setLoading(false)
      return () => window.clearTimeout(badgeTimeoutId)
    }

    bootstrapAdmin()

    return () => {
      cancelled = true
    }
  }, [router]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAuthenticated) {
      const timeoutId = window.setTimeout(() => {
        // eslint-disable-next-line react-hooks/immutability -- hoisted function declaration
        refreshDashboardData({ force: true })
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [isAuthenticated, activeDomainMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // The signed-in admin's own card order, or null when they have never saved one
  // and should follow the domain default. A read failure is treated the same way:
  // the dashboard still renders, with the domain layout.
  const fetchPersonalDashboardCardOrder = async (token) => {
    try {
      const response = await fetch(
        `${ADMIN_DASHBOARD_LAYOUT_ENDPOINT}?domain=${encodeURIComponent(getDashboardDomainKey())}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      )
      if (!response.ok) return null

      const data = await response.json().catch(() => ({}))
      return Array.isArray(data?.cardOrder) && data.cardOrder.length > 0
        ? normalizeAdminDashboardCardOrder(data.cardOrder)
        : null
    } catch {
      return null
    }
  }

  const loadDomainSettings = async () => {
    // The directory cards fall back to the per-domain defaults whenever the
    // stored settings cannot be read (no token / request failed).
    const resetDirectoryFlags = (domainKey) => {
      const defaults = getDefaultDomainFeatureFlags(domainKey)
      setSuppliersCardEnabled(defaults.suppliersEnabled)
      setProvidersCardEnabled(defaults.providersEnabled)
      setQuickActionsEnabled(defaults.quickActionsEnabled)
      setToolsPageEnabled(defaults.toolsEnabled)
      setTasksPageEnabled(defaults.tasksEnabled)
      setFilesPageEnabled(defaults.filesEnabled)
      return defaults
    }

    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setPatientsEnabled(false)
      setReportsCardEnabled(false)
      setCasesCardEnabled(false)
      setPatientBillingEnabled(false)
      setAiUsageEnabled(false)
      setAiUsageSummary(null)
      setChatsEnabled(false)
      setAssistantEnabled(false)
      setMessagesEnabled(false)
      setRecentUpdatesEnabled(true)
      setDashboardCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
      setDashboardDomainCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
      setAppointmentsCardEnabled(false)
      setFormsCardEnabled(false)
      setNotesCardEnabled(false)
      setDocsCardEnabled(false)
      setAnalysisCardEnabled(false)
      setPracticeType(normalizePracticeType('', activeDomainMode))
      const directoryFlagsForDomain = resetDirectoryFlags(activeDomainMode)
      return {
        patientsEnabled: false,
        reportsCardEnabled: false,
        casesCardEnabled: false,
        appointmentsCardEnabled: false,
        formsCardEnabled: false,
        notesCardEnabled: false,
        docsCardEnabled: false,
        analysisCardEnabled: false,
        patientBillingEnabled: false,
        aiUsageEnabled: false,
        chatsEnabled: false,
        assistantEnabled: false,
        messagesEnabled: false,
        recentUpdatesEnabled: true,
        dashboardCardOrder: [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER],
        practiceType: normalizePracticeType('', activeDomainMode),
        ...directoryFlagsForDomain,
      }
    }

    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    const settingsDomainKey = scopedDomainKey || activeDomainMode

    try {
      const response = await fetch('/api/settings/domains', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      if (!response.ok) {
        setPatientsEnabled(false)
        setReportsCardEnabled(false)
        setCasesCardEnabled(false)
        setAppointmentsCardEnabled(false)
        setFormsCardEnabled(false)
        setNotesCardEnabled(false)
        setDocsCardEnabled(false)
        setAnalysisCardEnabled(false)
        setPatientBillingEnabled(false)
        setAiUsageEnabled(false)
        setAiUsageSummary(null)
        setChatsEnabled(false)
        setAssistantEnabled(false)
        setMessagesEnabled(false)
        setRecentUpdatesEnabled(true)
        setDashboardCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
        setDashboardDomainCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
        setPracticeType(normalizePracticeType('', settingsDomainKey))
        const directoryFlagsForDomain = resetDirectoryFlags(settingsDomainKey)
        return {
          patientsEnabled: false,
          reportsCardEnabled: false,
          casesCardEnabled: false,
          appointmentsCardEnabled: false,
          formsCardEnabled: false,
          notesCardEnabled: false,
          docsCardEnabled: false,
          analysisCardEnabled: false,
          patientBillingEnabled: false,
          aiUsageEnabled: false,
          chatsEnabled: false,
          assistantEnabled: false,
          messagesEnabled: false,
          recentUpdatesEnabled: true,
          dashboardCardOrder: [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER],
          practiceType: normalizePracticeType('', settingsDomainKey),
          ...directoryFlagsForDomain,
        }
      }

      const data = await response.json().catch(() => ({}))
      const savedDomainSettings = data?.domains?.[settingsDomainKey] || {}
      const domainSettings = settingsDomainKey === 'default'
        ? { ...getDefaultDomainFeatureSettings(), ...savedDomainSettings }
        : savedDomainSettings
      const patientsEnabledForDomain = domainSettings?.patientsEnabled === true
      const reportsCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.reportsCardEnabled !== false
      const casesCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.casesCardEnabled !== false
      const appointmentsCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.appointmentsCardEnabled !== false
      const formsCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.formsCardEnabled !== false
      const notesCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.notesCardEnabled !== false
      const docsCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.docsCardEnabled !== false
      const analysisCardEnabledForDomain = patientsEnabledForDomain && domainSettings?.analysisCardEnabled !== false
      const directoryFlagsForDomain = normalizeDomainFeatureFlags(domainSettings, settingsDomainKey)
      const billingEnabledForDomain = patientsEnabledForDomain && domainSettings?.patientBillingEnabled === true
      const aiUsageEnabledForDomain = domainSettings?.aiUsageEnabled === true
      const chatsEnabledForDomain = domainSettings?.chatEnabled === true
      const assistantEnabledForDomain = domainSettings?.assistantEnabled === true
      const messagesEnabledForDomain = domainSettings?.contactEmailDelivery?.enabled !== false
      const recentUpdatesEnabledForDomain = domainSettings?.recentUpdatesEnabled !== false
      const dashboardCardOrderForDomain = normalizeAdminDashboardCardOrder(domainSettings?.adminDashboardCardOrder)
      // A personal override wins; otherwise the admin follows the domain default.
      const personalCardOrder = await fetchPersonalDashboardCardOrder(token)
      const dashboardCardOrderForAdmin = personalCardOrder || dashboardCardOrderForDomain
      const practiceTypeForDomain = normalizePracticeType(domainSettings?.practiceType, settingsDomainKey)

      setPatientsEnabled(patientsEnabledForDomain)
      setReportsCardEnabled(reportsCardEnabledForDomain)
      setCasesCardEnabled(casesCardEnabledForDomain)
      setAppointmentsCardEnabled(appointmentsCardEnabledForDomain)
      setFormsCardEnabled(formsCardEnabledForDomain)
      setNotesCardEnabled(notesCardEnabledForDomain)
      setDocsCardEnabled(docsCardEnabledForDomain)
      setAnalysisCardEnabled(analysisCardEnabledForDomain)
      setPatientBillingEnabled(billingEnabledForDomain)
      setAiUsageEnabled(aiUsageEnabledForDomain)
      setChatsEnabled(chatsEnabledForDomain)
      setAssistantEnabled(assistantEnabledForDomain)
      setMessagesEnabled(messagesEnabledForDomain)
      setRecentUpdatesEnabled(recentUpdatesEnabledForDomain)
      setDashboardDomainCardOrder(dashboardCardOrderForDomain)
      setDashboardCardOrder(dashboardCardOrderForAdmin)
      setPracticeType(practiceTypeForDomain)
      setSuppliersCardEnabled(directoryFlagsForDomain.suppliersEnabled)
      setProvidersCardEnabled(directoryFlagsForDomain.providersEnabled)
      setQuickActionsEnabled(directoryFlagsForDomain.quickActionsEnabled)
      setToolsPageEnabled(directoryFlagsForDomain.toolsEnabled)
      setTasksPageEnabled(directoryFlagsForDomain.tasksEnabled)
      setFilesPageEnabled(directoryFlagsForDomain.filesEnabled)
      return {
        patientsEnabled: patientsEnabledForDomain,
        reportsCardEnabled: reportsCardEnabledForDomain,
        casesCardEnabled: casesCardEnabledForDomain,
        appointmentsCardEnabled: appointmentsCardEnabledForDomain,
        formsCardEnabled: formsCardEnabledForDomain,
        notesCardEnabled: notesCardEnabledForDomain,
        docsCardEnabled: docsCardEnabledForDomain,
        analysisCardEnabled: analysisCardEnabledForDomain,
        patientBillingEnabled: billingEnabledForDomain,
        aiUsageEnabled: aiUsageEnabledForDomain,
        chatsEnabled: chatsEnabledForDomain,
        assistantEnabled: assistantEnabledForDomain,
        messagesEnabled: messagesEnabledForDomain,
        recentUpdatesEnabled: recentUpdatesEnabledForDomain,
        ...directoryFlagsForDomain,
        dashboardCardOrder: dashboardCardOrderForAdmin,
        practiceType: practiceTypeForDomain,
        source: 'loadDomainSettings',
      }
    } catch {
      setPatientsEnabled(false)
      setReportsCardEnabled(false)
      setCasesCardEnabled(false)
      setAppointmentsCardEnabled(false)
      setFormsCardEnabled(false)
      setNotesCardEnabled(false)
      setDocsCardEnabled(false)
      setAnalysisCardEnabled(false)
      setPatientBillingEnabled(false)
      setAiUsageEnabled(false)
      setAiUsageSummary(null)
      setChatsEnabled(false)
      setAssistantEnabled(false)
      setMessagesEnabled(false)
      setRecentUpdatesEnabled(true)
      setDashboardCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
      setDashboardDomainCardOrder([...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER])
      setPracticeType(normalizePracticeType('', settingsDomainKey))
      const directoryFlagsForDomain = resetDirectoryFlags(settingsDomainKey)
      return {
        patientsEnabled: false,
        reportsCardEnabled: false,
        casesCardEnabled: false,
        appointmentsCardEnabled: false,
        formsCardEnabled: false,
        notesCardEnabled: false,
        docsCardEnabled: false,
        analysisCardEnabled: false,
        patientBillingEnabled: false,
        aiUsageEnabled: false,
        chatsEnabled: false,
        assistantEnabled: false,
        messagesEnabled: false,
        recentUpdatesEnabled: true,
        dashboardCardOrder: [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER],
        practiceType: normalizePracticeType('', settingsDomainKey),
        ...directoryFlagsForDomain,
      }
    }
  }

  const loadAiUsageSummary = async ({ aiUsageEnabledOverride = aiUsageEnabled } = {}) => {
    if (!aiUsageEnabledOverride) {
      setAiUsageSummary(null)
      return null
    }

    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setAiUsageSummary(null)
      return null
    }

    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    const settingsDomainKey = scopedDomainKey || activeDomainMode

    try {
      const response = await fetch(`/api/settings/domains/ai-usage?domainKey=${encodeURIComponent(settingsDomainKey)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      if (!response.ok) {
        setAiUsageSummary(null)
        return null
      }

      const data = await response.json().catch(() => ({}))
      const nextSummary = data?.summary && typeof data.summary === 'object' ? data.summary : null
      setAiUsageSummary(nextSummary)
      return nextSummary
    } catch {
      setAiUsageSummary(null)
      return null
    }
  }

  const loadDisplayPolicy = async () => {
    try {
      const response = await fetch('/api/settings/display-policy', { cache: 'no-store' })
      if (!response.ok) {
        return {
          displayPolicy: DEFAULT_DISPLAY_POLICY,
        }
      }

      const data = await response.json().catch(() => ({}))
      const nextDisplayPolicy = normalizeDisplayPolicy(data?.policy)

      setDisplayPolicy(nextDisplayPolicy)
      return {
        displayPolicy: nextDisplayPolicy,
      }
    } catch (error) {
      console.error('Failed to load display policy:', error)
      return {
        displayPolicy: DEFAULT_DISPLAY_POLICY,
      }
    }
  }

  const loadQuickActionsConfig = async () => {
    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setQuickActionsConfig(getDefaultAdminQuickActionsConfig())
      setQuickActionsEnabled(true)
      setHomePageBlockEditorEnabled(false)
      setRecentUpdatesEnabled(true)
      return {
        quickActionsConfig: getDefaultAdminQuickActionsConfig(),
        quickActionsEnabled: true,
        homePageBlockEditorEnabled: false,
        recentUpdatesEnabled: true,
      }
    }

    const currentUser = getCurrentUser()
    const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
    const settingsDomainKey = scopedDomainKey || activeDomainMode

    try {
      const response = await fetch(`/api/settings/domains/quick-actions?domainKey=${encodeURIComponent(settingsDomainKey)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      })

      if (!response.ok) {
        setQuickActionsConfig(getDefaultAdminQuickActionsConfig())
        setQuickActionsEnabled(true)
        setHomePageBlockEditorEnabled(false)
        setRecentUpdatesEnabled(true)
        return {
          quickActionsConfig: getDefaultAdminQuickActionsConfig(),
          quickActionsEnabled: true,
          homePageBlockEditorEnabled: false,
          recentUpdatesEnabled: true,
        }
      }

      const data = await response.json().catch(() => ({}))
      const nextQuickActionsConfig = normalizeAdminQuickActionsConfig(data?.quickActions)
      const nextQuickActionsEnabled = data?.quickActionsEnabled !== false
      const nextHomePageBlockEditorEnabled = data?.homePageBlockEditorEnabled === true
      const nextRecentUpdatesEnabled = data?.recentUpdatesEnabled !== false

      setQuickActionsConfig(nextQuickActionsConfig)
      setQuickActionsEnabled(nextQuickActionsEnabled)
      setHomePageBlockEditorEnabled(nextHomePageBlockEditorEnabled)
      setRecentUpdatesEnabled(nextRecentUpdatesEnabled)
      return {
        quickActionsConfig: nextQuickActionsConfig,
        quickActionsEnabled: nextQuickActionsEnabled,
        homePageBlockEditorEnabled: nextHomePageBlockEditorEnabled,
        recentUpdatesEnabled: nextRecentUpdatesEnabled,
      }
    } catch {
      setQuickActionsConfig(getDefaultAdminQuickActionsConfig())
      setQuickActionsEnabled(true)
      setHomePageBlockEditorEnabled(false)
      setRecentUpdatesEnabled(true)
      return {
        quickActionsConfig: getDefaultAdminQuickActionsConfig(),
        quickActionsEnabled: true,
        homePageBlockEditorEnabled: false,
        recentUpdatesEnabled: true,
      }
    }
  }

  const showPracticeBackendContent = shouldShowPracticeContent({
    surface: 'backend',
    policy: displayPolicy,
  })

  const fetchRecentActivity = async ({
    patientsEnabledOverride = patientsEnabled,
    reportsCardEnabledOverride = reportsCardEnabled,
    casesEnabledOverride = casesCardEnabled,
    appointmentsEnabledOverride = appointmentsCardEnabled,
    formsEnabledOverride = formsCardEnabled,
    notesEnabledOverride = notesCardEnabled,
    docsEnabledOverride = docsCardEnabled,
    analysisEnabledOverride = analysisCardEnabled,
    patientBillingEnabledOverride = patientBillingEnabled,
    chatsEnabledOverride = chatsEnabled,
    messagesEnabledOverride = messagesEnabled,
    suppliersEnabledOverride = suppliersCardEnabled,
    providersEnabledOverride = providersCardEnabled,
    sourcingEnabledOverride = patientsEnabled,
    tasksPageEnabledOverride = tasksPageEnabled,
    filesPageEnabledOverride = filesPageEnabled,
  } = {}) => {
    setRecentActivityLoading(true)
    try {
      const token = window.localStorage.getItem('adminToken')
      const currentUser = getCurrentUser()
      const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
      const recentUpdatesDomainKey = scopedDomainKey || activeDomainMode
      const query = new URLSearchParams()

      if (recentUpdatesDomainKey) {
        query.set('domain', recentUpdatesDomainKey)
      }

      const response = await fetch(`/api/database/recent-activity${query.toString() ? `?${query.toString()}` : ''}`, {
        mode: 'cors',
        cache: 'no-cache',
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : undefined,
      })

      if (response.status === 401) {
        // The stored token is no longer accepted (expired or revoked). Drop the
        // dead session instead of leaving the dashboard to fail every request.
        clearAdminSession()
        router.push('/login')
        return
      }

      if (!response.ok) {
        throw new Error(`Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      const nextRecentActivity = Array.isArray(data?.activity) ? data.activity : []
      const nextRecentContentUpdates = filterRecentContentUpdates(data?.contentUpdates)
      let nextRecentEquipmentUpdates = []
      let nextProviderSpotlight = []
      let nextRecentPatientUpdates = []
      let nextRecentBillingUpdates = []
      let nextRecentAnalyses = []
      let patientRows = []
      const nextRecentChatUpdates = chatsEnabledOverride && Array.isArray(data?.chatUpdates)
        ? data.chatUpdates
        : []
      let nextRecentEmailUpdates = []
      let nextRecentReports = []
      let nextRecentCases = []
      let nextRecentAppointments = []
      let nextRecentForms = []
      let nextRecentNotes = []
      let nextRecentContacts = []
      let nextRecentDocuments = []
      let nextRecentSourcingItems = []
      let nextRecentTaskItems = []
      let nextRecentFiles = []

      setRecentActivity(nextRecentActivity)
      setRecentContentUpdates(nextRecentContentUpdates)
      setRecentChatUpdates(nextRecentChatUpdates)

      // Directory cards are domain-gated: skip the fetch entirely when the flag
      // is off so a hidden card never loads data.
      if (suppliersEnabledOverride) {
        const equipmentResponse = await fetch('/api/equipment?admin=1', {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })
        const equipmentData = await equipmentResponse.json().catch(() => ({}))
        if (equipmentResponse.ok) {
          nextRecentEquipmentUpdates = (Array.isArray(equipmentData?.suppliers) ? equipmentData.suppliers : [])
            .sort((a, b) => {
              const aTime = new Date(a?.updated_at || a?.created_at || 0).getTime()
              const bTime = new Date(b?.updated_at || b?.created_at || 0).getTime()
              return bTime - aTime
            })
            .slice(0, 3)
          setRecentEquipmentUpdates(nextRecentEquipmentUpdates)
        } else {
          setRecentEquipmentUpdates([])
        }
      } else {
        setRecentEquipmentUpdates([])
      }

      if (providersEnabledOverride) {
        const providersResponse = await fetch('/api/providers?admin=1', {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })
        const providersData = await providersResponse.json().catch(() => ({}))
        if (providersResponse.ok) {
          // The Providers card shows random provider websites rather than the three most
          // recently touched records, so only providers the API vouched for a capture are
          // eligible and the pick is reshuffled on every refresh.
          nextProviderSpotlight = shuffleItems(
            (Array.isArray(providersData?.providers) ? providersData.providers : [])
              .filter((provider) => Boolean(provider?.hero_url))
          ).slice(0, 3)
          setProviderSpotlight(nextProviderSpotlight)
        } else {
          setProviderSpotlight([])
        }
      } else {
        setProviderSpotlight([])
      }

      if (reportsCardEnabledOverride) {
        const reportsQuery = new URLSearchParams(query)
        reportsQuery.set('limit', '50')

        const reportsResponse = await fetch(`/api/database/reports?${reportsQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const reportsData = await reportsResponse.json().catch(() => ({}))
        if (reportsResponse.ok) {
          nextRecentReports = getMostRecentReportPerPatient(reportsData?.data, 2)
          setRecentReports(nextRecentReports)
        } else {
          setRecentReports([])
        }
      } else {
        setRecentReports([])
      }

      if (casesEnabledOverride) {
        const casesQuery = new URLSearchParams(query)
        casesQuery.set('limit', '100')

        const casesResponse = await fetch(`/api/database/cases?${casesQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const casesData = await casesResponse.json().catch(() => ({}))
        if (casesResponse.ok) {
          nextRecentCases = Array.isArray(casesData?.data) ? casesData.data : []
          setRecentCases(nextRecentCases)
        } else {
          setRecentCases([])
        }
      } else {
        setRecentCases([])
      }

      if (appointmentsEnabledOverride) {
        const appointmentsQuery = new URLSearchParams(query)
        appointmentsQuery.set('limit', '100')

        const appointmentsResponse = await fetch(`/api/database/appointments?${appointmentsQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const appointmentsData = await appointmentsResponse.json().catch(() => ({}))
        if (appointmentsResponse.ok) {
          nextRecentAppointments = Array.isArray(appointmentsData?.data) ? appointmentsData.data : []
          setRecentAppointments(nextRecentAppointments)
        } else {
          setRecentAppointments([])
        }
      } else {
        setRecentAppointments([])
      }

      if (formsEnabledOverride) {
        const formsQuery = new URLSearchParams(query)
        formsQuery.set('limit', '100')
        formsQuery.set('compact', '1')

        const formsResponse = await fetch(`/api/database/forms?${formsQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const formsData = await formsResponse.json().catch(() => ({}))
        if (formsResponse.ok) {
          nextRecentForms = Array.isArray(formsData?.data) ? formsData.data : []
          setRecentForms(nextRecentForms)
        } else {
          setRecentForms([])
        }
      } else {
        setRecentForms([])
      }

      if (notesEnabledOverride) {
        const notesQuery = new URLSearchParams(query)
        notesQuery.set('limit', '100')
        notesQuery.set('compact', '1')

        const notesResponse = await fetch(`/api/database/notes?${notesQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const notesData = await notesResponse.json().catch(() => ({}))
        if (notesResponse.ok) {
          nextRecentNotes = Array.isArray(notesData?.data) ? notesData.data : []
          setRecentNotes(nextRecentNotes)
        } else {
          setRecentNotes([])
        }
      } else {
        setRecentNotes([])
      }

      // The Docs card shows the newest document of each type, so it reads a small window
      // of every type's list at once. A type whose table is missing (a domain mid-import)
      // simply contributes no row instead of failing the whole card.
      if (docsEnabledOverride) {
        const documentsByType = {}
        await Promise.all(PATIENT_DOCUMENT_TYPES.map(async (type) => {
          const documentsResponse = await fetch(type.endpoint(recentUpdatesDomainKey, DOCS_CARD_SOURCE_LIMIT), {
            mode: 'cors',
            cache: 'no-cache',
            headers: token
              ? { Authorization: `Bearer ${token}` }
              : undefined,
          }).catch(() => null)

          if (!documentsResponse?.ok) return

          const documentsData = await documentsResponse.json().catch(() => ({}))
          documentsByType[type.key] = Array.isArray(documentsData?.data) ? documentsData.data : []
        }))

        nextRecentDocuments = selectRecentDocuments(documentsByType, DOCS_CARD_ITEM_LIMIT)
          .map(({ type, row }) => ({ typeKey: type.key, row }))
        setRecentDocuments(nextRecentDocuments)
      } else {
        setRecentDocuments([])
      }

      // The Contacts card is a domain directory rather than a per-domain
      // optional card, so it loads unconditionally like the Funders card.
      {
        const contactsQuery = new URLSearchParams(query)
        contactsQuery.set('limit', '100')

        const contactsResponse = await fetch(`/api/database/contacts?${contactsQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const contactsData = await contactsResponse.json().catch(() => ({}))
        if (contactsResponse.ok) {
          nextRecentContacts = Array.isArray(contactsData?.data) ? contactsData.data : []
          setRecentContacts(nextRecentContacts)
        } else {
          setRecentContacts([])
        }
      }

      if (patientsEnabledOverride) {
        const patientsResponse = await fetch(`/api/database/patients${query.toString() ? `?${query.toString()}` : ''}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const patientsData = await patientsResponse.json().catch(() => ({}))
        if (patientsResponse.ok) {
          patientRows = Array.isArray(patientsData?.data) ? patientsData.data : []
          const sortedRecentPatients = patientRows
            .sort((a, b) => {
              const aTime = new Date(a?.updated_at || a?.created_at || 0).getTime()
              const bTime = new Date(b?.updated_at || b?.created_at || 0).getTime()
              return bTime - aTime
            })
            .slice(0, 3)
          nextRecentPatientUpdates = sortedRecentPatients
          setRecentPatientUpdates(sortedRecentPatients)
        } else {
          setRecentPatientUpdates([])
        }
      } else {
        setRecentPatientUpdates([])
      }

      if (nextRecentReports.length > 0 && patientRows.length > 0) {
        nextRecentReports = nextRecentReports.map((report) => {
          const patient = patientRows.find((row) => String(row?.id || '') === String(report?.patientId || report?.patient_id || ''))
          return {
            ...report,
            patientFunderBadge: getPatientFunderBadge(patient),
            reportAgent: getPatientReportAgentKey(patient),
          }
        })
        setRecentReports(nextRecentReports)
      }

      // The Analysis card carries its own per-domain toggle, so a domain can keep
      // Patients on and still retire the card (and skip the read entirely).
      if (analysisEnabledOverride) {
        const analysesQuery = new URLSearchParams(query)
        analysesQuery.set('limit', '3')

        const analysesResponse = await fetch(`/api/database/patients/analysis?${analysesQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const analysesData = await analysesResponse.json().catch(() => ({}))
        if (analysesResponse.ok) {
          nextRecentAnalyses = Array.isArray(analysesData?.data) ? analysesData.data.slice(0, 3) : []
          setRecentAnalyses(nextRecentAnalyses)
        } else {
          setRecentAnalyses([])
        }
      } else {
        setRecentAnalyses([])
      }

      if (patientBillingEnabledOverride) {
        const billingResponse = await fetch(`/api/database/billing${query.toString() ? `?${query.toString()}` : ''}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const billingData = await billingResponse.json().catch(() => ({}))
        if (billingResponse.ok) {
          const sortedRecentBilling = (Array.isArray(billingData?.data) ? billingData.data : [])
            .map((event) => ({
              ...event,
              patientFunderBadge: getPatientFunderBadge(
                patientRows.find((patient) => String(patient?.id || '') === String(event?.account_id || ''))
              ),
            }))
            .sort((a, b) => {
              const aTime = new Date(a?.updated_at || a?.created_at || 0).getTime()
              const bTime = new Date(b?.updated_at || b?.created_at || 0).getTime()
              return bTime - aTime
            })
            .slice(0, 3)
          nextRecentBillingUpdates = sortedRecentBilling
          setRecentBillingUpdates(sortedRecentBilling)
        } else {
          setRecentBillingUpdates([])
        }
      } else {
        setRecentBillingUpdates([])
      }

      if (messagesEnabledOverride) {
        const emailDeliveryResponse = await fetch(`/api/settings/domains/email-delivery?domainKey=${encodeURIComponent(recentUpdatesDomainKey)}`, {
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
          cache: 'no-store',
        })

        const emailDeliveryData = await emailDeliveryResponse.json().catch(() => ({}))
        if (emailDeliveryResponse.ok) {
          const recentEmails = Array.isArray(emailDeliveryData?.recentEmails) ? emailDeliveryData.recentEmails : []
          nextRecentEmailUpdates = recentEmails.slice(0, 3)
          setRecentEmailUpdates(nextRecentEmailUpdates)
        } else {
          setRecentEmailUpdates([])
        }
      } else {
        setRecentEmailUpdates([])
      }

      if (sourcingEnabledOverride) {
        const sourcingQuery = new URLSearchParams(query)
        sourcingQuery.set('limit', '3')

        const sourcingResponse = await fetch(`/api/database/sourcing?${sourcingQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        })

        const sourcingData = await sourcingResponse.json().catch(() => ({}))
        if (sourcingResponse.ok) {
          nextRecentSourcingItems = Array.isArray(sourcingData?.items) ? sourcingData.items.slice(0, 3) : []
          setRecentSourcingItems(nextRecentSourcingItems)
        } else {
          setRecentSourcingItems([])
        }
      } else {
        setRecentSourcingItems([])
      }

      // The Tasks card rolls the per-patient "Waiting on review" queue up across
      // the practice. Only a domain that turned Tasks on loads it, so a hidden card
      // never asks for data nobody sees.
      if (tasksPageEnabledOverride) {
        const tasksQuery = new URLSearchParams(query)
        tasksQuery.set('limit', String(DASHBOARD_TASK_PREVIEW_LIMIT))

        const tasksResponse = await fetch(`/api/admin/tasks?${tasksQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: 'Bearer ' + token }
            : undefined,
        })

        const tasksData = await tasksResponse.json().catch(() => ({}))
        if (tasksResponse.ok && tasksData?.success === true && Array.isArray(tasksData?.previewItems)) {
          nextRecentTaskItems = tasksData.previewItems.slice(0, DASHBOARD_TASK_PREVIEW_LIMIT)
          setRecentTaskItems(nextRecentTaskItems)
        } else {
          setRecentTaskItems([])
        }
      } else {
        setRecentTaskItems([])
      }

      // The Files card previews the practice's newest uploads - patient files and
      // practice-level files in one list. A domain with Files off skips the request.
      if (filesPageEnabledOverride) {
        const filesQuery = new URLSearchParams(query)
        filesQuery.set('limit', String(DASHBOARD_FILES_PREVIEW_LIMIT))

        const filesResponse = await fetch(`/api/database/patient-files?${filesQuery.toString()}`, {
          mode: 'cors',
          cache: 'no-cache',
          headers: token
            ? { Authorization: 'Bearer ' + token }
            : undefined,
        })

        const filesData = await filesResponse.json().catch(() => ({}))
        if (filesResponse.ok && filesData?.success === true && Array.isArray(filesData?.data)) {
          nextRecentFiles = filesData.data.slice(0, DASHBOARD_FILES_PREVIEW_LIMIT)
          setRecentFiles(nextRecentFiles)
        } else {
          setRecentFiles([])
        }
      } else {
        setRecentFiles([])
      }

      return {
        recentActivity: nextRecentActivity,
        recentContentUpdates: nextRecentContentUpdates,
        recentEquipmentUpdates: nextRecentEquipmentUpdates,
        providerSpotlight: nextProviderSpotlight,
        recentPatientUpdates: nextRecentPatientUpdates,
        recentBillingUpdates: nextRecentBillingUpdates,
        recentAnalyses: nextRecentAnalyses,
        recentChatUpdates: nextRecentChatUpdates,
        recentEmailUpdates: nextRecentEmailUpdates,
        recentReports: nextRecentReports,
        recentCases: nextRecentCases,
        recentAppointments: nextRecentAppointments,
        recentForms: nextRecentForms,
        recentNotes: nextRecentNotes,
        recentContacts: nextRecentContacts,
        recentDocuments: nextRecentDocuments,
        recentSourcingItems: nextRecentSourcingItems,
        recentTaskItems: nextRecentTaskItems,
        recentFiles: nextRecentFiles,
      }
    } catch (error) {
      console.error('Failed to fetch recent activity:', error)
      setRecentActivity([])
      setRecentContentUpdates([])
      setRecentEquipmentUpdates([])
      setProviderSpotlight([])
      setRecentPatientUpdates([])
      setRecentBillingUpdates([])
      setRecentAnalyses([])
      setRecentChatUpdates([])
      setRecentEmailUpdates([])
      setRecentReports([])
      setRecentCases([])
      setRecentAppointments([])
      setRecentForms([])
      setRecentNotes([])
      setRecentContacts([])
      setRecentDocuments([])
      setRecentSourcingItems([])
      setRecentTaskItems([])
      setRecentFiles([])
      return {
        recentActivity: [],
        recentContentUpdates: [],
        recentEquipmentUpdates: [],
        providerSpotlight: [],
        recentPatientUpdates: [],
        recentBillingUpdates: [],
        recentAnalyses: [],
        recentChatUpdates: [],
        recentEmailUpdates: [],
        recentReports: [],
        recentCases: [],
        recentAppointments: [],
        recentForms: [],
        recentNotes: [],
        recentContacts: [],
        recentDocuments: [],
        recentSourcingItems: [],
        recentTaskItems: [],
        recentFiles: [],
      }
    } finally {
      setRecentActivityLoading(false)
    }
  }

  async function refreshDashboardData({ force = false } = {}) {
    if (!force) {
      const hydrated = hydrateDashboardFromCache()
      if (hydrated) {
        return
      }
    }

    const [backendStatusResult, openAiStatusResult, displayPolicyResult, quickActionsResult, domainSettingsResult] = await Promise.all([
      checkBackendStatus(),
      // eslint-disable-next-line react-hooks/immutability -- hoisted function declaration
      checkOpenAiStatus(),
      loadDisplayPolicy(),
      loadQuickActionsConfig(),
      loadDomainSettings(),
    ])

    const aiUsageResult = await loadAiUsageSummary({
      aiUsageEnabledOverride: domainSettingsResult?.aiUsageEnabled === true,
    })

    const activityResult = await fetchRecentActivity({
      patientsEnabledOverride: domainSettingsResult?.patientsEnabled === true,
      reportsCardEnabledOverride: domainSettingsResult?.reportsCardEnabled === true,
      casesCardEnabledOverride: domainSettingsResult?.casesCardEnabled === true,
      appointmentsEnabledOverride: domainSettingsResult?.appointmentsCardEnabled === true,
      formsEnabledOverride: domainSettingsResult?.formsCardEnabled === true,
      notesEnabledOverride: domainSettingsResult?.notesCardEnabled === true,
      docsEnabledOverride: domainSettingsResult?.docsCardEnabled === true,
      analysisEnabledOverride: domainSettingsResult?.analysisCardEnabled === true,
      patientBillingEnabledOverride: domainSettingsResult?.patientBillingEnabled === true,
      chatsEnabledOverride: domainSettingsResult?.chatsEnabled === true,
      messagesEnabledOverride: domainSettingsResult?.messagesEnabled === true,
      suppliersEnabledOverride: domainSettingsResult?.suppliersEnabled === true,
      providersEnabledOverride: domainSettingsResult?.providersEnabled === true,
      sourcingEnabledOverride: domainSettingsResult?.patientsEnabled === true,
      tasksPageEnabledOverride: domainSettingsResult?.tasksEnabled === true,
      filesPageEnabledOverride: domainSettingsResult?.filesEnabled === true,
    })

    persistDashboardCache({
      backendOnline: backendStatusResult?.online === true,
      databaseConfigured: backendStatusResult?.databaseConfigured ?? null,
      openAiStatus: openAiStatusResult,
      displayPolicy: displayPolicyResult?.displayPolicy || DEFAULT_DISPLAY_POLICY,
      quickActionsConfig: quickActionsResult?.quickActionsConfig || getDefaultAdminQuickActionsConfig(),
      homePageBlockEditorEnabled: quickActionsResult?.homePageBlockEditorEnabled === true,
      patientsEnabled: domainSettingsResult?.patientsEnabled === true,
      reportsCardEnabled: domainSettingsResult?.reportsCardEnabled === true,
      casesCardEnabled: domainSettingsResult?.casesCardEnabled === true,
      appointmentsCardEnabled: domainSettingsResult?.appointmentsCardEnabled === true,
      formsCardEnabled: domainSettingsResult?.formsCardEnabled === true,
      notesCardEnabled: domainSettingsResult?.notesCardEnabled === true,
      docsCardEnabled: domainSettingsResult?.docsCardEnabled === true,
      analysisCardEnabled: domainSettingsResult?.analysisCardEnabled === true,
      patientBillingEnabled: domainSettingsResult?.patientBillingEnabled === true,
      aiUsageEnabled: domainSettingsResult?.aiUsageEnabled === true,
      aiUsageSummary: aiUsageResult,
      chatsEnabled: domainSettingsResult?.chatsEnabled === true,
      assistantEnabled: domainSettingsResult?.assistantEnabled === true,
      messagesEnabled: domainSettingsResult?.messagesEnabled === true,
      suppliersEnabled: domainSettingsResult?.suppliersEnabled === true,
      providersEnabled: domainSettingsResult?.providersEnabled === true,
      quickActionsEnabled: domainSettingsResult?.quickActionsEnabled !== false,
      toolsEnabled: domainSettingsResult?.toolsEnabled === true,
      tasksEnabled: domainSettingsResult?.tasksEnabled === true,
      filesEnabled: domainSettingsResult?.filesEnabled === true,
      recentUpdatesEnabled: domainSettingsResult?.recentUpdatesEnabled !== false,
      dashboardCardOrder: domainSettingsResult?.dashboardCardOrder || [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER],
      recentActivity: activityResult?.recentActivity || [],
      recentContentUpdates: activityResult?.recentContentUpdates || [],
      recentEquipmentUpdates: activityResult?.recentEquipmentUpdates || [],
      providerSpotlight: activityResult?.providerSpotlight || [],
      recentPatientUpdates: activityResult?.recentPatientUpdates || [],
      recentBillingUpdates: activityResult?.recentBillingUpdates || [],
      recentAnalyses: activityResult?.recentAnalyses || [],
      recentChatUpdates: activityResult?.recentChatUpdates || [],
      recentEmailUpdates: activityResult?.recentEmailUpdates || [],
      recentReports: activityResult?.recentReports || [],
      recentCases: activityResult?.recentCases || [],
      recentAppointments: activityResult?.recentAppointments || [],
      recentForms: activityResult?.recentForms || [],
      recentNotes: activityResult?.recentNotes || [],
      recentContacts: activityResult?.recentContacts || [],
      recentDocuments: activityResult?.recentDocuments || [],
      recentSourcingItems: activityResult?.recentSourcingItems || [],
      recentTaskItems: activityResult?.recentTaskItems || [],
      recentFiles: activityResult?.recentFiles || [],
    })
  }

  const formatRelativeTime = (isoString) => {
    if (!isoString) return 'Unknown time'
    const timestamp = new Date(isoString).getTime()
    if (!Number.isFinite(timestamp)) return 'Unknown time'

    const diffMs = refreshTicker - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const formatUnit = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'} ago`

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return formatUnit(Math.max(1, Math.floor(diffMs / minute)), 'minute')
    if (diffMs < day) return formatUnit(Math.max(1, Math.floor(diffMs / hour)), 'hour')
    return formatUnit(Math.max(1, Math.floor(diffMs / day)), 'day')
  }

  const formatRelativeDayLabel = (isoString) => {
    if (!isoString) return null
    const timestamp = new Date(isoString)
    if (!Number.isFinite(timestamp.getTime())) return null

    const now = new Date(refreshTicker)
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)

    const startOfTimestampDay = new Date(timestamp)
    startOfTimestampDay.setHours(0, 0, 0, 0)

    const dayDiff = Math.floor((startOfToday.getTime() - startOfTimestampDay.getTime()) / 86400000)

    if (dayDiff === 0) {
      return 'earlier today'
    }
    if (dayDiff === 1) {
      return 'yesterday'
    }

    const weekday = timestamp.toLocaleDateString(undefined, { weekday: 'long' })
    return `on ${weekday}`
  }

  const formatInteger = (value) => {
    const numericValue = Number(value || 0)
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number.isFinite(numericValue) ? numericValue : 0)
  }

  const formatCurrency = (value, currency = 'USD') => {
    const numericValue = Number(value || 0)
    const normalizedCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD'

    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: normalizedCurrency,
        maximumFractionDigits: 0,
      }).format(Number.isFinite(numericValue) ? numericValue : 0)
    } catch {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number.isFinite(numericValue) ? numericValue : 0)
    }
  }

  const getActivityIconClasses = (type) => {
    if (type === 'database_update') {
      return {
        wrap: 'bg-green-100',
        icon: 'text-green-600'
      }
    }

    if (type === 'content_update') {
      return {
        wrap: 'bg-indigo-100',
        icon: 'text-indigo-600'
      }
    }

    if (type === 'domain_service_startup') {
      return {
        wrap: 'bg-purple-100',
        icon: 'text-purple-600'
      }
    }

    return {
      wrap: 'bg-blue-100',
      icon: 'text-blue-600'
    }
  }

  useEffect(() => {
    let timeoutId = null

    if (backendOnline === false) {
      timeoutId = setTimeout(() => {
        setShowBackendOfflineWarning(true)
      }, 1200)
    } else {
      const hideTimeoutId = setTimeout(() => {
        setShowBackendOfflineWarning(false)
      }, 0)
      timeoutId = hideTimeoutId
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [backendOnline])

  // Check AI provider key health once when backend becomes online (no interval)
  useEffect(() => {
    if (backendOnline) {
      checkOpenAiStatus()
    }
  }, [backendOnline])

  const checkBackendStatus = async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch('/api/database/check', {
        signal: controller.signal,
        headers: await getAdminAuthHeaders(),
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        const configured = data?.configured === true
        setBackendOnline(true)
        setDatabaseConfigured(configured)
        return { online: true, databaseConfigured: configured }
      }

      setBackendOnline(false)
      setDatabaseConfigured(null)
      return { online: false, databaseConfigured: null }
    } catch (error) {
      console.error('Backend check failed:', error)
      setBackendOnline(false)
      setDatabaseConfigured(null)
      return { online: false, databaseConfigured: null }
    }
  }

  async function checkOpenAiStatus() {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch('/api/openai/check', {
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache',
        headers: await getAdminAuthHeaders(),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      console.log('OpenAI status:', data)
      setOpenAiStatus(data)
      setAiProviderConfigured(hasConfiguredAiProvider(data))
      return data
    } catch (error) {
      console.error('Failed to check OpenAI status:', error)
      setOpenAiStatus(null)
      setAiProviderConfigured(null)
      return null
    }
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    try {
      await refreshDashboardData({ force: true })
    } finally {
      setRefreshingAll(false)
    }
  }

  const handleDatabaseSetup = (selectedDb, envValues) => {
    console.log('Database configured:', selectedDb.name, envValues)
    setShowDbSetup(false)
    alert('Database configuration saved! Please restart your backend server.')
  }

  const testDatabaseConnection = async (dbType, envValues, mode = 'primary') => {
    try {
      console.log('Testing database connection:', { dbType, mode, envValues })

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const endpoint = `/api/database/test-${mode}`
      console.log('Calling endpoint:', endpoint)

      const response = await fetch(endpoint, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache',
        headers: await getAdminAuthHeaders(),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      console.log('Test response:', data)

      return {
        connected: data.connected,
        type: data.type,
        timestamp: data.timestamp,
        error: data.error
      }
    } catch (error) {
      console.error('Test connection error:', error)
      throw error
    }
  }

  // Content type configurations
  const contentTypeConfigs = {
    post: {
      id: 'post',
      label: 'Post',
      icon: '📝',
      domain: 'core',
      attributes: []
    },
    page: {
      id: 'page',
      label: 'Page',
      icon: '📄',
      domain: 'core',
      attributes: ['domain']
    }
  }

  const openNewContentModal = (typeId) => {
    const typeConfig = contentTypeConfigs[typeId]
    if (!typeConfig) return

    const pageDomain = DEFAULT_CONTENT_DOMAIN

    const newItem = {
      id: null,
      type: typeId,
      title: '',
      slug: '',
      status: 'draft',
      preview: '',
      attributes: typeId === 'page' ? { domain: pageDomain } : {}
    }

    setSelectedContentType(typeConfig)
    setSelectedContentItem(newItem)
    setShowContentModal(true)
  }

  const handleContentChange = (field, value) => {
    setSelectedContentItem(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleContentSave = async () => {
    try {
      // Prepare payload
      const payload = {
        type: selectedContentItem.type,
        title: selectedContentItem.title,
        slug: selectedContentItem.slug,
        status: selectedContentItem.status,
        preview: selectedContentItem.preview,
        attributes: selectedContentItem.attributes,
        metadata: {
          source: 'admin-dashboard',
          created_via: 'content-modal'
        }
      }

      const response = await fetch('/api/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const createdId = data?.id || data?.data?.id
      alert(`✅ ${selectedContentType.label} created${createdId ? ` (ID: ${createdId})` : ''}`)
      setShowContentModal(false)
      setSelectedContentItem(null)
    } catch (error) {
      alert(`Failed to create ${selectedContentType.label}: ${error.message}`)
    }
  }

  const handleCreatePage = async () => {
    openNewContentModal('page')
  }

  useEffect(() => {
    if (!showFcaQuickMenu) return

    const handlePointerDown = (event) => {
      if (!fcaQuickMenuRef.current) return
      if (fcaQuickMenuRef.current.contains(event.target)) return
      setShowFcaQuickMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [showFcaQuickMenu])

  // The mini Tools card opens its destination shortcuts from the icon. Close that
  // menu on an outside click or Escape, the same way the FCA quick menu closes.
  useEffect(() => {
    if (!toolsShortcutMenuCardKey) return undefined

    const handlePointerDown = (event) => {
      if (toolsShortcutMenuRef.current?.contains(event.target)) return
      setToolsShortcutMenuCardKey(null)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setToolsShortcutMenuCardKey(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [toolsShortcutMenuCardKey])

  // The mini cards share the last dashboard row, so the shortcut menu opens below
  // the icon normally and flips above it when there is no room left in the window.
  const toggleToolsShortcutMenu = (cardKey, trigger) => {
    if (toolsShortcutMenuCardKey === cardKey) {
      setToolsShortcutMenuCardKey(null)
      return
    }

    const triggerRect = trigger?.getBoundingClientRect?.()
    if (triggerRect) {
      const spaceBelow = window.innerHeight - triggerRect.bottom
      setToolsShortcutMenuPlacement(spaceBelow < TOOLS_SHORTCUT_MENU_MIN_HEIGHT && triggerRect.top > spaceBelow ? 'up' : 'down')
    }

    setToolsShortcutMenuCardKey(cardKey)
  }

  const normalizedQuickActionsConfig = normalizeAdminQuickActionsConfig(quickActionsConfig)
  const builtinByKey = ADMIN_BUILTIN_QUICK_ACTIONS.reduce((acc, action) => {
    acc[action.key] = action
    return acc
  }, {})

  const builtinQuickActions = normalizedQuickActionsConfig.order
    .map((actionKey) => builtinByKey[actionKey])
    .filter(Boolean)
    .filter((action) => {
      const allowedByMode = !action.requiresDomainMode || action.requiresDomainMode === activeDomainMode
      const enabledByConfig = normalizedQuickActionsConfig.enabled?.[action.key] !== false
      return allowedByMode && enabledByConfig
    })
    .map((action) => ({
      key: action.key,
      label: action.label,
      tone: action.tone,
      glow: action.glow,
      onClick: () => openNewContentModal(action.contentType || action.key),
    }))

  const customQuickActions = normalizedQuickActionsConfig.customLinks
    .filter((action) => action.enabled !== false && action.label && action.url)
    .map((action) => ({
      key: action.id,
      label: action.label,
      tone: 'from-slate-100 via-slate-200 to-gray-200',
      glow: 'shadow-slate-200/70',
      icon: action.icon || '🔗',
      customColor: action.color || '#94a3b8',
      isCustom: true,
      onClick: () => {
        const targetUrl = String(action.url || '').trim()
        if (!targetUrl) return

        if (targetUrl.startsWith('/')) {
          if (action.openInNewTab !== false) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer')
          } else {
            router.push(targetUrl)
          }
          return
        }

        if (action.openInNewTab !== false) {
          window.open(targetUrl, '_blank', 'noopener,noreferrer')
        } else {
          window.location.href = targetUrl
        }
      },
    }))

  const patientQuickAction = patientsEnabled
    ? [{
      key: 'add-patient',
      label: 'Add Patient',
      tone: 'from-teal-200 via-emerald-300 to-cyan-200',
      glow: 'shadow-teal-300/70',
      onClick: () => router.push('/admin/patients?create=1'),
    }]
    : []

  const billingQuickAction = patientBillingEnabled
    ? [{
      key: 'add-billing-event',
      label: 'Add Billing Event',
      tone: 'from-violet-200 via-purple-300 to-fuchsia-200',
      glow: 'shadow-purple-300/70',
      onClick: () => router.push('/admin/billing?create=1'),
    }]
    : []

  const currentUser = getCurrentUser()
  const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
  const hostnameDomainHint = typeof window !== 'undefined'
    ? String(window.location.hostname || '').trim().toLowerCase()
    : ''
  const resolvedDomainKey = scopedDomainKey || hostnameDomainHint.split('.')[0]
  const isFcaQuickActionDomain = hasPrivateDomainTrait(resolvedDomainKey, 'fcaQuickAction')

  const createFcaQuickAction = (isFcaQuickActionDomain && patientsEnabled)
    ? [{
      key: 'create-fca-report',
      label: 'Create Report',
      tone: 'from-orange-300 via-orange-400 to-amber-300',
      glow: 'shadow-orange-300/80',
      isCreateFcaAction: true,
      onClick: () => {
        setShowFcaQuickMenu((prev) => !prev)
      },
    }]
    : []

  const quickActions = [...createFcaQuickAction, ...patientQuickAction, ...billingQuickAction, ...builtinQuickActions, ...customQuickActions]
  const openAiUsageModal = () => {
    if (aiUsageSummary) {
      setShowAiUsageModal(true)
    }
  }
  const aiUsageModelBreakdown = Array.isArray(aiUsageSummary?.modelsUsed)
    ? aiUsageSummary.modelsUsed.filter((entry) => entry && typeof entry === 'object')
    : []
  const aiUsageModelNames = aiUsageModelBreakdown
    .map((entry) => String(entry.model || '').trim())
    .filter(Boolean)
  const usageValueSummary = aiUsageSummary?.value && typeof aiUsageSummary.value === 'object' ? aiUsageSummary.value : null
  const usageBillingCurrency = aiUsageSummary?.billingCurrency
  const usageTotalMonthlyCost = usageValueSummary
    ? usageValueSummary.platformMonthlyCost
    : (aiUsageSummary?.roundedMonthlyCost || 0)
  const usageReplacedTools = Array.isArray(usageValueSummary?.replacedTools) ? usageValueSummary.replacedTools : []

  // Cases are surfaced by funding risk (expired, expiring soon, nearly exhausted)
  // rather than recency; fall back to the newest cases when none need attention.
  const caseAttentionEntries = selectCaseAttentionItems(recentCases, { limit: 3 })
  const caseCardEntries = caseAttentionEntries.length > 0
    ? caseAttentionEntries
    : recentCases.slice(0, 3).map((row) => ({ row, metrics: buildCaseMetrics(row) }))

  // Appointments are surfaced by the soonest upcoming session; once the loaded
  // window has moved into the past the newest sessions are shown instead.
  const upcomingAppointmentEntries = recentAppointments
    .filter((row) => {
      const startsAt = row?.starts_at ? new Date(row.starts_at).getTime() : NaN
      return Number.isFinite(startsAt) && startsAt >= refreshTicker
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const appointmentCardEntries = (upcomingAppointmentEntries.length > 0
    ? upcomingAppointmentEntries
    : recentAppointments
  ).slice(0, 3)

  // Forms are surfaced newest submission first; an unlinked submission is the
  // one a user can still act on, so those are shown ahead of linked ones.
  const formCardEntries = [...recentForms]
    .sort((a, b) => {
      const aUnlinked = a?.patient_id ? 0 : 1
      const bUnlinked = b?.patient_id ? 0 : 1
      if (aUnlinked !== bUnlinked) return bUnlinked - aUnlinked
      return new Date(b?.submitted_at || 0).getTime() - new Date(a?.submitted_at || 0).getTime()
    })
    .slice(0, 3)

  // Notes are surfaced draft-first (a draft is the one a user can still act on),
  // then newest import first.
  const noteCardEntries = [...recentNotes]
    .sort((a, b) => {
      const aDraft = a?.draft === true ? 0 : 1
      const bDraft = b?.draft === true ? 0 : 1
      if (aDraft !== bDraft) return aDraft - bDraft
      return new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime()
    })
    .slice(0, 3)

  // Contacts are surfaced most-recently-touched first, so the card answers
  // "who was just added or updated" rather than restating the alphabetical list.
  const contactCardEntries = [...recentContacts]
    .sort((a, b) => new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime())
    .slice(0, CONTACTS_CARD_ITEM_LIMIT)

  // Random provider websites for the Providers card. Only records the API attached an
  // approved capture to are eligible, and the shape is flattened here so the two card
  // layouts (tile grid / capture plus details) can render straight from `items`.
  //
  // A card click lands on the directory with its search box seeded with the provider's
  // name (`?q=`), so the admin gets a filtered result list rather than the record's edit
  // modal. The admin header practice search builds the same link for a provider result.
  const providerSpotlightItems = providerSpotlight.map((provider) => {
    const name = provider.provider || 'Unnamed provider'
    return {
      key: provider.id,
      href: `/admin/providers?q=${encodeURIComponent(name)}`,
      name,
      heroUrl: provider.hero_url || '',
      geography: Array.isArray(provider.geography) ? provider.geography.join(' · ') : String(provider.geography || ''),
      description: provider.description || '',
    }
  })

  // Marking a row done is what takes it off the Tasks list; actioning the record no
  // longer does (see `taskEntries.js`). The row is removed straight away so the click
  // lands, then the dashboard re-reads its data so the card, the cached payload and
  // the snapshot all agree — otherwise a reload inside the cache window could bring
  // the row back.
  const dismissTaskPreviewItem = async (itemKey) => {
    const token = window.localStorage.getItem('adminToken')
    if (!token || !itemKey || taskPreviewDismissing) return

    const domainKey = getDashboardDomainKey()

    setTaskPreviewDismissing(true)
    try {
      const response = await fetch(`/api/admin/tasks?domain=${encodeURIComponent(domainKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'dismiss', itemKey }),
      })

      if (!response.ok) return

      setRecentTaskItems((previous) => previous.filter((row) => row?.key !== itemKey))
      await refreshDashboardData({ force: true })
    } catch {
      // A failed dismissal leaves the row on the card, which is the honest result.
    } finally {
      setTaskPreviewDismissing(false)
    }
  }

  const dashboardCards = [
    {
      key: 'patients',
      enabled: patientsEnabled,
      title: 'Patients',
      icon: UsersRound,
      description: 'Manage patient intake data and notes.',
      actionLabel: 'Open',
      actionHref: '/admin/patients',
      recentLabel: 'Recently Updated',
      emptyLabel: 'No recent patient updates yet.',
      items: recentPatientUpdates.map((patient) => ({
        key: patient.id,
        href: `/admin/patients?patientId=${encodeURIComponent(String(patient.id))}`,
        primary: patient.patient_name || 'Untitled patient',
        secondary: patient.updated_at ? `Updated ${formatRelativeTime(patient.updated_at)}` : 'No update timestamp',
        badge: getPatientFunderBadge(patient),
      })),
    },
    {
      key: 'tasks',
      // The Tasks page is the practice-wide roll-up of the "Waiting on review"
      // queue every patient Overview shows, so this card is the head of that list
      // rather than a second derivation of it. Opt-in per domain, like Tools.
      //
      // This card previews five rows instead of three, so its rows drop to the
      // dense style and the extra rows fit without a taller card.
      enabled: tasksPageEnabled,
      title: 'Tasks',
      icon: ListTodo,
      description: 'Suggestions based on practice activity.',
      actionLabel: 'Open',
      actionHref: '/admin/tasks',
      recentLabel: 'ON YOUR LIST',
      emptyLabel: 'Nothing is on your tasks list.',
      denseItemRows: true,
      items: recentTaskItems.map((item) => ({
        key: item.key,
        href: item.href,
        // Marking the row done clears it from every Tasks surface without touching the
        // underlying record, so it can be restored from the page's Done filter.
        onDismiss: () => dismissTaskPreviewItem(item.key),
        primary: item.title,
        // The review kind is the one thing the row title cannot say at a glance
        // ("3 quotes need review" vs "Report ready to review"), so it leads with
        // the same glyph and tint the destination page uses.
        icon: TASK_KIND_ICONS[item.kind],
        iconClassName: TASK_KIND_ACCENTS[item.kind],
        // The card row is a single line, so the patient is the only meta it carries;
        // the queue age is left to the Tasks page itself.
        secondary: item.patientName || `Patient #${item.patientId}`,
      })),
    },
    {
      key: 'files',
      // Files is the practice's upload library: patient files and practice-level
      // files in one list. Opt-in per domain and off by default, like Tools.
      enabled: filesPageEnabled,
      title: 'Files',
      icon: Files,
      description: 'Every file uploaded to this practice, in one place.',
      actionLabel: 'Open',
      actionHref: '/admin/files',
      recentLabel: 'RECENT FILES',
      emptyLabel: 'No files have been uploaded yet.',
      items: recentFiles.map((file) => ({
        key: file.id,
        // A patient file opens the patient's Files tab, where the rest of that
        // patient's documents are; a practice-level file opens the Files page.
        href: file.patient_id
          ? buildPatientFilesHref(file.patient_id, { returnTo: '/admin' })
          : '/admin/files',
        primary: file.file_name || 'Untitled file',
        secondary: `${describeFileOwner(file)}${file.file_size ? ` • ${formatFileSize(file.file_size)}` : ''}`,
      })),
    },
    {
      key: 'reports',
      enabled: reportsCardEnabled,
      title: 'Reports',
      icon: FileText,
      description: 'Review formal patient reports and drafts.',
      actionLabel: 'Open',
      actionHref: '/admin/reports',
      recentLabel: 'RECENT REPORTS',
      // Used when a single report is on show (the medium card always renders exactly
      // one), so the plural heading doesn't read as a mismatch.
      recentLabelSingular: 'RECENT REPORT',
      emptyLabel: 'No recent reports found yet.',
      // The large and medium styles show the report *type* as artwork (see
      // ReportTypeTile); the mini style stays icon + title like every other card.
      // Reports that never recorded a type still resolve through the patient's
      // report agent, so the artwork style covers them too.
      isReportCard: true,
      items: recentReports.map((report) => {
        const patientId = String(report?.patientId || report?.patient_id || '').trim()
        const patientName = String(report?.patientName || report?.patient_name || '').trim()
        // Both generated reports and queued jobs carry the type on their metadata.
        const reportTypeId = report?.sourceMetadata?.reportTypeId
        const reportType = report?.sourceMetadata?.reportType
        // With no published report the Report tab has nothing to open, so the tile goes
        // straight to the builder instead. Only the NDIS FCA is built by hand (OTF10 and
        // OTF6 are worker-generated), and the API reports `hasCurrentReport` as false only
        // when it confirmed it — a cached payload written before the flag existed keeps
        // the old Reports-tab link rather than jumping into a builder.
        const builderHref = report?.hasCurrentReport === false
          && patientId
          && patientName
          && (isNdisFcaReportType(reportTypeId) || isNdisFcaReportType(reportType))
          ? `/admin/reports?newFca=1&patientId=${encodeURIComponent(patientId)}&patientName=${encodeURIComponent(patientName)}`
          : ''

        return {
          key: report.id,
          href: builderHref || `/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=report&openCurrentReport=1&returnTo=${encodeURIComponent('/admin/reports')}`,
          primary: patientName || 'Untitled report',
          secondary: `${report.preview || 'No preview available'}${report.updatedAt ? ` • Updated ${formatRelativeTime(report.updatedAt)}` : ''}`,
          badge: report.patientFunderBadge || null,
          artwork: resolveReportTypeArtwork({
            reportTypeId,
            reportType,
            // The report's associated agent, so a row with no type metadata still shows
            // the agent's report background instead of the text tile.
            agent: report.reportAgent,
            domain: getDashboardDomainKey(),
          }),
        }
      }),
    },
    {
      key: 'cases',
      enabled: casesCardEnabled,
      title: 'Cases',
      icon: Briefcase,
      description: 'Track funding allocations, their usage and expiry.',
      actionLabel: 'Open',
      actionHref: '/admin/cases',
      recentLabel: caseAttentionEntries.length > 0 ? 'NEEDS ATTENTION' : 'RECENT CASES',
      emptyLabel: 'No cases found yet.',
      items: caseCardEntries.map(({ row, metrics }) => ({
        key: row.id,
        href: `/admin/patients?patientId=${encodeURIComponent(String(row.patient_id || ''))}&tab=cases`,
        primary: row.patient_name || row.case_number || 'Untitled case',
        secondary: describeCaseSummary(row, metrics),
        badge: metrics.attention
          ? { label: metrics.attention.label, className: CASE_ATTENTION_BADGES[metrics.attention.tone] || CASE_ATTENTION_BADGES.warning }
          : null,
      })),
    },
    {
      key: 'appointments',
      enabled: appointmentsCardEnabled,
      title: 'Appointments',
      icon: CalendarClock,
      description: 'Review and import appointments from the practice management system.',
      actionLabel: 'Open',
      actionHref: '/admin/appointments',
      recentLabel: upcomingAppointmentEntries.length > 0 ? 'UPCOMING' : 'RECENT APPOINTMENTS',
      emptyLabel: 'No appointments imported yet.',
      items: appointmentCardEntries.map((row) => ({
        key: row.id,
        href: '/admin/appointments',
        primary: row.linked_patient_name || row.patient_name || 'Unassigned appointment',
        secondary: describeAppointmentSummary(row),
        badge: null,
      })),
    },
    {
      key: 'forms',
      enabled: formsCardEnabled,
      title: 'Forms',
      icon: ClipboardList,
      description: 'Review submitted intake forms and import them from the practice management system.',
      actionLabel: 'Open',
      actionHref: '/admin/forms',
      recentLabel: 'RECENT SUBMISSIONS',
      emptyLabel: 'No forms imported yet.',
      items: formCardEntries.map((row) => ({
        key: row.id,
        href: row.patient_id
          ? `/admin/patients?patientId=${encodeURIComponent(String(row.patient_id))}&tab=forms`
          : '/admin/forms',
        primary: row.linked_patient_name || row.patient_name || 'Unassigned form',
        secondary: describeFormSummary(row),
        badge: row.patient_id
          ? null
          : { label: 'Not linked', className: 'border-amber-500 bg-amber-500 text-white' },
      })),
    },
    {
      key: 'notes',
      enabled: notesCardEnabled,
      title: 'Notes',
      icon: NotebookPen,
      description: 'Patient notes written in the app, plus imports from the practice management system.',
      actionLabel: 'Open',
      actionHref: '/admin/notes',
      recentLabel: 'RECENT NOTES',
      emptyLabel: 'No notes yet.',
      // No status chips here (no 'Draft', no 'Not linked'): this card is a plain
      // recency list, and the status words live in the admin Notes list instead.
      items: noteCardEntries.map((row) => ({
        key: row.id,
        href: row.patient_id
          ? `/admin/patients?patientId=${encodeURIComponent(String(row.patient_id))}&tab=notes`
          : '/admin/notes',
        primary: row.linked_patient_name || row.patient_name || 'Unassigned note',
        secondary: describeNoteSummary(row, { includeDraft: false }),
        badge: null,
      })),
    },
    {
      key: 'docs',
      // Patient documents, so it needs the Patients entity and then its own
      // per-domain toggle, exactly like the other patient cards.
      enabled: docsCardEnabled,
      title: 'Docs',
      icon: BookOpen,
      description: 'Every quote, case, service agreement, form, analysis and summary in one place.',
      actionLabel: 'Open',
      actionHref: '/admin/docs',
      recentLabel: 'RECENT DOCUMENTS',
      emptyLabel: 'No patient documents in this domain yet.',
      // The Docs card draws each preview as a portrait document page (see
      // `DocumentTypeTile`), so a row only needs the patient name, the document type and
      // the type's colour.
      isDocsCard: true,
      // It previews two documents in both larger styles, so the medium card is not
      // narrowed to the single row the other data cards show.
      compactItemCount: DOCS_CARD_ITEM_LIMIT,
      // Newest document of each type, at most one per type (the selector caps the list),
      // so the card previews what just changed without one type crowding out the rest.
      items: recentDocuments.map(({ typeKey, row }) => {
        const type = PATIENT_DOCUMENT_TYPE_BY_KEY[typeKey]
        const typeLabel = type?.singular || type?.label || 'Document'
        const identifier = String(type?.identifier?.(row) || '').trim()
        const patientName = String(row?.patient_name || row?.patientName || row?.linked_patient_name || '').trim()
        const accent = PATIENT_DOCUMENT_TYPE_ACCENTS[typeKey]

        return {
          key: `${typeKey}:${row?.id ?? identifier}`,
          href: buildPatientDocumentsHref(typeKey),
          primary: patientName || identifier || `Untitled ${typeLabel.toLowerCase()}`,
          secondary: typeLabel,
          icon: PATIENT_DOCUMENT_TYPE_ICONS[typeKey],
          bandClassName: accent?.band,
          labelClassName: accent?.label,
          badge: null,
        }
      }),
    },
    {
      key: 'analysis',
      // Its own per-domain toggle on top of the Patients entity, exactly like the
      // other patient cards.
      enabled: analysisCardEnabled,
      title: 'Analysis',
      icon: Brain,
      description: 'Review FCA Analyst suggestions prepared from patient notes and transcripts.',
      actionLabel: 'Open',
      actionHref: '/admin/analysis',
      recentLabel: 'Recent Analyses',
      emptyLabel: 'No recent analyses yet.',
      usesUsagePreviewHeight: true,
      items: recentAnalyses.map((analysis) => ({
        key: analysis.id,
        href: `/admin/patients?patientId=${encodeURIComponent(String(analysis.patientId || analysis.patient_id || ''))}&tab=analysis&returnTo=${encodeURIComponent('/admin/analysis')}`,
        primary: analysis.patientName || analysis.patient_name || 'Untitled patient',
        secondary: `${analysis.summaryText || 'Analysis ready'}${analysis.updatedAt ? ` • Updated ${formatRelativeTime(analysis.updatedAt)}` : ''}`,
      })),
    },
    {
      key: 'billing',
      enabled: patientBillingEnabled,
      title: 'Billing',
      icon: CreditCard,
      description: 'View and create billing records.',
      actionLabel: 'Open',
      actionHref: '/admin/billing',
      recentLabel: 'Recent Events',
      emptyLabel: 'No recent billing events yet.',
      items: recentBillingUpdates.map((event) => {
        const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {}
        const eventType = String(metadata?.eventType || 'event')
        const accountName = event?.account_name || 'Unnamed billing account'

        return {
          key: event.id,
          href: '/admin/billing',
          primary: accountName,
          secondary: `${eventType}${event.updated_at ? ` • Updated ${formatRelativeTime(event.updated_at)}` : ''}`,
          badge: event.patientFunderBadge || null,
        }
      }),
    },
    {
      key: 'equipment',
      enabled: suppliersCardEnabled,
      title: 'Suppliers',
      icon: Accessibility,
      description: 'Manage the supplier directory and your favourites.',
      actionLabel: 'Open',
      actionHref: '/admin/suppliers',
      recentLabel: 'Recent Suppliers',
      emptyLabel: 'Search, add, and maintain equipment suppliers.',
      // Two suppliers rather than one, so the medium card previews the last two
      // changes to the directory.
      compactItemCount: SUPPLIERS_CARD_COMPACT_ITEM_LIMIT,
      items: recentEquipmentUpdates.map((supplier) => ({
        key: supplier.id,
        href: `/admin/suppliers?supplier=${encodeURIComponent(String(supplier.id))}`,
        primary: supplier.supplier || 'Unnamed supplier',
        logoUrl: supplier.logo_url || '',
      })),
    },
    {
      key: 'providers',
      enabled: providersCardEnabled,
      title: 'Providers',
      icon: Stethoscope,
      description: 'Manage the provider directory and your favourites.',
      actionLabel: 'Open',
      actionHref: '/admin/providers',
      recentLabel: 'Recent Providers',
      emptyLabel: 'Search, add, and maintain allied health providers.',
      isProviderSpotlightCard: true,
      items: providerSpotlightItems,
    },
    {
      key: 'contacts',
      // A domain directory rather than a per-domain optional card, so it is
      // always available (like Funders) instead of gated by a domain setting.
      enabled: true,
      title: 'Contacts',
      icon: Contact,
      description: 'The people and organisations you work with.',
      actionLabel: 'Open',
      actionHref: '/admin/contacts',
      recentLabel: 'RECENT CONTACTS',
      emptyLabel: 'No contacts added yet.',
      // Names only, so the card carries more rows than the other data cards: the
      // large card shows all six and the medium card shows four. Both sizes use the
      // dense single-line row, which is what keeps six of them inside the card.
      denseItemRows: true,
      compactItemCount: CONTACTS_CARD_COMPACT_ITEM_LIMIT,
      items: contactCardEntries.map((row) => ({
        key: row.id,
        // Each row deep-links to its own contact, e.g. /admin/contacts?contactId=12,
        // which opens that record's editor rather than the unfiltered directory.
        href: `/admin/contacts?contactId=${encodeURIComponent(String(row.id))}`,
        primary: contactDisplayName(row),
      })),
    },
    {
      key: 'sourcing',
      enabled: patientsEnabled,
      title: 'Sourcing',
      icon: PackageSearch,
      description: 'Track the equipment quotes requested from suppliers.',
      actionLabel: 'Open',
      actionHref: '/admin/sourcing',
      recentLabel: 'IN PROGRESS',
      emptyLabel: 'No equipment items are being sourced yet.',
      items: recentSourcingItems.map((item) => ({
        key: item.key || `${item.patientId || 'patient'}:${item.itemIndex}`,
        href: item.href || `/admin/patients?patientId=${encodeURIComponent(String(item.patientId || ''))}&tab=equipment`,
        primary: item.name || 'Equipment item',
        logoUrl: item.supplierLogoUrl || '',
        secondary: [
          item.statusLabel || 'In progress',
          item.supplierName,
          item.patientName,
          item.lastActivityAt ? formatRelativeTime(item.lastActivityAt) : null,
        ].filter(Boolean).join(' • '),
      })),
    },
    {
      key: 'chat',
      enabled: chatsEnabled,
      title: 'Chat',
      icon: MessageSquare,
      description: 'View recent chat session activity.',
      actionLabel: 'Open',
      actionHref: '/admin/chat',
      recentLabel: 'Recent Sessions',
      emptyLabel: 'No recent chat sessions yet.',
      items: recentChatUpdates.map((chat) => ({
        key: chat.id,
        href: chat.id ? `/admin/chat/${encodeURIComponent(String(chat.id))}` : '/admin/chat',
        primary: chat.title || chat.role || 'Chat session',
        secondary: `${chat.description || 'No preview available'}${chat.timestamp ? `\nUpdated ${formatRelativeTime(chat.timestamp)}` : ''}${chat.messageCount > 0 ? ` • ${chat.messageCount} message${chat.messageCount === 1 ? '' : 's'}` : ''}`,
      })),
      isChatCard: true,
    },
    {
      key: 'assistant',
      enabled: assistantEnabled,
      title: 'Assistant',
      icon: Brain,
      description: 'Chat with a general AI assistant.',
      actionLabel: 'Open',
      actionHref: '/admin/assistant',
      recentLabel: 'Assistant',
      emptyLabel: 'Ask questions, draft content, or get help.',
      items: [],
    },
    {
      key: 'messages',
      enabled: messagesEnabled,
      title: 'Messages',
      icon: Mail,
      description: 'View contact email messages.',
      actionLabel: 'Open',
      actionHref: '/admin/messages',
      recentLabel: 'RECENT EMAILS',
      emptyLabel: 'No recent emails found.',
      usesUsagePreviewHeight: true,
      items: recentEmailUpdates.map((email) => ({
        key: email.id || `${email.createdAt || 'unknown'}:${email.toEmail || 'recipient'}`,
        href: email.id ? `/admin/messages/${encodeURIComponent(String(email.id))}` : '/admin/messages',
        primary: email.subject || email.contactName || email.toEmail || 'Outbound contact email',
        secondary: `${email.toEmail || 'No recipient'}${email.createdAt ? ` • ${formatRelativeTime(email.createdAt)}` : ''}`,
      })),
    },
    {
      key: 'ai-usage',
      enabled: aiUsageEnabled,
      title: 'Usage',
      icon: BarChart3,
      description: 'Monthly platform cost, and the software subscription spend it replaces.',
      actionLabel: 'View',
      actionOnClick: openAiUsageModal,
      recentLabel: 'ESTIMATED MONTHLY COST',
      emptyLabel: 'No usage or cost data found in the last 30 days.',
      isAiUsageCard: true,
      items: aiUsageSummary ? [
        {
          key: 'ai-usage-summary',
          onClick: openAiUsageModal,
          primary: formatCurrency(usageTotalMonthlyCost, usageBillingCurrency),
          monthlySaving: usageValueSummary && usageValueSummary.replacedToolsMonthlyCost > 0
            ? formatCurrency(usageValueSummary.netMonthlySaving, usageBillingCurrency)
            : undefined,
        },
      ] : [],
    },
    {
      key: 'tools',
      // The Tools dashboard collects the Content, Funders, Recycling and Activities
      // cards on their own page (/admin/tools). The items below are the fixed
      // destinations those cards open, shared with the mini card's icon menu, rather
      // than recent records.
      enabled: toolsPageEnabled,
      title: 'Tools',
      icon: Wrench,
      description: 'Practice management tools.',
      actionLabel: 'Open',
      actionHref: '/admin/tools',
      isToolsCard: true,
      recentLabel: 'ON THE TOOLS PAGE',
      shortcutLabel: 'SHORTCUTS',
      emptyLabel: 'Turn on the Tools dashboard for this domain in Settings to use it.',
      items: TOOLS_DASHBOARD_SHORTCUTS,
    },
  ]

  const dashboardCardKeys = dashboardCards.map((card) => card.key)
  const dashboardCardKeySignature = dashboardCardKeys.join('|')

  const normalizeDashboardCardOrder = (order, cardKeys) => {
    const knownCardKeys = new Set(cardKeys)

    const safeOrder = Array.isArray(order)
      ? order.filter((key) => knownCardKeys.has(key))
      : []

    const missingKeys = cardKeys.filter((key) => !safeOrder.includes(key))
    return [...safeOrder, ...missingKeys]
  }

  // While the layout editor is open the draft order drives the grid, so panels
  // settle into place as soon as they are dropped.
  const baseDashboardCardOrder = layoutEditing && layoutDraftOrder.length > 0
    ? layoutDraftOrder
    : dashboardCardOrder

  const orderedDashboardCards = normalizeDashboardCardOrder(baseDashboardCardOrder, dashboardCardKeys)
    .map((cardKey) => dashboardCards.find((card) => card.key === cardKey))
    .filter(Boolean)

  const enabledDashboardCards = orderedDashboardCards.filter((card) => card.enabled)
  const featuredDashboardCards = enabledDashboardCards.slice(0, 3)
  const compactDashboardCards = enabledDashboardCards.slice(3)

  // Row capacities drive the automatic style downgrade: row 1 = featured
  // (lg:grid-cols-6 with lg:col-span-2), row 2 = compact (lg:grid-cols-5) and
  // every following row = mini (lg:grid-cols-9). Keep these in sync with the
  // grid classes below.
  const compactRowDashboardCards = compactDashboardCards.slice(0, COMPACT_ROW_CAPACITY)
  const miniDashboardCards = compactDashboardCards.slice(COMPACT_ROW_CAPACITY)

  const resolveLayoutDraftKeys = (draft) => (
    draft?.length > 0
      ? draft
      : enabledDashboardCards.map((card) => card.key)
  )

  const startLayoutEditing = () => {
    setLayoutDraftOrder(enabledDashboardCards.map((card) => card.key))
    setLayoutDraggingKey('')
    setLayoutDropTarget(null)
    setLayoutStatus(null)
    setLayoutEditing(true)
  }

  const stopLayoutEditing = () => {
    setLayoutEditing(false)
    setLayoutDraftOrder([])
    setLayoutDraggingKey('')
    setLayoutDropTarget(null)
  }

  const resetLayoutDraftOrder = () => {
    const enabledCardKeys = new Set(enabledDashboardCards.map((card) => card.key))
    // Back to the domain default rather than the code default: that is the layout
    // every admin starts from.
    setLayoutDraftOrder(dashboardDomainCardOrder.filter((cardKey) => enabledCardKeys.has(cardKey)))
    setLayoutDraggingKey('')
    setLayoutDropTarget(null)
    setLayoutStatus(null)
  }

  const moveLayoutDraftCard = (cardKey, delta) => {
    setLayoutDraftOrder((prev) => {
      const current = [...resolveLayoutDraftKeys(prev)]
      const index = current.indexOf(cardKey)
      const targetIndex = index + delta
      if (index === -1 || targetIndex < 0 || targetIndex >= current.length) return current
      current.splice(index, 1)
      current.splice(targetIndex, 0, cardKey)
      return current
    })
    setLayoutStatus(null)
  }

  const sendLayoutDraftCardToEnd = (cardKey) => {
    setLayoutDraftOrder((prev) => {
      const current = resolveLayoutDraftKeys(prev)
      if (!current.includes(cardKey)) return current
      return [...current.filter((key) => key !== cardKey), cardKey]
    })
    setLayoutStatus(null)
  }

  const resolveLayoutDropPlacement = (event, element) => {
    const rect = element.getBoundingClientRect()
    const withinHorizontalBand = event.clientY >= rect.top && event.clientY <= rect.bottom
    const pastCenter = withinHorizontalBand
      ? event.clientX > rect.left + (rect.width / 2)
      : event.clientY > rect.top + (rect.height / 2)

    return pastCenter ? 'after' : 'before'
  }

  const updateLayoutDropTarget = (nextTarget) => {
    setLayoutDropTarget((prev) => {
      if (!nextTarget) return prev === null ? prev : null
      if (prev?.cardKey === nextTarget.cardKey && prev?.placement === nextTarget.placement) return prev
      return nextTarget
    })
  }

  const handleCardDragStart = (event, cardKey) => {
    if (!layoutEditing) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', cardKey)
    setLayoutDraggingKey(cardKey)
    setLayoutStatus(null)
  }

  const handleCardDragEnd = () => {
    setLayoutDraggingKey('')
    updateLayoutDropTarget(null)
  }

  const handleCardDragOver = (event, cardKey) => {
    if (!layoutEditing || !layoutDraggingKey || layoutDraggingKey === cardKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const element = dashboardCardRefs.current.get(cardKey)
    updateLayoutDropTarget({
      cardKey,
      placement: element ? resolveLayoutDropPlacement(event, element) : 'before',
    })
  }

  const handleCardDragLeave = (event, cardKey) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setLayoutDropTarget((prev) => (prev?.cardKey === cardKey ? null : prev))
  }

  const handleCardDrop = (event, cardKey) => {
    if (!layoutEditing) return
    event.preventDefault()

    const draggedKey = layoutDraggingKey || event.dataTransfer.getData('text/plain')
    const placement = layoutDropTarget?.cardKey === cardKey ? layoutDropTarget.placement : 'before'

    if (draggedKey && draggedKey !== cardKey) {
      setLayoutDraftOrder((prev) => {
        const current = [...resolveLayoutDraftKeys(prev)]
        if (!current.includes(draggedKey) || !current.includes(cardKey)) return current
        const next = current.filter((key) => key !== draggedKey)
        let targetIndex = next.indexOf(cardKey)
        if (placement === 'after') targetIndex += 1
        next.splice(targetIndex, 0, draggedKey)
        return next
      })
      setLayoutStatus(null)
    }

    setLayoutDraggingKey('')
    updateLayoutDropTarget(null)
  }

  const applyDashboardCardOrder = (order) => {
    const normalizedOrder = normalizeAdminDashboardCardOrder(order)
    setDashboardCardOrder(normalizedOrder)

    try {
      const cacheKey = getDashboardCacheKey()
      const rawCache = window.sessionStorage.getItem(cacheKey)
      if (!rawCache) return

      const parsedCache = JSON.parse(rawCache)
      const nextPayload = { ...(parsedCache?.payload || {}), dashboardCardOrder: normalizedOrder }
      window.sessionStorage.setItem(cacheKey, JSON.stringify({ ...parsedCache, payload: nextPayload }))
      void persistDashboardSnapshot(nextPayload)
    } catch {
      // Local cache/snapshot sync is best-effort; the saved layout (personal
      // override or domain default) is the source of truth.
    }
  }

  async function saveDashboardLayout() {
    const enabledCardKeys = new Set(enabledDashboardCards.map((card) => card.key))
    const nextOrder = normalizeAdminDashboardCardOrder([
      ...layoutDraftOrder.filter((cardKey) => enabledCardKeys.has(cardKey)),
      ...dashboardCardOrder.filter((cardKey) => !enabledCardKeys.has(cardKey)),
    ])

    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setLayoutStatus({ tone: 'error', message: 'Your admin session has expired. Sign in again to save the layout.' })
      return
    }

    // Matching the domain default is the same as having no override, so clear it
    // and keep following any later change a superadmin makes on /domains. Only the
    // cards this admin can actually see are compared: the draft carries the
    // disabled cards from the current order, which would otherwise always differ.
    const matchesDomainDefault = isSameVisibleCardOrder(
      nextOrder,
      dashboardDomainCardOrder,
      (cardKey) => enabledCardKeys.has(cardKey)
    )
    const cardOrder = matchesDomainDefault ? null : nextOrder

    setLayoutSaving(true)
    setLayoutStatus(null)

    try {
      const response = await fetch(
        `${ADMIN_DASHBOARD_LAYOUT_ENDPOINT}?domain=${encodeURIComponent(getDashboardDomainKey())}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ cardOrder }),
        }
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.success) {
        setLayoutStatus({ tone: 'error', message: data?.error || 'Could not save the dashboard layout.' })
        return
      }

      applyDashboardCardOrder(data?.cardOrder || dashboardDomainCardOrder)
      setLayoutEditing(false)
      setLayoutDraftOrder([])
      setLayoutDraggingKey('')
      setLayoutDropTarget(null)
      // The edit controls (and this status line) are only rendered while editing,
      // so clear it on success instead of leaving a stale message behind.
      setLayoutStatus(null)
    } catch (error) {
      setLayoutStatus({ tone: 'error', message: error?.message || 'Could not save the dashboard layout.' })
    } finally {
      setLayoutSaving(false)
    }
  }

  const getContrastTextColor = (hexColor) => {
    const raw = String(hexColor || '').trim()
    const valid = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#94a3b8'
    const hex = valid.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.62 ? '#0f172a' : '#f8fafc'
  }

  const formatLastRefreshed = (timestamp) => {
    if (!timestamp) return 'not refreshed yet'

    const parsedTimestamp = Number(timestamp)
    if (!Number.isFinite(parsedTimestamp)) return 'not refreshed yet'

    const diffMs = refreshTicker - parsedTimestamp
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'

    const diffSeconds = Math.floor(diffMs / 1000)
    if (diffSeconds <= 20) return 'just now'
    if (diffSeconds < 60) return '<1m ago'

    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`

    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  // `cardVariant` is 'featured' (row 1), 'compact' (row 2) or 'mini' (row 3+).
  const renderDashboardCard = (card, cardVariant = 'featured', positionIndex = 0) => {
    const isMiniCard = cardVariant === 'mini'
    const isCompactCard = cardVariant === 'compact'
    // Mini cards are only ~124px wide (9 per row), so while the layout editor is
    // open they need a taller box and a top inset to clear the drag badge and
    // the move chevrons. Otherwise they keep the 4:3 tile shape.
    const miniCardShapeClasses = layoutEditing
      ? 'lg:aspect-auto lg:min-h-[140px] lg:pt-12'
      : 'lg:min-h-0 lg:aspect-[4/3]'
    // The Tools card is a fixed directory of destination pages rather than recent
    // records, so its compact and mini layouts list those shortcuts directly: the
    // compact card shows all of them and the mini card opens them from its icon.
    const isToolsShortcutCard = Boolean(card.isToolsCard)
    // Data cards preview one record in the compact style; the Tools card keeps its
    // whole shortcut list there so every destination stays one click away, and a card
    // can widen its own preview with `compactItemCount` (the Docs card shows two).
    const compactCardItems = isToolsShortcutCard ? card.items : card.items.slice(0, card.compactItemCount ?? 1)
    const cardItems = isCompactCard ? compactCardItems : isMiniCard ? [] : card.items
    // A card that previews more rows than the standard three (the Tasks card shows
    // five, Contacts six) opts into the dense row: a smaller tile, one line and
    // tighter padding, so the longer preview keeps the card height the three-row
    // cards set. The medium card previews a single record in the standard style, so
    // a card only extends the dense row to it when it widens its own preview there
    // (`compactItemCount`), as the Contacts card does with four names.
    const usesDenseItemRows = Boolean(card.denseItemRows)
      && !isMiniCard
      && (!isCompactCard || (card.compactItemCount ?? 1) > 1)
    // The Tools card lists one destination per row; once the destination page
    // holds more than two, a second column keeps the card short.
    const toolsShortcutItemsUseTwoColumns = isToolsShortcutCard && !isCompactCard && cardItems.length > 2
    const recentLabel = cardItems.length === 1 && card.recentLabelSingular
      ? card.recentLabelSingular
      : card.recentLabel
    // The Reports card shows each report's report-type artwork in the two larger styles
    // (featured and compact). If no recent report resolves to artwork — a domain with no
    // report art, or only report types that ship none — the generic text list below
    // renders unchanged, so nothing regresses where the artwork does not exist yet.
    // Reports with no type metadata of their own resolve through their agent, so the
    // card answers "what kind of report is this" rather than falling back to the preview
    // text for records the worker wrote before the type was recorded.
    const usesReportArtwork = Boolean(card.isReportCard) && cardItems.some((item) => item.artwork)
    const isDraggingLayoutCard = layoutEditing && layoutDraggingKey === card.key
    const layoutDropPlacement = layoutEditing
      && layoutDropTarget?.cardKey === card.key
      && layoutDraggingKey
      && layoutDraggingKey !== card.key
      ? layoutDropTarget.placement
      : null
    const isLastLayoutCard = positionIndex === enabledDashboardCards.length - 1

    const openCardAction = () => {
      if (typeof card.actionOnClick === 'function') {
        card.actionOnClick()
        return
      }

      router.push(card.actionHref)
    }

    // A row that carries `onDismiss` (the Tasks card's rows) keeps the whole row a
    // link and adds a sibling button, so the click that marks the work done never
    // also opens the record.
    const renderDismissButton = (item) => (
      <button
        type="button"
        onClick={() => item.onDismiss()}
        disabled={taskPreviewDismissing}
        title={`Mark ${item.primary} as done`}
        aria-label={`Mark ${item.primary} as done`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )

    // Mini cards keep only the title + icon + open arrow, so the arrow is
    // rendered standalone instead of the wide labelled button.
    const renderCardActionButton = (variant) => (
      <button
        type="button"
        onClick={openCardAction}
        className={`inline-flex items-center justify-center ${variant === 'featured' ? 'text-xs font-medium text-gray-600 hover:text-gray-900' : variant === 'mini' ? 'h-7 w-7 shrink-0 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900' : 'h-7 w-7 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'}`}
        title={`${card.actionLabel} ${card.title}`}
        aria-label={`${card.actionLabel} ${card.title}`}
      >
        {variant === 'featured' && <span>{card.actionLabel}</span>}
        <svg className={`${variant === 'featured' ? 'ml-1 h-4 w-4' : 'h-4 w-4'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )

    return (
      <div
        key={card.key}
        ref={(node) => {
          if (node) {
            dashboardCardRefs.current.set(card.key, node)
          } else {
            dashboardCardRefs.current.delete(card.key)
          }
        }}
        draggable={layoutEditing}
        onDragStart={(event) => handleCardDragStart(event, card.key)}
        onDragEnd={handleCardDragEnd}
        onDragOver={(event) => handleCardDragOver(event, card.key)}
        onDragLeave={(event) => handleCardDragLeave(event, card.key)}
        onDrop={(event) => handleCardDrop(event, card.key)}
        className={`relative bg-white rounded-xl border border-slate-200/90 ring-1 ring-slate-100 text-left transition-all duration-200 flex flex-col ${isMiniCard ? `min-h-[88px] items-center justify-center gap-2 px-4 py-4 sm:min-h-[96px] lg:gap-1.5 lg:px-3 lg:py-3 ${miniCardShapeClasses}` : ''} ${isMiniCard ? '' : 'shadow-[0_10px_30px_-18px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset]'} ${isCompactCard ? 'h-[220px] overflow-hidden p-4' : isMiniCard ? '' : 'p-6 min-h-[260px] lg:col-span-2'} ${layoutEditing ? 'cursor-grab active:cursor-grabbing pt-12' : isMiniCard ? 'hover:border-slate-300 hover:bg-slate-50' : 'hover:-translate-y-0.5 hover:border-slate-300 hover:ring-slate-200 hover:shadow-[0_18px_36px_-18px_rgba(15,23,42,0.35),0_1px_0_rgba(255,255,255,0.95)_inset]'} ${isDraggingLayoutCard ? 'opacity-40' : ''} ${layoutDropPlacement ? 'ring-2 ring-blue-400' : ''}`}
      >
        {layoutEditing && (
          <>
            <span className="pointer-events-none absolute inset-0 z-10 rounded-xl border-2 border-dashed border-slate-300/80" aria-hidden="true" />
            <span className={`absolute left-3 top-3 z-20 inline-flex items-center rounded-full bg-slate-900/90 py-1 text-[11px] font-bold text-white ${isMiniCard ? 'gap-1 px-2 lg:gap-0.5 lg:px-1.5' : 'gap-1 px-2'}`}>
              <GripVertical className={`h-3.5 w-3.5 ${isMiniCard ? 'lg:hidden' : ''}`} aria-hidden="true" />
              {positionIndex + 1}
            </span>
            <span className="absolute right-3 top-3 z-20 flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveLayoutDraftCard(card.key, -1)}
                disabled={positionIndex === 0}
                title={`Move ${card.title} earlier`}
                aria-label={`Move ${card.title} earlier`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => moveLayoutDraftCard(card.key, 1)}
                disabled={isLastLayoutCard}
                title={`Move ${card.title} later`}
                aria-label={`Move ${card.title} later`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
            {layoutDropPlacement && (
              <span
                className={`pointer-events-none absolute top-0 z-30 h-full w-1.5 rounded-full bg-blue-500 ${layoutDropPlacement === 'after' ? 'right-0' : 'left-0'}`}
                aria-hidden="true"
              />
            )}
          </>
        )}

        {isMiniCard ? (
          <>
            <span className={`absolute right-3 top-3 z-10 flex items-center ${layoutEditing ? 'invisible' : ''}`}>
              {renderCardActionButton('mini')}
            </span>
            <div
              ref={isToolsShortcutCard ? toolsShortcutMenuRef : undefined}
              className={`relative flex w-full flex-col items-center justify-center gap-2 text-center ${layoutEditing ? 'pointer-events-none select-none' : ''}`}
            >
              {isToolsShortcutCard && card.icon ? (
                // The mini card is too small for the shortcut list, so the icon doubles
                // as the trigger for a menu of the same destinations.
                <button
                  type="button"
                  onClick={(event) => toggleToolsShortcutMenu(card.key, event.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={toolsShortcutMenuCardKey === card.key}
                  title={`${card.title} shortcuts`}
                  aria-label={`${card.title} shortcuts`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <card.icon className="h-6 w-6 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : (
                card.icon && <card.icon className="h-6 w-6 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />
              )}
              <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-gray-900">{card.title}</h3>
              {isToolsShortcutCard && toolsShortcutMenuCardKey === card.key && (
                <div
                  role="menu"
                  aria-label={`${card.title} shortcuts`}
                  className={`absolute left-1/2 z-30 w-44 -translate-x-1/2 overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-left shadow-lg ${toolsShortcutMenuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                >
                  {card.items.map((item) => {
                    const ShortcutIcon = TOOL_CARD_ICONS[item.key]
                    const accent = TOOL_CARD_ACCENTS[item.key]

                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        role="menuitem"
                        className={`flex items-center justify-between gap-2 bg-gradient-to-r px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900 ${accent.band} to-white`}
                      >
                        {item.primary}
                        {ShortcutIcon && (
                          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-white shadow-sm ${accent.tile}`}>
                            <ShortcutIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                          </span>
                        )}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={`flex items-start justify-between gap-3 ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            <div>
              <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-gray-900">
                {card.icon && <card.icon className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />}
                <span>{card.title}</span>
              </h3>
              {!isCompactCard && (
                <p className="text-sm text-gray-600 mt-2">{card.description}</p>
              )}
            </div>
            <div className={`flex shrink-0 items-center gap-1 ${layoutEditing ? 'invisible' : ''}`}>
              {renderCardActionButton(cardVariant)}
            </div>
          </div>
        )}

        {!isMiniCard && card.isProviderSpotlightCard ? (
          // Providers card: random provider website captures instead of recent records.
          // The large card lays two 3:4 captures side by side (each carrying its provider
          // name in a bottom overlay); the medium card shows one capture with the provider
          // details beside it. The medium card also carries the same small caps label the
          // other row-2 cards put above their preview. The mini card above is untouched
          // and stays icon + title.
          <div className={`${isCompactCard ? 'mt-3' : 'mt-4'} flex flex-1 flex-col ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            {!recentActivityLoading && cardItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                {card.emptyLabel}
              </p>
            ) : isCompactCard ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Featured</p>
                <div className="mt-2 min-h-0 flex-1">{cardItems[0] ? <ProviderSiteFeature item={cardItems[0]} /> : null}</div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {cardItems.slice(0, 2).map((item) => <ProviderSiteTile key={item.key} item={item} />)}
              </div>
            )}
          </div>
        ) : null}

        {!isMiniCard && usesReportArtwork ? (
          // Reports card: report-type artwork instead of the text preview. The featured
          // card lays up to two covers side by side (the list already caps at one report
          // per patient), the compact card shows its single cover full width.
          <div className={`${isCompactCard ? 'mt-3' : 'mt-4'} flex flex-1 flex-col ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{recentLabel}</p>
            <div className={`mt-2 grid flex-1 content-start gap-3 ${isCompactCard ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {cardItems.map((item) => <ReportTypeTile key={item.key} item={item} />)}
            </div>
          </div>
        ) : null}

        {!isMiniCard && isToolsShortcutCard && isCompactCard && (
          // Row 2 prints the destinations themselves instead of the single preview
          // row the data cards use, so the Tools dashboard is not a required detour.
          // The tiles are narrow, so the label takes the full width and no glyph.
          <div className={`mt-3 flex-1 ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.shortcutLabel || card.recentLabel}</p>
            <div className="mt-2 grid grid-cols-2 content-start gap-2">
              {cardItems.map((item) => {
                const accent = TOOL_CARD_ACCENTS[item.key]

                return (
                  <a
                    key={item.key}
                    href={item.href}
                    title={item.secondary}
                    className={`block truncate rounded-md border border-gray-200 bg-gradient-to-r px-2 py-2 text-sm font-medium text-gray-900 hover:border-gray-300 ${accent.band} to-white`}
                  >
                    {item.primary}
                  </a>
                )
              })}
            </div>
          </div>
        )}

        {!isMiniCard && card.isDocsCard && (
          // Docs card: two recent documents as portrait pages (see `DocumentTypeTile`),
          // side by side so the card reads like a small stack of documents.
          <div className={`${isCompactCard ? 'mt-3' : 'mt-4'} flex flex-1 flex-col ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{recentLabel}</p>
            {cardItems.length === 0 && !recentActivityLoading && (
              <p className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                {card.emptyLabel}
              </p>
            )}
            {cardItems.length > 0 && (
              <div className="mt-2 grid grid-cols-2 content-start gap-2">
                {cardItems.map((item) => (
                  <DocumentTypeTile key={item.key} item={item} detailed={!isCompactCard} />
                ))}
              </div>
            )}
          </div>
        )}

        {!isMiniCard && !card.isProviderSpotlightCard && !card.isDocsCard && !usesReportArtwork && !(isToolsShortcutCard && isCompactCard) && (
          <div className={`${isCompactCard ? 'mt-3' : 'mt-4'} flex-1 ${layoutEditing ? 'pointer-events-none select-none' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{recentLabel}</p>
            <div className={toolsShortcutItemsUseTwoColumns ? 'mt-2 grid grid-cols-2 content-start gap-2' : usesDenseItemRows ? 'mt-2 space-y-1' : 'mt-2 space-y-2'}>
              {cardItems.map((item) => {
                const ItemIcon = item.icon

                if (card.isAiUsageCard) {
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onClick}
                      className="block h-[92px] w-full overflow-hidden rounded-md border border-gray-200 px-3 py-4 text-left hover:border-gray-300 hover:bg-gray-50"
                    >
                      <span className="block text-xl font-bold text-gray-900">{item.primary}</span>
                      {item.monthlySaving && (
                        <span className="mt-2 block w-fit rounded bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                          Saves {item.monthlySaving}/mo
                        </span>
                      )}
                    </button>
                  )
                }

                if (card.isChatCard) {
                  if (item.href) {
                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        className="block rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{item.primary}</span>
                        <span className="block text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-line">{item.secondary}</span>
                      </a>
                    )
                  }

                  return (
                    <div
                      key={item.key}
                      className="block rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
                    >
                      <span className="font-medium text-gray-900">{item.primary}</span>
                      <span className="block text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-line">{item.secondary}</span>
                    </div>
                  )
                }

                if (isToolsShortcutCard) {
                  // The Tools card lists destination pages rather than records, so each
                  // row carries the same glyph and colour band as the card it opens on
                  // the Tools dashboard. Only the large (featured) card reaches here, so
                  // the roomier padding applies to it alone.
                  const ShortcutIcon = TOOL_CARD_ICONS[item.key]
                  const accent = TOOL_CARD_ACCENTS[item.key]

                  return (
                    <a
                      key={item.key}
                      href={item.href}
                      className={`block rounded-md border border-gray-200 bg-gradient-to-r px-3 py-4 text-sm text-gray-700 hover:border-gray-300 ${accent.band} to-white`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 font-medium text-gray-900">{item.primary}</span>
                        {ShortcutIcon && (
                          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white shadow-sm ${accent.tile}`}>
                            <ShortcutIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-gray-500 mt-1">{item.secondary}</span>
                    </a>
                  )
                }

                if (usesDenseItemRows) {
                  // Several rows share the height three standard rows occupy, so each
                  // row is a single line: glyph, title, then the patient as trailing
                  // meta. The title wins the space and ellipsises; the full value
                  // stays available on hover. The medium card is a fixed 220px box, so
                  // its dense rows drop the vertical padding to fit four of them.
                  const denseRowClassName = `flex min-w-0 items-center gap-2 rounded-md border border-gray-200 px-2.5 text-gray-700 hover:border-gray-300 hover:bg-gray-50 ${isCompactCard ? 'py-1' : 'py-2'}`

                  const denseRowContent = (
                    <>
                      {ItemIcon && (
                        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${item.iconClassName || 'bg-gray-100 text-gray-600'}`}>
                          <ItemIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4 text-gray-900" title={item.primary}>{item.primary}</span>
                      {item.secondary && (
                        <span className="max-w-[45%] shrink-0 truncate text-[11px] leading-4 text-gray-500" title={item.secondary}>{item.secondary}</span>
                      )}
                    </>
                  )

                  // A row that can be marked done keeps the whole row a link but carries
                  // a sibling button: a button cannot live inside an anchor.
                  if (item.onDismiss) {
                    return (
                      <div key={item.key} className="flex items-center gap-1">
                        <a href={item.href} className={`${denseRowClassName} flex-1`}>{denseRowContent}</a>
                        {renderDismissButton(item)}
                      </div>
                    )
                  }

                  return (
                    <a key={item.key} href={item.href} className={denseRowClassName}>
                      {denseRowContent}
                    </a>
                  )
                }

                const standardRowClassName = `block rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 ${card.usesUsagePreviewHeight ? 'h-[92px] overflow-hidden' : ''}`

                const standardRowContent = (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      {ItemIcon && (
                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${item.iconClassName || 'bg-gray-100 text-gray-600'}`}>
                          <ItemIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        </span>
                      )}
                      <span className={`min-w-0 flex-1 font-medium text-gray-900 ${card.usesUsagePreviewHeight ? 'block truncate' : ''}`}>{item.primary}</span>
                      {item.badge && (
                        <span className="ml-auto flex w-12 shrink-0 justify-center">
                          <span className={`inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase ${item.badge.className}`}>
                            {item.badge.label}
                          </span>
                        </span>
                      )}
                      {item.logoUrl && (
                        <Image
                          src={item.logoUrl}
                          alt=""
                          width={32}
                          height={32}
                          unoptimized
                          className="ml-auto h-8 w-8 shrink-0 rounded border border-gray-200 bg-white object-contain"
                          onError={(event) => { event.currentTarget.style.display = 'none' }}
                        />
                      )}
                    </span>
                    {item.secondary && (
                      <span className={`block text-xs text-gray-500 mt-1 ${isCompactCard ? 'line-clamp-2' : ''}`}>{item.secondary}</span>
                    )}
                  </>
                )

                if (item.onDismiss) {
                  return (
                    <div key={item.key} className="flex items-center gap-1">
                      <a href={item.href} className={`${standardRowClassName} min-w-0 flex-1`}>{standardRowContent}</a>
                      {renderDismissButton(item)}
                    </div>
                  )
                }

                return (
                  <a
                    key={item.key}
                    href={item.href}
                    className={standardRowClassName}
                  >
                    {standardRowContent}
                  </a>
                )
              })}

              {!recentActivityLoading && cardItems.length === 0 && (
                <p className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                  {card.emptyLabel}
                </p>
              )}

            </div>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <>
      <DatabaseSetupModal
        isOpen={showDbSetup}
        onClose={() => setShowDbSetup(false)}
        onSetup={handleDatabaseSetup}
        onTestConnection={testDatabaseConnection}
      />
      <SetupRequiredModal
        isOpen={!setupDismissed && (databaseConfigured === false || aiProviderConfigured === false)}
        onClose={() => setSetupDismissed(true)}
      />

      {showAuthTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Auth Test</h2>
                <p className="mt-1 text-sm text-gray-600">Validate JWTs and table access for different admin roles.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthTestModal(false)}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close auth test modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Role scenario</label>
                  <select
                    value={authTestScenario}
                    onChange={(event) => {
                      const nextScenario = event.target.value
                      setAuthTestScenario(nextScenario)
                      if (nextScenario === 'current-session') {
                        const currentToken = window.localStorage.getItem('adminToken') || ''
                        setAuthTestToken(currentToken)
                      }
                      if (nextScenario === 'custom-token') {
                        setAuthTestToken('')
                      }
                    }}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="current-session">Current session</option>
                    <option value="admin-domain">Simulated admin for domain</option>
                    <option value="custom-token">Custom JWT</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Domain</label>
                  <input
                    type="text"
                    value={authTestDomain}
                    onChange={(event) => setAuthTestDomain(event.target.value)}
                    placeholder="e.g. acme"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              </div>

              {authTestScenario === 'admin-domain' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Simulate as</label>
                  <select
                    value={authTestSimTarget}
                    onChange={(event) => setAuthTestSimTarget(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    {authTestSimOptions.map((option) => (
                      <option
                        key={option.value || 'placeholder'}
                        value={option.value}
                        disabled={option.disabled}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-700">JWT / session token</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const currentToken = window.localStorage.getItem('adminToken') || ''
                        setAuthTestToken(currentToken)
                        setAuthTestScenario('current-session')
                      }}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Use current session
                    </button>
                    <button
                      type="button"
                      onClick={simulateAuthTestAdmin}
                      disabled={authTestScenario === 'admin-domain' && !isSimulationTargetChosen(authTestSimTarget)}
                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate admin token
                    </button>
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={authTestToken}
                  onChange={(event) => setAuthTestToken(event.target.value)}
                  placeholder="Paste a JWT or use the current session"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => verifyAuthToken(authTestToken)}
                  disabled={authTestLoading}
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  {authTestLoading ? 'Checking…' : 'Verify token'}
                </button>
                <button
                  type="button"
                  onClick={() => runAuthTableAccessCheck(authTestToken)}
                  disabled={authTestLoading}
                  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  Check table access
                </button>
              </div>

              {(currentAdminUser || authTestResult || authTestTableResult || authTestError) && (
                <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current session</div>
                  <div className="grid gap-2 text-sm text-gray-700 md:grid-cols-3">
                    <div><span className="font-medium text-gray-900">Username:</span> {currentAdminUser?.username || 'unknown'}</div>
                    <div><span className="font-medium text-gray-900">Role:</span> {currentAdminUser?.role ? getAdminRoleLabel(currentAdminUser.role) : 'unknown'}</div>
                    <div><span className="font-medium text-gray-900">Domain:</span> {currentAdminUser?.domain || 'n/a'}</div>
                  </div>

                  {authTestError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {authTestError}
                    </div>
                  )}

                  {(authTestResult || authTestTableResult) && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {authTestResult ? 'JWT verification' : 'Table access / RLS check'}
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-700">
                        {JSON.stringify(authTestResult || authTestTableResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowAuthTestModal(false)}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiUsageModal && aiUsageSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Usage</h2>
                <p className="mt-1 text-sm text-gray-600">Platform cost and value comparison for the last {aiUsageSummary.periodDays} days.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAiUsageModal(false)}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close usage details"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-12">
              <div className="rounded-lg bg-gray-50 px-4 py-4 lg:col-span-8">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estimated Monthly Platform Cost</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(usageTotalMonthlyCost, usageBillingCurrency)}</p>
                <div className="mt-3 space-y-1 text-sm text-gray-700">
                  <div className="flex items-center justify-between gap-4">
                    <span>Website</span>
                    <span className="font-medium text-gray-900">{formatCurrency(usageValueSummary?.websiteMonthlyCost || 0, usageBillingCurrency)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      AI usage
                      {aiUsageSummary.usageMarkupPercent > 0 ? ` (incl. ${aiUsageSummary.usageMarkupPercent}% markup)` : ''}
                    </span>
                    <span className="font-medium text-gray-900">{formatCurrency(aiUsageSummary.roundedMonthlyCost, usageBillingCurrency)}</span>
                  </div>
                </div>
                {aiUsageModelNames.length > 1 ? (
                  <p className="mt-3 text-xs text-gray-600">Models: {aiUsageModelNames.join(', ')}</p>
                ) : (
                  <p className="mt-3 text-xs text-gray-600">Model: {aiUsageSummary.model || aiUsageModelNames[0] || 'Unknown'}</p>
                )}
                {aiUsageSummary.usageMarkupPercent > 0 && (
                  <p className="mt-1 text-xs text-gray-600">
                    Base AI: {formatCurrency(aiUsageSummary.roundedBaseMonthlyCost, usageBillingCurrency)}
                    {' · '}
                    Markup: {formatCurrency(aiUsageSummary.markupAmount, usageBillingCurrency)}
                    {' · '}
                    {aiUsageSummary.customerCohortLabel || 'Assigned cohort'}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
                <div className="rounded-lg border border-gray-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reports</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{formatInteger(aiUsageSummary.reportCount)}</p>
                  <p className="mt-1 text-sm text-gray-600">{formatInteger(aiUsageSummary.reportInputTokens + aiUsageSummary.reportOutputTokens)} tokens</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Transcripts</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{formatInteger(aiUsageSummary.transcriptCount)}</p>
                  <p className="mt-1 text-sm text-gray-600">{formatInteger(aiUsageSummary.transcriptTokens)} tokens</p>
                </div>
              </div>

              {usageReplacedTools.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 lg:col-span-12">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-800">Value Comparison</p>
                  <p className="mt-2 text-2xl font-bold text-green-900">
                    {formatCurrency(usageValueSummary.netMonthlySaving, usageBillingCurrency)} saved / month
                  </p>
                  <p className="mt-1 text-sm text-green-800">
                    {formatCurrency(usageValueSummary.netAnnualSaving, usageBillingCurrency)} per year versus the tools this platform replaces.
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-gray-700">
                    {usageReplacedTools.map((tool) => (
                      <div key={tool.name} className="flex items-center justify-between gap-4">
                        <span>{tool.name}</span>
                        <span className="font-medium text-gray-900">{formatCurrency(tool.monthlyCost, usageBillingCurrency)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 border-t border-green-200 pt-2">
                      <span>Total replaced software subscription spend</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(usageValueSummary.replacedToolsMonthlyCost, usageBillingCurrency)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>This platform</span>
                      <span className="font-semibold text-gray-900">-{formatCurrency(usageTotalMonthlyCost, usageBillingCurrency)}</span>
                    </div>
                  </div>
                </div>
              )}

              {aiUsageModelBreakdown.length > 1 && (
                <div className="rounded-lg border border-gray-200 px-4 py-4 lg:col-span-7">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Model Cost Breakdown</p>
                  <div className="mt-3 space-y-2 text-sm text-gray-700">
                    {aiUsageModelBreakdown.map((entry) => (
                      <div key={entry.model} className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-gray-900">{entry.model || 'Unknown model'}</p>
                          <p className="text-xs text-gray-500">{formatInteger(entry.totalTokens)} tokens</p>
                        </div>
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(entry.estimatedCost, aiUsageSummary.billingCurrency)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={`rounded-lg border border-gray-200 px-4 py-4 ${aiUsageModelBreakdown.length > 1 ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Token Detail</p>
                <div className="mt-3 space-y-2 text-sm text-gray-700">
                  <div className="flex items-center justify-between gap-4">
                    <span>Report input tokens</span>
                    <span className="font-medium text-gray-900">{formatInteger(aiUsageSummary.reportInputTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Report output tokens</span>
                    <span className="font-medium text-gray-900">{formatInteger(aiUsageSummary.reportOutputTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Transcript tokens</span>
                    <span className="font-medium text-gray-900">{formatInteger(aiUsageSummary.transcriptTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-gray-100 pt-2">
                    <span>Total estimated tokens</span>
                    <span className="font-semibold text-gray-900">{formatInteger(aiUsageSummary.totalEstimatedTokens)}</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-500 lg:col-span-12">Uses stored token metadata when available and falls back to text-length estimation otherwise.</p>
            </div>

            <div className="flex shrink-0 justify-end border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowAiUsageModal(false)}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content Modal */}
      {selectedContentType && (
        <ContentModal
          isOpen={showContentModal}
          item={selectedContentItem}
          typeConfig={selectedContentType}
          domain={selectedContentType.domain}
          isReadOnly={false}
          onChange={handleContentChange}
          onSave={handleContentSave}
          onClose={() => {
            setShowContentModal(false)
            setSelectedContentItem(null)
            setSelectedContentType(null)
          }}
          isSaving={false}
          error={null}
        />
      )}

      <div className="min-h-screen">
        {adminToolsVisible && (
          <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
            <div className="relative">
              {showAuthTestMenu && (
                <div className="absolute bottom-14 left-1/2 w-64 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                  {showVersionBadge && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left">
                      <div className="font-mono text-[10px] leading-relaxed text-gray-600">
                        v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString() : 'dev'}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={openAuthTestModal}
                    className="mt-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <span>Auth test</span>
                    <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v.01M12 12a2 2 0 002-2V9a2 2 0 10-4 0v1a2 2 0 002 2zm0 0v3" />
                    </svg>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAuthTestMenu((value) => !value)}
                aria-label="Admin tools menu"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-xl text-gray-700 shadow-lg transition-transform hover:scale-105 hover:shadow-xl"
              >
                ⋮
              </button>
            </div>
          </div>
        )}

        {/* Backend Status Banner */}
        {showBackendOfflineWarning && (
          <div className="bg-red-600 text-white px-4 py-3">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-semibold">API Not Available</p>
                  <p className="text-sm text-red-100">Database and API services are not responding. Please check your configuration in Settings.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <AdminHeader />

        {/* Status Indicators */}
        {showBackendOfflineWarning && (
          <div className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center gap-4">
                <span className="px-3 py-1 bg-red-100 text-red-800 text-sm rounded-full">
                  ⚠️ API Offline
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {showTopStatsRow && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Stats Cards */}
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Posts</p>
                      <p className="text-3xl font-bold text-gray-900">12</p>
                    </div>
                    <div className="bg-blue-100 rounded-full p-3">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Pages</p>
                      <p className="text-3xl font-bold text-gray-900">8</p>
                    </div>
                    <div className="bg-green-100 rounded-full p-3">
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Media</p>
                      <p className="text-3xl font-bold text-gray-900">45</p>
                    </div>
                    <div className="bg-purple-100 rounded-full p-3">
                      <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions */}
            {quickActionsEnabled && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold tracking-tight text-gray-900">Quick Actions</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {quickActions.map((action) => (
                    <div key={action.key} className="relative" ref={action.isCreateFcaAction ? fcaQuickMenuRef : undefined}>
                      <button
                        onClick={action.onClick}
                        className={`group relative w-full overflow-hidden rounded-lg border border-white/50 bg-gradient-to-br ${action.tone} px-3 py-2 text-slate-900 shadow-md ${action.glow} transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-600/70`}
                        style={action.isCustom
                          ? {
                            backgroundImage: `linear-gradient(135deg, ${action.customColor}55 0%, ${action.customColor}99 100%)`,
                          }
                          : action.key === 'post'
                            ? { backgroundImage: 'linear-gradient(135deg, #bae6fd 0%, #93c5fd 50%, #c7d2fe 100%)' }
                            : action.key === 'page'
                              ? { backgroundImage: 'linear-gradient(135deg, #fde68a 0%, #fbbf24 50%, #fed7aa 100%)' }
                              : undefined}
                      >
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.55),transparent_52%)]" />
                        <div className="relative flex items-center justify-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-white/60 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
                            {action.isCustom ? (
                              <span className="text-sm leading-none">{action.icon}</span>
                            ) : (
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            )}
                          </span>
                          <span className="text-xs font-semibold tracking-wide">{action.label}</span>
                        </div>
                      </button>

                      {action.isCreateFcaAction && showFcaQuickMenu && (
                        <div className="absolute left-0 right-0 z-20 mt-2 rounded-lg border border-orange-200 bg-white p-2 shadow-xl">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-orange-700">Create For Recent Patient</p>
                          <div className="mt-1 space-y-1">
                            {recentPatientUpdates.map((patient) => {
                              const patientId = String(patient?.id || '').trim()
                              const patientName = String(patient?.patient_name || '').trim() || 'Untitled patient'
                              if (!patientId) return null

                              const launchHref = `/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=overview`

                              return (
                                <button
                                  key={patientId}
                                  type="button"
                                  onClick={() => {
                                    setShowFcaQuickMenu(false)
                                    router.push(launchHref)
                                  }}
                                  className="block w-full rounded-md border border-orange-100 bg-orange-50 px-2 py-2 text-left text-xs text-orange-900 transition-colors hover:border-orange-200 hover:bg-orange-100"
                                >
                                  <span className="block truncate font-medium">{patientName}</span>
                                  <span className="block truncate text-[11px] text-orange-700">{patient?.updated_at ? `Updated ${formatRelativeTime(patient.updated_at)}` : 'No update timestamp'}</span>
                                </button>
                              )
                            })}

                            {recentPatientUpdates.length === 0 && (
                              <p className="rounded-md border border-dashed border-orange-200 px-2 py-2 text-xs text-orange-700">
                                No recent patients available yet.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
                {featuredDashboardCards.map((card, index) => renderDashboardCard(card, 'featured', index))}
              </div>

              {compactRowDashboardCards.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                  {compactRowDashboardCards.map((card, index) => renderDashboardCard(card, 'compact', featuredDashboardCards.length + index))}
                </div>
              )}

              {miniDashboardCards.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-9 gap-3">
                  {miniDashboardCards.map((card, index) => renderDashboardCard(card, 'mini', featuredDashboardCards.length + compactRowDashboardCards.length + index))}
                </div>
              )}

              {layoutEditing && (
                <div
                  onDragOver={(event) => {
                    if (!layoutDraggingKey) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    updateLayoutDropTarget({ cardKey: '', placement: 'end' })
                  }}
                  onDragLeave={() => setLayoutDropTarget((prev) => (prev?.placement === 'end' ? null : prev))}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (layoutDraggingKey) {
                      sendLayoutDraftCardToEnd(layoutDraggingKey)
                    }
                    setLayoutDraggingKey('')
                    setLayoutDropTarget(null)
                  }}
                  className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-xs font-medium transition-colors ${layoutDropTarget?.placement === 'end' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-500'}`}
                >
                  Drop a panel here to move it to the last position
                </div>
              )}

              {homePageBlockEditorEnabled && (
                <button
                  onClick={() => router.push('/admin/homepage')}
                  className="bg-white rounded-lg shadow p-6 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 mt-1">Home Page</h3>
                      <p className="text-sm text-gray-600 mt-2">Manage the practice home page and sample content.</p>
                    </div>
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              )}

              <div className="flex flex-wrap items-end justify-between gap-4">
                {!layoutEditing ? (
                  <button
                    type="button"
                    onClick={startLayoutEditing}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit layout
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="max-w-md">
                      <h2 className="text-xl font-bold tracking-tight text-gray-900">Panels</h2>
                      <p className="text-sm text-gray-600">
                        Drag a panel to move it — the first three appear as large cards, the next five as medium cards, and anything after that as compact rows. This layout is yours; it does not change the domain default on /domains.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {layoutStatus && (
                        <span className={`text-xs font-medium ${layoutStatus.tone === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                          {layoutStatus.message}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={resetLayoutDraftOrder}
                        disabled={layoutSaving}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reset to default
                      </button>
                      <button
                        type="button"
                        onClick={stopLayoutEditing}
                        disabled={layoutSaving}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveDashboardLayout}
                        disabled={layoutSaving}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {layoutSaving ? 'Saving…' : 'Save layout'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-xs text-gray-500">
                    {refreshingAll || recentActivityLoading
                      ? 'Refreshing...'
                      : `Last refreshed: ${formatLastRefreshed(lastRefreshedAt)}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleRefreshAll}
                    disabled={refreshingAll}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Refresh Data
                  </button>
                </div>
              </div>
            </div>

            {recentUpdatesEnabled && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Recent Updates</h2>
                </div>
                <div className="space-y-4">
                  {!recentActivityLoading && recentContentUpdates.map((item) => {
                    const iconClasses = getActivityIconClasses(item.type)
                    return (
                      <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                        <div className={`${iconClasses.wrap} rounded-full p-2`}>
                          <svg className={`w-5 h-5 ${iconClasses.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                          <p className="text-xs text-gray-600 truncate">{item.description}</p>
                          <p className="text-xs text-gray-500 mt-1">{item.timestamp ? formatRelativeTime(item.timestamp) : 'No timestamp yet'}</p>
                        </div>
                      </div>
                    )

                  })}

                  {!recentActivityLoading && recentContentUpdates.length === 0 && (
                    <div className="text-sm text-gray-600">No content updates found yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
