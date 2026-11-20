'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, MoreVertical, Plus } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import ReportViewerPanel from '@/admin-ui/components/ReportViewerPanel'
import PatientCasesPanel from '@/admin-ui/components/PatientCasesPanel'
import PatientQuotesPanel from '@/admin-ui/components/PatientQuotesPanel'
import PatientServiceAgreementsPanel from '@/admin-ui/components/PatientServiceAgreementsPanel'
import PatientAppointmentsPanel from '@/admin-ui/components/PatientAppointmentsPanel'
import PatientFormsPanel from '@/admin-ui/components/PatientFormsPanel'
import PatientContactsPanel from '@/admin-ui/components/PatientContactsPanel'
import PatientNotesPanel from '@/admin-ui/components/PatientNotesPanel'
import { getAdminAuthHeaders as resolveAdminAuthHeaders, getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getDomainDisplayLabel } from '@/lib/assistantConfig'
import { DEFAULT_WORKER_VISIBILITY, readWorkerVisibility } from '@/lib/aiWorkers'
import { DEFAULT_QUOTE_WRITER_AGENT_CONFIG } from '@/lib/patientQuoteDrafting'
import { isQuoteWriterQuote, isUnreviewedWorkerQuote } from '@/lib/workerProvenance'
import { buildWorkerReviewItems, summarizeWorkerReviewItems } from '@/lib/workerReviewQueue'
import { summarizeAnalysisDocuments } from '@/lib/patientAnalysisDisplay'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'
import { isDocsBackedPageEnabled } from '@/lib/domainFeatureFlags'
import { getPrivateDomainFcaBuilderArtwork, hasPrivateDomainTrait } from '@/lib/domainExtension'
import { buildEquipmentQuoteRequest, resolveDomainLogoUrl } from '@/lib/equipmentQuoteRequest'
import { DEFAULT_EXTERNAL_SOURCE, parsePatientCsv } from '@/lib/patients'
import { groupEvidenceFactsByDomain, isStructuredSummaryStyle, normalizeStructuredEvidenceFacts, splitScribeSummaryText } from '@/lib/scribeSummaryDisplay'
import { encodeWavFromFloat32, getAudioExtensionFromMimeType, maybeConvertAudioBlobToWav, mergeFloat32Chunks, splitTranscriptIntoUtterances } from './patientMedia'
import { buildPatientMetadata, createDraftSnapshot, derivePatientName, getOverviewDobValue, getOverviewNameValue, getOverviewSuburbValue, normalizeAddressValue, resolveDobField, resolvePatientNameField, resolveSuburbField, toPatientDraft } from './patientMetadata'
import { AGENT_CARD_STYLES, buildDerivedScribeWorkerPrompt, DEFAULT_ANALYST_AGENT_CONFIG, DEFAULT_BILLING_AGENT_CONFIG, DEFAULT_HSR_CREATOR_AGENT_CONFIG, DEFAULT_HSR_SUMMARISER_AGENT_CONFIG, DEFAULT_PATIENT_BILLING_FORM, DEFAULT_REPORTING_AGENT_CONFIG, DEFAULT_SCRIBE_AGENT_CONFIG, DEFAULT_SPLPOSE_FIELDS, DEFAULT_SUMMARY_STYLE, describeSummaryStyleLabel, FCA_SUMMARY_STYLE, findBySummaryStyle, isAgentActiveForPatient, normalizePatientAgents, normalizeSummaryStyleKey, PATIENT_MODAL_TABS, PRIMARY_SUMMARY_STYLE_ORDER, REPORTING_COMPARATIVE_OPTIONS, resolveSummaryStyleRank, shortenScribeActionItemWording, shortenScribeSummaryWording, SUMMARY_STYLE_ORDER } from './patientPageConfig'
import { PatientTabButton } from './PatientPageParts'
import { fetchWithTimeout, getReportTypeKey, getReportTypeLabelForReport, isGeneratedReportDraft, isInProgressReport, isWorkingReportDraft, resolveReportEnqueueMethodInfo, resolveReportingSaveImpact } from './patientReporting'
import { formatDraftTimestamp, safeMetadata, sanitizeModalErrorMessage, toIsoOrNull, toLocalDatetimeInput } from './patientUtils'
import PatientAnalysisTab from './PatientAnalysisTab'
import PatientBillingTab from './PatientBillingTab'
import PatientEquipmentTab from './PatientEquipmentTab'
import PatientFilesTab from './PatientFilesTab'
import PatientOverviewTab from './PatientOverviewTab'
import PatientReportTab from './PatientReportTab'
import PatientTranscriptsTab from './PatientTranscriptsTab'

// The Transcript Summariser stores one summary per transcript per style, so the patient Summary
// tab is a style-based reader: each stored style gets its own view and its own label. Keep the
// labels here rather than inline so the style tabs, the summary action menu and the delete
// The FCA summary is produced by the FCA prerequisite pass (not by the Scribe agent's own
// Canonical style order for the Summary tab. Unlisted styles sort last so a newly added
// When the patient has an FCA summary it leads the version strip instead of following the

// Stored styles are matched case-insensitively, and an empty request matches nothing (a summary

// 'forms' has no tab of its own — submitted forms render at the bottom of the
// Info pane — and 'summary' no longer has one either, now that summaries render
// inside the Transcripts pane. Both stay in the set only so `?tab=` deep links
// (the Forms admin page, the dashboard Forms card, and saved summary links) still

// Agents that are only meaningful for NDIS-funded patients — the FCA Builder drives the
// `reporting` agent. The AI workers grid marks these cards with `autoActiveForNdis`, but
// the full-width hero cards resolve the agent by key alone, so the key list is the canonical
// source for both call shapes. Without it a key-only lookup falls through to the stored agent

function PatientModal({
    isOpen,
    isPopOutView,
    mode,
    activeDomain,
    domainDisplayName,
    domainSourcingReplyTo,
    domainSourcingReplyToName,
    domainSourcingBccReplyToDefault,
    domainSourcingEmailSignature,
    domainSourcingLogoUrl,
    workerVisibility,
    appointmentsEnabled,
    formsEnabled,
    openCurrentReportOnLoad,
    initialTab,
    draft,
    fields,
    saving,
    hasUnsavedChanges,
    error,
    onClose,
    onSave,
    onSaveAndClose,
    onChangeField,
    onChangeAddressField,
    onChangeOverviewName,
    onChangeOverviewSuburb,
    onChangeOverviewDob,
    onToggleAgent,
    onChangeAgentConfig,
    agentSavingKey,
    reportJobStatus,
    reportJobLoading,
    onReportReviewed,
    reportSaveImpact,
    billingJobStatus,
    billingJobLoading,
    analysisJobStatus,
    analysisJobLoading,
    equipmentSourcing,
    equipmentSourcingLoading,
    equipmentSourcingError,
    scribeJobStatus,
    scribeJobLoading,
    scribeSummary,
    scribeSummaries,
    scribeSummaryLoading,
    scribeSummaryError,
    scribeSummaryDeleting,
    patientAnalysis,
    patientAnalysisLoading,
    patientAnalysisError,
    analysisDeleting,
    formalReport,
    reportDrafts,
    reportDraftsLoading,
    reportDraftsError,
    patients,
    onFetchComparativeReportDrafts,
    patientFiles,
    patientFilesLoading,
    patientFileUploading,
    patientFileDeletingId,
    patientFilesError,
    onUploadPatientFile,
    onPreviewPatientFile,
    onDownloadPatientFile,
    onDeletePatientFile,
    analysisEvidenceFileId,
    analysisEvidenceError,
    onToggleAnalysisEvidenceFile,
    billingRecords,
    billingLoading,
    billingSubmitting,
    billingDeletingId,
    billingError,
    billingForm,
    onRefreshBilling,
    onRefreshAnalysis,
    onRefreshEquipmentSourcing,
    onSetEquipmentSourcingError,
    onRefreshSummary,
    onDeleteAnalysis,
    onRerunAnalysis,
    analysisRerunning,
    onDeleteSummary,
    onRefreshFormalReport,
    onRefreshReportDrafts,
    onChangeBillingForm,
    onAddBillingRecord,
    onDeleteBillingRecord,
    transcriptionRecords,
    transcriptionLoading,
    transcriptionDeletingId,
    transcriptionError,
    recorderSupported,
    recorderReady,
    recorderPermission,
    recorderHint,
    recorderActive,
    recorderBusy,
    liveTranscript,
    onRefreshTranscriptions,
    onDeleteTranscription,
    onRestoreTranscription,
    onStartRecording,
    onStopRecording,
    focusedTranscriptionId,
}) {
    const [activeTab, setActiveTab] = useState('overview')
    // The strip can hold more tabs than the header is wide, so it scrolls
    // sideways; this drives the affordances either side of it.
    const [tabStripOverflow, setTabStripOverflow] = useState({ left: false, right: false })
    const tabStripRef = useRef(null)
    // "+ Add" only offers the record types this patient is missing, and hands the
    // chosen tab a one-shot intent to open its create form. The same probe decides
    // which record tabs are worth showing at all.
    const [pendingCreateTab, setPendingCreateTab] = useState(null)
    const [addMenuOpen, setAddMenuOpen] = useState(false)
    // The "+ Add" trigger sits inside the horizontally scrolling tab bar, and that scroller
    // clips its own overflow (overflow-x: auto forces overflow-y to auto), so the menu is not
    // a child of the trigger: it renders fixed and is placed from the trigger's rect.
    const [addMenuPosition, setAddMenuPosition] = useState(null)
    const [recordPresence, setRecordPresence] = useState(null)
    // Worker-draft quotes, for the Overview review queue. Separate from
    // `recordPresence` because that probe answers "does the patient have any?"
    // with a single row and ignores status.
    const [quoteWorkerDrafts, setQuoteWorkerDrafts] = useState([])
    const [quoteWorkerContent, setQuoteWorkerContent] = useState({ patientId: '', hasContent: false })
    const addMenuRef = useRef(null)
    const addMenuAnchorRef = useRef(null)
    const [showAnalysisMetadata, setShowAnalysisMetadata] = useState(false)
    const [showAnalysisPrompt, setShowAnalysisPrompt] = useState(false)
    const [showSummaryMetadata, setShowSummaryMetadata] = useState(false)
    const [showSummaryPrompt, setShowSummaryPrompt] = useState(false)
    // Empty means "no style asked for by name": the Summary pane then opens on the patient's
    // primary style (the FCA summary when they have one, otherwise the generic style).
    const [selectedSummaryStyle, setSelectedSummaryStyle] = useState('')
    // Summaries are stored per transcript, so a style alone is not enough to identify the
    // summary being viewed. Null means "newest summary stored for the selected style".
    const [selectedSummaryTranscriptId, setSelectedSummaryTranscriptId] = useState(null)
    const [selectedTranscriptId, setSelectedTranscriptId] = useState(null)
    // A Summary sits above these recordings when one exists, so the Transcripts pane can be
    // tall enough to hide the recordings table below the fold. The pane's "Recordings"
    // affordances scroll the table into view and pulse a ring around it; a counter (rather than
    // a boolean) lets a repeat click restart the pulse.
    const previousRecordingsRef = useRef(null)
    const [previousRecordingsPulse, setPreviousRecordingsPulse] = useState(0)
    useEffect(() => {
        if (!previousRecordingsPulse) return undefined
        const timer = setTimeout(() => setPreviousRecordingsPulse(0), 1600)
        return () => clearTimeout(timer)
    }, [previousRecordingsPulse])
    const scrollToPreviousRecordings = useCallback(() => {
        const node = previousRecordingsRef.current
        if (!node) return
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setPreviousRecordingsPulse((value) => value + 1)
    }, [])
    const [selectedReportKeys, setSelectedReportKeys] = useState([])
    const [reportVersionSelection, setReportVersionSelection] = useState({})
    const [openReport, setOpenReport] = useState(null)
    const [openReportMarkdown, setOpenReportMarkdown] = useState('')
    const [reportActionMessage, setReportActionMessage] = useState('')
    const [reportActionTone, setReportActionTone] = useState('info')
    const [reportSavingId, setReportSavingId] = useState('')
    const [reportDeletingKey, setReportDeletingKey] = useState('')
    const [reportBulkDeleting, setReportBulkDeleting] = useState(false)
    const [reportExportingId, setReportExportingId] = useState('')
    const [openAgentSettingsKey, setOpenAgentSettingsKey] = useState('')
    const [comparativeDraftsByOption, setComparativeDraftsByOption] = useState({})
    const [comparativeDraftLoadedPatientByOption, setComparativeDraftLoadedPatientByOption] = useState({})
    const [comparativeDraftLoadingByOption, setComparativeDraftLoadingByOption] = useState({})
    const [comparativeDraftErrorByOption, setComparativeDraftErrorByOption] = useState({})
    const [equipmentItemDrafts, setEquipmentItemDrafts] = useState({})
    const [sourcingWizardItem, setSourcingWizardItem] = useState(null)
    const [sourcingWizardSaving, setSourcingWizardSaving] = useState(false)
    const [sourcingWizardError, setSourcingWizardError] = useState('')
    const [sourcingSuppliers, setSourcingSuppliers] = useState([])
    const [sourcingSupplierId, setSourcingSupplierId] = useState(null)
    const [expandedSourcingSupplierIds, setExpandedSourcingSupplierIds] = useState([])
    const [sourcingQuoteDraft, setSourcingQuoteDraft] = useState(null)
    const [sourcingQuoteViewType, setSourcingQuoteViewType] = useState('html')
    const [sourcingQuoteSent, setSourcingQuoteSent] = useState('')
    const [showSourcingReplyToAddress, setShowSourcingReplyToAddress] = useState(false)
    const [showSourcingEmailOptions, setShowSourcingEmailOptions] = useState(false)
    const [unavailableAgentActionKey, setUnavailableAgentActionKey] = useState('')
    const [sourcingBccReplyTo, setSourcingBccReplyTo] = useState(domainSourcingBccReplyToDefault === true)
    const [equipmentSuggestionMenuIndex, setEquipmentSuggestionMenuIndex] = useState(null)
    const [equipmentSuggestionResettingIndex, setEquipmentSuggestionResettingIndex] = useState(null)
    const openedCurrentReportFromQueryRef = useRef(false)

    const sourcingPracticeName = String(domainDisplayName || '').trim() || activeDomain
    const sourcingReplyToEmail = String(domainSourcingReplyTo || '').trim()
    const sourcingReplyToName = String(domainSourcingReplyToName || '').trim()
    const sourcingBccReplyToDefault = domainSourcingBccReplyToDefault === true
    const sourcingEmailSignature = String(domainSourcingEmailSignature || '').trim()
    const sourcingLogoUrl = String(domainSourcingLogoUrl || '').trim()

    const closeSourcingWizard = () => {
        setSourcingWizardItem(null)
        setSourcingWizardSaving(false)
        setSourcingWizardError('')
        setSourcingSuppliers([])
        setSourcingSupplierId(null)
        setExpandedSourcingSupplierIds([])
        setSourcingQuoteDraft(null)
        setSourcingQuoteViewType('html')
        setSourcingQuoteSent('')
        setSourcingBccReplyTo(sourcingBccReplyToDefault)
        setShowSourcingReplyToAddress(false)
        setShowSourcingEmailOptions(false)
    }

    const toggleSourcingSupplierDetails = (supplierId) => {
        setExpandedSourcingSupplierIds((current) => (current.includes(supplierId) ? current.filter((id) => id !== supplierId) : [...current, supplierId]))
    }

    const confirmSourcingItemDetails = async () => {
        if (!sourcingWizardItem) return
        setSourcingWizardSaving(true)
        setSourcingWizardError('')
        try {
            const response = await fetch('/api/database/patients/equipment-suggestions', {
                method: 'PATCH',
                headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: activeDomain,
                    patient_id: draft?.id,
                    item_index: sourcingWizardItem.index,
                    name: sourcingWizardItem.name,
                    description: sourcingWizardItem.description,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to update equipment item')

            setEquipmentItemDrafts((current) => ({
                ...current,
                [sourcingWizardItem.key]: {
                    name: sourcingWizardItem.name.trim(),
                    description: sourcingWizardItem.description.trim(),
                },
            }))

            const token = await getOrCreateAdminTokenForLocalhost()
            const query = `${sourcingWizardItem.name} ${sourcingWizardItem.description}`.trim()
            const matchResponse = await fetch(`/api/equipment/match?q=${encodeURIComponent(query)}&limit=3`, {
                cache: 'no-store',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
            const matchData = await matchResponse.json().catch(() => ({}))
            if (!matchResponse.ok) throw new Error(matchData?.error || 'Failed to search the equipment catalog')

            const matches = matchData.suppliers || []
            setSourcingSuppliers(matches)
            setSourcingSupplierId(matches[0]?.id ?? null)
            setExpandedSourcingSupplierIds([])
            setSourcingWizardItem((current) => current && { ...current, step: 2 })
            await onRefreshEquipmentSourcing?.()
        } catch (wizardError) {
            setSourcingWizardError(wizardError?.message || 'Failed to update equipment item')
        } finally {
            setSourcingWizardSaving(false)
        }
    }

    const resetEquipmentSuggestionStatus = async (itemIndex) => {
        setEquipmentSuggestionMenuIndex(null)
        setEquipmentSuggestionResettingIndex(itemIndex)
        onSetEquipmentSourcingError('')
        try {
            const response = await fetch('/api/database/patients/equipment-suggestions', {
                method: 'PATCH',
                headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reset_status',
                    domain: activeDomain,
                    patient_id: draft?.id,
                    item_index: itemIndex,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to reset equipment suggestion status')
            await onRefreshEquipmentSourcing?.()
        } catch (resetError) {
            onSetEquipmentSourcingError(resetError?.message || 'Failed to reset equipment suggestion status')
        } finally {
            setEquipmentSuggestionResettingIndex(null)
        }
    }

    const prepareSourcingQuoteDraft = () => {
        const supplier = sourcingSuppliers.find((candidate) => candidate.id === sourcingSupplierId)
        if (!supplier || !sourcingWizardItem) return
        const answers = draft?.answers || {}
        const { subject, body, html } = buildEquipmentQuoteRequest({
            itemName: sourcingWizardItem.name,
            itemDescription: sourcingWizardItem.description,
            supplierName: supplier.supplier,
            funderType: answers.funding_source_or_referral_type || '',
            funderReference: answers.claim_or_reference_number || '',
            practiceName: sourcingPracticeName,
            senderName: 'Equipment Sourcing',
            emailSignature: sourcingEmailSignature,
            domainLogoUrl: sourcingLogoUrl,
        })
        setSourcingWizardError('')
        setSourcingBccReplyTo(sourcingBccReplyToDefault)
        setSourcingQuoteDraft({ toEmail: supplier.email || '', subject, body, html })
        setSourcingQuoteViewType('html')
        setSourcingWizardItem((current) => current && { ...current, step: 3 })
    }

    const sendSourcingQuoteRequest = async () => {
        if (!sourcingWizardItem || !sourcingQuoteDraft) return
        const supplier = sourcingSuppliers.find((candidate) => candidate.id === sourcingSupplierId)
        setSourcingWizardSaving(true)
        setSourcingWizardError('')
        try {
            const response = await fetch('/api/database/patients/equipment-suggestions', {
                method: 'POST',
                headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: activeDomain,
                    patient_id: draft?.id,
                    item_index: sourcingWizardItem.index,
                    supplier_id: supplier?.id ?? null,
                    supplier_name: supplier?.supplier || '',
                    supplier_website: supplier?.website_url || '',
                    to_email: sourcingQuoteDraft.toEmail,
                    subject: sourcingQuoteDraft.subject,
                    body: sourcingQuoteDraft.body,
                    html: sourcingQuoteDraft.html,
                    bcc_reply_to: sourcingBccReplyTo,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to queue quote request')
            setSourcingQuoteSent(`Quote request queued for ${supplier?.supplier || sourcingQuoteDraft.toEmail}.`)
            await onRefreshEquipmentSourcing?.()
        } catch (wizardError) {
            setSourcingWizardError(wizardError?.message || 'Failed to queue quote request')
        } finally {
            setSourcingWizardSaving(false)
        }
    }

    // "Quote received" items link straight to the inbound supplier email that
    // was matched to the quote request.
    const openSourcingReplyMessage = (messageId) => {
        if (typeof window === 'undefined') return
        const normalizedId = String(messageId || '').trim()
        if (!normalizedId) return

        const targetUrl = new URL(`/admin/messages/${encodeURIComponent(normalizedId)}`, window.location.origin)
        targetUrl.searchParams.set('direction', 'inbound')
        window.location.assign(targetUrl.toString())
    }

    useEffect(() => {
        if (!isOpen) {
            setActiveTab('overview')
            setShowAnalysisMetadata(false)
            setShowAnalysisPrompt(false)
            setShowSummaryMetadata(false)
            setShowSummaryPrompt(false)
            setSelectedSummaryStyle('')
            setSelectedSummaryTranscriptId(null)
            setSelectedTranscriptId(null)
            setSelectedReportKeys([])
            setReportVersionSelection({})
            setOpenReport(null)
            setOpenReportMarkdown('')
            setReportActionMessage('')
            setReportActionTone('info')
            setReportSavingId('')
            setReportDeletingKey('')
            setReportBulkDeleting(false)
            setReportExportingId('')
            setOpenAgentSettingsKey('')
            setComparativeDraftsByOption({})
            setComparativeDraftLoadedPatientByOption({})
            setComparativeDraftLoadingByOption({})
            setComparativeDraftErrorByOption({})
            setEquipmentItemDrafts({})
            setSourcingWizardItem(null)
            setSourcingWizardSaving(false)
            setSourcingWizardError('')
            setSourcingSuppliers([])
            setSourcingSupplierId(null)
            setExpandedSourcingSupplierIds([])
            setSourcingQuoteDraft(null)
            setSourcingQuoteSent('')
            openedCurrentReportFromQueryRef.current = false
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        const requestedTab = PATIENT_MODAL_TABS.has(initialTab) ? initialTab : 'overview'
        // Submitted forms live at the bottom of the Info pane and summaries now
        // live inside the Transcripts pane, so `?tab=forms` and `?tab=summary`
        // deep links land on those panes instead of a tab of their own.
        const resolvedTab = requestedTab === 'forms'
            ? 'intake'
            : requestedTab === 'summary'
                ? 'transcripts'
                : requestedTab
        const requestedTabEnabled = resolvedTab !== 'appointments' || appointmentsEnabled
        setActiveTab(requestedTabEnabled ? resolvedTab : 'overview')
    }, [isOpen, initialTab, appointmentsEnabled, formsEnabled])

    useEffect(() => {
        const normalizedId = String(focusedTranscriptionId || '').trim()
        if (!isOpen || !normalizedId || transcriptionRecords.length === 0) return

        const matchingRecord = transcriptionRecords.find((record) => String(record?.id || '') === normalizedId)
        if (!matchingRecord) return

        setActiveTab('transcripts')
        setSelectedTranscriptId(normalizedId)
    }, [focusedTranscriptionId, isOpen, transcriptionRecords])

    useEffect(() => {
        if ((openAgentSettingsKey !== 'reporting' && openAgentSettingsKey !== 'billing' && openAgentSettingsKey !== 'analyst' && openAgentSettingsKey !== 'scribe' && openAgentSettingsKey !== 'hsrCreator' && openAgentSettingsKey !== 'quoteWriter') || typeof window === 'undefined') return

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpenAgentSettingsKey('')
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [openAgentSettingsKey])

    useEffect(() => {
        const agents = normalizePatientAgents(draft?.agents)
        if (activeTab === 'appointments' && !appointmentsEnabled) {
            setActiveTab('overview')
            return
        }

        if (activeTab === 'analysis' && agents.analyst !== true) {
            setActiveTab('overview')
            return
        }

        if (activeTab === 'equipment' && agents.equipmentSourcer !== true) {
            setActiveTab('overview')
            return
        }
    }, [activeTab, draft?.agents, scribeSummary, scribeJobStatus?.summaryExists, appointmentsEnabled, formsEnabled])

    // Picking a tab by hand cancels any pending "+ Add" intent, so its create form
    // does not pop back open the next time that tab is visited.
    const openPatientTab = useCallback((tabKey) => {
        setPendingCreateTab(null)
        setActiveTab(tabKey)
    }, [])

    // "+ Add" opens the tab its create form lives on; the panel reports back once
    // the intent has been consumed.
    const startPatientRecord = useCallback((tabKey) => {
        setAddMenuOpen(false)
        setPendingCreateTab(tabKey)
        setActiveTab(tabKey)
    }, [])

    const handleCreateIntentHandled = useCallback(() => {
        setPendingCreateTab(null)
    }, [])

    // Anchored on open and again on any scroll or resize, so the menu keeps sitting under its
    // trigger even when the tab bar is scrolled with the menu open.
    const positionAddMenu = useCallback(() => {
        const anchor = addMenuAnchorRef.current
        if (!anchor) return
        const rect = anchor.getBoundingClientRect()
        setAddMenuPosition({
            top: rect.bottom + 8,
            right: Math.max(8, window.innerWidth - rect.right),
        })
    }, [])

    const toggleAddMenu = useCallback(() => {
        if (addMenuOpen) {
            setAddMenuOpen(false)
            return
        }
        positionAddMenu()
        setAddMenuOpen(true)
    }, [addMenuOpen, positionAddMenu])

    const scrollTabStripBy = useCallback((delta) => {
        const strip = tabStripRef.current
        if (!strip) return
        strip.scrollBy({ left: delta, behavior: 'smooth' })
    }, [])

    const scrollActiveTabIntoView = useCallback((tabKey) => {
        const strip = tabStripRef.current
        if (!strip || !tabKey) return
        const button = strip.querySelector(`[data-patient-tab="${tabKey}"]`)
        if (!button) return
        const padding = 12
        const start = button.offsetLeft - padding
        const end = button.offsetLeft + button.offsetWidth + padding
        if (start < strip.scrollLeft) {
            strip.scrollTo({ left: Math.max(0, start), behavior: 'smooth' })
        } else if (end > strip.scrollLeft + strip.clientWidth) {
            strip.scrollTo({ left: end - strip.clientWidth, behavior: 'smooth' })
        }
    }, [])

    const updateTabStripOverflow = useCallback(() => {
        const strip = tabStripRef.current
        if (!strip) return
        const maxScroll = strip.scrollWidth - strip.clientWidth
        const next = {
            left: strip.scrollLeft > 2,
            right: maxScroll > 2 && strip.scrollLeft < maxScroll - 2,
        }
        setTabStripOverflow((previous) => (
            previous.left === next.left && previous.right === next.right ? previous : next
        ))
    }, [])

    // Arrow and Home/End move the selection the way a tablist does, which also
    // drags the scroller along through scrollActiveTabIntoView.
    const handleTabStripKeyDown = useCallback((event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const strip = tabStripRef.current
        if (!strip) return
        const buttons = Array.from(strip.querySelectorAll('[data-patient-tab]'))
        if (buttons.length === 0) return
        const selectedIndex = buttons.findIndex((button) => button.getAttribute('aria-selected') === 'true')
        const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
        let nextIndex = currentIndex
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length
        if (event.key === 'Home') nextIndex = 0
        if (event.key === 'End') nextIndex = buttons.length - 1
        const nextTab = buttons[nextIndex]?.getAttribute('data-patient-tab')
        if (!nextTab) return
        event.preventDefault()
        openPatientTab(nextTab)
        buttons[nextIndex].focus()
    }, [openPatientTab])

    // The strip scrolls, so a tab chosen programmatically (a ?tab=… deep link, or
    // an Overview action card) can otherwise land off-screen.
    useEffect(() => {
        if (!isOpen) return
        scrollActiveTabIntoView(activeTab)
    }, [isOpen, activeTab, scrollActiveTabIntoView])

    // Overflow is measured rather than assumed: the same modal serves domains with
    // a handful of tabs and patients that show all fifteen.
    useEffect(() => {
        if (!isOpen) return undefined
        updateTabStripOverflow()
        const strip = tabStripRef.current
        if (!strip) return undefined
        const observer = new ResizeObserver(updateTabStripOverflow)
        observer.observe(strip)
        if (strip.firstElementChild) observer.observe(strip.firstElementChild)
        return () => observer.disconnect()
    }, [isOpen, updateTabStripOverflow])

    // A vertical wheel over the strip scrolls it sideways, which is what a mouse
    // user expects from a tab bar. Registered natively because React's wheel
    // listener is passive and cannot preventDefault().
    useEffect(() => {
        if (!isOpen) return undefined
        const strip = tabStripRef.current
        if (!strip) return undefined
        const handleWheel = (event) => {
            const maxScroll = strip.scrollWidth - strip.clientWidth
            if (maxScroll <= 2) return
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
            if (!delta) return
            const next = Math.max(0, Math.min(maxScroll, strip.scrollLeft + delta))
            if (next === strip.scrollLeft) return
            strip.scrollLeft = next
            event.preventDefault()
        }
        strip.addEventListener('wheel', handleWheel, { passive: false })
        return () => strip.removeEventListener('wheel', handleWheel)
    }, [isOpen])

    // Dismiss the "+ Add" menu on an outside click or Escape, matching the import
    // menu on the patients list. The trigger counts as inside, so a click on it
    // closes the menu through its own handler rather than closing and reopening.
    useEffect(() => {
        if (!addMenuOpen) return undefined

        const closeMenu = (event) => {
            if (event.type === 'keydown' && event.key !== 'Escape') return
            if (event.type === 'pointerdown' && (addMenuRef.current?.contains(event.target) || addMenuAnchorRef.current?.contains(event.target))) return
            setAddMenuOpen(false)
        }

        document.addEventListener('pointerdown', closeMenu)
        document.addEventListener('keydown', closeMenu)
        // A scroll inside the tab bar is dispatched on that element and does not bubble to
        // window, so the re-anchor listener has to capture.
        window.addEventListener('scroll', positionAddMenu, true)
        window.addEventListener('resize', positionAddMenu)
        return () => {
            document.removeEventListener('pointerdown', closeMenu)
            document.removeEventListener('keydown', closeMenu)
            window.removeEventListener('scroll', positionAddMenu, true)
            window.removeEventListener('resize', positionAddMenu)
        }
    }, [addMenuOpen, positionAddMenu])

    // Fetch all quotes once: the review queue needs only unreviewed worker drafts,
    // while the Quotes tab mark must also cover worker quotes a person has reviewed.
    const refreshQuoteWorkerDrafts = useCallback(async (patientId) => {
        if (!patientId || !activeDomain) return

        const normalizedPatientId = String(patientId)
        setQuoteWorkerContent({ patientId: normalizedPatientId, hasContent: false })
        const token = await getOrCreateAdminTokenForLocalhost()
        const query = new URLSearchParams({
            domain: activeDomain,
            patient_id: normalizedPatientId,
            limit: '200',
        })
        const response = await fetchWithTimeout(`/api/database/quotes?${query.toString()}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: 'no-store',
        })
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        const quotes = Array.isArray(data?.data) ? data.data : []
        setQuoteWorkerDrafts(quotes.filter(isUnreviewedWorkerQuote).slice(0, 10))
        setQuoteWorkerContent({
            patientId: normalizedPatientId,
            hasContent: quotes.some(isQuoteWriterQuote),
        })
    }, [activeDomain])

    const handleQuoteWorkerContentChange = useCallback((hasContent) => {
        setQuoteWorkerContent({
            patientId: String(draft?.id || ''),
            hasContent,
        })
    }, [draft?.id])

    // The four record collections are probed with limit=1 rather than loaded: the
    // answer only has to be "some" or "none" to choose the tabs and the "+ Add"
    // items. The patient id travels with the result so a stale probe can never
    // describe the wrong patient.
    useEffect(() => {
        if (!isOpen || mode !== 'edit' || !draft?.id) return undefined

        let cancelled = false
        const patientId = String(draft.id)

        const probe = async (path, params) => {
            const token = await getOrCreateAdminTokenForLocalhost()
            const query = new URLSearchParams({ domain: activeDomain, limit: '1', ...params })
            const response = await fetchWithTimeout(`${path}?${query.toString()}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                cache: 'no-store',
            })
            if (!response.ok) throw new Error(`Request failed (${response.status})`)
            const data = await response.json().catch(() => ({}))
            return Array.isArray(data?.data) && data.data.length > 0
        }

        const loadPresence = async () => {
            const results = await Promise.allSettled([
                probe('/api/database/billing', { account_id: patientId }),
                probe('/api/database/cases', { patient_id: patientId }),
                probe('/api/database/quotes', { patient_id: patientId }),
                probe('/api/database/service-agreements', { patient_id: patientId }),
                appointmentsEnabled ? probe('/api/database/appointments', { patient_id: patientId }) : Promise.resolve(null),
            ])
            if (cancelled) return
            const [billing, cases, quotes, agreements, appointments] = results.map((result) => (
                result.status === 'fulfilled' ? result.value : null
            ))
            setRecordPresence({ patientId, billing, cases, quotes, agreements, appointments })
        }

        // The probes are external reads, and the setter only publishes their result.
        loadPresence().catch(() => {
            if (cancelled) return
            setRecordPresence(null)
        })
        refreshQuoteWorkerDrafts(patientId).catch(() => { })
        return () => {
            cancelled = true
        }
    }, [isOpen, mode, draft?.id, activeDomain, appointmentsEnabled, refreshQuoteWorkerDrafts])

    // Sending a quote inside the modal is what takes it out of the review queue, and
    // the modal has no event for that, so coming back to Overview re-checks. One
    // request, and only while Overview is actually on screen.
    useEffect(() => {
        if (!isOpen || mode !== 'edit' || !draft?.id || activeTab !== 'overview') return
        refreshQuoteWorkerDrafts(String(draft.id)).catch(() => { })
    }, [isOpen, mode, draft?.id, activeTab, refreshQuoteWorkerDrafts])

    const addableRecordTypes = useMemo(() => {
        if (mode !== 'edit' || !draft?.id) return []
        if (!recordPresence || recordPresence.patientId !== String(draft.id)) return []
        const items = []
        if (recordPresence.billing === false) items.push({ tab: 'billing', label: 'Billing event' })
        if (recordPresence.cases === false) items.push({ tab: 'cases', label: 'Case' })
        if (appointmentsEnabled && recordPresence.appointments === false) items.push({ tab: 'appointments', label: 'Appointment' })
        if (recordPresence.quotes === false) items.push({ tab: 'quotes', label: 'Quote' })
        if (recordPresence.agreements === false) items.push({ tab: 'agreements', label: 'Service agreement' })
        return items
    }, [mode, draft?.id, recordPresence, appointmentsEnabled])

    // A record tab is only worth showing once the patient has something in it; the
    // empty pane is reachable through "+ Add" instead. Shown only once known, so the
    // strip starts on the tabs that are always there and grows as the probe reports
    // each collection, rather than starting full and hiding the empty ones. A probe
    // that failed reported `null`, which is not evidence of an empty collection, so
    // that tab stays; and the pane the user is already on keeps its tab, so the strip
    // always has a selection to point at.
    const hasRecordType = useCallback((key) => {
        if (activeTab === key) return true
        if (!recordPresence || recordPresence.patientId !== String(draft?.id)) return false
        return recordPresence[key] !== false
    }, [recordPresence, draft?.id, activeTab])

    const reportVersionRows = useMemo(() => {
        return (Array.isArray(reportDrafts) ? reportDrafts : [])
            .filter((report) => String(report?.patientId || '') === String(draft?.id || ''))
            .sort((a, b) => {
                const aTime = new Date(String(a?.updatedAt || a?.createdAt || '')).getTime()
                const bTime = new Date(String(b?.updatedAt || b?.createdAt || '')).getTime()
                const safeATime = Number.isFinite(aTime) ? aTime : 0
                const safeBTime = Number.isFinite(bTime) ? bTime : 0
                return safeBTime - safeATime
            })
            .map((report, index) => {
                const versionKey = String(report?.id || `${report?.patientId || ''}:${report?.updatedAt || report?.createdAt || ''}`)
                const sourceKey = String(report?.sourceTable || 'unknown').trim().toLowerCase()
                const timestampKey = String(report?.updatedAt || report?.createdAt || '')

                return {
                    ...report,
                    versionKey,
                    rowKey: `${versionKey}:${sourceKey}:${timestampKey}:${index}`,
                    timestampLabel: formatDraftTimestamp(report?.updatedAt || report?.createdAt),
                }
            })
    }, [reportDrafts, draft?.id])

    const currentReportRow = useMemo(() => (
        reportVersionRows.find((report) => {
            const sourceTable = String(report?.sourceTable || '').trim().toLowerCase()
            return sourceTable && !sourceTable.includes('draft') && !sourceTable.includes('job') && !sourceTable.includes('queue')
        }) || null
    ), [reportVersionRows])

    // Only completed reports keep a version history: the current report plus every generated
    // report the worker produced. The API collapses in-progress builder saves to one working
    // draft per patient, so the old trail of near-identical step snapshots is gone.
    const completedReportRows = useMemo(() => {
        const currentMarkdown = String(currentReportRow?.reportMarkdown || '').trim()
        const seenMarkdownByType = new Set()
        return reportVersionRows.filter((report) => {
            if (report === currentReportRow) return false
            if (!isGeneratedReportDraft(report)) return false

            const reportMarkdown = String(report?.reportMarkdown || '').trim()
            if (!reportMarkdown) return false
            if (currentMarkdown && reportMarkdown === currentMarkdown) return false

            const dedupeKey = `${getReportTypeKey(report)}:${reportMarkdown}`
            if (seenMarkdownByType.has(dedupeKey)) return false
            seenMarkdownByType.add(dedupeKey)
            return true
        })
    }, [reportVersionRows, currentReportRow])

    const workingDraftRow = useMemo(
        () => reportVersionRows.find((report) => isWorkingReportDraft(report)) || null,
        [reportVersionRows]
    )

    const inProgressReportRows = useMemo(
        () => reportVersionRows.filter((report) => isInProgressReport(report)),
        [reportVersionRows]
    )

    // One entry per report type. A type with more than one completed report exposes a version
    // picker instead of listing every row, mirroring the compact Summary-tab selector.
    const reportTypeGroups = useMemo(() => {
        const groups = []
        for (const report of completedReportRows) {
            const key = getReportTypeKey(report)
            let group = groups.find((entry) => entry.key === key)
            if (!group) {
                group = { key, label: getReportTypeLabelForReport(report), versions: [] }
                groups.push(group)
            }
            group.versions.push(report)
        }
        return groups
    }, [completedReportRows])

    const reportTableRows = useMemo(() => {
        const rows = reportTypeGroups.map((group) => {
            const selected = group.versions.find((report) => String(report?.rowKey || '') === String(reportVersionSelection[group.key] || ''))
                || group.versions[0]
            return {
                key: String(selected?.rowKey || group.key),
                kind: 'completed',
                label: group.label,
                groupKey: group.key,
                versions: group.versions,
                versionValue: String(selected?.rowKey || ''),
                report: selected,
            }
        })

        if (workingDraftRow) {
            rows.push({
                key: String(workingDraftRow.rowKey || 'working-draft'),
                kind: 'working',
                label: 'Working draft',
                groupKey: '',
                versions: null,
                versionValue: '',
                report: workingDraftRow,
            })
        }

        for (const report of inProgressReportRows) {
            rows.push({
                key: String(report.rowKey || report.id || 'in-progress'),
                kind: 'in-progress',
                label: 'Generating',
                groupKey: '',
                versions: null,
                versionValue: '',
                report,
            })
        }

        return rows
    }, [reportTypeGroups, reportVersionSelection, workingDraftRow, inProgressReportRows])

    const selectedReportRows = useMemo(() => {
        const selectedKeys = new Set(selectedReportKeys)
        return reportTableRows
            .map((row) => row.report)
            .filter((report) => report && selectedKeys.has(String(report?.rowKey || '')))
    }, [reportTableRows, selectedReportKeys])

    useEffect(() => {
        if (selectedReportKeys.length === 0) return
        const availableKeys = new Set(reportTableRows.map((row) => String(row?.key || '')).filter(Boolean))
        setSelectedReportKeys((prev) => prev.filter((key) => availableKeys.has(key)))
    }, [reportTableRows, selectedReportKeys.length])

    const openReportEditor = useCallback((report) => {
        setOpenReport(report || null)
        setOpenReportMarkdown(String(report?.reportMarkdown || ''))
        setReportActionMessage('')
        setReportActionTone('info')
        // Opening a report *is* the review: it is how a person takes on what the
        // worker published, and the only trace a finished report can leave (see
        // `workerProvenance.js`). The page holds the review state, so it decides
        // whether there is anything waiting to be taken off the queue.
        onReportReviewed?.()
    }, [onReportReviewed])

    useEffect(() => {
        if (!isOpen || !openCurrentReportOnLoad || openedCurrentReportFromQueryRef.current) return
        if (!currentReportRow?.reportMarkdown) return

        openedCurrentReportFromQueryRef.current = true
        openReportEditor(currentReportRow)
    }, [currentReportRow, isOpen, openCurrentReportOnLoad, openReportEditor])

    const closeReportEditor = useCallback(() => {
        setOpenReport(null)
        setOpenReportMarkdown('')
        setReportActionMessage('')
        setReportActionTone('info')
        setReportSavingId('')
        setReportDeletingKey('')
        setReportExportingId('')
    }, [])

    const parseReportDownloadFileName = useCallback((contentDisposition, fallbackName) => {
        const raw = String(contentDisposition || '').trim()
        if (!raw) return fallbackName

        const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
        if (utf8Match?.[1]) {
            try {
                return decodeURIComponent(utf8Match[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
            } catch {
                return fallbackName
            }
        }

        const plainMatch = raw.match(/filename="?([^";]+)"?/i)
        if (plainMatch?.[1]) {
            return String(plainMatch[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
        }

        return fallbackName
    }, [])

    const saveOpenReport = useCallback(async (reportMarkdown) => {
        const reportId = String(openReport?.id || '').trim()
        const patientId = String(openReport?.patientId || draft?.id || '').trim()
        const patientName = String(openReport?.patientName || draft?.patient_name || derivePatientName(fields, draft?.answers, draft?.patient_name) || '').trim()
        const sourceTable = String(openReport?.sourceTable || '').trim().toLowerCase()

        if (!activeDomain || !patientName) {
            setReportActionMessage('Missing patient context for report save.')
            setReportActionTone('error')
            return
        }

        setReportSavingId(reportId || String(openReport?.versionKey || 'report'))
        setReportActionMessage('')
        try {
            const headers = await getOrCreateAdminTokenForLocalhost()
                .then((token) => token ? { Authorization: `Bearer ${token}` } : {})
            const isDraftRow = sourceTable.includes('draft')
            const response = await fetchWithTimeout('/api/database/patients/formal-report', {
                method: isDraftRow ? 'POST' : 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    draft_id: isDraftRow ? reportId : undefined,
                    patient_id: patientId || null,
                    patient_name: patientName,
                    report_markdown: String(reportMarkdown || ''),
                    source_notes: openReport?.sourceNotes || null,
                    source_metadata: openReport?.sourceMetadata || {},
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save report')
            }

            const savedReport = data?.report && typeof data.report === 'object'
                ? { ...openReport, ...data.report, reportMarkdown: String(reportMarkdown || '') }
                : { ...openReport, reportMarkdown: String(reportMarkdown || '') }
            setOpenReport(savedReport)
            setOpenReportMarkdown(String(reportMarkdown || ''))
            setReportActionMessage('Report draft saved.')
            setReportActionTone('success')
            onRefreshFormalReport?.()
            await onRefreshReportDrafts?.()
        } catch (error) {
            setReportActionMessage(error?.message || 'Failed to save report')
            setReportActionTone('error')
        } finally {
            setReportSavingId('')
        }
    }, [activeDomain, draft, fields, onRefreshFormalReport, onRefreshReportDrafts, openReport])

    const deleteReportRows = useCallback(async (rows, options = {}) => {
        const targets = (Array.isArray(rows) ? rows : [])
            .filter((report) => String(report?.sourceTable || '').trim() && String(report?.sourceTable || '').trim().toLowerCase() !== 'pending-ui')

        if (!targets.length || !activeDomain) return

        const confirmed = options.skipConfirm === true
            ? true
            : window.confirm(targets.length === 1
                ? 'Move this report to Recently Deleted? You can restore it from Recycling.'
                : `Move ${targets.length} reports to Recently Deleted? You can restore them from Recycling.`)
        if (!confirmed) return

        setReportActionMessage('')
        if (targets.length > 1) {
            setReportBulkDeleting(true)
        } else {
            setReportDeletingKey(String(targets[0]?.rowKey || targets[0]?.versionKey || targets[0]?.id || ''))
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            for (const report of targets) {
                const reportId = Number.parseInt(String(report?.id || ''), 10)
                const sourceTable = String(report?.sourceTable || '').trim()
                if (!Number.isFinite(reportId) || reportId <= 0 || !sourceTable) continue

                const response = await fetchWithTimeout('/api/database/reports', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        domain: activeDomain,
                        id: reportId,
                        sourceTable,
                    }),
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to delete report')
                }
            }

            const deletedKeys = new Set(targets.map((report) => String(report?.rowKey || '')).filter(Boolean))
            setSelectedReportKeys((prev) => prev.filter((key) => !deletedKeys.has(key)))
            if (openReport && deletedKeys.has(String(openReport?.rowKey || ''))) {
                closeReportEditor()
            }
            setReportActionMessage(targets.length === 1 ? 'Report marked as pending delete.' : `${targets.length} reports marked as pending delete.`)
            setReportActionTone('success')
            onRefreshFormalReport?.()
            await onRefreshReportDrafts?.()
        } catch (error) {
            setReportActionMessage(error?.message || 'Failed to delete report')
            setReportActionTone('error')
        } finally {
            setReportDeletingKey('')
            setReportBulkDeleting(false)
        }
    }, [activeDomain, closeReportEditor, onRefreshFormalReport, onRefreshReportDrafts, openReport])

    const exportOpenReportDocx = useCallback(async (reportMarkdown) => {
        const patientId = String(openReport?.patientId || draft?.id || '').trim()
        const patientName = String(openReport?.patientName || draft?.patient_name || derivePatientName(fields, draft?.answers, draft?.patient_name) || '').trim()
        if (!activeDomain || !patientId) {
            setReportActionMessage('Missing patient context for DOCX export.')
            setReportActionTone('error')
            return
        }

        setReportExportingId(String(openReport?.id || openReport?.versionKey || 'report'))
        setReportActionMessage('')
        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/patients/formal-report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    format: 'word-docx',
                    domain: activeDomain,
                    patient_id: patientId,
                    patient_name: patientName || null,
                    report_markdown: String(reportMarkdown || ''),
                }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to export report as DOCX')
            }

            const blob = await response.blob()
            const fallbackName = `${patientName || `patient-${patientId}`}-formal-report.docx`
            const fileName = parseReportDownloadFileName(response.headers.get('content-disposition'), fallbackName)

            if (typeof window !== 'undefined') {
                const objectUrl = window.URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = objectUrl
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                link.remove()
                window.URL.revokeObjectURL(objectUrl)
            }

            setReportActionMessage('DOCX download started.')
            setReportActionTone('success')
        } catch (error) {
            setReportActionMessage(error?.message || 'Failed to export report as DOCX')
            setReportActionTone('error')
        } finally {
            setReportExportingId('')
        }
    }, [activeDomain, draft, fields, openReport, parseReportDownloadFileName])

    const comparativePatientOptions = useMemo(() => {
        return (Array.isArray(patients) ? patients : [])
            .filter((patient) => {
                const patientId = String(patient?.id || '').trim()
                return patientId && patientId !== String(draft?.id || '')
            })
            .map((patient) => ({
                id: String(patient?.id || '').trim(),
                name: String(patient?.patient_name || '').trim() || `Patient #${String(patient?.id || '').trim()}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    }, [patients, draft?.id])

    const loadComparativeDrafts = useCallback(async (option, patientId) => {
        const optionKey = String(option?.key || '').trim()
        const draftConfigKey = String(option?.draftConfigKey || '').trim()
        const normalizedPatientId = String(patientId || '').trim()
        if (!optionKey || !draftConfigKey) return

        if (!normalizedPatientId) {
            setComparativeDraftsByOption((prev) => ({ ...prev, [optionKey]: [] }))
            setComparativeDraftLoadedPatientByOption((prev) => ({ ...prev, [optionKey]: '' }))
            setComparativeDraftErrorByOption((prev) => ({ ...prev, [optionKey]: '' }))
            onChangeAgentConfig('reporting', draftConfigKey, '')
            return
        }

        setComparativeDraftLoadingByOption((prev) => ({ ...prev, [optionKey]: true }))
        setComparativeDraftErrorByOption((prev) => ({ ...prev, [optionKey]: '' }))

        try {
            const rows = typeof onFetchComparativeReportDrafts === 'function'
                ? await onFetchComparativeReportDrafts(normalizedPatientId)
                : []
            const normalizedRows = (Array.isArray(rows) ? rows : [])
                .map((report, index) => {
                    const versionKey = String(report?.id || `${report?.patientId || ''}:${report?.updatedAt || report?.createdAt || ''}`)
                    const id = String(report?.id || '').trim()
                    const sourceKey = String(report?.sourceTable || 'unknown').trim().toLowerCase()
                    const timestampKey = String(report?.updatedAt || report?.createdAt || '')
                    return {
                        ...report,
                        versionKey,
                        rowKey: `${versionKey}:${sourceKey}:${timestampKey}:${index}`,
                        id,
                        timestampLabel: formatDraftTimestamp(report?.updatedAt || report?.createdAt),
                    }
                })
                .filter((report) => report.id)
                .sort((a, b) => {
                    const aTime = new Date(String(a?.updatedAt || a?.createdAt || '')).getTime()
                    const bTime = new Date(String(b?.updatedAt || b?.createdAt || '')).getTime()
                    const safeATime = Number.isFinite(aTime) ? aTime : 0
                    const safeBTime = Number.isFinite(bTime) ? bTime : 0
                    return safeBTime - safeATime
                })

            setComparativeDraftsByOption((prev) => ({ ...prev, [optionKey]: normalizedRows }))
            setComparativeDraftLoadedPatientByOption((prev) => ({ ...prev, [optionKey]: normalizedPatientId }))

            const reportingSettings = normalizePatientAgents(draft?.agents).reportingConfig || DEFAULT_REPORTING_AGENT_CONFIG
            const currentSelectedDraftId = String(reportingSettings?.[draftConfigKey] || '').trim()
            const hasCurrentSelectedDraft = normalizedRows.some((report) => report.id === currentSelectedDraftId)
            const nextDraftId = hasCurrentSelectedDraft ? currentSelectedDraftId : String(normalizedRows[0]?.id || '')

            if (nextDraftId !== currentSelectedDraftId) {
                onChangeAgentConfig('reporting', draftConfigKey, nextDraftId)
            }
        } catch (error) {
            setComparativeDraftsByOption((prev) => ({ ...prev, [optionKey]: [] }))
            setComparativeDraftLoadedPatientByOption((prev) => ({ ...prev, [optionKey]: normalizedPatientId }))
            setComparativeDraftErrorByOption((prev) => ({
                ...prev,
                [optionKey]: error?.message || 'Failed to load comparative draft versions',
            }))
            onChangeAgentConfig('reporting', draftConfigKey, '')
        } finally {
            setComparativeDraftLoadingByOption((prev) => ({ ...prev, [optionKey]: false }))
        }
    }, [draft?.agents, onChangeAgentConfig, onFetchComparativeReportDrafts])

    useEffect(() => {
        if (!isOpen || openAgentSettingsKey !== 'reporting') return
        const reportingSettings = normalizePatientAgents(draft?.agents).reportingConfig || DEFAULT_REPORTING_AGENT_CONFIG

        REPORTING_COMPARATIVE_OPTIONS.forEach((option) => {
            const selectedPatientId = String(reportingSettings?.[option.patientConfigKey] || '').trim()
            const existingRows = Array.isArray(comparativeDraftsByOption[option.key]) ? comparativeDraftsByOption[option.key] : []
            const loadedPatientId = String(comparativeDraftLoadedPatientByOption[option.key] || '').trim()
            if (!selectedPatientId) {
                if (existingRows.length > 0) {
                    setComparativeDraftsByOption((prev) => ({ ...prev, [option.key]: [] }))
                }
                if (loadedPatientId) {
                    setComparativeDraftLoadedPatientByOption((prev) => ({ ...prev, [option.key]: '' }))
                }
                setComparativeDraftErrorByOption((prev) => ({ ...prev, [option.key]: '' }))
                return
            }

            if (loadedPatientId !== selectedPatientId && comparativeDraftLoadingByOption[option.key] !== true) {
                loadComparativeDrafts(option, selectedPatientId)
            }
        })
    }, [
        isOpen,
        openAgentSettingsKey,
        draft?.agents,
        comparativeDraftsByOption,
        comparativeDraftLoadedPatientByOption,
        comparativeDraftLoadingByOption,
        loadComparativeDrafts,
    ])

    const handlePopOut = () => {
        if (typeof window === 'undefined' || !draft?.id) return

        const targetUrl = new URL(window.location.href)
        targetUrl.searchParams.set('patientId', String(draft.id))
        targetUrl.searchParams.set('tab', PATIENT_MODAL_TABS.has(activeTab) ? activeTab : 'overview')
        targetUrl.searchParams.set('popout', '1')

        const popup = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
        if (!popup) {
            window.location.assign(targetUrl.toString())
        }
    }

    const overviewAgents = normalizePatientAgents(draft?.agents)
    const reportingFunder = String(
        draft?.answers?.funding_source_or_referral_type
        || draft?.labelledAnswers?.['Funding Source or Referral Type']
        || draft?.labelledAnswers?.['Funding source or referral type']
        || ''
    ).trim().toLowerCase()
    const isNdisFundedPatient = reportingFunder === 'ndis'
    const isAgentActive = (agent) => isAgentActiveForPatient(agent, { isNdisFundedPatient, agents: overviewAgents })
    const handleBuildFca = () => {
        if (typeof window === 'undefined') return

        const patientId = String(draft?.id || '').trim()
        const patientName = String(draft?.patient_name || '').trim()
        if (!patientId || !patientName) return

        const targetUrl = new URL('/admin/reports', window.location.origin)
        targetUrl.searchParams.set('newFca', '1')
        targetUrl.searchParams.set('patientId', patientId)
        targetUrl.searchParams.set('patientName', patientName)
        window.location.assign(targetUrl.toString())
    }

    const patientAgentCards = useMemo(() => {
        const isActive = (agent) => isAgentActiveForPatient(agent, { isNdisFundedPatient, agents: overviewAgents })
        const visibleAgents = [
            {
                key: 'reporting',
                label: 'FCA Builder',
                description: 'Build an NDIS Functional Capacity Assessment using the patient’s clinical notes, transcripts and recommendations.',
                summary: 'NDIS Functional Capacity Assessment',
                style: 'ndis',
                autoActiveForNdis: true,
                buildAction: true,
                configurable: false,
            },
            {
                key: 'equipmentSourcer',
                label: 'Equipment Sourcer',
                description: 'Find suitable equipment and supplier options based on the patient’s clinical needs and recommendations.',
                summary: 'Equipment and supplier sourcing',
                configurable: false,
            },
            {
                key: 'quoteWriter',
                label: 'Quote Writer',
                description: 'Draft a priced NDIS quote from the patient’s notes, transcripts, reports and equipment recommendations.',
                style: 'ndisHelper',
            },
            // DEPRECATED — the original "HSR Writer" (hsrCreator) grid card has been removed
            // from the AI workers grid. It was a duplicate of the full-width HSR Writer
            // card rendered right after the active agents (formerly branded "HSR Writer v2"),
            // and both drove the same `hsrCreator` agent. That full-width card is now the
            // canonical HSR Writer, so hsrCreator must NOT render as a second grid card here.
            {
                key: 'hsrSummariser',
                label: 'HSR Summariser',
                style: 'tacHelper',
            },
            {
                key: 'billing',
                label: 'Billing',
                description: 'Create draft invoices for recent consultations and related activities.',
            },
            {
                key: 'analyst',
                label: 'FCA Analyst',
                description: 'Review patient notes and transcripts to prepare FCA-building suggestions for clinicians.',
                // NDIS-helper artwork card with the TAC-helper control layout (see ndisHelper).
                style: 'ndisHelper',
            },
            {
                key: 'scribe',
                label: 'Transcript Summariser',
                description: 'Summarize completed transcripts automatically after they settle for 5 minutes.',
            },
        ].filter((agent) => workerVisibility[agent.key] !== false)
            // Domains that declare the fcaBuilderHero trait render the FCA Builder as the
            // image-backed FCA Builder hero card (see fcaBuilderHeroVisible / fcaBuilderHeroCard)
            // instead of a grid card, so drop the grid duplicate to avoid two cards driving
            // the same `reporting` agent.
            .filter((agent) => !(agent.key === 'reporting' && hasPrivateDomainTrait(activeDomain, 'fcaBuilderHero')))
        const hasActiveAgent = visibleAgents.some((agent) => isActive(agent))

        return visibleAgents.sort((left, right) => {
            const leftEnabled = isActive(left)
            const rightEnabled = isActive(right)
            if (hasActiveAgent && leftEnabled !== rightEnabled) {
                return leftEnabled ? -1 : 1
            }

            if (!hasActiveAgent || (leftEnabled && rightEnabled)) {
                const leftType = AGENT_CARD_STYLES[left.style || 'general']?.badge || ''
                const rightType = AGENT_CARD_STYLES[right.style || 'general']?.badge || ''
                const typeComparison = leftType.localeCompare(rightType, undefined, { sensitivity: 'base' })
                if (typeComparison !== 0) return typeComparison
            }

            return String(left.label || '').localeCompare(String(right.label || ''), undefined, { sensitivity: 'base' })
        })
    }, [overviewAgents, workerVisibility, isNdisFundedPatient, activeDomain])
    const firstInactiveAgentKey = patientAgentCards.find((agent) => !isAgentActive(agent))?.key
    // Render active agents first, then the full-width HSR Writer card (the former
    // "HSR Writer v2" hero — now the canonical HSR Writer after the original duplicate
    // grid card was deprecated), then push the remaining inactive agents to the bottom
    // of the AI workers section.
    const hsrWriterDomainVisible = workerVisibility.hsrCreator !== false
    // Domains that declare the fcaBuilderHero trait promote the FCA Builder to the
    // full-width hero card (same layout as the HSR Writer hero below, with the domain's
    // FCA artwork as its background) instead of a grid card — the grid card is filtered
    // out of patientAgentCards above.
    const fcaBuilderHeroVisible = hasPrivateDomainTrait(activeDomain, 'fcaBuilderHero') && workerVisibility.reporting !== false
    const fcaBuilderArtwork = fcaBuilderHeroVisible ? getPrivateDomainFcaBuilderArtwork(activeDomain) : ''
    const activeAgentCards = patientAgentCards.filter((agent) => isAgentActive(agent))
    const inactiveAgentCards = patientAgentCards.filter((agent) => !isAgentActive(agent))
    const agentCardOrder = [
        ...activeAgentCards,
        ...(fcaBuilderHeroVisible ? [{ key: '__fcaBuilderHero__' }] : []),
        ...(hsrWriterDomainVisible ? [{ key: '__hsrWriterHero__' }] : []),
        ...inactiveAgentCards,
    ]
    // Hero cards share one row, so only the first hero marker in the order renders that row.
    const firstWorkerHeroKey = agentCardOrder.find((agent) => agent.key === '__fcaBuilderHero__' || agent.key === '__hsrWriterHero__')?.key

    if (!isOpen || !draft) return null

    const groupedFields = fields.reduce((acc, field) => {
        const section = field.section || 'General'
        if (!acc[section]) acc[section] = []
        acc[section].push(field)
        return acc
    }, {})

    const renderFieldInput = (field) => {
        const value = draft.answers[field.id]
        const lowerType = String(field.type || '').toLowerCase()

        if (lowerType === 'dropdown') {
            return (
                <select
                    value={String(value || '')}
                    onChange={(event) => onChangeField(field.id, event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                    <option value="">Select an option</option>
                    {Array.isArray(field.options) && field.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
            )
        }

        if (lowerType === 'longtext' || lowerType === 'textarea') {
            return (
                <textarea
                    value={String(value || '')}
                    onChange={(event) => onChangeField(field.id, event.target.value)}
                    className="mt-1 min-h-[88px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder={field.label}
                />
            )
        }

        if (lowerType === 'date') {
            return (
                <input
                    type="date"
                    value={String(value || '')}
                    onChange={(event) => onChangeField(field.id, event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
            )
        }

        if (lowerType === 'address') {
            const address = normalizeAddressValue(value)
            return (
                <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                        type="text"
                        value={address.addressLine1}
                        onChange={(event) => onChangeAddressField(field.id, 'addressLine1', event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
                        placeholder="Address line 1"
                    />
                    <input
                        type="text"
                        value={address.city}
                        onChange={(event) => onChangeAddressField(field.id, 'city', event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="City"
                    />
                    <input
                        type="text"
                        value={address.state}
                        onChange={(event) => onChangeAddressField(field.id, 'state', event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="State"
                    />
                    <input
                        type="text"
                        value={address.postalCode}
                        onChange={(event) => onChangeAddressField(field.id, 'postalCode', event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Postal code"
                    />
                    <input
                        type="text"
                        value={address.country}
                        onChange={(event) => onChangeAddressField(field.id, 'country', event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Country"
                    />
                </div>
            )
        }

        return (
            <input
                type="text"
                value={String(value || '')}
                onChange={(event) => onChangeField(field.id, event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder={field.label}
            />
        )
    }

    const selectedTranscriptRecord = selectedTranscriptId
        ? transcriptionRecords.find((record) => String(record?.id || '') === String(selectedTranscriptId)) || null
        : null
    const showCurrentTranscriptPanel = recorderActive
    const showFullTranscriptPanel = !recorderActive && Boolean(selectedTranscriptRecord)
    const liveTranscriptRows = splitTranscriptIntoUtterances(liveTranscript).join('\n')
    const selectedTranscriptRows = splitTranscriptIntoUtterances(selectedTranscriptRecord?.transcript_text).join('\n')
    const selectedTranscriptPendingDelete = String(selectedTranscriptRecord?.status || '').trim().toLowerCase() === 'pending delete'
    const overviewName = getOverviewNameValue(fields, draft)
    const overviewSuburb = getOverviewSuburbValue(fields, draft)
    const overviewDob = getOverviewDobValue(fields, draft)
    const reportingConfig = overviewAgents.reportingConfig || DEFAULT_REPORTING_AGENT_CONFIG
    const billingConfig = overviewAgents.billingConfig || DEFAULT_BILLING_AGENT_CONFIG
    const analysisConfig = overviewAgents.analysisConfig || DEFAULT_ANALYST_AGENT_CONFIG
    const scribeConfig = overviewAgents.scribeConfig || DEFAULT_SCRIBE_AGENT_CONFIG
    const hsrSummariserConfig = overviewAgents.hsrSummariserConfig || DEFAULT_HSR_SUMMARISER_AGENT_CONFIG
    const hsrCreatorConfig = overviewAgents.hsrCreatorConfig || DEFAULT_HSR_CREATOR_AGENT_CONFIG
    const quoteWriterConfig = overviewAgents.quoteWriterConfig || DEFAULT_QUOTE_WRITER_AGENT_CONFIG
    const activeAgentSettingsKey = openAgentSettingsKey === 'billing'
        ? 'billing'
        : openAgentSettingsKey === 'reporting'
            ? 'reporting'
            : openAgentSettingsKey === 'hsrCreator'
                ? 'hsrCreator'
                : openAgentSettingsKey === 'hsrSummariser'
                    ? 'hsrSummariser'
                    : openAgentSettingsKey === 'analyst'
                        ? 'analyst'
                        : openAgentSettingsKey === 'scribe'
                            ? 'scribe'
                            : openAgentSettingsKey === 'quoteWriter'
                                ? 'quoteWriter'
                                : ''
    const activeAgentSettings = activeAgentSettingsKey === 'billing'
        ? billingConfig
        : activeAgentSettingsKey === 'hsrCreator'
            ? hsrCreatorConfig
            : activeAgentSettingsKey === 'hsrSummariser'
                ? hsrSummariserConfig
                : activeAgentSettingsKey === 'analyst'
                    ? analysisConfig
                    : activeAgentSettingsKey === 'scribe'
                        ? scribeConfig
                        : activeAgentSettingsKey === 'quoteWriter'
                            ? quoteWriterConfig
                            : reportingConfig
    const hasFormalReport = Boolean(
        formalReport
        && (
            String(formalReport?.reportMarkdown || '').trim()
            || formalReport?.updatedAt
            || formalReport?.id
        )
    )
    const analysisPayload = patientAnalysis?.analysisPayload && typeof patientAnalysis.analysisPayload === 'object'
        ? patientAnalysis.analysisPayload
        : null
    const analysisRecommendedInterventions = Array.isArray(analysisPayload?.recommendedInterventions)
        ? analysisPayload.recommendedInterventions
        : []
    const analysisAddressedInterventions = Array.isArray(analysisPayload?.addressedInterventions)
        ? analysisPayload.addressedInterventions
        : []
    const analysisStats = analysisPayload?.sourceStats && typeof analysisPayload.sourceStats === 'object'
        ? analysisPayload.sourceStats
        : null
    // What the analysis was built from, including the reference documents it was given and whether
    // any finding is attributed to one. A document can be in scope without reaching the report, and
    // the operator has to be able to see that without reading the payload. Deliberately not a hook:
    // this component returns early when it is closed, so any hook down here changes the hook order.
    const analysisDocuments = summarizeAnalysisDocuments({
        sourceStats: analysisStats,
        facts: analysisPayload?.structuredEvidenceFacts,
    })
    const analysisWorkerPrompt = String(analysisPayload?.workerPrompt || '').trim()
    const analysisSummaryText = String(patientAnalysis?.summaryText || analysisPayload?.summaryText || '')
        .replace(/\s+Worker prompt:\s*[\s\S]*$/i, '')
        .trim()
    const availableSummaryStyles = Array.isArray(scribeSummaries) ? scribeSummaries : []
    // A patient can have several completed transcripts and the summariser stores one summary per
    // transcript per style, so the same style can be returned more than once. Group by style so
    // each version tab stays unique, then let the transcript selector pick which stored summary
    // of that style is displayed (the API already returns the newest row first).
    const summaryStyleGroups = availableSummaryStyles.reduce((groups, item) => {
        const style = String(item?.summaryStyle || '').trim()
        const groupKey = style || 'summary-unspecified'
        const existing = groups.find((group) => group.key === groupKey)
        if (existing) {
            existing.items.push(item)
        } else {
            groups.push({ key: groupKey, style, items: [item] })
        }
        return groups
    }, [])
    // The FCA summary is the primary summary view for any patient who has one: it leads the
    // version strip (before General Summary) and opens by default. The generic style stays
    // primary for patients with no FCA summary.
    const hasFcaSummary = summaryStyleGroups.some((group) => normalizeSummaryStyleKey(group.style) === FCA_SUMMARY_STYLE)
    const primarySummaryStyle = hasFcaSummary ? FCA_SUMMARY_STYLE : DEFAULT_SUMMARY_STYLE
    // Sort by the canonical style order: the API returns newest-updated first, so without this the
    // style views reshuffle every time the worker regenerates a single style.
    const summaryStyleOrder = hasFcaSummary ? PRIMARY_SUMMARY_STYLE_ORDER : SUMMARY_STYLE_ORDER
    summaryStyleGroups.sort((a, b) => resolveSummaryStyleRank(a.style, summaryStyleOrder) - resolveSummaryStyleRank(b.style, summaryStyleOrder))
    // A patient only holds the styles that were actually summarised, while `selectedSummaryStyle`
    // stays empty until a style is asked for by name. Fall back to the primary style and then to
    // the generic style, so an untouched view lands on the primary summary and an OTF10-only or
    // FCA-only patient opens on a real style view instead of an empty tab in front of a summary
    // labelled as the wrong style.
    const activeSummaryGroup = findBySummaryStyle(summaryStyleGroups, selectedSummaryStyle)
        || findBySummaryStyle(summaryStyleGroups, primarySummaryStyle)
        || findBySummaryStyle(summaryStyleGroups, DEFAULT_SUMMARY_STYLE)
        || summaryStyleGroups[0]
        || null
    const activeSummaryGroupKey = activeSummaryGroup?.key || ''
    const activeSummaryGroupItems = activeSummaryGroup?.items || []
    const selectedSummary = activeSummaryGroupItems.find((item) => String(item?.transcriptionId ?? '') === String(selectedSummaryTranscriptId ?? ''))
        || activeSummaryGroupItems[0]
        || scribeSummary
    const buildSummaryTranscriptOptionLabel = (item) => {
        const transcriptId = String(item?.transcriptionId ?? '').trim()
        const transcriptRecord = transcriptionRecords.find((record) => String(record?.id || '') === transcriptId)
        const transcriptCreatedAt = formatDraftTimestamp(transcriptRecord?.created_at || item?.createdAt)
        return `Transcript #${transcriptId || '?'}${transcriptCreatedAt ? ` · ${transcriptCreatedAt}` : ''}`
    }
    const selectedSummaryLabel = describeSummaryStyleLabel(selectedSummary?.summaryStyle)
    const hasSelectedSummary = Boolean(selectedSummary)
    const scribeSummaryPayload = selectedSummary?.summaryPayload && typeof selectedSummary.summaryPayload === 'object'
        ? selectedSummary.summaryPayload
        : null
    const scribeWorkerPrompt = String(scribeSummaryPayload?.workerPrompt || '').trim()
        || buildDerivedScribeWorkerPrompt(scribeSummaryPayload)
    const scribeSummaryText = shortenScribeSummaryWording(String(selectedSummary?.summaryText || '')).trim()
    const scribeSummaryTextParts = splitScribeSummaryText(scribeSummaryText)
    // OTF10 and FCA summaries ARE the evidence block: their text is the facts flattened into one
    // run-on bullet per finding ("Area: mobility Evidence: ..." on a single line) and they repeat the
    // follow-ups the Action items card already lists. Those two styles therefore render the stored
    // structuredEvidenceFacts as labelled blocks instead. Every other style keeps the stored text
    // lines exactly as before, evidence lines included.
    const scribeSummaryIsStructured = isStructuredSummaryStyle(selectedSummary?.summaryStyle)
    const scribeSummaryEvidenceGroups = scribeSummaryIsStructured
        ? groupEvidenceFactsByDomain(normalizeStructuredEvidenceFacts(scribeSummaryPayload))
        : []
    const showScribeSummaryEvidence = scribeSummaryEvidenceGroups.length > 0
    const scribeSummaryActionItems = Array.isArray(scribeSummaryPayload?.actionItems)
        ? scribeSummaryPayload.actionItems.map((item) => shortenScribeActionItemWording(String(item || '').trim())).filter(Boolean)
        : []
    const showScribeSummaryActionItems = scribeSummaryActionItems.length > 0
    const scribeSummaryBulletLines = scribeSummaryTextParts.items
        // In the structured view the evidence text lines are replaced by the fact blocks, and the
        // follow-up lines are only kept when the Action items card is not already listing them.
        .filter((item) => {
            if (!showScribeSummaryEvidence) return true
            if (item.kind === 'topic') return true
            if (item.kind === 'followUp') return !showScribeSummaryActionItems
            return false
        })
        .map((item) => item.text)
    const showScribeSummaryBullets = scribeSummaryBulletLines.length > 0
    const hasStoredSummary = Boolean(scribeSummary) || scribeJobStatus?.summaryExists === true
    // Summaries no longer own a tab: they render inside the Transcripts pane, above the
    // Recordings list. The panel still only appears when the patient has the
    // Transcript Summariser switched on or a stored summary to read.
    const showSummariesPanel = mode === 'edit' && (overviewAgents.scribe === true || hasStoredSummary)
    // The tabs an AI worker writes close the strip, alphabetically (analysis, equipment,
    // quotes, report, transcripts), so their visibility is derived once here rather than inline.
    // Quotes is a worker output as much as a record store — the quote writer drafts into it —
    // and Reports is where the HSR Writer files its work, so both sit in the same run.
    const showAnalysisTab = mode === 'edit' && overviewAgents.analyst === true
    const showEquipmentTab = mode === 'edit' && overviewAgents.equipmentSourcer === true
    const showQuotesTab = mode === 'edit' && hasRecordType('quotes')
    const showTranscriptsTab = mode === 'edit'
    const showReportTab = mode === 'edit'
    // Names the agent group for the Overview section heading, e.g. "Acme OT Agents":
    // the tab strip no longer carries a named group of its own. The heading also carries an
    // ⓘ affordance that explains the group in one line (see InfoTooltip).
    const agentGroupDomainLabel = getDomainDisplayLabel(activeDomain, domainDisplayName)
    const agentGroupLabel = `${agentGroupDomainLabel} Agents`
    // The "Human-created, AI-powered" stamp is a node rather than plain copy so it can read as a
    // tag; InfoTooltip renders whatever it is given.
    const agentGroupExplainer = (
        <>
            {agentGroupDomainLabel} Agents know your work and get things done with the flick of a
            switch.{' '}
            <span className="ml-1 inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase leading-none tracking-wide text-sky-700">
                Human-created, AI-powered
            </span>
        </>
    )

    // What the workers have produced that nobody has taken on yet. Derived from the
    // records' own lifecycle rather than a parallel "reviewed" flag: a quote leaves
    // the queue by being sent or accepted, an equipment suggestion by being sourced,
    // a finished report by being opened (its job row carries the marker — see
    // `workerProvenance.js`). Entries whose destination tab is off screen are dropped,
    // so a row can never link somewhere unreachable.
    //
    // A plain derivation rather than `useMemo`: this sits after the modal's early
    // return, so a hook here would be called conditionally. Both inputs are tiny
    // (at most ten quotes and a handful of suggestions) and `hasRecordType` changes
    // identity whenever the probe does, so memoising would buy almost nothing.
    const unreviewedReportJob = reportJobStatus?.unreviewedReportJob || null

    const workerReviewItems = buildWorkerReviewItems({
        quotes: quoteWorkerDrafts,
        equipmentSuggestions: equipmentSourcing?.result?.suggestions || [],
        reportJobs: unreviewedReportJob ? [unreviewedReportJob] : [],
        tabAvailability: {
            quotes: hasRecordType('quotes'),
            equipment: showEquipmentTab || activeTab === 'equipment',
            report: showReportTab,
        },
    })

    const workerReviewSummary = summarizeWorkerReviewItems(workerReviewItems)

    // The full-width HSR Writer card (formerly branded "HSR Writer v2") is now the canonical
    // HSR Writer for the `hsrCreator` agent — the original "HSR Writer" grid card that
    // duplicated it has been deprecated and removed from the AI workers grid. Its on/off
    // switch and status chip therefore mirror the same hsrCreator semantics the removed grid
    // card used (shared workerStatus/saving/statusOverride/defaultStatusLabel and status-class
    // logic); keep the derivations in sync if anything changes.
    const hsrWriterEnabled = isAgentActive({ key: 'hsrCreator' })
    const hsrWriterSaving = agentSavingKey === 'hsrCreator' || agentSavingKey === 'hsrSummariser'
    const hsrWriterStatusOverride = hasUnsavedChanges && !saving
        ? String(reportSaveImpact?.statusOverride || '').trim()
        : ''
    const hsrWriterResolvedStatus = String(hsrWriterStatusOverride || reportJobStatus?.statusLabel || 'Working').trim()
    const hsrWriterStatusLabel = hsrWriterEnabled
        ? (hsrWriterResolvedStatus === 'Waiting' || hsrWriterResolvedStatus === 'waiting' ? 'Working' : hsrWriterResolvedStatus)
        : 'Inactive'
    const hsrWriterCardStyle = AGENT_CARD_STYLES.tac || {}
    const hsrWriterStatusClass = hsrWriterStatusLabel === 'Ready'
        ? (hsrWriterCardStyle.status?.accent || 'bg-green-100 text-green-700')
        : hsrWriterStatusLabel === 'Creating'
            ? (hsrWriterCardStyle.status?.active || 'bg-blue-100 text-blue-700')
            : hsrWriterStatusLabel === 'Updating'
                ? (hsrWriterCardStyle.status?.active || 'bg-cyan-100 text-cyan-700')
                : hsrWriterStatusLabel === 'Update Pending'
                    ? (hsrWriterCardStyle.status?.accent || 'bg-amber-100 text-amber-800')
                    : hsrWriterStatusLabel === 'Working'
                        ? (hsrWriterCardStyle.status?.active || 'bg-blue-100 text-blue-700')
                        : hsrWriterStatusLabel === 'Failed'
                            ? (hsrWriterCardStyle.status?.failed || 'bg-red-100 text-red-700')
                            : hsrWriterStatusLabel === 'Inactive'
                                ? 'bg-gray-100 text-gray-700'
                                : (hsrWriterCardStyle.status?.accent || 'bg-amber-100 text-amber-700')
    const hsrWriterCanOpenReport = !reportJobLoading && hasFormalReport && hsrWriterStatusLabel === 'Ready'
    // Single reusable HSR Writer card; rendered as a full-width row between the active
    // agent cards and the inactive group (see agentCardOrder/__hsrWriterHero__). It is the
    // only HSR Writer card shown now that the duplicate grid card has been deprecated.
    const hsrWriterHeroCard = (
        <div className="relative flex aspect-[3/2] flex-col justify-between overflow-hidden rounded-lg border border-gray-200 bg-gray-100 drop-shadow-[0_8px_10px_rgba(15,23,42,0.14)]">
            <img
                src="/allied-health/OT/OTF10-Preview.png"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover object-top"
            />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-gray-900/70 to-transparent" />

            <div className="relative flex items-center justify-end gap-3 px-4 py-3">
                <button
                    type="button"
                    role="switch"
                    aria-checked={hsrWriterEnabled}
                    aria-label={hsrWriterEnabled ? 'Turn off HSR Writer' : 'Turn on HSR Writer'}
                    onClick={() => onToggleAgent('hsrCreator', !hsrWriterEnabled)}
                    disabled={hsrWriterSaving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${hsrWriterEnabled ? 'bg-emerald-600' : 'bg-gray-400/70'} ring-1 ring-white/80 ${hsrWriterSaving ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${hsrWriterEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
            </div>

            <div className="relative flex items-center justify-between gap-3 px-4 py-3">
                {hsrWriterCanOpenReport ? (
                    // The Ready chip becomes the report link, so there is no separate
                    // "Open report" affordance on the card.
                    <button
                        type="button"
                        onClick={() => openReportEditor(currentReportRow)}
                        title="Open the latest HSR report"
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold hover:opacity-80 ${hsrWriterStatusClass}`}
                    >
                        Open
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                            <path d="M7.5 4.5L13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                ) : (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${hsrWriterStatusClass}`}>
                        {reportJobLoading ? 'Updating...' : hsrWriterStatusLabel}
                    </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 flex justify-center">
                    <span className="inline-flex items-center rounded-md bg-gray-900/80 px-2.5 py-1 text-sm font-semibold text-white shadow-sm">HSR Writer</span>
                </span>
                <button
                    type="button"
                    aria-label="HSR Writer settings"
                    aria-expanded={openAgentSettingsKey === 'hsrCreator'}
                    title="Settings"
                    onClick={() => setOpenAgentSettingsKey('hsrCreator')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/70 bg-white/90 text-gray-700 hover:bg-white"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                </button>
            </div>
        </div>
    )
    // FCA Builder hero card (domains that declare the fcaBuilderHero trait, NDIS-funded patients). It reuses the HSR Writer hero layout —
    // full-bleed background artwork, status chip and title chip overlaid along the bottom —
    // but swaps in the domain's FCA artwork and mirrors the FCA Builder grid card semantics
    // (the `reporting` agent's build action and worker status instead of an on/off switch).
    const fcaBuilderEnabled = isAgentActive({ key: 'reporting' })
    const fcaBuilderStatusOverride = hasUnsavedChanges && !saving
        ? String(reportSaveImpact?.statusOverride || '').trim()
        : ''
    const fcaBuilderResolvedStatus = String(fcaBuilderStatusOverride || reportJobStatus?.statusLabel || 'Working').trim()
    const fcaBuilderStatusLabel = fcaBuilderEnabled
        ? (fcaBuilderResolvedStatus === 'Waiting' || fcaBuilderResolvedStatus === 'waiting' ? 'Working' : fcaBuilderResolvedStatus)
        : 'Inactive'
    const fcaBuilderCardStyle = AGENT_CARD_STYLES.ndis || {}
    const fcaBuilderStatusClass = fcaBuilderStatusLabel === 'Ready'
        ? (fcaBuilderCardStyle.status?.accent || 'bg-green-100 text-green-700')
        : fcaBuilderStatusLabel === 'Creating'
            ? (fcaBuilderCardStyle.status?.active || 'bg-blue-100 text-blue-700')
            : fcaBuilderStatusLabel === 'Updating'
                ? (fcaBuilderCardStyle.status?.active || 'bg-cyan-100 text-cyan-700')
                : fcaBuilderStatusLabel === 'Update Pending'
                    ? (fcaBuilderCardStyle.status?.accent || 'bg-amber-100 text-amber-800')
                    : fcaBuilderStatusLabel === 'Working'
                        ? (fcaBuilderCardStyle.status?.active || 'bg-blue-100 text-blue-700')
                        : fcaBuilderStatusLabel === 'Failed'
                            ? (fcaBuilderCardStyle.status?.failed || 'bg-red-100 text-red-700')
                            : fcaBuilderStatusLabel === 'Inactive'
                                ? 'bg-gray-100 text-gray-700'
                                : (fcaBuilderCardStyle.status?.accent || 'bg-amber-100 text-amber-700')
    const fcaBuilderCanOpenReport = !reportJobLoading && hasFormalReport && fcaBuilderStatusLabel === 'Ready'
    const fcaBuilderHeroCard = (
        <div className="relative flex aspect-[3/2] flex-col justify-between overflow-hidden rounded-lg border border-gray-200 bg-gray-100 drop-shadow-[0_8px_10px_rgba(15,23,42,0.14)]">
            <img
                src={fcaBuilderArtwork}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover object-top"
            />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-gray-900/70 to-transparent" />

            <div className="relative flex items-center justify-end gap-3 px-4 py-3">
                <span
                    role={!fcaBuilderEnabled ? 'button' : undefined}
                    tabIndex={!fcaBuilderEnabled ? 0 : undefined}
                    title={!fcaBuilderEnabled ? 'FCA Builder is available when the patient Funder is NDIS.' : undefined}
                    onClick={() => {
                        if (!fcaBuilderEnabled) setUnavailableAgentActionKey('reporting')
                    }}
                    onKeyDown={(event) => {
                        if (!fcaBuilderEnabled && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault()
                            setUnavailableAgentActionKey('reporting')
                        }
                    }}
                    className={!fcaBuilderEnabled ? 'cursor-not-allowed' : undefined}
                >
                    {/* A translucent white border disappears against the light FCA artwork,
                        so the Build button uses the NDIS purple (see AGENT_CARD_STYLES.ndis). */}
                    <button
                        type="button"
                        onClick={handleBuildFca}
                        disabled={!fcaBuilderEnabled}
                        className="rounded-md border border-[#6a2875] bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#6a2875] shadow-sm hover:bg-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Build
                    </button>
                </span>
            </div>

            {unavailableAgentActionKey === 'reporting' && !fcaBuilderEnabled && (
                <p
                    role="status"
                    className="relative mx-auto max-w-[16rem] rounded-md bg-gray-900/80 px-2.5 py-1 text-center text-[11px] font-medium text-white shadow-sm"
                >
                    FCA Builder is available when the patient Funder is NDIS.
                </p>
            )}

            <div className="relative flex items-center justify-between gap-3 px-4 py-3">
                {fcaBuilderCanOpenReport ? (
                    // The Ready chip becomes the report link, so there is no separate
                    // "Open report" affordance on the card.
                    <button
                        type="button"
                        onClick={() => openReportEditor(currentReportRow)}
                        title="Open the latest NDIS FCA report"
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold hover:opacity-80 ${fcaBuilderStatusClass}`}
                    >
                        Open
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                            <path d="M7.5 4.5L13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                ) : (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${fcaBuilderStatusClass}`}>
                        {reportJobLoading ? 'Updating...' : fcaBuilderStatusLabel}
                    </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 flex justify-center">
                    <span className="inline-flex items-center rounded-md bg-gray-900/80 px-2.5 py-1 text-sm font-semibold text-white shadow-sm">FCA Builder</span>
                </span>
            </div>
        </div>
    )

    return (
        <div className={isPopOutView
            ? 'fixed inset-0 z-50 overflow-y-auto bg-gray-900/35 p-3 md:p-6'
            : 'fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-3 md:p-4'}
        >
            <div className={isPopOutView
                ? 'relative mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl md:min-h-[calc(100vh-3rem)]'
                : 'relative flex h-[92vh] min-h-[680px] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl md:h-[86vh] md:max-h-[920px]'}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close patient details"
                    title="Close"
                    className="absolute right-3 top-3 z-20 rounded-md border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-50"
                >
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
                        <path
                            d="M5 5l10 10M15 5L5 15"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
                <div className="flex items-center gap-4 border-b border-gray-200 px-6 py-3">
                    <h2 className="flex-none text-lg font-semibold text-gray-900">
                        {mode === 'create' ? 'Add Patient' : 'Patient'}
                    </h2>

                    {/* The strip carries as many as fifteen tabs, so it scrolls
                        sideways rather than squeezing the title and actions. */}
                    <div className="relative min-w-0 flex-1">
                        {tabStripOverflow.left && (
                            <button
                                type="button"
                                onClick={() => scrollTabStripBy(-180)}
                                aria-label="Scroll patient tabs left"
                                className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-300 bg-white/95 p-1 text-gray-600 shadow-sm hover:bg-gray-50"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        )}
                        <div
                            ref={tabStripRef}
                            onKeyDown={handleTabStripKeyDown}
                            onScroll={updateTabStripOverflow}
                            className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            {/* One tablist for the whole strip: the record tabs first, then the
                                tabs an AI worker writes. The "+ Add" trigger is a sibling of
                                the tablist rather than one of its children, so the tablist never
                                owns a button that is not a tab. */}
                            <div className="mx-auto flex w-max items-center whitespace-nowrap text-xs">
                                <div className="flex flex-none items-center rounded-md border border-gray-300 bg-white p-1">
                                    <div role="tablist" aria-label="Patient sections" className="flex items-center">
                                        <PatientTabButton tabKey="overview" active={activeTab === 'overview'} onSelect={openPatientTab}>
                                            Overview
                                        </PatientTabButton>
                                        <PatientTabButton tabKey="intake" active={activeTab === 'intake'} onSelect={openPatientTab}>
                                            Info
                                        </PatientTabButton>
                                        <PatientTabButton tabKey="notes" active={activeTab === 'notes'} onSelect={openPatientTab}>
                                            Notes
                                        </PatientTabButton>
                                        {mode === 'edit' && (
                                            <PatientTabButton tabKey="files" active={activeTab === 'files'} onSelect={openPatientTab}>
                                                Files
                                            </PatientTabButton>
                                        )}
                                        {mode === 'edit' && hasRecordType('billing') && (
                                            <PatientTabButton tabKey="billing" active={activeTab === 'billing'} onSelect={openPatientTab}>
                                                Billing
                                            </PatientTabButton>
                                        )}
                                        {mode === 'edit' && hasRecordType('cases') && (
                                            <PatientTabButton tabKey="cases" active={activeTab === 'cases'} onSelect={openPatientTab}>
                                                Cases
                                            </PatientTabButton>
                                        )}
                                        {mode === 'edit' && appointmentsEnabled && hasRecordType('appointments') && (
                                            <PatientTabButton tabKey="appointments" active={activeTab === 'appointments'} onSelect={openPatientTab} title="Appointments">
                                                Appts
                                            </PatientTabButton>
                                        )}
                                        {mode === 'edit' && hasRecordType('agreements') && (
                                            <PatientTabButton tabKey="agreements" active={activeTab === 'agreements'} onSelect={openPatientTab} title="Service agreements">
                                                Agreements
                                            </PatientTabButton>
                                        )}
                                        {/* The tabs an AI worker writes close the strip,
                                            alphabetically: Analysis, Equipment, Quotes, Reports,
                                            Transcripts. They are ordinary tabs rather than a second
                                            tablist, so a tab that appears or disappears with its agent
                                            never has to cross between groups, and the assistant mark on
                                            the tab itself is what says a worker writes it. */}
                                        {showAnalysisTab && (
                                            <PatientTabButton
                                                tabKey="analysis"
                                                active={activeTab === 'analysis'}
                                                onSelect={openPatientTab}
                                                domainKey={activeDomain}
                                                workerContent
                                            >
                                                Analysis
                                            </PatientTabButton>
                                        )}
                                        {showEquipmentTab && (
                                            <PatientTabButton
                                                tabKey="equipment"
                                                active={activeTab === 'equipment'}
                                                onSelect={openPatientTab}
                                                domainKey={activeDomain}
                                                workerContent={(equipmentSourcing?.result?.suggestions || []).length > 0}
                                            >
                                                Equipment
                                            </PatientTabButton>
                                        )}
                                        {showQuotesTab && (
                                            <PatientTabButton
                                                tabKey="quotes"
                                                active={activeTab === 'quotes'}
                                                onSelect={openPatientTab}
                                                title="NDIS quotes"
                                                domainKey={activeDomain}
                                                workerContent={quoteWorkerContent.patientId === String(draft?.id || '') && quoteWorkerContent.hasContent}
                                            >
                                                Quotes
                                            </PatientTabButton>
                                        )}
                                        {showReportTab && (
                                            <PatientTabButton
                                                tabKey="report"
                                                active={activeTab === 'report'}
                                                onSelect={openPatientTab}
                                                domainKey={activeDomain}
                                                workerContent={hasFormalReport || Boolean(currentReportRow) || completedReportRows.length > 0}
                                            >
                                                Reports
                                            </PatientTabButton>
                                        )}
                                        {showTranscriptsTab && (
                                            <PatientTabButton
                                                tabKey="transcripts"
                                                active={activeTab === 'transcripts'}
                                                onSelect={openPatientTab}
                                                domainKey={activeDomain}
                                                workerContent={
                                                    (Array.isArray(transcriptionRecords) && transcriptionRecords.some((record) => String(record?.transcript_text || '').trim()))
                                                    || (Array.isArray(scribeSummaries) && scribeSummaries.length > 0)
                                                }
                                            >
                                                Transcripts
                                            </PatientTabButton>
                                        )}
                                    </div>
                                    {mode === 'edit' && draft?.id && addableRecordTypes.length > 0 && (
                                        <>
                                            <span aria-hidden="true" className="mx-1 h-4 w-px flex-none bg-gray-300" />
                                            <button
                                                ref={addMenuAnchorRef}
                                                type="button"
                                                onClick={toggleAddMenu}
                                                aria-haspopup="menu"
                                                aria-expanded={addMenuOpen}
                                                title="Add a record to this patient"
                                                className="inline-flex flex-none items-center gap-1.5 rounded px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                                Add
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        {tabStripOverflow.right && (
                            <button
                                type="button"
                                onClick={() => scrollTabStripBy(180)}
                                aria-label="Scroll patient tabs right"
                                className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-300 bg-white/95 p-1 text-gray-600 shadow-sm hover:bg-gray-50"
                            >
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                    <div className="flex flex-none items-center gap-2 pr-8">
                        {/* The trigger lives inside the scrolling bar, so the menu is placed
                            against the viewport (see positionAddMenu) rather than being a child
                            the bar would clip. */}
                        {addMenuOpen && addMenuPosition && (
                            <div
                                ref={addMenuRef}
                                role="menu"
                                style={{ top: addMenuPosition.top, right: addMenuPosition.right }}
                                className="fixed z-30 w-44 rounded-lg border border-gray-200 bg-white p-1 text-left shadow-lg"
                            >
                                {addableRecordTypes.map((item) => (
                                    <button
                                        key={item.tab}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => startPatientRecord(item.tab)}
                                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        <Plus className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {mode === 'edit' && draft?.id && !isPopOutView && (
                            <button
                                type="button"
                                onClick={handlePopOut}
                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                aria-label="Open patient modal in a new window"
                                title="Pop out"
                            >
                                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
                                    <path
                                        d="M7.5 5.5h-3A1.5 1.5 0 0 0 3 7v6A1.5 1.5 0 0 0 4.5 14.5h6A1.5 1.5 0 0 0 12 13v-3"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M9 3h8v8"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M17 3l-8 8"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                Pop out
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {activeTab === 'overview' && (
                        <PatientOverviewTab
                            activeAgentSettings={activeAgentSettings}
                            activeAgentSettingsKey={activeAgentSettingsKey}
                            activeDomain={activeDomain}
                            agentCardOrder={agentCardOrder}
                            agentGroupExplainer={agentGroupExplainer}
                            agentGroupLabel={agentGroupLabel}
                            agentSavingKey={agentSavingKey}
                            analysisConfig={analysisConfig}
                            analysisEvidenceError={analysisEvidenceError}
                            analysisEvidenceFileId={analysisEvidenceFileId}
                            analysisJobLoading={analysisJobLoading}
                            analysisJobStatus={analysisJobStatus}
                            billingConfig={billingConfig}
                            billingJobLoading={billingJobLoading}
                            billingJobStatus={billingJobStatus}
                            comparativeDraftErrorByOption={comparativeDraftErrorByOption}
                            comparativeDraftLoadingByOption={comparativeDraftLoadingByOption}
                            comparativeDraftsByOption={comparativeDraftsByOption}
                            comparativePatientOptions={comparativePatientOptions}
                            currentReportRow={currentReportRow}
                            draft={draft}
                            equipmentSourcing={equipmentSourcing}
                            equipmentSourcingLoading={equipmentSourcingLoading}
                            fcaBuilderHeroCard={fcaBuilderHeroCard}
                            fcaBuilderHeroVisible={fcaBuilderHeroVisible}
                            firstInactiveAgentKey={firstInactiveAgentKey}
                            firstWorkerHeroKey={firstWorkerHeroKey}
                            handleBuildFca={handleBuildFca}
                            hasFormalReport={hasFormalReport}
                            hasUnsavedChanges={hasUnsavedChanges}
                            hsrCreatorConfig={hsrCreatorConfig}
                            hsrSummariserConfig={hsrSummariserConfig}
                            hsrWriterDomainVisible={hsrWriterDomainVisible}
                            hsrWriterHeroCard={hsrWriterHeroCard}
                            isAgentActive={isAgentActive}
                            loadComparativeDrafts={loadComparativeDrafts}
                            onChangeAgentConfig={onChangeAgentConfig}
                            onChangeOverviewDob={onChangeOverviewDob}
                            onChangeOverviewName={onChangeOverviewName}
                            onChangeOverviewSuburb={onChangeOverviewSuburb}
                            onToggleAgent={onToggleAgent}
                            onToggleAnalysisEvidenceFile={onToggleAnalysisEvidenceFile}
                            openAgentSettingsKey={openAgentSettingsKey}
                            openReportEditor={openReportEditor}
                            overviewDob={overviewDob}
                            overviewName={overviewName}
                            overviewSuburb={overviewSuburb}
                            patientFiles={patientFiles}
                            patientFilesLoading={patientFilesLoading}
                            quoteWriterConfig={quoteWriterConfig}
                            reportJobLoading={reportJobLoading}
                            reportJobStatus={reportJobStatus}
                            reportSaveImpact={reportSaveImpact}
                            reportingConfig={reportingConfig}
                            saving={saving}
                            scribeConfig={scribeConfig}
                            scribeJobLoading={scribeJobLoading}
                            scribeJobStatus={scribeJobStatus}
                            setActiveTab={setActiveTab}
                            setOpenAgentSettingsKey={setOpenAgentSettingsKey}
                            setSelectedSummaryStyle={setSelectedSummaryStyle}
                            setSelectedSummaryTranscriptId={setSelectedSummaryTranscriptId}
                            setUnavailableAgentActionKey={setUnavailableAgentActionKey}
                            unavailableAgentActionKey={unavailableAgentActionKey}
                            workerReviewItems={workerReviewItems}
                            workerReviewSummary={workerReviewSummary}
                        />
                    )}

                    {activeTab === 'intake' && (
                        <div className="space-y-6">
                            {Object.entries(groupedFields).map(([sectionName, sectionFields]) => (
                                <section key={sectionName}>
                                    <h3 className="text-sm font-semibold text-gray-900">{sectionName}</h3>
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {sectionFields.map((field) => (
                                            <label
                                                key={field.id}
                                                className={`block ${String(field.type || '').toLowerCase() === 'longtext' || String(field.type || '').toLowerCase() === 'address' ? 'md:col-span-2' : ''}`}
                                            >
                                                <span className="text-xs font-medium text-gray-700">
                                                    {field.label}
                                                    {field.required ? ' *' : ''}
                                                </span>
                                                {renderFieldInput(field)}
                                            </label>
                                        ))}
                                    </div>
                                </section>
                            ))}

                            {/* Contacts linked to this patient, so the people around
                                them are visible alongside their intake answers. */}
                            {draft?.id && (
                                <div className="border-t border-gray-200 pt-6">
                                    <PatientContactsPanel
                                        key={`contacts:${activeDomain}:${draft.id}`}
                                        patientId={draft.id}
                                        patientName={String(draft?.patient_name || '').trim()}
                                        domain={activeDomain}
                                    />
                                </div>
                            )}

                            {/* Submitted forms sit under the intake fields: they feed
                                this pane, so they belong with it rather than in a tab. */}
                            {mode === 'edit' && formsEnabled && draft?.id && (
                                <div className="border-t border-gray-200 pt-6">
                                    <PatientFormsPanel
                                        key={`forms:${activeDomain}:${draft?.id}`}
                                        patientId={draft.id}
                                        patientName={String(draft?.patient_name || '').trim()}
                                        domain={activeDomain}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'notes' && (
                        <PatientNotesPanel
                            key={`${activeDomain}:${draft?.id || 'new'}`}
                            patientId={draft?.id}
                            patientName={String(draft?.patient_name || '').trim()}
                            domain={activeDomain}
                        />
                    )}

                    {activeTab === 'report' && mode === 'edit' && (
                        <PatientReportTab
                            completedReportRows={completedReportRows}
                            currentReportRow={currentReportRow}
                            deleteReportRows={deleteReportRows}
                            onRefreshFormalReport={onRefreshFormalReport}
                            onRefreshReportDrafts={onRefreshReportDrafts}
                            openReportEditor={openReportEditor}
                            reportActionMessage={reportActionMessage}
                            reportActionTone={reportActionTone}
                            reportBulkDeleting={reportBulkDeleting}
                            reportDeletingKey={reportDeletingKey}
                            reportDraftsError={reportDraftsError}
                            reportDraftsLoading={reportDraftsLoading}
                            reportTableRows={reportTableRows}
                            reportTypeGroups={reportTypeGroups}
                            selectedReportKeys={selectedReportKeys}
                            selectedReportRows={selectedReportRows}
                            setReportVersionSelection={setReportVersionSelection}
                            setSelectedReportKeys={setSelectedReportKeys}
                            workingDraftRow={workingDraftRow}
                        />
                    )}

                    {openReport && (
                        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6">
                            <div className="w-full max-w-6xl max-h-[90vh] overflow-auto rounded-xl border border-gray-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                                <div className="p-6">
                                    <ReportViewerPanel
                                        title={openReport?.patientName ? `${openReport.patientName} Report` : 'Report'}
                                        patientName={openReport?.patientName || ''}
                                        patientId={openReport?.patientId}
                                        domain={activeDomain}
                                        report={openReport}
                                        initialMarkdown={openReportMarkdown}
                                        loading={Boolean(reportSavingId || reportDeletingKey || reportExportingId)}
                                        saving={Boolean(reportSavingId)}
                                        deleting={Boolean(reportDeletingKey)}
                                        onSave={saveOpenReport}
                                        onDelete={() => deleteReportRows([openReport])}
                                        onRefresh={() => openReportEditor({ ...openReport, reportMarkdown: openReportMarkdown })}
                                        onClose={closeReportEditor}
                                        onExportDocx={exportOpenReportDocx}
                                        exportingDocx={Boolean(reportExportingId)}
                                        statusMessage={reportActionMessage}
                                        statusTone={reportActionTone}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'analysis' && mode === 'edit' && overviewAgents.analyst === true && (
                        <PatientAnalysisTab
                            analysisAddressedInterventions={analysisAddressedInterventions}
                            analysisDeleting={analysisDeleting}
                            analysisDocuments={analysisDocuments}
                            analysisJobLoading={analysisJobLoading}
                            analysisJobStatus={analysisJobStatus}
                            analysisRecommendedInterventions={analysisRecommendedInterventions}
                            analysisRerunning={analysisRerunning}
                            analysisStats={analysisStats}
                            analysisSummaryText={analysisSummaryText}
                            analysisWorkerPrompt={analysisWorkerPrompt}
                            onDeleteAnalysis={onDeleteAnalysis}
                            onRefreshAnalysis={onRefreshAnalysis}
                            onRerunAnalysis={onRerunAnalysis}
                            patientAnalysis={patientAnalysis}
                            patientAnalysisError={patientAnalysisError}
                            patientAnalysisLoading={patientAnalysisLoading}
                            selectedSummaryLabel={selectedSummaryLabel}
                            setShowAnalysisMetadata={setShowAnalysisMetadata}
                            setShowAnalysisPrompt={setShowAnalysisPrompt}
                            showAnalysisMetadata={showAnalysisMetadata}
                            showAnalysisPrompt={showAnalysisPrompt}
                        />
                    )}

                    {activeTab === 'equipment' && mode === 'edit' && overviewAgents.equipmentSourcer === true && (
                        <PatientEquipmentTab
                            closeSourcingWizard={closeSourcingWizard}
                            confirmSourcingItemDetails={confirmSourcingItemDetails}
                            equipmentItemDrafts={equipmentItemDrafts}
                            equipmentSourcing={equipmentSourcing}
                            equipmentSourcingError={equipmentSourcingError}
                            equipmentSourcingLoading={equipmentSourcingLoading}
                            equipmentSuggestionMenuIndex={equipmentSuggestionMenuIndex}
                            equipmentSuggestionResettingIndex={equipmentSuggestionResettingIndex}
                            expandedSourcingSupplierIds={expandedSourcingSupplierIds}
                            onRefreshEquipmentSourcing={onRefreshEquipmentSourcing}
                            openSourcingReplyMessage={openSourcingReplyMessage}
                            prepareSourcingQuoteDraft={prepareSourcingQuoteDraft}
                            resetEquipmentSuggestionStatus={resetEquipmentSuggestionStatus}
                            sendSourcingQuoteRequest={sendSourcingQuoteRequest}
                            setEquipmentSuggestionMenuIndex={setEquipmentSuggestionMenuIndex}
                            setShowSourcingEmailOptions={setShowSourcingEmailOptions}
                            setShowSourcingReplyToAddress={setShowSourcingReplyToAddress}
                            setSourcingBccReplyTo={setSourcingBccReplyTo}
                            setSourcingQuoteDraft={setSourcingQuoteDraft}
                            setSourcingQuoteViewType={setSourcingQuoteViewType}
                            setSourcingSupplierId={setSourcingSupplierId}
                            setSourcingWizardItem={setSourcingWizardItem}
                            showSourcingEmailOptions={showSourcingEmailOptions}
                            showSourcingReplyToAddress={showSourcingReplyToAddress}
                            sourcingBccReplyTo={sourcingBccReplyTo}
                            sourcingPracticeName={sourcingPracticeName}
                            sourcingQuoteDraft={sourcingQuoteDraft}
                            sourcingQuoteSent={sourcingQuoteSent}
                            sourcingQuoteViewType={sourcingQuoteViewType}
                            sourcingReplyToEmail={sourcingReplyToEmail}
                            sourcingReplyToName={sourcingReplyToName}
                            sourcingSupplierId={sourcingSupplierId}
                            sourcingSuppliers={sourcingSuppliers}
                            sourcingWizardError={sourcingWizardError}
                            sourcingWizardItem={sourcingWizardItem}
                            sourcingWizardSaving={sourcingWizardSaving}
                            toggleSourcingSupplierDetails={toggleSourcingSupplierDetails}
                        />
                    )}

                    {activeTab === 'files' && mode === 'edit' && (
                        <PatientFilesTab
                            onDeletePatientFile={onDeletePatientFile}
                            onDownloadPatientFile={onDownloadPatientFile}
                            onPreviewPatientFile={onPreviewPatientFile}
                            onUploadPatientFile={onUploadPatientFile}
                            patientFileDeletingId={patientFileDeletingId}
                            patientFileUploading={patientFileUploading}
                            patientFiles={patientFiles}
                            patientFilesError={patientFilesError}
                            patientFilesLoading={patientFilesLoading}
                        />
                    )}

                    {activeTab === 'billing' && mode === 'edit' && (
                        <PatientBillingTab
                            billingDeletingId={billingDeletingId}
                            billingError={billingError}
                            billingForm={billingForm}
                            billingLoading={billingLoading}
                            billingRecords={billingRecords}
                            billingSubmitting={billingSubmitting}
                            onAddBillingRecord={onAddBillingRecord}
                            onChangeBillingForm={onChangeBillingForm}
                            onDeleteBillingRecord={onDeleteBillingRecord}
                            onRefreshBilling={onRefreshBilling}
                        />
                    )}

                    {activeTab === 'cases' && mode === 'edit' && draft?.id && (
                        <PatientCasesPanel
                            key={`${activeDomain}:${draft?.id}`}
                            patientId={draft.id}
                            patientName={String(draft?.patient_name || '').trim()}
                            domain={activeDomain}
                            domainDisplayName={domainDisplayName}
                            openCreate={pendingCreateTab === 'cases'}
                            onOpenCreateHandled={handleCreateIntentHandled}
                        />
                    )}

                    {activeTab === 'appointments' && mode === 'edit' && appointmentsEnabled && draft?.id && (
                        <PatientAppointmentsPanel
                            key={`${activeDomain}:${draft?.id}`}
                            patientId={draft.id}
                            patientName={String(draft?.patient_name || '').trim()}
                            domain={activeDomain}
                            openCreate={pendingCreateTab === 'appointments'}
                            onOpenCreateHandled={handleCreateIntentHandled}
                        />
                    )}

                    {activeTab === 'quotes' && mode === 'edit' && draft?.id && (
                        <PatientQuotesPanel
                            key={`quotes:${activeDomain}:${draft?.id}`}
                            patientId={draft.id}
                            patientName={String(draft?.patient_name || '').trim()}
                            domain={activeDomain}
                            domainDisplayName={domainDisplayName}
                            patientAnswers={draft?.answers}
                            patientLabelledAnswers={draft?.rawMetadata?.sploseLabelledAnswers}
                            openCreate={pendingCreateTab === 'quotes'}
                            onOpenCreateHandled={handleCreateIntentHandled}
                            onWorkerContentChange={handleQuoteWorkerContentChange}
                        />
                    )}

                    {activeTab === 'agreements' && mode === 'edit' && draft?.id && (
                        <PatientServiceAgreementsPanel
                            key={`agreements:${activeDomain}:${draft?.id}`}
                            patientId={draft.id}
                            patientName={String(draft?.patient_name || '').trim()}
                            domain={activeDomain}
                            domainDisplayName={domainDisplayName}
                            patientAnswers={draft?.answers}
                            patientLabelledAnswers={draft?.rawMetadata?.sploseLabelledAnswers}
                            openCreate={pendingCreateTab === 'agreements'}
                            onOpenCreateHandled={handleCreateIntentHandled}
                        />
                    )}

                    {activeTab === 'transcripts' && mode === 'edit' && (
                        <PatientTranscriptsTab
                            activeSummaryGroupItems={activeSummaryGroupItems}
                            activeSummaryGroupKey={activeSummaryGroupKey}
                            buildSummaryTranscriptOptionLabel={buildSummaryTranscriptOptionLabel}
                            hasSelectedSummary={hasSelectedSummary}
                            hasStoredSummary={hasStoredSummary}
                            liveTranscript={liveTranscript}
                            liveTranscriptRows={liveTranscriptRows}
                            onDeleteSummary={onDeleteSummary}
                            onDeleteTranscription={onDeleteTranscription}
                            onRefreshSummary={onRefreshSummary}
                            onRefreshTranscriptions={onRefreshTranscriptions}
                            onRestoreTranscription={onRestoreTranscription}
                            onStartRecording={onStartRecording}
                            onStopRecording={onStopRecording}
                            overviewAgents={overviewAgents}
                            previousRecordingsPulse={previousRecordingsPulse}
                            previousRecordingsRef={previousRecordingsRef}
                            recorderActive={recorderActive}
                            recorderBusy={recorderBusy}
                            recorderHint={recorderHint}
                            recorderPermission={recorderPermission}
                            recorderReady={recorderReady}
                            recorderSupported={recorderSupported}
                            scribeJobLoading={scribeJobLoading}
                            scribeJobStatus={scribeJobStatus}
                            scribeSummary={scribeSummary}
                            scribeSummaryActionItems={scribeSummaryActionItems}
                            scribeSummaryBulletLines={scribeSummaryBulletLines}
                            scribeSummaryDeleting={scribeSummaryDeleting}
                            scribeSummaryError={scribeSummaryError}
                            scribeSummaryEvidenceGroups={scribeSummaryEvidenceGroups}
                            scribeSummaryLoading={scribeSummaryLoading}
                            scribeSummaryText={scribeSummaryText}
                            scribeWorkerPrompt={scribeWorkerPrompt}
                            scrollToPreviousRecordings={scrollToPreviousRecordings}
                            selectedSummary={selectedSummary}
                            selectedSummaryLabel={selectedSummaryLabel}
                            selectedTranscriptId={selectedTranscriptId}
                            selectedTranscriptPendingDelete={selectedTranscriptPendingDelete}
                            selectedTranscriptRecord={selectedTranscriptRecord}
                            selectedTranscriptRows={selectedTranscriptRows}
                            setSelectedSummaryStyle={setSelectedSummaryStyle}
                            setSelectedSummaryTranscriptId={setSelectedSummaryTranscriptId}
                            setSelectedTranscriptId={setSelectedTranscriptId}
                            setShowSummaryMetadata={setShowSummaryMetadata}
                            setShowSummaryPrompt={setShowSummaryPrompt}
                            showCurrentTranscriptPanel={showCurrentTranscriptPanel}
                            showFullTranscriptPanel={showFullTranscriptPanel}
                            showScribeSummaryActionItems={showScribeSummaryActionItems}
                            showScribeSummaryBullets={showScribeSummaryBullets}
                            showScribeSummaryEvidence={showScribeSummaryEvidence}
                            showSummariesPanel={showSummariesPanel}
                            showSummaryMetadata={showSummaryMetadata}
                            showSummaryPrompt={showSummaryPrompt}
                            summaryStyleGroups={summaryStyleGroups}
                            transcriptionDeletingId={transcriptionDeletingId}
                            transcriptionError={transcriptionError}
                            transcriptionLoading={transcriptionLoading}
                            transcriptionRecords={transcriptionRecords}
                        />
                    )}
                </div>

                {error && (
                    <p className="mx-6 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                {!error && hasUnsavedChanges && (
                    <p className="mx-6 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        You have unsaved changes.
                    </p>
                )}

                <div className="flex items-center justify-end border-t border-gray-200 px-6 py-4">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                            type="button"
                            onClick={onSaveAndClose}
                            disabled={saving}
                            className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving ? 'Saving...' : 'Save & Close'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function PatientsPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryPatientId = String(searchParams.get('patientId') || '').trim()
    const focusedTranscriptionId = String(searchParams.get('transcriptionId') || '').trim()
    const isPopOutView = searchParams.get('popout') === '1' || Boolean(queryPatientId)

    const clearCreateQueryParam = useCallback(() => {
        if (typeof window === 'undefined') return

        const url = new URL(window.location.href)
        if (!url.searchParams.has('create')) return

        url.searchParams.delete('create')
        const nextPath = `${url.pathname}${url.search}${url.hash}`
        router.replace(nextPath)
    }, [router])

    const clearPatientQueryParam = useCallback(() => {
        if (typeof window === 'undefined') return

        const url = new URL(window.location.href)
        const hasPatientId = url.searchParams.has('patientId')
        const hasTab = url.searchParams.has('tab')
        const hasPopOut = url.searchParams.has('popout')
        const hasOpenCurrentReport = url.searchParams.has('openCurrentReport')
        if (!hasPatientId && !hasTab && !hasPopOut && !hasOpenCurrentReport) return

        url.searchParams.delete('patientId')
        url.searchParams.delete('tab')
        url.searchParams.delete('popout')
        url.searchParams.delete('openCurrentReport')
        const nextPath = `${url.pathname}${url.search}${url.hash}`
        router.replace(nextPath)
    }, [router])

    // A `tab` query param carried without a patient (the Admin docs deep link) is the
    // requested panel: remember it so the next patient opened from the list lands there.
    const requestedPatientTab = String(searchParams.get('tab') || '').trim().toLowerCase()

    const openPatientEditor = useCallback((patientId, initialTab = requestedPatientTab) => {
        if (typeof window === 'undefined') return

        const normalizedPatientId = String(patientId || '').trim()
        if (!normalizedPatientId) return

        const nextTab = PATIENT_MODAL_TABS.has(initialTab) ? initialTab : 'overview'
        const url = new URL(window.location.href)
        url.searchParams.set('patientId', normalizedPatientId)
        url.searchParams.set('tab', nextTab)
        url.searchParams.set('popout', '1')

        const nextPath = `${url.pathname}${url.search}${url.hash}`
        router.push(nextPath)
    }, [router, requestedPatientTab])

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [domainDisplayName, setDomainDisplayName] = useState('')
    const [domainSourcingReplyTo, setDomainSourcingReplyTo] = useState('')
    const [domainSourcingReplyToName, setDomainSourcingReplyToName] = useState('')
    const [domainSourcingBccReplyToDefault, setDomainSourcingBccReplyToDefault] = useState(false)
    const [domainSourcingEmailSignature, setDomainSourcingEmailSignature] = useState('')
    const [domainSourcingLogoUrl, setDomainSourcingLogoUrl] = useState('')
    const [patientsEnabled, setPatientsEnabled] = useState(false)
    const [appointmentsEnabled, setAppointmentsEnabled] = useState(false)
    const [formsEnabled, setFormsEnabled] = useState(false)
    const [workerVisibility, setWorkerVisibility] = useState(DEFAULT_WORKER_VISIBILITY)
    const [schemaLoading, setSchemaLoading] = useState(false)
    const [schemaFields, setSchemaFields] = useState(DEFAULT_SPLPOSE_FIELDS)
    const [schemaFormUuid, setSchemaFormUuid] = useState('')

    const [patients, setPatients] = useState([])
    const [loadingPatients, setLoadingPatients] = useState(false)
    const [searchText, setSearchText] = useState('')

    const [importSource, setImportSource] = useState(DEFAULT_EXTERNAL_SOURCE)
    const [importFile, setImportFile] = useState(null)
    const [importText, setImportText] = useState('')
    const [importDryRun, setImportDryRun] = useState(true)
    const [importRunning, setImportRunning] = useState(false)
    const [importResult, setImportResult] = useState(null)
    const fileInputRef = useRef(null)

    // Importing lives behind the page menu: it is an occasional, advanced tool
    // rather than part of the day-to-day list view.
    const [importMenuOpen, setImportMenuOpen] = useState(false)
    const importMenuRef = useRef(null)

    const [showModal, setShowModal] = useState(false)
    const [modalMode, setModalMode] = useState('create')
    const [modalInitialTab, setModalInitialTab] = useState('overview')
    const [draft, setDraft] = useState(null)
    const [initialDraftSnapshot, setInitialDraftSnapshot] = useState('')
    const [saving, setSaving] = useState(false)
    const [agentSavingKey, setAgentSavingKey] = useState('')
    const [deletingPatientId, setDeletingPatientId] = useState(null)
    const [modalError, setModalError] = useState('')
    const [billingRecords, setBillingRecords] = useState([])
    const [billingLoading, setBillingLoading] = useState(false)
    const [billingSubmitting, setBillingSubmitting] = useState(false)
    const [billingDeletingId, setBillingDeletingId] = useState(null)
    const [billingError, setBillingError] = useState('')
    const [billingForm, setBillingForm] = useState(DEFAULT_PATIENT_BILLING_FORM)
    const [reportJobStatus, setReportJobStatus] = useState(null)
    const [reportJobLoading, setReportJobLoading] = useState(false)
    const [formalReport, setFormalReport] = useState(null)
    const [formalReportLoading, setFormalReportLoading] = useState(false)
    const [formalReportSaving, setFormalReportSaving] = useState(false)
    const [formalReportDownloadingWord, setFormalReportDownloadingWord] = useState(false)
    const [formalReportExportingTemplate, setFormalReportExportingTemplate] = useState(false)
    const [reportDrafts, setReportDrafts] = useState([])
    const [reportDraftsLoading, setReportDraftsLoading] = useState(false)
    const [reportDraftsError, setReportDraftsError] = useState('')
    const [billingJobStatus, setBillingJobStatus] = useState(null)
    const [billingJobLoading, setBillingJobLoading] = useState(false)
    const [analysisJobStatus, setAnalysisJobStatus] = useState(null)
    const [analysisJobLoading, setAnalysisJobLoading] = useState(false)
    const [equipmentSourcing, setEquipmentSourcing] = useState(null)
    const [equipmentSourcingLoading, setEquipmentSourcingLoading] = useState(false)
    const [equipmentSourcingError, setEquipmentSourcingError] = useState('')
    const [scribeJobStatus, setScribeJobStatus] = useState(null)
    const [scribeJobLoading, setScribeJobLoading] = useState(false)
    const [scribeSummary, setScribeSummary] = useState(null)
    const [scribeSummaries, setScribeSummaries] = useState([])
    const [scribeSummaryLoading, setScribeSummaryLoading] = useState(false)
    const [scribeSummaryError, setScribeSummaryError] = useState('')
    const [scribeSummaryDeleting, setScribeSummaryDeleting] = useState(false)
    const [patientAnalysis, setPatientAnalysis] = useState(null)
    const [patientAnalysisLoading, setPatientAnalysisLoading] = useState(false)
    const [patientAnalysisError, setPatientAnalysisError] = useState('')
    const [analysisDeleting, setAnalysisDeleting] = useState(false)
    const [analysisRerunning, setAnalysisRerunning] = useState(false)
    const [transcriptionRecords, setTranscriptionRecords] = useState([])
    const [transcriptionLoading, setTranscriptionLoading] = useState(false)
    const [transcriptionDeletingId, setTranscriptionDeletingId] = useState(null)
    const [transcriptionError, setTranscriptionError] = useState('')
    const [patientFiles, setPatientFiles] = useState([])
    const [patientFilesLoading, setPatientFilesLoading] = useState(false)
    const [patientFileUploading, setPatientFileUploading] = useState(false)
    const [patientFileDeletingId, setPatientFileDeletingId] = useState(null)
    const [patientFilesError, setPatientFilesError] = useState('')
    const [analysisEvidenceFileId, setAnalysisEvidenceFileId] = useState('')
    const [analysisEvidenceError, setAnalysisEvidenceError] = useState('')
    const [recorderSupported, setRecorderSupported] = useState(false)
    const [recorderReady, setRecorderReady] = useState(false)
    const [recorderPermission, setRecorderPermission] = useState('unknown')
    const [recorderHint, setRecorderHint] = useState('')
    const [recorderActive, setRecorderActive] = useState(false)
    const [recorderBusy, setRecorderBusy] = useState(false)
    const [liveTranscript, setLiveTranscript] = useState('')

    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')
    const handledQueryPatientIdRef = useRef('')
    const reportJobStatusCacheRef = useRef(new Map())
    const mediaRecorderRef = useRef(null)
    const mediaStreamRef = useRef(null)
    const chunkIndexRef = useRef(0)
    const activeTranscriptionIdRef = useRef(null)
    const stopRequestedRef = useRef(false)
    const uploadQueueRef = useRef(Promise.resolve())
    const recordedChunksRef = useRef([])
    const recorderFlushIntervalRef = useRef(null)
    const useLiveChunkingRef = useRef(true)
    const usePcmFallbackRef = useRef(false)
    const pcmContextRef = useRef(null)
    const pcmSourceRef = useRef(null)
    const pcmProcessorRef = useRef(null)
    const pcmSilenceGainRef = useRef(null)
    const pcmChunksRef = useRef([])
    const pcmSampleRateRef = useRef(44100)

    const reportStatusCacheKey = useCallback((patientId, domain) => {
        const normalizedPatientId = String(patientId || '').trim()
        const normalizedDomain = String(domain || '').trim().toLowerCase()
        if (!normalizedPatientId || !normalizedDomain) return ''
        return `${normalizedDomain}:${normalizedPatientId}`
    }, [])

    const getCachedReportJobStatus = useCallback((patientId, domain) => {
        const key = reportStatusCacheKey(patientId, domain)
        if (!key) return null
        return reportJobStatusCacheRef.current.get(key) || null
    }, [reportStatusCacheKey])

    const setCachedReportJobStatus = useCallback((patientId, domain, status) => {
        const key = reportStatusCacheKey(patientId, domain)
        if (!key || !status || typeof status !== 'object') return
        reportJobStatusCacheRef.current.set(key, status)
    }, [reportStatusCacheKey])

    const clearCachedReportJobStatus = useCallback((patientId, domain) => {
        const key = reportStatusCacheKey(patientId, domain)
        if (!key) return
        reportJobStatusCacheRef.current.delete(key)
    }, [reportStatusCacheKey])

    const refreshMicrophonePermission = useCallback(async () => {
        if (typeof window === 'undefined') return
        const canQueryPermissions = typeof window.navigator?.permissions?.query === 'function'
        if (!canQueryPermissions) {
            setRecorderPermission('unknown')
            return
        }

        try {
            const result = await window.navigator.permissions.query({ name: 'microphone' })
            const state = String(result?.state || 'unknown').trim().toLowerCase()
            setRecorderPermission(state || 'unknown')
        } catch {
            setRecorderPermission('unknown')
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const hasMediaRecorder = typeof window.MediaRecorder !== 'undefined' || typeof globalThis.MediaRecorder !== 'undefined'
        const hasGetUserMedia = typeof window.navigator?.mediaDevices?.getUserMedia === 'function'
        const isSecure = window.isSecureContext === true
        const hostname = String(window.location?.hostname || '').trim().toLowerCase()
        const isLoopbackHost =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]' ||
            hostname.endsWith('.localhost')

        queueMicrotask(() => {
            setRecorderSupported(hasMediaRecorder)
            setRecorderReady(Boolean(hasMediaRecorder && hasGetUserMedia && isSecure))
        })

        if (!hasMediaRecorder) {
            queueMicrotask(() => setRecorderHint('MediaRecorder is not available in this browser runtime.'))
            return
        }

        if (!isSecure || !hasGetUserMedia) {
            if (!isSecure && !isLoopbackHost && hostname) {
                queueMicrotask(() => setRecorderHint(`Safari does not treat http://${hostname} as a secure origin for microphone access. Use https://, http://localhost:3000, or http://<domain>.localhost:3000 (for example: http://my-practice.localhost:3000).`))
                return
            }

            queueMicrotask(() => setRecorderHint('Microphone capture requires a secure origin and microphone permission. Open this app on https:// or localhost and allow microphone permissions in Safari.'))
            return
        }

        queueMicrotask(() => setRecorderHint(''))
        queueMicrotask(() => refreshMicrophonePermission())
    }, [refreshMicrophonePermission])

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) {
            throw new Error('Missing admin session token')
        }
        return { Authorization: `Bearer ${token}` }
    }, [])

    const refreshPatients = useCallback(async (domain) => {
        if (!domain) return

        setLoadingPatients(true)
        try {
            const response = await fetchWithTimeout(`/api/database/patients?domain=${encodeURIComponent(domain)}&limit=200`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load patients')
            }

            setPatients(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setPatients([])
            setStatusMessage(error?.message || 'Failed to load patients')
            setStatusTone('error')
        } finally {
            setLoadingPatients(false)
        }
    }, [])

    // Dismiss the import menu on an outside click or Escape so it never traps
    // focus behind the rest of the page.
    useEffect(() => {
        if (!importMenuOpen) return undefined

        const closeMenu = (event) => {
            if (event.type === 'keydown' && event.key !== 'Escape') return
            if (event.type === 'pointerdown' && importMenuRef.current && importMenuRef.current.contains(event.target)) return
            setImportMenuOpen(false)
        }

        document.addEventListener('pointerdown', closeMenu)
        document.addEventListener('keydown', closeMenu)
        return () => {
            document.removeEventListener('pointerdown', closeMenu)
            document.removeEventListener('keydown', closeMenu)
        }
    }, [importMenuOpen])

    const importPreview = useMemo(() => {
        if (!importText) return null
        try {
            const parsed = parsePatientCsv(importText)
            return {
                rowCount: parsed.rowCount,
                unknownHeaders: parsed.unknownHeaders,
                firstRow: parsed.records[0]?.raw || null,
            }
        } catch (error) {
            return { error: error?.message || 'Failed to parse CSV' }
        }
    }, [importText])

    const handleImportFileSelected = useCallback(async (file) => {
        if (!file) return

        setImportFile(file)
        setImportResult(null)

        try {
            const text = await file.text()
            setImportText(text)
        } catch (error) {
            setImportText('')
            setStatusMessage(error?.message || 'Failed to read the selected file')
            setStatusTone('error')
        }
    }, [])

    const runPatientImport = useCallback(async (dryRun) => {
        if (!importText) {
            setStatusMessage('Choose a CSV file to import first')
            setStatusTone('error')
            return
        }

        setImportRunning(true)
        setImportResult(null)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/patients/import', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: activeDomain,
                    csv: importText,
                    source: importSource || DEFAULT_EXTERNAL_SOURCE,
                    fileName: importFile?.name || null,
                    dryRun,
                }),
            }, 120000)

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to import patients')
            }

            setImportResult(data?.data || null)
            setStatusTone('success')

            if (!dryRun) {
                setStatusMessage(`Import complete: ${data?.data?.inserted ?? 0} added, ${data?.data?.updated ?? 0} updated.`)
                await refreshPatients(activeDomain)
            } else {
                setStatusMessage('Dry run complete — nothing was written.')
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to import patients')
            setStatusTone('error')
        } finally {
            setImportRunning(false)
        }
    }, [importText, importSource, importFile, activeDomain, getAdminAuthHeaders, refreshPatients])

    const loadSchema = useCallback(async () => {
        setSchemaLoading(true)
        try {
            const response = await fetchWithTimeout('/api/intake/schema', { cache: 'no-store' })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load intake schema')
            }

            setSchemaFields(normalizeFieldList(data?.fields))
            setSchemaFormUuid(String(data?.formUuid || '').trim())
        } catch {
            setSchemaFields(DEFAULT_SPLPOSE_FIELDS)
        } finally {
            setSchemaLoading(false)
        }
    }, [])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { patientsEnabled: false, appointmentsEnabled: false, formsEnabled: false, workerVisibility: DEFAULT_WORKER_VISIBILITY, displayName: '' }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                patientsEnabled: domainSettings?.patientsEnabled === true,
                appointmentsEnabled: domainSettings?.patientsEnabled === true
                    && domainSettings?.appointmentsCardEnabled !== false,
                formsEnabled: isDocsBackedPageEnabled(domainSettings, 'formsCardEnabled'),
                workerVisibility: readWorkerVisibility(domainSettings),
                displayName: String(domainSettings?.displayName || '').trim(),
                sourcingReplyToEmail: String(domainSettings?.sourcingReplyToEmail || '').trim(),
                sourcingReplyToName: String(domainSettings?.sourcingReplyToName || '').trim(),
                sourcingBccReplyToDefault: domainSettings?.sourcingBccReplyToDefault === true,
                sourcingEmailSignature: String(domainSettings?.sourcingEmailSignature || '').trim(),
                sourcingLogoUrl: resolveDomainLogoUrl({
                    domainKey: String(domainSettings?.domainKey || domain || '').trim().toLowerCase(),
                    publicBaseUrl: domainSettings?.publicBaseUrl,
                    primaryHostname: domainSettings?.primaryHostname,
                    fallbackOrigin: typeof window !== 'undefined' ? window.location.origin : '',
                }),
            }
        } catch {
            return {
                patientsEnabled: false,
                appointmentsEnabled: false,
                formsEnabled: false,
                workerVisibility: DEFAULT_WORKER_VISIBILITY,
                displayName: '',
                sourcingReplyToEmail: '',
                sourcingReplyToName: '',
                sourcingBccReplyToDefault: false,
                sourcingEmailSignature: '',
                sourcingLogoUrl: '',
            }
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (cancelled) return

                if (!token) {
                    router.push('/login')
                    return
                }

                const user = getCurrentUser()
                if (!user) {
                    router.push('/login')
                    return
                }

                const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
                const storedDomain = readStoredDefaultDomain()
                const { mode } = getEffectiveDomainMode(hostname, storedDomain)
                const userDomain = String(user?.domain || '').trim().toLowerCase()
                const effectiveDomain = userDomain || mode

                const featureState = await loadDomainFeatureState(token, effectiveDomain)
                if (cancelled) return

                setActiveDomain(effectiveDomain)
                setDomainDisplayName(featureState.displayName)
                setDomainSourcingReplyTo(featureState.sourcingReplyToEmail || '')
                setDomainSourcingReplyToName(featureState.sourcingReplyToName || '')
                setDomainSourcingBccReplyToDefault(featureState.sourcingBccReplyToDefault === true)
                setDomainSourcingEmailSignature(featureState.sourcingEmailSignature || '')
                setDomainSourcingLogoUrl(featureState.sourcingLogoUrl || '')
                setPatientsEnabled(featureState.patientsEnabled)
                setAppointmentsEnabled(featureState.appointmentsEnabled)
                setFormsEnabled(featureState.formsEnabled === true)
                setWorkerVisibility(featureState.workerVisibility)
                setIsAuthenticated(true)

                await Promise.all([loadSchema(), refreshPatients(effectiveDomain)])
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize patients view')
                setStatusTone('error')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        bootstrap()
        return () => { cancelled = true }
    }, [router, loadDomainFeatureState, loadSchema, refreshPatients])

    useEffect(() => {
        if (!isAuthenticated || !patientsEnabled) return
        if (searchParams.get('create') !== '1') return
        if (showModal) return

        const nextDraft = toPatientDraft({ domain: activeDomain }, schemaFields)
        queueMicrotask(() => {
            setModalMode('create')
            setDraft(nextDraft)
            setInitialDraftSnapshot(createDraftSnapshot(nextDraft))
            setModalError('')
            setShowModal(true)
            clearCreateQueryParam()
        })
    }, [isAuthenticated, patientsEnabled, searchParams, showModal, activeDomain, schemaFields, clearCreateQueryParam])

    const refreshBillingForPatient = useCallback(async (patientId, domain) => {
        const billingAccountId = String(patientId || '').trim()
        if (!billingAccountId || !domain) {
            setBillingRecords([])
            return
        }

        setBillingLoading(true)
        setBillingError('')
        try {
            const query = new URLSearchParams({
                domain,
                account_id: billingAccountId,
                limit: '200',
            })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/billing?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load billing records')
            }

            setBillingRecords(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setBillingRecords([])
            setBillingError(error?.message || 'Failed to load billing records')
        } finally {
            setBillingLoading(false)
        }
    }, [getAdminAuthHeaders])

    const refreshReportJobStatus = useCallback(async (patientId, domain, options = {}) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setReportJobStatus(null)
            return null
        }

        const forceRefresh = options?.force === true
        const cachedStatus = getCachedReportJobStatus(numericPatientId, domain)
        const cachedLabel = String(cachedStatus?.statusLabel || '').trim().toLowerCase()
        const cachedReady = cachedLabel === 'ready' || String(cachedStatus?.status || '').trim().toLowerCase() === 'completed'
        if (!forceRefresh && cachedStatus && cachedReady) {
            setReportJobStatus(cachedStatus)
            return cachedStatus
        }

        setReportJobLoading(true)
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/report-job-status?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load report job status')
            }

            const status = String(data?.status || 'none').trim().toLowerCase()
            const latestEventType = String(data?.latest?.eventType || data?.latest?.event_type || '').trim().toLowerCase()
            let statusLabel = String(data?.statusLabel || 'Creating').trim() || 'Creating'

            // Pre-save edits use the unsaved override "Update Pending".
            // After save, config-change jobs should read as actively updating.
            if (latestEventType === 'reporting_config_changed' && (status === 'queued' || status === 'processing')) {
                statusLabel = 'Updating'
            }

            const nextStatus = {
                status,
                statusLabel,
                latest: data?.latest || null,
                counts: data?.counts || {},
                source: String(data?.source || '').trim(),
                upstreamUnavailable: data?.upstreamUnavailable === true,
                // The finished report nobody has opened, which is what the review
                // queue lists for this patient (see `workerProvenance.js`).
                unreviewedReportJob: data?.unreviewedReportJob || null,
            }
            setReportJobStatus((prev) => {
                const methodInfo = resolveReportEnqueueMethodInfo(null, data)
                const next = {
                    ...nextStatus,
                    enqueueMethod: methodInfo.enqueueMethod || prev?.enqueueMethod || null,
                    enqueueMethodLabel: methodInfo.enqueueMethodLabel || prev?.enqueueMethodLabel || '',
                }
                setCachedReportJobStatus(numericPatientId, domain, next)
                return next
            })
            return nextStatus
        } catch {
            setReportJobStatus(null)
            clearCachedReportJobStatus(numericPatientId, domain)
            return null
        } finally {
            setReportJobLoading(false)
        }
    }, [getCachedReportJobStatus, setCachedReportJobStatus, clearCachedReportJobStatus])

    /**
     * Opening a report is the review: it is the one thing that tells the queue a
     * person has taken the worker's report on (see `workerProvenance.js`). The entry
     * is cleared from local state straight away rather than re-read, because a review
     * cannot change the job's status — a refetch would only say "Ready" again.
     */
    const markReportReviewed = useCallback(async () => {
        const patientId = String(draft?.id || '').trim()
        const job = reportJobStatus?.unreviewedReportJob
        if (!patientId || !job?.id || !activeDomain) return

        setReportJobStatus((prev) => {
            if (!prev) return prev
            const next = { ...prev, unreviewedReportJob: null }
            setCachedReportJobStatus(patientId, activeDomain, next)
            return next
        })

        try {
            const headers = await getAdminAuthHeaders()
            await fetchWithTimeout('/api/database/patients/report-job-status', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: activeDomain, patient_id: patientId, job_id: job.id }),
            })
        } catch {
            // A write that did not land leaves the entry off the queue for this visit
            // only; the next load reads the record again and puts it back.
        }
    }, [draft?.id, reportJobStatus?.unreviewedReportJob, activeDomain, getAdminAuthHeaders, setCachedReportJobStatus])

    const refreshFormalReport = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setFormalReport(null)
            return null
        }

        setFormalReportLoading(true)
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/formal-report?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load formal report')
            }

            const report = data?.report && typeof data.report === 'object' ? data.report : null
            setFormalReport(report)
            return report
        } catch {
            setFormalReport(null)
            return null
        } finally {
            setFormalReportLoading(false)
        }
    }, [])

    const refreshReportDrafts = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setReportDrafts([])
            setReportDraftsError('')
            return []
        }

        setReportDraftsLoading(true)
        setReportDraftsError('')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
                limit: '100',
                days: 'all',
            })
            const response = await fetchWithTimeout(`/api/database/reports?${query.toString()}`, {
                cache: 'no-store',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load report drafts')
            }

            const rows = Array.isArray(data?.data) ? data.data : []
            setReportDrafts(rows)
            return rows
        } catch (error) {
            setReportDrafts([])
            setReportDraftsError(error?.message || 'Failed to load report drafts')
            return []
        } finally {
            setReportDraftsLoading(false)
        }
    }, [getAdminAuthHeaders])

    const fetchReportDraftsForPatient = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            return []
        }

        const headers = await getAdminAuthHeaders()
        const query = new URLSearchParams({
            domain,
            patient_id: numericPatientId,
            limit: '100',
            days: 'all',
        })
        const response = await fetchWithTimeout(`/api/database/reports?${query.toString()}`, {
            cache: 'no-store',
            headers,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load report drafts')
        }

        return Array.isArray(data?.data) ? data.data : []
    }, [getAdminAuthHeaders])

    const saveFormalReport = useCallback(async ({ patientId, domain, patientName, reportMarkdown }) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            throw new Error('Missing patient context for report save')
        }

        setFormalReportSaving(true)
        try {
            const response = await fetchWithTimeout('/api/database/patients/formal-report', {
                method: 'PATCH',
                headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    report_markdown: String(reportMarkdown || '')
                })
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save formal report')
            }

            const report = data?.report && typeof data.report === 'object' ? data.report : null
            setFormalReport(report)
            setStatusMessage('Formal report draft saved.')
            setStatusTone('success')
            await refreshReportJobStatus(patientId, domain)
            await refreshReportDrafts(patientId, domain)
        } finally {
            setFormalReportSaving(false)
        }
    }, [refreshReportJobStatus, refreshReportDrafts])

    const parseDownloadFileName = useCallback((contentDisposition, fallbackName) => {
        const raw = String(contentDisposition || '').trim()
        if (!raw) return fallbackName

        const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
        if (utf8Match?.[1]) {
            try {
                return decodeURIComponent(utf8Match[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
            } catch {
                return fallbackName
            }
        }

        const plainMatch = raw.match(/filename="?([^";]+)"?/i)
        if (plainMatch?.[1]) {
            return String(plainMatch[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
        }

        return fallbackName
    }, [])

    const downloadFormalReportForWord = useCallback(async ({ patientId, domain, patientName, reportMarkdown }) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            throw new Error('Missing patient context for report download')
        }

        setFormalReportDownloadingWord(true)
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/patients/formal-report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({
                    format: 'word-docx',
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    report_markdown: String(reportMarkdown || ''),
                }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                if (response.status === 401 && data?.needsAuth && data?.oauthStartUrl) {
                    if (typeof window !== 'undefined') {
                        window.location.assign(String(data.oauthStartUrl))
                    }
                    return
                }

                throw new Error(data?.error || 'Failed to prepare Microsoft Word download')
            }

            const blob = await response.blob()
            const fallbackName = `${String(patientName || '').trim() || `patient-${numericPatientId}`}-formal-report.docx`
            const fileName = parseDownloadFileName(response.headers.get('content-disposition'), fallbackName)

            if (typeof window !== 'undefined') {
                const objectUrl = window.URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = objectUrl
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                link.remove()
                window.URL.revokeObjectURL(objectUrl)
            }

            setStatusMessage('Microsoft Word download started.')
            setStatusTone('success')
        } finally {
            setFormalReportDownloadingWord(false)
        }
    }, [getAdminAuthHeaders, parseDownloadFileName])

    const exportFormalReportUsingTemplate = useCallback(async ({ patientId, domain, patientName, reportMarkdown }) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            throw new Error('Missing patient context for template export')
        }

        setFormalReportExportingTemplate(true)
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/patients/formal-report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({
                    format: 'template-docx',
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    report_markdown: String(reportMarkdown || ''),
                }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to export report using template')
            }

            const blob = await response.blob()
            const fallbackName = `${String(patientName || '').trim() || `patient-${numericPatientId}`}-template-report.docx`
            const fileName = parseDownloadFileName(response.headers.get('content-disposition'), fallbackName)

            if (typeof window !== 'undefined') {
                const objectUrl = window.URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = objectUrl
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                link.remove()
                window.URL.revokeObjectURL(objectUrl)
            }

            setStatusMessage('Template-based DOCX download started.')
            setStatusTone('success')
        } finally {
            setFormalReportExportingTemplate(false)
        }
    }, [getAdminAuthHeaders, parseDownloadFileName])

    const refreshBillingJobStatus = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setBillingJobStatus(null)
            return
        }

        setBillingJobLoading(true)
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/patients/billing-job-status?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load billing job status')
            }

            const status = String(data?.status || 'none').trim().toLowerCase()
            const statusLabel = String(data?.statusLabel || 'Waiting').trim() || 'Waiting'
            setBillingJobStatus({
                status,
                statusLabel,
                latest: data?.latest || null,
                counts: data?.counts || {},
                source: String(data?.source || '').trim(),
                upstreamUnavailable: data?.upstreamUnavailable === true,
            })
        } catch {
            setBillingJobStatus(null)
        } finally {
            setBillingJobLoading(false)
        }
    }, [getAdminAuthHeaders])

    const refreshAnalysisJobStatus = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setAnalysisJobStatus(null)
            return null
        }

        setAnalysisJobLoading(true)
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/analysis-job-status?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load analysis job status')
            }

            const status = String(data?.status || 'none').trim().toLowerCase()
            const statusLabel = String(data?.statusLabel || 'Waiting').trim() || 'Waiting'
            const nextStatus = {
                status,
                statusLabel,
                latest: data?.latest || null,
                counts: data?.counts || {},
                source: String(data?.source || '').trim(),
                upstreamUnavailable: data?.upstreamUnavailable === true,
            }
            setAnalysisJobStatus(nextStatus)
            return nextStatus
        } catch {
            setAnalysisJobStatus(null)
            return null
        } finally {
            setAnalysisJobLoading(false)
        }
    }, [])

    const refreshEquipmentSourcing = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setEquipmentSourcing(null)
            setEquipmentSourcingError('')
            return null
        }

        setEquipmentSourcingLoading(true)
        setEquipmentSourcingError('')
        try {
            const query = new URLSearchParams({ domain, patient_id: numericPatientId })
            const response = await fetchWithTimeout(`/api/database/patients/equipment-suggestions?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load equipment suggestions')

            const next = {
                status: String(data?.status || 'none').trim().toLowerCase(),
                statusLabel: String(data?.statusLabel || 'Waiting').trim() || 'Waiting',
                latest: data?.latest && typeof data.latest === 'object' ? data.latest : null,
                result: data?.result && typeof data.result === 'object' ? data.result : null,
            }
            setEquipmentSourcing(next)
            return next
        } catch (error) {
            setEquipmentSourcing(null)
            setEquipmentSourcingError(error?.message || 'Failed to load equipment suggestions')
            return null
        } finally {
            setEquipmentSourcingLoading(false)
        }
    }, [])

    const refreshScribeJobStatus = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setScribeJobStatus(null)
            return null
        }

        setScribeJobLoading(true)
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/scribe-job-status?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load scribe job status')
            }

            const status = String(data?.status || 'none').trim().toLowerCase()
            const statusLabel = String(data?.statusLabel || 'Waiting').trim() || 'Waiting'
            const nextStatus = {
                status,
                statusLabel,
                latest: data?.latest || null,
                counts: data?.counts || {},
                source: String(data?.source || '').trim(),
                upstreamUnavailable: data?.upstreamUnavailable === true,
                summaryExists: data?.summaryExists === true,
                transcriptionId: data?.transcriptionId || null,
                summaryUpdatedAt: data?.summaryUpdatedAt || null,
            }
            setScribeJobStatus(nextStatus)
            return nextStatus
        } catch {
            setScribeJobStatus(null)
            return null
        } finally {
            setScribeJobLoading(false)
        }
    }, [])

    const refreshScribeSummary = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setScribeSummary(null)
            setScribeSummaryError('')
            return null
        }

        setScribeSummaryLoading(true)
        setScribeSummaryError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/scribe-summary?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load transcript summary')
            }

            const summaries = Array.isArray(data?.summaries) ? data.summaries.filter((item) => item && typeof item === 'object') : []
            const summary = data?.summary && typeof data.summary === 'object' ? data.summary : summaries[0] || null
            setScribeSummaries(summaries)
            setScribeSummary(summary)
            return summary
        } catch (error) {
            setScribeSummary(null)
            setScribeSummaries([])
            setScribeSummaryError(error?.message || 'Failed to load transcript summary')
            return null
        } finally {
            setScribeSummaryLoading(false)
        }
    }, [])

    const refreshPatientAnalysis = useCallback(async (patientId, domain) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setPatientAnalysis(null)
            setPatientAnalysisError('')
            return null
        }

        setPatientAnalysisLoading(true)
        setPatientAnalysisError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/analysis?${query.toString()}`, {
                cache: 'no-store',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load patient analysis')
            }

            const analysis = data?.analysis && typeof data.analysis === 'object' ? data.analysis : null
            setPatientAnalysis(analysis)
            return analysis
        } catch (error) {
            setPatientAnalysis(null)
            setPatientAnalysisError(error?.message || 'Failed to load patient analysis')
            return null
        } finally {
            setPatientAnalysisLoading(false)
        }
    }, [])

    const handleDeleteAnalysis = useCallback(async () => {
        const patientId = String(draft?.id || '').trim()
        if (!patientId || !activeDomain || !patientAnalysis) return

        const confirmed = window.confirm('Delete this analysis? This will remove the generated analysis for this patient.')
        if (!confirmed) return

        setAnalysisDeleting(true)
        setPatientAnalysisError('')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({
                domain: activeDomain,
                patient_id: patientId,
            })
            const response = await fetchWithTimeout(`/api/database/patients/analysis?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete analysis')
            }

            setPatientAnalysis(null)
            setAnalysisJobStatus(null)
            setStatusMessage('Analysis deleted.')
            setStatusTone('success')
            await refreshAnalysisJobStatus(patientId, activeDomain)
        } catch (error) {
            setPatientAnalysisError(error?.message || 'Failed to delete analysis')
        } finally {
            setAnalysisDeleting(false)
        }
    }, [activeDomain, draft?.id, getAdminAuthHeaders, patientAnalysis, refreshAnalysisJobStatus])

    // Regenerate the analysis in place. This exists so a clinician no longer has to delete the
    // analysis (and wait for the backfill to notice the gap) just to pick up new notes, a changed
    // worker prompt, or a different AI model.
    const handleRerunAnalysis = useCallback(async () => {
        const patientId = String(draft?.id || '').trim()
        if (!patientId || !activeDomain) return

        setAnalysisRerunning(true)
        setPatientAnalysisError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/patients/analysis', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: activeDomain, patient_id: patientId }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to queue analysis')
            }

            setStatusMessage('Analysis queued. The FCA Analyst will run it on the domain\u2019s configured model.')
            setStatusTone('success')
            await refreshAnalysisJobStatus(patientId, activeDomain)
        } catch (error) {
            setPatientAnalysisError(error?.message || 'Failed to queue analysis')
        } finally {
            setAnalysisRerunning(false)
        }
    }, [activeDomain, draft?.id, getAdminAuthHeaders, refreshAnalysisJobStatus])

    const handleDeleteSummary = useCallback(async (summaryStyle) => {
        const patientId = String(draft?.id || '').trim()
        const normalizedSummaryStyle = String(summaryStyle || '').trim()
        const summaryToDelete = (Array.isArray(scribeSummaries) ? scribeSummaries : [])
            .find((item) => String(item?.summaryStyle || '').trim() === normalizedSummaryStyle)
            || (!normalizedSummaryStyle ? scribeSummary : null)
        if (!patientId || !activeDomain || !summaryToDelete) return

        const summaryLabel = describeSummaryStyleLabel(summaryToDelete?.summaryStyle)

        const confirmed = window.confirm(`Delete the ${summaryLabel} summary? This will remove only this summary version for this patient.`)
        if (!confirmed) return

        setScribeSummaryDeleting(true)
        setScribeSummaryError('')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({
                domain: activeDomain,
                patient_id: patientId,
                summary_style: String(summaryToDelete?.summaryStyle || '').trim(),
            })
            const response = await fetchWithTimeout(`/api/database/patients/scribe-summary?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete summary')
            }

            setScribeSummaries((previous) => previous.filter((item) => String(item?.summaryStyle || '').trim() !== String(summaryToDelete?.summaryStyle || '').trim()))
            if (scribeSummary === summaryToDelete || String(scribeSummary?.summaryStyle || '').trim() === String(summaryToDelete?.summaryStyle || '').trim()) {
                setScribeSummary(null)
            }
            setStatusMessage(`${summaryLabel} summary deleted.`)
            setStatusTone('success')
            await refreshScribeSummary(patientId, activeDomain)
            await refreshScribeJobStatus(patientId, activeDomain)
        } catch (error) {
            setScribeSummaryError(error?.message || 'Failed to delete summary')
        } finally {
            setScribeSummaryDeleting(false)
        }
    }, [activeDomain, draft?.id, getAdminAuthHeaders, refreshScribeJobStatus, refreshScribeSummary, scribeSummaries, scribeSummary])

    const refreshTranscriptionsForPatient = useCallback(async (patientId, domain, options = {}) => {
        const numericPatientId = String(patientId || '').trim()
        if (!numericPatientId || !domain) {
            setTranscriptionRecords([])
            return
        }

        setTranscriptionLoading(true)
        setTranscriptionError('')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({
                domain,
                patient_id: numericPatientId,
                limit: '200',
            })
            const focusedPendingDeleteId = String(options?.includePendingDeleteId || '').trim()
            if (focusedPendingDeleteId) {
                query.set('include_pending_delete_id', focusedPendingDeleteId)
            }
            const response = await fetchWithTimeout(`/api/database/patient-transcriptions?${query.toString()}`, {
                cache: 'no-store',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load transcripts')
            }

            setTranscriptionRecords(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setTranscriptionRecords([])
            setTranscriptionError(error?.message || 'Failed to load transcripts')
        } finally {
            setTranscriptionLoading(false)
        }
    }, [getAdminAuthHeaders])

    const refreshPatientFiles = useCallback(async (patientId, domain) => {
        const normalizedPatientId = String(patientId || '').trim()
        if (!normalizedPatientId || !domain) {
            setPatientFiles([])
            return
        }

        setPatientFilesLoading(true)
        setPatientFilesError('')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain, patient_id: normalizedPatientId })
            const response = await fetchWithTimeout(`/api/database/patient-files?${query.toString()}`, { cache: 'no-store', headers })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load uploaded files')
            setPatientFiles(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setPatientFiles([])
            setPatientFilesError(error?.message || 'Failed to load uploaded files')
        } finally {
            setPatientFilesLoading(false)
        }
    }, [getAdminAuthHeaders])

    const uploadPatientFile = useCallback(async (file) => {
        const patientId = String(draft?.id || '').trim()
        if (!patientId) return

        setPatientFileUploading(true)
        setPatientFilesError('')
        try {
            const headers = await getAdminAuthHeaders()
            const formData = new FormData()
            formData.set('domain', activeDomain)
            formData.set('patient_id', patientId)
            formData.set('file', file)
            const response = await fetchWithTimeout('/api/database/patient-files', { method: 'POST', headers, body: formData })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to upload file')
            setStatusMessage('File uploaded.')
            setStatusTone('success')
            await refreshPatientFiles(patientId, activeDomain)
        } catch (error) {
            setPatientFilesError(error?.message || 'Failed to upload file')
        } finally {
            setPatientFileUploading(false)
        }
    }, [activeDomain, draft, getAdminAuthHeaders, refreshPatientFiles])

    // Moving a document in or out of the analyst's evidence scope changes what the analyst reads,
    // so the API re-runs the analysis as part of the same request. The flag is written first, so a
    // queueing failure is reported as a notice rather than as a failed toggle.
    const toggleAnalysisEvidenceFile = useCallback(async (file, nextValue) => {
        const fileId = String(file?.id || '').trim()
        const patientId = String(draft?.id || '').trim()
        if (!fileId) return

        setAnalysisEvidenceFileId(fileId)
        setAnalysisEvidenceError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/patient-files/${encodeURIComponent(fileId)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: activeDomain, analysis_evidence: nextValue }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to update analyst scope')

            await refreshPatientFiles(patientId, activeDomain)

            if (data?.queueError) {
                setAnalysisEvidenceError(`Scope saved, but the analyst re-run could not be queued: ${data.queueError}`)
                return
            }
            setStatusMessage(
                data?.analysisQueued
                    ? 'Analyst scope updated. The analysis will re-run with the current documents.'
                    : 'Analyst scope updated.'
            )
            setStatusTone('success')
        } catch (error) {
            setAnalysisEvidenceError(error?.message || 'Failed to update analyst scope')
        } finally {
            setAnalysisEvidenceFileId('')
        }
    }, [activeDomain, draft?.id, getAdminAuthHeaders, refreshPatientFiles])

    const fetchPatientFileBlob = useCallback(async (file) => {
        const fileId = String(file?.id || '').trim()
        if (!fileId) throw new Error('Missing file id')
        setPatientFilesError('')
        const headers = await getAdminAuthHeaders()
        const response = await fetchWithTimeout(`/api/database/patient-files/${encodeURIComponent(fileId)}?domain=${encodeURIComponent(activeDomain)}`, { headers })
        if (!response.ok) {
            const data = await response.json().catch(() => ({}))
            throw new Error(data?.error || 'Failed to load file')
        }
        return response.blob()
    }, [activeDomain, getAdminAuthHeaders])

    const downloadPatientFile = useCallback(async (file) => {
        try {
            const blob = await fetchPatientFileBlob(file)
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = String(file?.file_name || 'download')
            anchor.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            setPatientFilesError(error?.message || 'Failed to download file')
        }
    }, [fetchPatientFileBlob])

    const deletePatientFile = useCallback(async (file) => {
        const fileId = String(file?.id || '').trim()
        if (!fileId || !window.confirm(`Delete ${file?.file_name || 'this file'}?`)) return
        setPatientFileDeletingId(fileId)
        setPatientFilesError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/patient-files/${encodeURIComponent(fileId)}?domain=${encodeURIComponent(activeDomain)}`, { method: 'DELETE', headers })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to delete file')
            setStatusMessage('File deleted.')
            setStatusTone('success')
            await refreshPatientFiles(draft?.id, activeDomain)
        } catch (error) {
            setPatientFilesError(error?.message || 'Failed to delete file')
        } finally {
            setPatientFileDeletingId(null)
        }
    }, [activeDomain, draft, getAdminAuthHeaders, refreshPatientFiles])

    const finalizeTranscriptionStatus = useCallback(async (transcriptionId, domain) => {
        const normalizedId = String(transcriptionId || '').trim()
        if (!normalizedId || !domain) return

        const headers = await getAdminAuthHeaders()
        const response = await fetch(
            `/api/database/patient-transcriptions/${encodeURIComponent(normalizedId)}?domain=${encodeURIComponent(domain)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({ status: 'completed' }),
            }
        )

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to finalize transcription status')
        }
    }, [getAdminAuthHeaders])

    const startTranscriptionRecording = useCallback(async () => {
        const patientId = String(draft?.id || '').trim()
        if (!patientId) {
            setTranscriptionError('Save this patient before recording.')
            return
        }
        if (!recorderSupported) {
            setTranscriptionError('MediaRecorder is not supported in this browser.')
            return
        }
        if (typeof window === 'undefined' || !window.isSecureContext) {
            setTranscriptionError('Microphone capture requires a secure origin (https:// or localhost).')
            return
        }
        if (typeof window.navigator?.mediaDevices?.getUserMedia !== 'function') {
            setTranscriptionError('Unable to access microphone APIs. In Safari, ensure microphone permissions are enabled and use https:// or localhost.')
            return
        }
        if (recorderActive || recorderBusy) return

        setRecorderBusy(true)
        setTranscriptionError('')
        setLiveTranscript('')
        activeTranscriptionIdRef.current = null
        chunkIndexRef.current = 0
        stopRequestedRef.current = false
        recordedChunksRef.current = []
        useLiveChunkingRef.current = true
        usePcmFallbackRef.current = false
        pcmChunksRef.current = []
        if (recorderFlushIntervalRef.current) {
            clearInterval(recorderFlushIntervalRef.current)
            recorderFlushIntervalRef.current = null
        }

        try {
            const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true })
            mediaStreamRef.current = stream

            const audioTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : []
            if (!audioTracks.length) {
                throw new Error('No microphone input track available')
            }
            setRecorderPermission('granted')

            const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
            let selectedMimeType = ''
            for (const type of preferredMimeTypes) {
                if (typeof window.MediaRecorder.isTypeSupported === 'function' && window.MediaRecorder.isTypeSupported(type)) {
                    selectedMimeType = type
                    break
                }
            }

            const uploadAudioBlob = async ({ blob, chunkIndex, isFinalChunk, transcriptMode }) => {
                const normalizedBlob = await maybeConvertAudioBlobToWav(blob)
                const chunkMimeType = String(normalizedBlob?.type || blob?.type || selectedMimeType || 'audio/wav').trim() || 'audio/wav'
                const extension = getAudioExtensionFromMimeType(chunkMimeType)
                const file = new File([normalizedBlob], `recording-${chunkIndex}.${extension}`, { type: chunkMimeType })

                const headers = await getAdminAuthHeaders()
                const form = new FormData()
                form.append('domain', activeDomain)
                form.append('patient_id', patientId)
                form.append('chunk_index', String(chunkIndex))
                form.append('is_final', isFinalChunk ? '1' : '0')
                form.append('source', 'browser-live')
                if (transcriptMode) {
                    form.append('transcript_mode', transcriptMode)
                }
                if (activeTranscriptionIdRef.current) {
                    form.append('transcription_id', String(activeTranscriptionIdRef.current))
                }
                form.append('chunk', file)

                const response = await fetch('/api/transcription/chunk', {
                    method: 'POST',
                    headers,
                    body: form,
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to transcribe recording')
                }

                const transcriptionId = String(data?.transcription_id || '').trim()
                if (transcriptionId) {
                    activeTranscriptionIdRef.current = transcriptionId
                }

                const chunkError = String(data?.chunk_error || '').trim()
                const nextText = String(data?.transcript_text || '').trim()
                if (nextText) {
                    setLiveTranscript(nextText)
                    if (chunkError) {
                        setTranscriptionError('')
                    }
                } else if (chunkError) {
                    setTranscriptionError(chunkError)
                }
            }

            // Always prefer the PCM/WAV path for live chunking. Uploading intermediate
            // WebM/Opus fragments produced by MediaRecorder.requestData() (or start(timeslice))
            // fails on OpenAI's transcription endpoint because only the first blob contains
            // the EBML/Segment/Tracks header — every subsequent chunk is a headerless Cluster
            // fragment that upstream reports as "Audio file might be corrupted or unsupported".
            // Capturing raw PCM via AudioContext and encoding each window as a self-contained
            // WAV blob avoids that entire class of container-corruption errors.
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext
            const canUsePcmChunking = Boolean(AudioContextCtor)

            if (canUsePcmChunking) {
                usePcmFallbackRef.current = true
                useLiveChunkingRef.current = false
                setRecorderHint('')

                const audioContext = new AudioContextCtor()
                pcmContextRef.current = audioContext
                pcmSampleRateRef.current = audioContext.sampleRate || 44100
                pcmChunksRef.current = []

                const source = audioContext.createMediaStreamSource(stream)
                pcmSourceRef.current = source

                const processor = audioContext.createScriptProcessor(4096, 1, 1)
                pcmProcessorRef.current = processor

                const silenceGain = audioContext.createGain()
                silenceGain.gain.value = 0
                pcmSilenceGainRef.current = silenceGain

                processor.onaudioprocess = (event) => {
                    const channel = event?.inputBuffer?.getChannelData?.(0)
                    if (!channel || channel.length === 0) return
                    pcmChunksRef.current.push(new Float32Array(channel))
                }

                source.connect(processor)
                processor.connect(silenceGain)
                silenceGain.connect(audioContext.destination)

                setRecorderActive(true)

                recorderFlushIntervalRef.current = setInterval(() => {
                    if (stopRequestedRef.current) return

                    // Drain the buffer synchronously so each interval captures exactly the
                    // samples that accumulated since the previous flush, independent of any
                    // in-flight upload backpressure. Each delta is uploaded with
                    // transcript_mode: 'append' so partial transcripts are persisted server-side
                    // even if the session ends abruptly.
                    const pending = pcmChunksRef.current
                    if (!Array.isArray(pending) || pending.length === 0) return
                    pcmChunksRef.current = []

                    const merged = mergeFloat32Chunks(pending)
                    if (merged.length === 0) return

                    chunkIndexRef.current += 1
                    const chunkIndex = chunkIndexRef.current
                    const wavBlob = encodeWavFromFloat32(merged, pcmSampleRateRef.current)

                    uploadQueueRef.current = uploadQueueRef.current
                        .then(async () => {
                            await uploadAudioBlob({
                                blob: wavBlob,
                                chunkIndex,
                                isFinalChunk: false,
                                transcriptMode: 'append',
                            })
                        })
                        .catch((error) => {
                            setTranscriptionError(error?.message || 'Failed to transcribe recording')
                        })
                }, 7000)

                return
            }

            usePcmFallbackRef.current = false

            const recorder = selectedMimeType
                ? new window.MediaRecorder(stream, { mimeType: selectedMimeType })
                : new window.MediaRecorder(stream)
            mediaRecorderRef.current = recorder
            const recorderMimeType = String(recorder.mimeType || selectedMimeType || '').toLowerCase()
            const canLiveChunk = recorderMimeType.includes('webm') || recorderMimeType.includes('ogg')
            useLiveChunkingRef.current = canLiveChunk

            if (!canLiveChunk) {
                setRecorderHint('Live preview is limited for this browser audio format. Transcript should appear after you stop recording.')
            }

            recorder.ondataavailable = (event) => {
                if (!event?.data || event.data.size <= 0) return
                recordedChunksRef.current.push(event.data)

                if (!useLiveChunkingRef.current) {
                    return
                }

                chunkIndexRef.current += 1
                const chunkIndex = chunkIndexRef.current
                const isFinalChunk = stopRequestedRef.current
                if (isFinalChunk) {
                    stopRequestedRef.current = false
                }

                uploadQueueRef.current = uploadQueueRef.current
                    .then(async () => {
                        await uploadAudioBlob({
                            blob: event.data,
                            chunkIndex,
                            isFinalChunk,
                            transcriptMode: 'append',
                        })
                    })
                    .catch((error) => {
                        setTranscriptionError(error?.message || 'Failed to transcribe recording')
                    })
            }

            recorder.onstop = () => {
                if (recorderFlushIntervalRef.current) {
                    clearInterval(recorderFlushIntervalRef.current)
                    recorderFlushIntervalRef.current = null
                }

                if (mediaStreamRef.current) {
                    for (const track of mediaStreamRef.current.getTracks()) {
                        track.stop()
                    }
                    mediaStreamRef.current = null
                }

                mediaRecorderRef.current = null
                setRecorderActive(false)

                uploadQueueRef.current = uploadQueueRef.current
                    .then(async () => {
                        const chunks = Array.isArray(recordedChunksRef.current) ? recordedChunksRef.current : []
                        if (chunks.length > 0) {
                            chunkIndexRef.current += 1
                            const mergedBlob = new Blob(chunks, {
                                type: String(chunks[0]?.type || recorderMimeType || 'audio/webm').trim() || 'audio/webm',
                            })
                            await uploadAudioBlob({
                                blob: mergedBlob,
                                chunkIndex: chunkIndexRef.current,
                                isFinalChunk: true,
                                transcriptMode: 'replace',
                            })
                        }

                        await refreshTranscriptionsForPatient(patientId, activeDomain)
                    })
                    .catch((error) => {
                        setTranscriptionError(error?.message || 'Failed to finish recording')
                    })
                    .finally(() => {
                        recordedChunksRef.current = []
                        setRecorderBusy(false)
                    })
            }

            // Use a single-blob recording across browsers to avoid chunk container corruption
            // errors from upstream transcription providers.
            recorder.start()
            if (useLiveChunkingRef.current) {
                recorderFlushIntervalRef.current = setInterval(() => {
                    if (stopRequestedRef.current) return
                    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return
                    try {
                        mediaRecorderRef.current.requestData()
                    } catch {
                        // no-op
                    }
                }, 7000)
            }
            setRecorderActive(true)
        } catch (error) {
            const errorName = String(error?.name || '').trim()
            if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
                setRecorderPermission('denied')
                setRecorderHint('Microphone permission denied. Open browser site settings and allow microphone access for this site.')
            } else if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
                setRecorderHint('No usable microphone device was found. Connect a microphone and try again.')
            }
            setTranscriptionError(error?.message || 'Unable to start recording')
            if (mediaStreamRef.current) {
                for (const track of mediaStreamRef.current.getTracks()) {
                    track.stop()
                }
                mediaStreamRef.current = null
            }
            mediaRecorderRef.current = null
            setRecorderActive(false)
        } finally {
            setRecorderBusy(false)
        }
    }, [activeDomain, draft?.id, getAdminAuthHeaders, recorderActive, recorderBusy, recorderSupported, refreshTranscriptionsForPatient])

    const stopTranscriptionRecording = useCallback(() => {
        if (usePcmFallbackRef.current) {
            const patientId = String(draft?.id || '').trim()
            if (!patientId) {
                setTranscriptionError('Save this patient before recording.')
                return
            }

            setRecorderBusy(true)
            stopRequestedRef.current = true

            if (recorderFlushIntervalRef.current) {
                clearInterval(recorderFlushIntervalRef.current)
                recorderFlushIntervalRef.current = null
            }

            const cleanupPcmResources = async () => {
                const processor = pcmProcessorRef.current
                const source = pcmSourceRef.current
                const gain = pcmSilenceGainRef.current
                const context = pcmContextRef.current

                try { processor?.disconnect?.() } catch { }
                try { source?.disconnect?.() } catch { }
                try { gain?.disconnect?.() } catch { }
                try { await context?.close?.() } catch { }

                pcmProcessorRef.current = null
                pcmSourceRef.current = null
                pcmSilenceGainRef.current = null
                pcmContextRef.current = null
            }

            // Drain any remaining samples so the tail since the last interval flush is
            // appended, not resent as a full replacement. The drain runs inside the queued
            // promise so any samples pushed by the audio processor while a preceding
            // interval upload was in flight are captured in the final chunk.
            uploadQueueRef.current = uploadQueueRef.current
                .then(async () => {
                    const pendingTail = pcmChunksRef.current
                    pcmChunksRef.current = []
                    const merged = mergeFloat32Chunks(pendingTail)
                    if (merged.length > 0) {
                        chunkIndexRef.current += 1
                        const wavBlob = encodeWavFromFloat32(merged, pcmSampleRateRef.current)

                        const headers = await getAdminAuthHeaders()
                        const form = new FormData()
                        form.append('domain', activeDomain)
                        form.append('patient_id', patientId)
                        form.append('chunk_index', String(chunkIndexRef.current))
                        form.append('is_final', '1')
                        form.append('source', 'browser-live')
                        form.append('transcript_mode', 'append')
                        if (activeTranscriptionIdRef.current) {
                            form.append('transcription_id', String(activeTranscriptionIdRef.current))
                        }
                        const file = new File([wavBlob], `recording-${chunkIndexRef.current}.wav`, { type: 'audio/wav' })
                        form.append('chunk', file)

                        const response = await fetch('/api/transcription/chunk', {
                            method: 'POST',
                            headers,
                            body: form,
                        })
                        const data = await response.json().catch(() => ({}))
                        if (!response.ok) {
                            throw new Error(data?.error || 'Failed to transcribe recording')
                        }

                        const transcriptionId = String(data?.transcription_id || '').trim()
                        if (transcriptionId) {
                            activeTranscriptionIdRef.current = transcriptionId
                        }

                        const nextText = String(data?.transcript_text || '').trim()
                        const chunkError = String(data?.chunk_error || '').trim()
                        if (nextText) {
                            setLiveTranscript(nextText)
                        } else if (chunkError) {
                            setTranscriptionError(chunkError)
                        }
                    }

                    await refreshTranscriptionsForPatient(patientId, activeDomain)
                })
                .catch((error) => {
                    setTranscriptionError(error?.message || 'Failed to finish recording')
                })
                .finally(async () => {
                    await cleanupPcmResources()

                    if (mediaStreamRef.current) {
                        for (const track of mediaStreamRef.current.getTracks()) {
                            track.stop()
                        }
                        mediaStreamRef.current = null
                    }

                    pcmChunksRef.current = []
                    usePcmFallbackRef.current = false
                    setRecorderActive(false)
                    setRecorderBusy(false)
                })

            return
        }

        const recorder = mediaRecorderRef.current
        if (!recorder || recorder.state === 'inactive') return

        setRecorderBusy(true)
        stopRequestedRef.current = true
        if (recorderFlushIntervalRef.current) {
            clearInterval(recorderFlushIntervalRef.current)
            recorderFlushIntervalRef.current = null
        }
        if (useLiveChunkingRef.current) {
            try {
                recorder.requestData()
            } catch {
                // Ignore requestData errors for browsers that do not support an explicit flush call.
            }
        }
        recorder.stop()
    }, [activeDomain, getAdminAuthHeaders, refreshTranscriptionsForPatient, draft?.id])

    useEffect(() => {
        return () => {
            const recorder = mediaRecorderRef.current
            if (recorder && recorder.state !== 'inactive') {
                try {
                    recorder.stop()
                } catch {
                    // no-op
                }
            }

            if (recorderFlushIntervalRef.current) {
                clearInterval(recorderFlushIntervalRef.current)
                recorderFlushIntervalRef.current = null
            }

            try { pcmProcessorRef.current?.disconnect?.() } catch { }
            try { pcmSourceRef.current?.disconnect?.() } catch { }
            try { pcmSilenceGainRef.current?.disconnect?.() } catch { }
            try { pcmContextRef.current?.close?.() } catch { }
            pcmProcessorRef.current = null
            pcmSourceRef.current = null
            pcmSilenceGainRef.current = null
            pcmContextRef.current = null

            if (mediaStreamRef.current) {
                for (const track of mediaStreamRef.current.getTracks()) {
                    track.stop()
                }
            }
        }
    }, [])

    useEffect(() => {
        if (!isAuthenticated || !patientsEnabled) return
        const targetPatientId = String(searchParams.get('patientId') || '').trim()
        const targetTab = String(searchParams.get('tab') || '').trim().toLowerCase()
        const targetTranscriptionId = String(searchParams.get('transcriptionId') || '').trim()
        if (!targetPatientId) {
            handledQueryPatientIdRef.current = ''
            return
        }
        const handledQueryKey = `${targetPatientId}:${targetTranscriptionId}`
        if (handledQueryPatientIdRef.current === handledQueryKey) return
        if (showModal) return

        const targetPatient = patients.find((patient) => String(patient?.id || '') === targetPatientId)
        if (!targetPatient) return

        const nextDraft = toPatientDraft(targetPatient, schemaFields)
        queueMicrotask(() => {
            setModalMode('edit')
            setModalInitialTab(PATIENT_MODAL_TABS.has(targetTab) ? targetTab : 'overview')
            setDraft(nextDraft)
            setInitialDraftSnapshot(createDraftSnapshot(nextDraft))
            setModalError('')
            setBillingForm((prev) => ({
                ...prev,
                occurredAt: prev.occurredAt || toLocalDatetimeInput(new Date().toISOString()),
            }))
        })
        const cachedReportStatus = getCachedReportJobStatus(targetPatient?.id, activeDomain)
        queueMicrotask(() => setReportJobStatus(cachedReportStatus))
        queueMicrotask(() => {
            setShowModal(true)
            refreshBillingForPatient(targetPatient?.id, activeDomain)
            refreshReportJobStatus(targetPatient?.id, activeDomain)
            refreshFormalReport(targetPatient?.id, activeDomain)
            refreshReportDrafts(targetPatient?.id, activeDomain)
            refreshBillingJobStatus(targetPatient?.id, activeDomain)
            refreshAnalysisJobStatus(targetPatient?.id, activeDomain)
            refreshScribeJobStatus(targetPatient?.id, activeDomain)
            refreshScribeSummary(targetPatient?.id, activeDomain)
            refreshPatientAnalysis(targetPatient?.id, activeDomain)
            refreshTranscriptionsForPatient(targetPatient?.id, activeDomain, { includePendingDeleteId: targetTranscriptionId })
            refreshPatientFiles(targetPatient?.id, activeDomain)
        })
        handledQueryPatientIdRef.current = handledQueryKey
    }, [isAuthenticated, patientsEnabled, searchParams, showModal, patients, schemaFields, refreshBillingForPatient, refreshReportJobStatus, refreshFormalReport, refreshReportDrafts, refreshBillingJobStatus, refreshAnalysisJobStatus, refreshScribeJobStatus, refreshScribeSummary, refreshPatientAnalysis, refreshTranscriptionsForPatient, refreshPatientFiles, activeDomain, getCachedReportJobStatus])

    useEffect(() => {
        if (!showModal || modalMode !== 'edit') return
        if (!draft?.id) return

        const reportingEnabled = normalizePatientAgents(draft?.agents).reporting === true
            || normalizePatientAgents(draft?.agents).hsrCreator === true
        if (!reportingEnabled) {
            queueMicrotask(() => setReportJobStatus(null))
            return
        }

        const patientId = draft.id
        const domain = activeDomain
        const cachedStatus = getCachedReportJobStatus(patientId, domain)
        if (cachedStatus) {
            queueMicrotask(() => setReportJobStatus(cachedStatus))
        }

        const cachedLabel = String(cachedStatus?.statusLabel || '').trim().toLowerCase()
        const cachedReady = cachedLabel === 'ready' || String(cachedStatus?.status || '').trim().toLowerCase() === 'completed'
        if (cachedReady) {
            return
        }

        let cancelled = false

        const run = async () => {
            if (cancelled) return
            await Promise.all([
                refreshReportJobStatus(patientId, domain),
                refreshFormalReport(patientId, domain),
                refreshReportDrafts(patientId, domain)
            ])
        }

        run().catch(() => { })
        const timer = setInterval(() => {
            run().catch(() => { })
        }, 60000)

        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [showModal, modalMode, draft?.id, draft?.agents, activeDomain, getCachedReportJobStatus, refreshReportJobStatus, refreshFormalReport, refreshReportDrafts])

    useEffect(() => {
        if (!showModal || modalMode !== 'edit') return
        if (!draft?.id) return

        const billingEnabled = normalizePatientAgents(draft?.agents).billing === true
        if (!billingEnabled) {
            return
        }

        let cancelled = false
        const patientId = draft.id
        const domain = activeDomain

        const run = async () => {
            if (cancelled) return
            await refreshBillingJobStatus(patientId, domain)
        }

        run().catch(() => { })
        const timer = setInterval(() => {
            run().catch(() => { })
        }, 60000)

        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [showModal, modalMode, draft?.id, draft?.agents, activeDomain, refreshBillingJobStatus])

    useEffect(() => {
        if (!showModal || modalMode !== 'edit') return
        if (!draft?.id) return

        const analysisEnabled = normalizePatientAgents(draft?.agents).analyst === true
        if (!analysisEnabled) {
            return
        }

        let cancelled = false
        const patientId = draft.id
        const domain = activeDomain

        const run = async () => {
            if (cancelled) return
            await Promise.all([
                refreshAnalysisJobStatus(patientId, domain),
                refreshPatientAnalysis(patientId, domain),
            ])
        }

        run().catch(() => { })
        const timer = setInterval(() => {
            run().catch(() => { })
        }, 60000)

        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [showModal, modalMode, draft?.id, draft?.agents, activeDomain, refreshAnalysisJobStatus, refreshPatientAnalysis])

    useEffect(() => {
        if (!showModal || modalMode !== 'edit' || !draft?.id) return
        if (normalizePatientAgents(draft?.agents).equipmentSourcer !== true) return

        let cancelled = false
        const run = async () => {
            if (!cancelled) await refreshEquipmentSourcing(draft.id, activeDomain)
        }
        run().catch(() => { })
        const timer = setInterval(() => run().catch(() => { }), 60000)
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [showModal, modalMode, draft?.id, draft?.agents, activeDomain, refreshEquipmentSourcing])

    useEffect(() => {
        if (!showModal || modalMode !== 'edit') return
        if (!draft?.id) return

        const scribeEnabled = normalizePatientAgents(draft?.agents).scribe === true
        const hasStoredSummary = Boolean(
            scribeSummary?.id
            || scribeSummary?.updatedAt
            || String(scribeSummary?.summaryText || '').trim()
        ) || scribeJobStatus?.summaryExists === true
        if (!scribeEnabled && !hasStoredSummary) {
            return
        }

        let cancelled = false
        const patientId = draft.id
        const domain = activeDomain

        const run = async () => {
            if (cancelled) return
            await Promise.all([
                refreshScribeJobStatus(patientId, domain),
                refreshScribeSummary(patientId, domain),
            ])
        }

        run().catch(() => { })
        const timer = setInterval(() => {
            run().catch(() => { })
        }, 60000)

        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [
        showModal,
        modalMode,
        draft?.id,
        draft?.agents,
        activeDomain,
        scribeSummary?.id,
        scribeSummary?.updatedAt,
        scribeSummary?.summaryText,
        scribeJobStatus?.summaryExists,
        refreshScribeJobStatus,
        refreshScribeSummary
    ])

    // Note bodies live in the Notes entity, so the loaded patient rows no longer
    // carry them. Search asks the Notes API which patients match instead.
    const [noteMatchPatientIds, setNoteMatchPatientIds] = useState([])

    useEffect(() => {
        const query = String(searchText || '').trim()
        let cancelled = false

        // Everything runs inside the timeout so the effect never sets state
        // synchronously.
        const timer = window.setTimeout(async () => {
            if (!isAuthenticated || !activeDomain || query.length < 2) {
                if (!cancelled) setNoteMatchPatientIds([])
                return
            }

            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                const params = new URLSearchParams({
                    domain: activeDomain,
                    search: query,
                    compact: 'text',
                    limit: '200',
                })
                const response = await fetchWithTimeout(`/api/database/notes?${params.toString()}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: 'no-store',
                })
                if (!response.ok) throw new Error('Failed to search notes')

                const data = await response.json().catch(() => ({}))
                if (cancelled) return

                setNoteMatchPatientIds(Array.from(new Set(
                    (Array.isArray(data?.data) ? data.data : [])
                        .map((row) => Number.parseInt(String(row?.patient_id ?? ''), 10))
                        .filter((id) => Number.isFinite(id) && id > 0)
                )))
            } catch {
                if (!cancelled) setNoteMatchPatientIds([])
            }
        }, 250)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [searchText, isAuthenticated, activeDomain])

    const filteredPatients = useMemo(() => {
        const query = String(searchText || '').trim().toLowerCase()
        if (!query) return patients

        const noteMatchIds = new Set(noteMatchPatientIds.map((id) => String(id)))

        return patients.filter((patient) => {
            const patientName = String(patient?.patient_name || '').toLowerCase()
            const labelledAnswers = patient?.metadata?.sploseLabelledAnswers
            const labelsText = labelledAnswers && typeof labelledAnswers === 'object'
                ? JSON.stringify(labelledAnswers).toLowerCase()
                : ''

            return patientName.includes(query)
                || labelsText.includes(query)
                || noteMatchIds.has(String(patient?.id || ''))
        })
    }, [patients, searchText, noteMatchPatientIds])

    const hasUnsavedDraftChanges = useMemo(() => {
        if (!showModal || !draft) return false
        return createDraftSnapshot(draft) !== String(initialDraftSnapshot || '')
    }, [showModal, draft, initialDraftSnapshot])

    const hasFormalReport = useMemo(() => {
        return Boolean(
            formalReport
            && (
                String(formalReport?.reportMarkdown || '').trim()
                || formalReport?.updatedAt
                || formalReport?.id
            )
        )
    }, [formalReport])

    const reportingSaveImpact = useMemo(() => {
        if (!showModal || !draft) return null
        return resolveReportingSaveImpact({
            mode: modalMode,
            draft,
            initialDraftSnapshot,
            hasFormalReport,
        })
    }, [showModal, draft, modalMode, initialDraftSnapshot, hasFormalReport])

    const resetBillingState = () => {
        setBillingRecords([])
        setBillingLoading(false)
        setBillingSubmitting(false)
        setBillingDeletingId(null)
        setBillingError('')
        setBillingForm(DEFAULT_PATIENT_BILLING_FORM)
    }

    const resetTranscriptionState = () => {
        setTranscriptionRecords([])
        setTranscriptionLoading(false)
        setTranscriptionDeletingId(null)
        setTranscriptionError('')
        setLiveTranscript('')
        activeTranscriptionIdRef.current = null
        chunkIndexRef.current = 0
        stopRequestedRef.current = false
    }

    const updateBillingFormField = (field, value) => {
        setBillingForm((prev) => ({ ...prev, [field]: value }))
    }

    const openCreateModal = () => {
        const nextDraft = toPatientDraft({ domain: activeDomain }, schemaFields)
        setModalMode('create')
        setModalInitialTab('overview')
        setDraft(nextDraft)
        setInitialDraftSnapshot(createDraftSnapshot(nextDraft))
        setModalError('')
        setReportJobStatus(null)
        setFormalReport(null)
        setReportDrafts([])
        setReportDraftsError('')
        setBillingJobStatus(null)
        setAnalysisJobStatus(null)
        setEquipmentSourcing(null)
        setEquipmentSourcingError('')
        setScribeJobStatus(null)
        setScribeSummary(null)
        setScribeSummaryError('')
        setScribeSummaryDeleting(false)
        setPatientAnalysis(null)
        setPatientAnalysisError('')
        setAnalysisDeleting(false)
        resetBillingState()
        resetTranscriptionState()
        setShowModal(true)
        clearCreateQueryParam()
    }

    const openEditModal = (patient) => {
        openPatientEditor(patient?.id)
    }

    const finalizeCloseModal = () => {
        const recorder = mediaRecorderRef.current
        if (recorder && recorder.state !== 'inactive') {
            try {
                stopRequestedRef.current = true
                recorder.requestData()
            } catch {
                // no-op
            }
            try {
                recorder.stop()
            } catch {
                // no-op
            }
        }

        if (mediaStreamRef.current) {
            for (const track of mediaStreamRef.current.getTracks()) {
                track.stop()
            }
            mediaStreamRef.current = null
        }

        try { pcmProcessorRef.current?.disconnect?.() } catch { }
        try { pcmSourceRef.current?.disconnect?.() } catch { }
        try { pcmSilenceGainRef.current?.disconnect?.() } catch { }
        try { pcmContextRef.current?.close?.() } catch { }
        pcmProcessorRef.current = null
        pcmSourceRef.current = null
        pcmSilenceGainRef.current = null
        pcmContextRef.current = null
        pcmChunksRef.current = []
        usePcmFallbackRef.current = false

        if (recorderFlushIntervalRef.current) {
            clearInterval(recorderFlushIntervalRef.current)
            recorderFlushIntervalRef.current = null
        }

        setShowModal(false)
        setDraft(null)
        setInitialDraftSnapshot('')
        setReportJobStatus(null)
        setFormalReport(null)
        setReportDrafts([])
        setReportDraftsError('')
        setBillingJobStatus(null)
        setAnalysisJobStatus(null)
        setEquipmentSourcing(null)
        setEquipmentSourcingError('')
        setScribeJobStatus(null)
        setScribeSummary(null)
        setScribeSummaryError('')
        setScribeSummaryDeleting(false)
        setPatientAnalysis(null)
        setPatientAnalysisError('')
        setAnalysisDeleting(false)
        setModalError('')
        resetBillingState()
        resetTranscriptionState()
        setRecorderActive(false)
        setRecorderBusy(false)
        clearCreateQueryParam()
        clearPatientQueryParam()
    }

    const closeModal = () => {
        if (!saving && !agentSavingKey && hasUnsavedDraftChanges) {
            const confirmed = window.confirm('You have unsaved changes. Discard them and close?')
            if (!confirmed) return
        }

        finalizeCloseModal()
    }

    const updateDraftField = (fieldId, value) => {
        setDraft((prev) => {
            if (!prev) return prev
            return {
                ...prev,
                answers: {
                    ...prev.answers,
                    [fieldId]: value,
                },
            }
        })
    }

    const updateDraftAddressField = (fieldId, addressField, value) => {
        setDraft((prev) => {
            if (!prev) return prev
            const currentAddress = normalizeAddressValue(prev.answers[fieldId])
            return {
                ...prev,
                answers: {
                    ...prev.answers,
                    [fieldId]: {
                        ...currentAddress,
                        [addressField]: value,
                    },
                },
            }
        })
    }

    const updateDraftOverviewName = (value) => {
        const nextName = String(value || '')
        const nameField = resolvePatientNameField(schemaFields)

        setDraft((prev) => {
            if (!prev) return prev
            return {
                ...prev,
                patient_name: nextName,
                answers: nameField
                    ? {
                        ...prev.answers,
                        [nameField.id]: nextName,
                    }
                    : prev.answers,
            }
        })
    }

    const updateDraftOverviewSuburb = (value) => {
        const nextSuburb = String(value || '')
        const suburbField = resolveSuburbField(schemaFields)
        if (!suburbField?.fieldId) return

        if (suburbField.addressKey) {
            updateDraftAddressField(suburbField.fieldId, suburbField.addressKey, nextSuburb)
            return
        }

        updateDraftField(suburbField.fieldId, nextSuburb)
    }

    const updateDraftOverviewDob = (value) => {
        const dobField = resolveDobField(schemaFields)
        if (!dobField?.id) return
        updateDraftField(dobField.id, String(value || ''))
    }

    const updateDraftAgentToggle = async (agentKey, enabled) => {
        const key = String(agentKey || '').trim().toLowerCase()
        if (key !== 'reporting' && key !== 'equipmentsourcer' && key !== 'hsrcreator' && key !== 'hsrsummariser' && key !== 'billing' && key !== 'analyst' && key !== 'scribe') return
        const normalizedKey = key === 'equipmentsourcer' ? 'equipmentSourcer' : key === 'hsrcreator' ? 'hsrCreator' : key === 'hsrsummariser' ? 'hsrSummariser' : key
        const enablesHsrSummariser = normalizedKey === 'hsrCreator' && enabled === true

        const previousAgents = normalizePatientAgents(draft?.agents)
        let nextDraft = null
        setDraft((prev) => {
            if (!prev) return prev
            nextDraft = {
                ...prev,
                agents: {
                    ...normalizePatientAgents(prev.agents),
                    [normalizedKey]: enabled === true,
                    ...(enablesHsrSummariser ? { hsrSummariser: true } : {}),
                },
            }
            return nextDraft
        })

        const patientId = String(nextDraft?.id || '').trim()
        if (modalMode !== 'edit' || !patientId) {
            return
        }

        const derivedName = derivePatientName(schemaFields, nextDraft.answers, nextDraft.patient_name)
        if (!derivedName) {
            setModalError('Patient full name is required.')
            setDraft((prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    agents: {
                        ...normalizePatientAgents(prev.agents),
                        [normalizedKey]: previousAgents[normalizedKey] === true,
                        ...(enablesHsrSummariser ? { hsrSummariser: previousAgents.hsrSummariser === true } : {}),
                    },
                }
            })
            return
        }

        const metadata = buildPatientMetadata({
            draft: nextDraft,
            schemaFormUuid,
            schemaFields,
        })

        const payload = {
            patient_name: derivedName,
            domain: activeDomain,
            metadata,
        }

        setAgentSavingKey(normalizedKey)
        setModalError('')

        try {
            const response = await fetch(`/api/database/patients/${encodeURIComponent(patientId)}?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'PATCH',
                headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to update patient')
            }

            setPatients((prev) => prev.map((patient) => (
                String(patient?.id || '') === patientId
                    ? {
                        ...patient,
                        patient_name: derivedName,
                        metadata,
                    }
                    : patient
            )))

            if (normalizedKey === 'reporting' || normalizedKey === 'hsrCreator') {
                if (enabled === true) {
                    const methodInfo = resolveReportEnqueueMethodInfo(data?.reportQueue, null)
                    setReportJobStatus((prev) => {
                        const next = {
                            ...(prev || {}),
                            status: 'queued',
                            statusLabel: 'Creating',
                            enqueueMethod: methodInfo.enqueueMethod,
                            enqueueMethodLabel: methodInfo.enqueueMethodLabel,
                        }
                        setCachedReportJobStatus(patientId, activeDomain, next)
                        return next
                    })
                } else {
                    setReportJobStatus(null)
                    clearCachedReportJobStatus(patientId, activeDomain)
                }
                await refreshReportJobStatus(patientId, activeDomain, { force: true })
            }

            if (normalizedKey === 'billing') {
                if (enabled === true) {
                    setBillingJobStatus((prev) => ({
                        ...(prev || {}),
                        status: 'queued',
                        statusLabel: 'Waiting',
                    }))
                } else {
                    setBillingJobStatus(null)
                }
                await refreshBillingJobStatus(patientId, activeDomain)
            }

            if (normalizedKey === 'analyst') {
                if (enabled === true) {
                    setAnalysisJobStatus((prev) => ({
                        ...(prev || {}),
                        status: 'queued',
                        statusLabel: 'Waiting',
                    }))
                } else {
                    setAnalysisJobStatus(null)
                    setPatientAnalysis(null)
                    setPatientAnalysisError('')
                }
                await Promise.all([
                    refreshAnalysisJobStatus(patientId, activeDomain),
                    refreshPatientAnalysis(patientId, activeDomain),
                ])
            }

            if (normalizedKey === 'equipmentSourcer') {
                if (enabled === true) {
                    setEquipmentSourcing({
                        status: 'queued',
                        statusLabel: 'Waiting',
                        latest: data?.equipmentSourcerQueue || null,
                        result: null,
                    })
                    await refreshEquipmentSourcing(patientId, activeDomain)
                } else {
                    setEquipmentSourcing(null)
                    setEquipmentSourcingError('')
                }
            }

            if (normalizedKey === 'scribe' || normalizedKey === 'hsrSummariser') {
                if (enabled === true) {
                    setScribeJobStatus((prev) => ({
                        ...(prev || {}),
                        status: 'queued',
                        statusLabel: 'Waiting',
                    }))
                } else {
                    setScribeJobStatus(null)
                }
                await refreshScribeJobStatus(patientId, activeDomain)
            }
        } catch (error) {
            setDraft((prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    agents: {
                        ...normalizePatientAgents(prev.agents),
                        [normalizedKey]: previousAgents[normalizedKey] === true,
                        ...(enablesHsrSummariser ? { hsrSummariser: previousAgents.hsrSummariser === true } : {}),
                    },
                }
            })
            setModalError(sanitizeModalErrorMessage(error?.message, 'Failed to update agent settings'))
        } finally {
            setAgentSavingKey('')
        }
    }

    const updateDraftAgentConfig = (agentKey, configKey, value) => {
        const key = String(agentKey || '').trim().toLowerCase()
        if (key !== 'reporting' && key !== 'billing' && key !== 'analyst' && key !== 'scribe' && key !== 'hsrcreator' && key !== 'hsrsummariser') return

        const configField = String(configKey || '').trim()
        if (!configField) return

        setDraft((prev) => {
            if (!prev) return prev

            const normalized = normalizePatientAgents(prev.agents)
            const configKeyName = key === 'reporting'
                ? 'reportingConfig'
                : key === 'analyst'
                    ? 'analysisConfig'
                    : key === 'scribe'
                        ? 'scribeConfig'
                        : key === 'hsrsummariser'
                            ? 'hsrSummariserConfig'
                            : key === 'hsrcreator'
                                ? 'hsrCreatorConfig'
                                : 'billingConfig'
            const currentConfig = normalized[configKeyName] && typeof normalized[configKeyName] === 'object'
                ? normalized[configKeyName]
                : key === 'reporting'
                    ? DEFAULT_REPORTING_AGENT_CONFIG
                    : key === 'analyst'
                        ? DEFAULT_ANALYST_AGENT_CONFIG
                        : key === 'scribe'
                            ? DEFAULT_SCRIBE_AGENT_CONFIG
                            : key === 'hsrsummariser'
                                ? DEFAULT_HSR_SUMMARISER_AGENT_CONFIG
                                : key === 'hsrcreator'
                                    ? DEFAULT_HSR_CREATOR_AGENT_CONFIG
                                    : DEFAULT_BILLING_AGENT_CONFIG

            return {
                ...prev,
                agents: {
                    ...normalized,
                    [configKeyName]: {
                        ...currentConfig,
                        [configField]: value,
                    },
                },
            }
        })
    }

    const savePatient = async ({ closeAfterSave }) => {
        if (!draft) return
        const previousFormalReportUpdatedAt = String(formalReport?.updatedAt || '').trim()

        const derivedName = derivePatientName(schemaFields, draft.answers, draft.patient_name)
        if (!derivedName) {
            setModalError('Patient full name is required.')
            return
        }

        const metadata = buildPatientMetadata({ draft, schemaFormUuid, schemaFields })

        const payload = {
            patient_name: derivedName,
            domain: activeDomain,
            metadata,
        }

        setSaving(true)
        setModalError('')
        try {
            const hasFormalReportBeforeSave = hasFormalReport
            let savedPatient = null
            let reportImpactReason = ''
            let reportQueued = false
            if (modalMode === 'create') {
                const response = await fetch('/api/database/patients', {
                    method: 'POST',
                    headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to create patient')
                }
                savedPatient = data?.patient || null
                const reportingEnabled = normalizePatientAgents(draft?.agents).reporting === true
                setStatusMessage(reportingEnabled
                    ? 'Patient created. Draft report generation queued.'
                    : 'Patient created.')
                setStatusTone('success')
            } else {
                const response = await fetch(`/api/database/patients/${encodeURIComponent(String(draft.id || ''))}?domain=${encodeURIComponent(activeDomain)}`, {
                    method: 'PATCH',
                    headers: { ...(await resolveAdminAuthHeaders()), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to update patient')
                }
                savedPatient = data?.patient || null

                reportImpactReason = String(data?.reportImpact?.reason || '').trim().toLowerCase()
                reportQueued = data?.reportImpact?.queued === true
                let successMessage = 'Patient updated.'

                if (reportQueued) {
                    const methodInfo = resolveReportEnqueueMethodInfo(data?.reportQueue, null)
                    setReportJobStatus((prev) => {
                        const next = {
                            ...(prev || {}),
                            status: 'queued',
                            statusLabel: reportImpactReason === 'config_changed' ? 'Updating' : 'Creating',
                            enqueueMethod: methodInfo.enqueueMethod,
                            enqueueMethodLabel: methodInfo.enqueueMethodLabel,
                        }
                        setCachedReportJobStatus(draft?.id, activeDomain, next)
                        return next
                    })
                }

                if (reportQueued && reportImpactReason === 'config_changed') {
                    successMessage = hasFormalReportBeforeSave
                        ? 'Patient updated. Draft report regeneration queued and will replace the current draft.'
                        : 'Patient updated. Draft report generation queued with the new reporting settings.'
                } else if (reportQueued && reportImpactReason === 'enabled') {
                    successMessage = hasFormalReportBeforeSave
                        ? 'Patient updated. Report generation queued and will replace the current draft.'
                        : 'Patient updated. Initial draft report generation queued.'
                }

                setStatusMessage(successMessage)
                setStatusTone('success')
            }

            await refreshPatients(activeDomain)

            if (closeAfterSave) {
                finalizeCloseModal()
                return
            }

            const nextSavedDraft = savedPatient ? toPatientDraft(savedPatient, schemaFields) : draft
            const nextPatientId = String(nextSavedDraft?.id || '').trim()
            const nextDomain = String(nextSavedDraft?.domain || activeDomain || '').trim()

            if (modalMode === 'create' && nextPatientId) {
                finalizeCloseModal()
                openPatientEditor(nextPatientId)
                return
            }

            setDraft(nextSavedDraft)
            setInitialDraftSnapshot(createDraftSnapshot(nextSavedDraft))

            if (modalMode === 'create' && nextPatientId) {
                setModalMode('edit')
            }

            if (nextPatientId && nextDomain) {
                const [latestReportStatus, _latestBillingStatus, _latestAnalysisStatus, _latestScribeStatus, _latestSummary, _latestAnalysis, latestFormalReport] = await Promise.all([
                    refreshReportJobStatus(nextPatientId, nextDomain),
                    refreshBillingJobStatus(nextPatientId, nextDomain),
                    refreshAnalysisJobStatus(nextPatientId, nextDomain),
                    refreshScribeJobStatus(nextPatientId, nextDomain),
                    refreshScribeSummary(nextPatientId, nextDomain),
                    refreshPatientAnalysis(nextPatientId, nextDomain),
                    refreshFormalReport(nextPatientId, nextDomain),
                ])

                // Keep a visible pending state after config changes until a newer report row is observed.
                if (reportImpactReason === 'config_changed' && reportQueued) {
                    const refreshedUpdatedAt = String(latestFormalReport?.updatedAt || '').trim()
                    const hasAdvancedTimestamp = Boolean(
                        previousFormalReportUpdatedAt
                        && refreshedUpdatedAt
                        && previousFormalReportUpdatedAt !== refreshedUpdatedAt
                    )

                    if (!hasAdvancedTimestamp) {
                        setReportJobStatus((prev) => {
                            const next = {
                                ...(prev || latestReportStatus || {}),
                                status: 'queued',
                                statusLabel: 'Updating',
                            }
                            setCachedReportJobStatus(nextPatientId, nextDomain, next)
                            return next
                        })
                    }
                }
            }
        } catch (error) {
            setModalError(sanitizeModalErrorMessage(error?.message, 'Failed to save patient'))
        } finally {
            setSaving(false)
        }
    }

    const handleSavePatient = async () => {
        await savePatient({ closeAfterSave: false })
    }

    const handleSavePatientAndClose = async () => {
        await savePatient({ closeAfterSave: true })
    }

    const handleDeletePatient = async (patient) => {
        const patientId = String(patient?.id || '').trim()
        if (!patientId) return

        const confirmed = window.confirm('Delete this patient record? This action cannot be undone.')
        if (!confirmed) return

        setDeletingPatientId(patientId)
        setModalError('')
        try {
            const response = await fetch(`/api/database/patients/${encodeURIComponent(patientId)}?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'DELETE',
                headers: await resolveAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete patient')
            }

            setStatusMessage('Patient deleted.')
            setStatusTone('success')
            await refreshPatients(activeDomain)

            if (showModal && String(draft?.id || '').trim() === patientId) {
                finalizeCloseModal()
            }
        } catch (error) {
            setModalError(sanitizeModalErrorMessage(error?.message, 'Failed to delete patient'))
        } finally {
            setDeletingPatientId(null)
        }
    }

    const handleAddBillingRecord = async () => {
        const billingAccountId = String(draft?.id || '').trim()
        if (!billingAccountId) {
            setBillingError('Save this patient before adding billing records.')
            return
        }

        setBillingSubmitting(true)
        setBillingError('')
        try {
            const amountText = String(billingForm.amount || '').trim()
            const payload = {
                account_id: billingAccountId,
                account_name: String(draft?.patient_name || '').trim() || null,
                domain: activeDomain,
                metadata: {
                    eventType: String(billingForm.eventType || 'note').trim().toLowerCase(),
                    invoiceId: String(billingForm.invoiceId || '').trim() || null,
                    paymentId: String(billingForm.paymentId || '').trim() || null,
                    status: String(billingForm.status || '').trim().toLowerCase() || null,
                    amount: amountText ? Number.parseFloat(amountText) : null,
                    occurredAt: toIsoOrNull(billingForm.occurredAt),
                    note: String(billingForm.note || '').trim() || null,
                    source: 'admin-patients',
                },
            }

            const authHeaders = await getAdminAuthHeaders()
            const response = await fetch('/api/database/billing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify(payload),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to create billing record')
            }

            setStatusMessage('Billing event added for patient.')
            setStatusTone('success')
            setBillingForm(DEFAULT_PATIENT_BILLING_FORM)
            await refreshBillingForPatient(billingAccountId, activeDomain)
        } catch (error) {
            setBillingError(error?.message || 'Failed to create billing record')
        } finally {
            setBillingSubmitting(false)
        }
    }

    const handleDeleteBillingRecord = async (recordId) => {
        const numericId = String(recordId || '').trim()
        if (!numericId) return

        const confirmed = window.confirm('Delete this billing record? This action cannot be undone.')
        if (!confirmed) return

        setBillingDeletingId(recordId)
        setBillingError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(`/api/database/billing/${encodeURIComponent(numericId)}?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete billing record')
            }

            setStatusMessage('Billing record deleted.')
            setStatusTone('success')
            await refreshBillingForPatient(draft?.id, activeDomain)
        } catch (error) {
            setBillingError(error?.message || 'Failed to delete billing record')
        } finally {
            setBillingDeletingId(null)
        }
    }

    const handleDeleteTranscription = async (record) => {
        const transcriptionId = String(record?.id || '').trim()
        if (!transcriptionId) return

        const confirmed = window.confirm('Move this transcript to Recently Deleted? You can restore it from Recycling.')
        if (!confirmed) return

        setTranscriptionDeletingId(record?.id || null)
        setTranscriptionError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(
                `/api/database/patient-transcriptions/${encodeURIComponent(transcriptionId)}?domain=${encodeURIComponent(activeDomain)}`,
                {
                    method: 'DELETE',
                    headers,
                }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to mark transcript as pending delete')
            }

            setStatusMessage('Transcript marked as pending delete.')
            setStatusTone('success')
            await refreshTranscriptionsForPatient(draft?.id, activeDomain)
        } catch (error) {
            setTranscriptionError(error?.message || 'Failed to mark transcript as pending delete')
        } finally {
            setTranscriptionDeletingId(null)
        }
    }

    const handleRestoreTranscription = async (record) => {
        const transcriptionId = String(record?.id || '').trim()
        if (!transcriptionId) return

        const confirmed = window.confirm('Restore this transcript?')
        if (!confirmed) return

        setTranscriptionDeletingId(record?.id || null)
        setTranscriptionError('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch('/api/database/recycling', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify({
                    action: 'restore',
                    domain: activeDomain,
                    itemType: 'transcript',
                    sourceId: transcriptionId,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to restore transcript')
            }

            setStatusMessage('Transcript restored.')
            setStatusTone('success')
            await refreshTranscriptionsForPatient(draft?.id, activeDomain)
        } catch (error) {
            setTranscriptionError(error?.message || 'Failed to restore transcript')
        } finally {
            setTranscriptionDeletingId(null)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading patients...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    return (
        <div className="min-h-screen">
            <AdminHeader title="Patients" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => refreshPatients(activeDomain)}
                                disabled={loadingPatients}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingPatients ? 'Refreshing...' : 'Refresh'}
                            </button>
                            <button
                                type="button"
                                onClick={openCreateModal}
                                disabled={!patientsEnabled}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Add Patient
                            </button>

                            {/* Import lives behind this menu: it is an occasional,
                                advanced tool rather than part of the daily list view. */}
                            <div className="relative" ref={importMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setImportMenuOpen((open) => !open)}
                                    disabled={!patientsEnabled}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label="More actions"
                                    aria-haspopup="true"
                                    aria-expanded={importMenuOpen}
                                    title="More actions"
                                >
                                    <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                                </button>

                                {importMenuOpen && (
                                    <div className="absolute right-0 top-full z-20 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 text-left shadow-lg">
                                        <h2 className="text-sm font-semibold text-gray-900">Import patients</h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Upload a CSV export from the practice management system. Rows are matched on the
                                            external patient ID, so re-importing the same file only touches records that
                                            changed. Start with a dry run to preview the changes.
                                        </p>

                                        <label className="mt-4 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">CSV file</span>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".csv,text/csv"
                                                onChange={(event) => handleImportFileSelected(event.target.files?.[0] || null)}
                                                className="mt-1 w-full text-sm text-gray-700"
                                            />
                                        </label>

                                        <label className="mt-3 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">External source</span>
                                            <input
                                                type="text"
                                                value={importSource}
                                                onChange={(event) => setImportSource(event.target.value)}
                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="splose"
                                            />
                                        </label>

                                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={importDryRun}
                                                onChange={(event) => setImportDryRun(event.target.checked)}
                                                className="h-4 w-4"
                                            />
                                            Dry run
                                        </label>

                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => runPatientImport(true)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Working...' : 'Preview changes'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => runPatientImport(importDryRun)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Importing...' : (importDryRun ? 'Import (dry run)' : 'Import')}
                                            </button>
                                        </div>

                                        {importPreview && (
                                            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                                {importPreview.error ? (
                                                    <span className="text-red-700">{importPreview.error}</span>
                                                ) : (
                                                    <>
                                                        <p>
                                                            <span className="font-semibold">{importPreview.rowCount}</span> data row(s) detected
                                                            {importFile?.name ? ` in ${importFile.name}` : ''}.
                                                        </p>
                                                        {importPreview.unknownHeaders?.length > 0 && (
                                                            <p className="mt-1 text-amber-800">
                                                                Unrecognised column(s) will be ignored: {importPreview.unknownHeaders.join(', ')}
                                                            </p>
                                                        )}
                                                        {importPreview.firstRow && (
                                                            <p className="mt-1 text-gray-500">
                                                                First row: {[importPreview.firstRow.first_name, importPreview.firstRow.last_name].filter(Boolean).join(' ')
                                                                    || importPreview.firstRow.patient_name
                                                                    || 'no name'} ·{' '}
                                                                {importPreview.firstRow.external_id || 'no external ID'}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {importResult && (
                                            <div className="mt-3 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                                                <p className="font-semibold text-gray-900">
                                                    {importResult.dryRun ? 'Dry run result' : 'Import result'}
                                                </p>
                                                <ul className="mt-1 space-y-0.5">
                                                    <li>Rows read: {importResult.total}</li>
                                                    <li>Added: {importResult.inserted}</li>
                                                    <li>Updated: {importResult.updated}</li>
                                                    <li>Unchanged: {importResult.unchanged}</li>
                                                    <li>Skipped: {importResult.skipped}</li>
                                                </ul>
                                                {importResult.errors?.length > 0 && (
                                                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-700">
                                                        {importResult.errors.map((entry) => (
                                                            <li key={`${entry.row}-${entry.message}`}>Row {entry.row}: {entry.message}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {statusMessage && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    )}

                    {!patientsEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Patients is disabled. Enable Patients in Domain Settings to manage records.
                        </p>
                    )}

                    {schemaLoading && (
                        <p className="mt-3 text-xs text-gray-500">Loading Splose field definitions...</p>
                    )}
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-gray-900">Patient Records</h2>
                        <input
                            type="text"
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                            className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
                            placeholder="Search by patient name, notes, or intake data"
                        />
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Funding</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Referrer</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Updated</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredPatients.map((patient) => {
                                    const labelled = safeMetadata(patient?.metadata?.sploseLabelledAnswers)
                                    const funding = String(
                                        labelled['Funding Source or Referral Type'] ||
                                        labelled['Funding source or referral type'] ||
                                        ''
                                    ).trim()
                                    const referrer = String(labelled['Full name'] || '').trim()
                                    const updatedAt = patient?.updated_at ? new Date(patient.updated_at).toLocaleString() : 'N/A'
                                    const importedRecord = safeMetadata(patient?.metadata?.splosePatient)
                                    const importedExternalId = String(importedRecord?.externalId || '').trim()
                                    const importedSource = String(importedRecord?.externalSource || '').trim()

                                    return (
                                        <tr
                                            key={patient.id}
                                            className="cursor-pointer hover:bg-gray-50"
                                            onClick={() => openEditModal(patient)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault()
                                                    openEditModal(patient)
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            <td className="px-3 py-2 font-medium text-gray-900">
                                                {patient.patient_name}
                                                {importedExternalId && (
                                                    <span
                                                        className="ml-2 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                                                        title={`Imported from ${importedSource || 'an external system'} · ID ${importedExternalId}`}
                                                    >
                                                        Imported
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">{funding || '-'}</td>
                                            <td className="px-3 py-2 text-gray-700">{referrer || '-'}</td>
                                            <td className="px-3 py-2 text-gray-700">{updatedAt}</td>
                                            <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                                <details className="relative inline-block" onClick={(event) => event.stopPropagation()}>
                                                    <summary
                                                        className="list-none cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                                        aria-label={`Open actions for ${patient.patient_name}`}
                                                    >
                                                        ...
                                                    </summary>
                                                    <div className="absolute right-0 z-20 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                openEditModal(patient)
                                                            }}
                                                            className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                        >
                                                            Open
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                handleDeletePatient(patient)
                                                            }}
                                                            disabled={deletingPatientId === String(patient?.id || '')}
                                                            className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {deletingPatientId === String(patient?.id || '') ? 'Deleting...' : 'Delete'}
                                                        </button>
                                                    </div>
                                                </details>
                                            </td>
                                        </tr>
                                    )
                                })}

                                {!loadingPatients && filteredPatients.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-5 text-center text-gray-500">
                                            No patients found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>

            <PatientModal
                isOpen={showModal}
                isPopOutView={isPopOutView}
                mode={modalMode}
                activeDomain={activeDomain}
                domainDisplayName={domainDisplayName}
                domainSourcingReplyTo={domainSourcingReplyTo}
                domainSourcingReplyToName={domainSourcingReplyToName}
                domainSourcingBccReplyToDefault={domainSourcingBccReplyToDefault}
                domainSourcingEmailSignature={domainSourcingEmailSignature}
                domainSourcingLogoUrl={domainSourcingLogoUrl}
                workerVisibility={workerVisibility}
                appointmentsEnabled={appointmentsEnabled}
                formsEnabled={formsEnabled}
                openCurrentReportOnLoad={searchParams.get('openCurrentReport') === '1'}
                initialTab={modalInitialTab}
                draft={draft}
                fields={schemaFields}
                saving={saving}
                hasUnsavedChanges={hasUnsavedDraftChanges}
                error={modalError}
                onClose={closeModal}
                onSave={handleSavePatient}
                onSaveAndClose={handleSavePatientAndClose}
                onChangeField={updateDraftField}
                onChangeAddressField={updateDraftAddressField}
                onChangeOverviewName={updateDraftOverviewName}
                onChangeOverviewSuburb={updateDraftOverviewSuburb}
                onChangeOverviewDob={updateDraftOverviewDob}
                onToggleAgent={updateDraftAgentToggle}
                onChangeAgentConfig={updateDraftAgentConfig}
                agentSavingKey={agentSavingKey}
                reportJobStatus={reportJobStatus}
                reportJobLoading={reportJobLoading}
                onReportReviewed={markReportReviewed}
                reportSaveImpact={reportingSaveImpact}
                billingJobStatus={billingJobStatus}
                billingJobLoading={billingJobLoading}
                analysisJobStatus={analysisJobStatus}
                analysisJobLoading={analysisJobLoading}
                equipmentSourcing={equipmentSourcing}
                equipmentSourcingLoading={equipmentSourcingLoading}
                equipmentSourcingError={equipmentSourcingError}
                onSetEquipmentSourcingError={setEquipmentSourcingError}
                scribeJobStatus={scribeJobStatus}
                scribeJobLoading={scribeJobLoading}
                scribeSummary={scribeSummary}
                scribeSummaries={scribeSummaries}
                scribeSummaryLoading={scribeSummaryLoading}
                scribeSummaryError={scribeSummaryError}
                scribeSummaryDeleting={scribeSummaryDeleting}
                patientAnalysis={patientAnalysis}
                patientAnalysisLoading={patientAnalysisLoading}
                patientAnalysisError={patientAnalysisError}
                analysisDeleting={analysisDeleting}
                formalReport={formalReport}
                formalReportLoading={formalReportLoading}
                formalReportSaving={formalReportSaving}
                formalReportDownloadingWord={formalReportDownloadingWord}
                formalReportExportingTemplate={formalReportExportingTemplate}
                reportDrafts={reportDrafts}
                reportDraftsLoading={reportDraftsLoading}
                reportDraftsError={reportDraftsError}
                patients={patients}
                onFetchComparativeReportDrafts={(patientId) => fetchReportDraftsForPatient(patientId, activeDomain)}
                patientFiles={patientFiles}
                patientFilesLoading={patientFilesLoading}
                patientFileUploading={patientFileUploading}
                patientFileDeletingId={patientFileDeletingId}
                patientFilesError={patientFilesError}
                onUploadPatientFile={uploadPatientFile}
                onPreviewPatientFile={fetchPatientFileBlob}
                onDownloadPatientFile={downloadPatientFile}
                onDeletePatientFile={deletePatientFile}
                analysisEvidenceFileId={analysisEvidenceFileId}
                analysisEvidenceError={analysisEvidenceError}
                onToggleAnalysisEvidenceFile={toggleAnalysisEvidenceFile}
                billingRecords={billingRecords}
                billingLoading={billingLoading}
                billingSubmitting={billingSubmitting}
                billingDeletingId={billingDeletingId}
                billingError={billingError}
                billingForm={billingForm}
                onRefreshBilling={() => refreshBillingForPatient(draft?.id, activeDomain)}
                onRefreshAnalysis={() => {
                    if (!draft?.id || !activeDomain) return
                    refreshAnalysisJobStatus(draft.id, activeDomain)
                    refreshPatientAnalysis(draft.id, activeDomain)
                }}
                onRefreshEquipmentSourcing={() => {
                    if (!draft?.id || !activeDomain) return
                    refreshEquipmentSourcing(draft.id, activeDomain)
                }}
                onRefreshSummary={() => {
                    if (!draft?.id || !activeDomain) return
                    refreshScribeJobStatus(draft.id, activeDomain)
                    refreshScribeSummary(draft.id, activeDomain)
                }}
                onDeleteAnalysis={handleDeleteAnalysis}
                onRerunAnalysis={handleRerunAnalysis}
                analysisRerunning={analysisRerunning}
                onDeleteSummary={handleDeleteSummary}
                onRefreshFormalReport={() => refreshFormalReport(draft?.id, activeDomain)}
                onRefreshReportDrafts={() => refreshReportDrafts(draft?.id, activeDomain)}
                onSaveFormalReport={(reportMarkdown) => saveFormalReport({
                    patientId: draft?.id,
                    domain: activeDomain,
                    patientName: derivePatientName(schemaFields, draft?.answers, draft?.patient_name),
                    reportMarkdown
                })}
                onDownloadFormalReportWord={(reportMarkdown) => downloadFormalReportForWord({
                    patientId: draft?.id,
                    domain: activeDomain,
                    patientName: derivePatientName(schemaFields, draft?.answers, draft?.patient_name),
                    reportMarkdown,
                })}
                onExportFormalReportTemplateDocx={(reportMarkdown) => exportFormalReportUsingTemplate({
                    patientId: draft?.id,
                    domain: activeDomain,
                    patientName: derivePatientName(schemaFields, draft?.answers, draft?.patient_name),
                    reportMarkdown,
                })}
                onChangeBillingForm={updateBillingFormField}
                onAddBillingRecord={handleAddBillingRecord}
                onDeleteBillingRecord={handleDeleteBillingRecord}
                transcriptionRecords={transcriptionRecords}
                transcriptionLoading={transcriptionLoading}
                transcriptionDeletingId={transcriptionDeletingId}
                transcriptionError={transcriptionError}
                recorderSupported={recorderSupported}
                recorderReady={recorderReady}
                recorderPermission={recorderPermission}
                recorderHint={recorderHint}
                recorderActive={recorderActive}
                recorderBusy={recorderBusy}
                liveTranscript={liveTranscript}
                onRefreshTranscriptions={() => refreshTranscriptionsForPatient(draft?.id, activeDomain, { includePendingDeleteId: focusedTranscriptionId })}
                onDeleteTranscription={handleDeleteTranscription}
                onRestoreTranscription={handleRestoreTranscription}
                onStartRecording={startTranscriptionRecording}
                onStopRecording={stopTranscriptionRecording}
                focusedTranscriptionId={focusedTranscriptionId}
            />
        </div>
    )
}

export default function PatientsPage() {
    return (
        <Suspense
            fallback={(
                <div className="min-h-screen flex items-center justify-center">
                    <div className="text-sm text-gray-600">Loading patients...</div>
                </div>
            )}
        >
            <PatientsPageContent />
        </Suspense>
    )
}

