'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Ban,
    Check,
    ChevronDown,
    ChevronRight,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Send,
    Trash2,
    X,
} from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    DEFAULT_NDIS_PRICING_REGION,
    NDIS_CATALOGUE_EFFECTIVE_FROM,
    NDIS_CATALOGUE_PERIOD,
    NDIS_PRICING_ARRANGEMENTS_URL,
    NDIS_PRICING_REGIONS,
    NDIS_PRICE_LIMIT_NOTE,
    NDIS_SUPPORT_CATALOGUE_URL,
    NDIS_SUPPORT_ITEMS,
    buildNdisQuoteLine,
    formatNdisSupportItemOption,
    getNdisSupportUnit,
    normalizeNdisPricingRegion,
    resolveNdisSupportItemSelection,
} from '@/lib/ndisSupportCatalogue'
import {
    FUNDING_TYPE_OPTIONS,
    formatCurrency,
    formatDisplayDate,
} from '@/lib/patientQuoteDisplay'
import {
    DEFAULT_CANCELLATION_NOTICE_DAYS,
    DEFAULT_FUNDING_TYPE,
    buildQuoteLineMetrics,
    computeServiceAgreementTotals,
    referenceNumberLabelFor,
    resolvePatientFundingContext,
} from '@/lib/patientServiceAgreements'
import {
    AGREEMENT_STATUS_LABELS,
    AGREEMENT_STATUS_PILL_STYLES,
    SERVICE_AGREEMENT_STATUS_OPTIONS,
    PLAN_MANAGEMENT_TYPE_OPTIONS,
    buildServiceAgreementMetrics,
    deriveServiceAgreementStatus,
    formatAgreementNumberPreview,
    planManagementTypeLabel,
    resolveSignatureState,
} from '@/lib/patientServiceAgreementDisplay'

const DEFAULT_AGREEMENT_DAYS = 365
const DEFAULT_REVIEW_LEAD_DAYS = 30

function toLocalDateString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0))
}

function createBlankAgreementForm(patientFunding = null) {
    const today = new Date()
    return {
        agreement_number: '',
        funding_type: patientFunding?.fundingType || DEFAULT_FUNDING_TYPE,
        plan_management_type: 'unknown',
        plan_manager: '',
        ndis_number: patientFunding?.referenceNumber || '',
        start_date: toLocalDateString(today),
        end_date: toLocalDateString(addDays(today, DEFAULT_AGREEMENT_DAYS)),
        review_date: toLocalDateString(addDays(addDays(today, DEFAULT_AGREEMENT_DAYS), -DEFAULT_REVIEW_LEAD_DAYS)),
        prepared_by: '',
        cancellation_notice_days: String(DEFAULT_CANCELLATION_NOTICE_DAYS),
        cancellation_policy: '',
        terms: '',
        notes: '',
        base_quote_id: '',
    }
}

function createBlankSupportForm(unit = 'H') {
    return {
        support_item: '',
        ndis_support_item_name: '',
        registration_group_number: '',
        registration_group_name: '',
        support_category_number: '',
        support_category_name: '',
        unit,
        quantity: '1',
        unit_price: '',
        price_limit: '',
        quote_required: false,
        description: '',
    }
}

async function buildAuthHeaders() {
    const token = await getOrCreateAdminTokenForLocalhost()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

async function requestJson(url, options = {}) {
    const authHeaders = await buildAuthHeaders()
    const hasBody = Boolean(options.body)
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders,
            ...(options.headers || {}),
        },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
}

/** Highest SA-nnnn number already used, so the create form can preview the next one. */
function nextAgreementSequence(agreements) {
    let max = 0
    for (const agreement of Array.isArray(agreements) ? agreements : []) {
        const match = /^SA-(\d+)$/i.exec(String(agreement?.agreement_number || '').trim())
        if (match) max = Math.max(max, Number.parseInt(match[1], 10))
    }
    return max + 1
}

function StatusPill({ status }) {
    const key = status || 'draft'
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${AGREEMENT_STATUS_PILL_STYLES[key] || AGREEMENT_STATUS_PILL_STYLES.draft}`}>
            {AGREEMENT_STATUS_LABELS[key] || String(key)}
        </span>
    )
}

function FundingBadge({ fundingType }) {
    const label = FUNDING_TYPE_OPTIONS.find((option) => option.value === fundingType)?.label || 'NDIS'
    return (
        <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
            {label}
        </span>
    )
}

function PlanManagementBadge({ planManagementType }) {
    if (!planManagementType || planManagementType === 'unknown') return null
    return (
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            {planManagementTypeLabel(planManagementType)}
        </span>
    )
}

function AttentionPill({ attention }) {
    if (!attention) return null

    const toneClasses = attention.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'

    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneClasses}`}>
            {attention.label}
        </span>
    )
}

function SignatureBadge({ signatures }) {
    const label = signatures.fullySigned
        ? 'Signed by both parties'
        : signatures.anySigned ? 'Partly signed' : 'Unsigned'
    const classes = signatures.fullySigned
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : signatures.anySigned
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-gray-200 bg-gray-50 text-gray-500'

    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${classes}`}>
            {label}
        </span>
    )
}

/** Shows the NDIS price limit for a support and warns when the price is above it. */
function PriceLimitNote({ item, region }) {
    const metrics = buildQuoteLineMetrics(item)
    if (metrics.priceLimit === null) {
        return (
            <span className="text-[11px] text-gray-400">
                No price limit — quoted support ({region === 'national' ? 'national' : NDIS_PRICING_REGIONS.find((entry) => entry.value === region)?.label?.toLowerCase()})
            </span>
        )
    }

    return (
        <span className={`text-[11px] ${metrics.overLimit ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
            Limit {formatCurrency(metrics.priceLimit)}
            {metrics.overLimit ? ` — ${formatCurrency(metrics.overLimitBy)} above the limit` : ''}
        </span>
    )
}

export default function PatientServiceAgreementsPanel({
    patientId,
    patientName,
    domain,
    domainDisplayName,
    patientAnswers,
    patientLabelledAnswers,
    openCreate = false,
    onOpenCreateHandled,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    // The participant/claim number and the funding scheme live on the patient's
    // intake record (Info tab), so they are read once here and reused for every
    // agreement rather than being retyped. An agreement still stores its own copy,
    // so a signed agreement keeps the number as at the date it was signed.
    const patientFunding = useMemo(
        () => resolvePatientFundingContext({ answers: patientAnswers, labelledAnswers: patientLabelledAnswers }),
        [patientAnswers, patientLabelledAnswers]
    )

    const referenceLabelForAgreement = useCallback((fundingType) => referenceNumberLabelFor(
        String(fundingType || '').toLowerCase() === 'ndis' ? 'ndis' : (patientFunding.fundingSource || fundingType)
    ), [patientFunding.fundingSource])

    const [agreements, setAgreements] = useState([])
    const [agreementsLoading, setAgreementsLoading] = useState(false)
    const [agreementsError, setAgreementsError] = useState('')
    const [notice, setNotice] = useState(null)

    const [quotes, setQuotes] = useState([])

    const [showCreateForm, setShowCreateForm] = useState(false)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState('')
    const [newAgreementForm, setNewAgreementForm] = useState(() => createBlankAgreementForm(patientFunding))

    const [expandedIds, setExpandedIds] = useState([])
    const [itemsByAgreement, setItemsByAgreement] = useState({})
    const [itemsLoadingAgreementId, setItemsLoadingAgreementId] = useState(null)
    const [itemsError, setItemsError] = useState('')

    const [lineForms, setLineForms] = useState({})
    const [addingLineAgreementId, setAddingLineAgreementId] = useState(null)
    const [lineAddError, setLineAddError] = useState('')
    const [deletingLineKey, setDeletingLineKey] = useState(null)

    const [editingLineKey, setEditingLineKey] = useState(null)
    const [lineEditForm, setLineEditForm] = useState(null)
    const [savingLine, setSavingLine] = useState(false)
    const [lineEditError, setLineEditError] = useState('')

    const [editingAgreementId, setEditingAgreementId] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const [editError, setEditError] = useState('')
    const [deletingAgreementId, setDeletingAgreementId] = useState(null)
    const [statusBusyId, setStatusBusyId] = useState(null)

    // Expiry and "ends in n days" are relative to the day the panel was opened.
    const [now] = useState(() => new Date())

    // Once the operator picks a quote for themselves — including clearing the field
    // back to "None" — the default must not fight them on the next render.
    const baseQuoteChosenByUser = useRef(false)

    const catalogOptions = useMemo(
        () => NDIS_SUPPORT_ITEMS.map(formatNdisSupportItemOption),
        []
    )
    const nextNumber = useMemo(() => nextAgreementSequence(agreements), [agreements])
    const quotesWithSupports = useMemo(
        () => (Array.isArray(quotes) ? quotes : []).filter((quote) => Number(quote?.item_count) > 0),
        [quotes]
    )
    // Quotes are listed newest first, so the first one carrying supports is the most
    // recent quote an agreement could formalise — the default the create form starts on.
    const defaultBaseQuoteId = useMemo(() => {
        const quoteId = quotesWithSupports[0]?.id
        return quoteId === undefined || quoteId === null ? '' : String(quoteId)
    }, [quotesWithSupports])
    const baseQuoteHint = defaultBaseQuoteId
        ? "Defaults to the most recent quote. Choosing one copies its supports onto the agreement's schedule and links the two; the quote is left untouched."
        : "Choosing a quote copies its supports onto the agreement's schedule and links the two. The quote is left untouched."

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    // Clearing the form also re-arms the quote default, so a form opened after an
    // agreement was created (or cancelled) starts from the most recent quote again.
    // The default is seeded here as well as in the effect below so a form opened after
    // the quotes have loaded never renders a frame with "None" selected.
    const resetAgreementForm = useCallback(() => {
        baseQuoteChosenByUser.current = false
        setNewAgreementForm({ ...createBlankAgreementForm(patientFunding), base_quote_id: defaultBaseQuoteId })
    }, [defaultBaseQuoteId, patientFunding])

    const refreshAgreements = useCallback(async () => {
        if (!canManage) return
        // Defer the busy flag so a mount effect doesn't synchronously cascade renders.
        await Promise.resolve()
        setAgreementsLoading(true)
        setAgreementsError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '200',
            })
            const data = await requestJson(`/api/database/service-agreements?${query.toString()}`, { cache: 'no-store' })
            setAgreements(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setAgreementsError(error?.message || 'Failed to load service agreements')
        } finally {
            setAgreementsLoading(false)
        }
    }, [canManage, domain, numericPatientId])

    // The patient's quotes are listed only to offer "base this agreement on a
    // quote" — a quote is the priced proposal an agreement formalises.
    const refreshQuotes = useCallback(async () => {
        if (!canManage) return
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '200',
            })
            const data = await requestJson(`/api/database/quotes?${query.toString()}`, { cache: 'no-store' })
            setQuotes(Array.isArray(data?.data) ? data.data : [])
        } catch {
            setQuotes([])
        }
    }, [canManage, domain, numericPatientId])

    const refreshItems = useCallback(async (agreementId) => {
        if (!agreementId || !domain) return
        setItemsLoadingAgreementId(agreementId)
        setItemsError('')
        try {
            const query = new URLSearchParams({ domain })
            const data = await requestJson(
                `/api/database/service-agreements/${encodeURIComponent(agreementId)}/items?${query.toString()}`,
                { cache: 'no-store' }
            )
            setItemsByAgreement((previous) => ({
                ...previous,
                [agreementId]: Array.isArray(data?.data) ? data.data : [],
            }))
        } catch (error) {
            setItemsError(error?.message || 'Failed to load the schedule of supports')
        } finally {
            setItemsLoadingAgreementId(null)
        }
    }, [domain])

    // The panel is rendered with a `key` per (domain, patient), so its state starts
    // fresh for every patient. This effect only fetches the initial lists.
    useEffect(() => {
        // Loading on mount is a deliberate external-data fetch (not a derived state
        // update); the rule below flags the loading-state setter inside refreshAgreements.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshAgreements()
        refreshQuotes()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // The patient header's "+ Add" menu opens straight into the create form. The
    // intent is single-shot, so it is reported as handled to keep a later visit to
    // this tab from reopening the form.
    useEffect(() => {
        if (!openCreate) return
        // Opening the form is the point of the intent, not a derived state update.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowCreateForm(true)
        baseQuoteChosenByUser.current = false
        onOpenCreateHandled?.()
    }, [openCreate, onOpenCreateHandled])

    // An agreement normally formalises the quote the participant has just accepted, so
    // the create form opens on the most recent quote rather than an empty schedule. The
    // quotes are fetched separately and can land after the form is open, so the default
    // is applied whenever the form is open and the list changes.
    useEffect(() => {
        if (!showCreateForm || baseQuoteChosenByUser.current) return
        setNewAgreementForm((previous) => (
            previous.base_quote_id === defaultBaseQuoteId
                ? previous
                : { ...previous, base_quote_id: defaultBaseQuoteId }
        ))
    }, [showCreateForm, defaultBaseQuoteId])

    const isExpanded = useCallback((agreementId) => expandedIds.includes(agreementId), [expandedIds])

    const toggleExpanded = useCallback(async (agreementRow) => {
        const agreementId = agreementRow?.id
        if (!agreementId) return

        if (isExpanded(agreementId)) {
            setExpandedIds((previous) => previous.filter((id) => id !== agreementId))
            return
        }
        setExpandedIds((previous) => [...previous, agreementId])
        await refreshItems(agreementId)
    }, [isExpanded, refreshItems])

    // Agreements are collapsed by default so a list of them stays scannable, but a
    // lone agreement has nothing to choose between, so it opens as soon as it
    // arrives. The ref keeps this to one automatic open per agreement, so collapsing
    // it by hand — or a later refresh — doesn't spring it back open.
    const autoOpenedAgreementId = useRef(null)
    useEffect(() => {
        if (agreements.length !== 1) return
        const onlyAgreement = agreements[0]
        const onlyAgreementId = onlyAgreement?.id
        if (!onlyAgreementId || autoOpenedAgreementId.current === onlyAgreementId) return
        autoOpenedAgreementId.current = onlyAgreementId
        if (isExpanded(onlyAgreementId)) return
        // Opening the only agreement is the point of the effect, not a derived state update.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        toggleExpanded(onlyAgreement)
    }, [agreements, isExpanded, toggleExpanded])

    const handleRefresh = useCallback(async () => {
        await refreshAgreements()
        await refreshQuotes()
    }, [refreshAgreements, refreshQuotes])

    const handleCreateAgreement = async (event) => {
        event.preventDefault()
        if (!canManage) return

        setCreating(true)
        setCreateError('')
        try {
            if (newAgreementForm.base_quote_id) {
                // Deriving from a quote copies its schedule onto the agreement and
                // links the two, so the same fields are not retyped.
                const data = await requestJson('/api/database/service-agreements/from-quote', {
                    method: 'POST',
                    body: JSON.stringify({
                        domain,
                        quote_id: newAgreementForm.base_quote_id,
                        plan_management_type: newAgreementForm.plan_management_type,
                        start_date: newAgreementForm.start_date,
                        end_date: newAgreementForm.end_date,
                        review_date: newAgreementForm.review_date,
                    }),
                })
                const copied = Number(data?.copiedItemCount || 0)
                flashNotice(`Service agreement ${data?.agreement?.agreement_number || ''} created from the quote with ${copied} support${copied === 1 ? '' : 's'}.`.trim())
            } else {
                const data = await requestJson('/api/database/service-agreements', {
                    method: 'POST',
                    body: JSON.stringify({
                        domain,
                        patient_id: numericPatientId,
                        agreement_number: newAgreementForm.agreement_number || null,
                        funding_type: newAgreementForm.funding_type,
                        plan_management_type: newAgreementForm.plan_management_type,
                        plan_manager: newAgreementForm.plan_manager || null,
                        ndis_number: newAgreementForm.ndis_number || null,
                        start_date: newAgreementForm.start_date,
                        end_date: newAgreementForm.end_date,
                        review_date: newAgreementForm.review_date,
                        prepared_by: newAgreementForm.prepared_by || null,
                        cancellation_notice_days: newAgreementForm.cancellation_notice_days,
                        cancellation_policy: newAgreementForm.cancellation_policy || null,
                        terms: newAgreementForm.terms || null,
                        notes: newAgreementForm.notes || null,
                    }),
                })
                flashNotice(`Service agreement ${data?.agreement?.agreement_number || ''} created.`.trim())
            }

            setShowCreateForm(false)
            resetAgreementForm()
            await refreshAgreements()
            await refreshQuotes()
        } catch (error) {
            setCreateError(error?.message || 'Failed to create the service agreement')
        } finally {
            setCreating(false)
        }
    }

    const handleDeleteAgreement = async (agreementRow) => {
        if (!agreementRow?.id) return
        const confirmed = window.confirm(`Delete service agreement ${agreementRow.agreement_number || ''}? This also removes its schedule of supports and cannot be undone.`)
        if (!confirmed) return

        setDeletingAgreementId(agreementRow.id)
        setAgreementsError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(
                `/api/database/service-agreements/${encodeURIComponent(agreementRow.id)}?${query.toString()}`,
                { method: 'DELETE' }
            )
            flashNotice('Service agreement deleted.')
            setExpandedIds((previous) => previous.filter((id) => id !== agreementRow.id))
            setItemsByAgreement((previous) => {
                const next = { ...previous }
                delete next[agreementRow.id]
                return next
            })
            await refreshAgreements()
        } catch (error) {
            setAgreementsError(error?.message || 'Failed to delete the service agreement')
        } finally {
            setDeletingAgreementId(null)
        }
    }

    const patchAgreement = useCallback(async (agreementRow, body) => {
        if (!agreementRow?.id) return
        const query = new URLSearchParams({ domain })
        await requestJson(
            `/api/database/service-agreements/${encodeURIComponent(agreementRow.id)}?${query.toString()}`,
            { method: 'PATCH', body: JSON.stringify(body) }
        )
    }, [domain])

    const handleStatusChange = async (agreementRow, status, successMessage) => {
        if (!agreementRow?.id) return
        setStatusBusyId(agreementRow.id)
        setAgreementsError('')
        try {
            const body = { status }
            // Ending an agreement stamps when it ended; reopening clears the stamp.
            if (status === 'terminated') body.terminated_at = 'now'
            if (status === 'draft' || status === 'sent' || status === 'active') body.terminated_at = null
            await patchAgreement(agreementRow, body)
            flashNotice(successMessage)
            await refreshAgreements()
        } catch (error) {
            setAgreementsError(error?.message || 'Failed to update the service agreement')
        } finally {
            setStatusBusyId(null)
        }
    }

    /**
     * Records a signature for one side and, once both the participant side and the
     * provider have signed, advances the agreement to active — the agreement only
     * governs delivery once both parties have put their name to it.
     */
    const handleSign = async (agreementRow, side) => {
        if (!agreementRow?.id) return
        setStatusBusyId(agreementRow.id)
        setAgreementsError('')
        try {
            const signatures = resolveSignatureState(agreementRow)
            const body = {}

            if (side === 'provider') {
                body.provider_signed_at = 'now'
                if (!agreementRow.provider_signatory_name && agreementRow.prepared_by) {
                    body.provider_signatory_name = agreementRow.prepared_by
                }
            } else if (side === 'representative') {
                body.representative_signed_at = 'now'
            } else {
                body.participant_signed_at = 'now'
                if (!agreementRow.participant_signatory_name && patientName) {
                    body.participant_signatory_name = patientName
                }
            }

            const willBeFullySigned = side === 'provider'
                ? signatures.participantSideSigned
                : signatures.providerSigned
            const currentStatus = deriveServiceAgreementStatus(agreementRow)
            if (willBeFullySigned && (currentStatus === 'draft' || currentStatus === 'sent')) {
                body.status = 'active'
            }

            await patchAgreement(agreementRow, body)
            flashNotice(willBeFullySigned ? 'Signature recorded — the agreement is now active.' : 'Signature recorded.')
            await refreshAgreements()
        } catch (error) {
            setAgreementsError(error?.message || 'Failed to record the signature')
        } finally {
            setStatusBusyId(null)
        }
    }

    const startEditingAgreement = (agreementRow) => {
        setEditingAgreementId(agreementRow.id)
        setEditError('')
        setEditForm({
            agreement_number: agreementRow.agreement_number || '',
            funding_type: agreementRow.funding_type || 'ndis',
            status: deriveServiceAgreementStatus(agreementRow),
            plan_management_type: agreementRow.plan_management_type || 'unknown',
            plan_manager: agreementRow.plan_manager || '',
            ndis_number: agreementRow.ndis_number || '',
            plan_start: agreementRow.plan_start || '',
            plan_end: agreementRow.plan_end || '',
            start_date: agreementRow.start_date || '',
            end_date: agreementRow.end_date || '',
            review_date: agreementRow.review_date || '',
            prepared_by: agreementRow.prepared_by || '',
            cancellation_notice_days: String(agreementRow.cancellation_notice_days ?? DEFAULT_CANCELLATION_NOTICE_DAYS),
            cancellation_policy: agreementRow.cancellation_policy || '',
            telehealth_authorised: Boolean(agreementRow.telehealth_authorised),
            non_face_to_face_authorised: Boolean(agreementRow.non_face_to_face_authorised),
            travel_claimable: Boolean(agreementRow.travel_claimable),
            terms: agreementRow.terms || '',
            participant_signatory_name: agreementRow.participant_signatory_name || '',
            representative_name: agreementRow.representative_name || '',
            representative_relationship: agreementRow.representative_relationship || '',
            provider_signatory_name: agreementRow.provider_signatory_name || '',
            termination_reason: agreementRow.termination_reason || '',
            notes: agreementRow.notes || '',
        })
        setExpandedIds((previous) => (previous.includes(agreementRow.id) ? previous : [...previous, agreementRow.id]))
    }

    const handleSaveAgreement = async (event, agreementRow) => {
        event.preventDefault()
        if (!agreementRow?.id || !editForm) return

        setSavingEdit(true)
        setEditError('')
        try {
            await patchAgreement(agreementRow, {
                agreement_number: editForm.agreement_number || null,
                funding_type: editForm.funding_type,
                status: editForm.status,
                plan_management_type: editForm.plan_management_type,
                plan_manager: editForm.plan_manager || null,
                ndis_number: editForm.ndis_number || null,
                plan_start: editForm.plan_start || null,
                plan_end: editForm.plan_end || null,
                start_date: editForm.start_date || null,
                end_date: editForm.end_date || null,
                review_date: editForm.review_date || null,
                prepared_by: editForm.prepared_by || null,
                cancellation_notice_days: editForm.cancellation_notice_days,
                cancellation_policy: editForm.cancellation_policy || null,
                telehealth_authorised: Boolean(editForm.telehealth_authorised),
                non_face_to_face_authorised: Boolean(editForm.non_face_to_face_authorised),
                travel_claimable: Boolean(editForm.travel_claimable),
                terms: editForm.terms || null,
                participant_signatory_name: editForm.participant_signatory_name || null,
                representative_name: editForm.representative_name || null,
                representative_relationship: editForm.representative_relationship || null,
                provider_signatory_name: editForm.provider_signatory_name || null,
                termination_reason: editForm.termination_reason || null,
                notes: editForm.notes || null,
            })
            flashNotice('Service agreement updated.')
            setEditingAgreementId(null)
            setEditForm(null)
            await refreshAgreements()
        } catch (error) {
            setEditError(error?.message || 'Failed to update the service agreement')
        } finally {
            setSavingEdit(false)
        }
    }

    /**
     * Choosing an NDIS support item fills in its catalogue identity, unit,
     * "quote required" flag and the price limit for the agreement's region, and
     * pre-fills the price with that limit (the maximum a provider may charge an
     * NDIA- or plan-managed participant).
     */
    const applyCatalogueSelection = (form, rawValue, region) => {
        const item = resolveNdisSupportItemSelection(rawValue)
        if (!item) {
            return { ...form, support_item: rawValue, ndis_support_item_name: '', unit: form.unit || 'H', price_limit: '', quote_required: false }
        }

        const line = buildNdisQuoteLine({ itemNumber: item.number, region })
        return {
            ...form,
            support_item: formatNdisSupportItemOption(item),
            ndis_support_item_name: line.ndis_support_item_name,
            registration_group_number: line.registration_group_number,
            registration_group_name: line.registration_group_name,
            support_category_number: line.support_category_number,
            support_category_name: line.support_category_name,
            unit: line.unit,
            price_limit: line.price_limit === null ? '' : String(line.price_limit),
            unit_price: line.price_limit === null ? form.unit_price : String(line.price_limit),
            quote_required: line.quote_required,
        }
    }

    const updateLineForm = (agreementId, field, value, region) => {
        setLineForms((previous) => {
            const current = previous[agreementId] || createBlankSupportForm()
            const next = field === 'support_item'
                ? applyCatalogueSelection(current, value, region)
                : { ...current, [field]: value }
            return { ...previous, [agreementId]: next }
        })
    }

    const buildSupportPayload = (form) => ({
        quantity: Number(form.quantity),
        unit_price: form.unit_price === '' ? 0 : Number(form.unit_price),
        price_limit: form.price_limit === '' ? null : Number(form.price_limit),
        ndis_support_item_number: resolveNdisSupportItemSelection(form.support_item)?.number || null,
        ndis_support_item_name: form.ndis_support_item_name || null,
        registration_group_number: form.registration_group_number || null,
        registration_group_name: form.registration_group_name || null,
        support_category_number: form.support_category_number || null,
        support_category_name: form.support_category_name || null,
        unit: form.unit || null,
        quote_required: Boolean(form.quote_required),
        description: form.description || null,
    })

    const handleAddLine = async (event, agreementRow) => {
        event.preventDefault()
        if (!agreementRow?.id) return

        const form = lineForms[agreementRow.id] || createBlankSupportForm()
        const quantity = Number(form.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setLineAddError('Quantity must be greater than zero.')
            return
        }
        if (!String(form.ndis_support_item_name || '').trim() && !String(form.description || '').trim()) {
            setLineAddError('Choose an NDIS support item or describe what the support covers.')
            return
        }

        setAddingLineAgreementId(agreementRow.id)
        setLineAddError('')
        try {
            await requestJson(`/api/database/service-agreements/${encodeURIComponent(agreementRow.id)}/items`, {
                method: 'POST',
                body: JSON.stringify({ domain, ...buildSupportPayload(form) }),
            })
            flashNotice('Support added to the schedule.')
            setLineForms((previous) => ({ ...previous, [agreementRow.id]: createBlankSupportForm() }))
            await refreshItems(agreementRow.id)
            await refreshAgreements()
        } catch (error) {
            setLineAddError(error?.message || 'Failed to add the support')
        } finally {
            setAddingLineAgreementId(null)
        }
    }

    const startEditingLine = (agreementId, item) => {
        setEditingLineKey(`${agreementId}:${item.id}`)
        setLineEditError('')
        setLineEditForm({
            support_item: item.ndis_support_item_number
                ? `${item.ndis_support_item_number} — ${item.ndis_support_item_name || ''}`.trim()
                : '',
            ndis_support_item_name: item.ndis_support_item_name || '',
            registration_group_number: item.registration_group_number || '',
            registration_group_name: item.registration_group_name || '',
            support_category_number: item.support_category_number || '',
            support_category_name: item.support_category_name || '',
            unit: item.unit || 'H',
            quantity: String(item.quantity ?? ''),
            unit_price: item.unit_price === null || item.unit_price === undefined ? '' : String(item.unit_price),
            price_limit: item.price_limit === null || item.price_limit === undefined ? '' : String(item.price_limit),
            quote_required: Boolean(item.quote_required),
            description: item.description || '',
        })
    }

    const cancelEditingLine = () => {
        setEditingLineKey(null)
        setLineEditForm(null)
        setLineEditError('')
    }

    const handleSaveLine = async (event, agreementRow, item) => {
        event.preventDefault()
        if (!agreementRow?.id || !item?.id || !lineEditForm) return

        const quantity = Number(lineEditForm.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setLineEditError('Quantity must be greater than zero.')
            return
        }

        setSavingLine(true)
        setLineEditError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(
                `/api/database/service-agreements/${encodeURIComponent(agreementRow.id)}/items/${encodeURIComponent(item.id)}?${query.toString()}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        ...buildSupportPayload(lineEditForm),
                        // Retain the existing catalogue number when the free-text
                        // box no longer resolves to a catalogue item.
                        ndis_support_item_number: resolveNdisSupportItemSelection(lineEditForm.support_item)?.number
                            || item.ndis_support_item_number
                            || null,
                    }),
                }
            )
            flashNotice('Support updated.')
            cancelEditingLine()
            await refreshItems(agreementRow.id)
            await refreshAgreements()
        } catch (error) {
            setLineEditError(error?.message || 'Failed to update the support')
        } finally {
            setSavingLine(false)
        }
    }

    const handleDeleteLine = async (agreementRow, item) => {
        if (!agreementRow?.id || !item?.id) return
        const confirmed = window.confirm('Remove this support from the schedule? This action cannot be undone.')
        if (!confirmed) return

        const key = `${agreementRow.id}:${item.id}`
        setDeletingLineKey(key)
        setItemsError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(
                `/api/database/service-agreements/${encodeURIComponent(agreementRow.id)}/items/${encodeURIComponent(item.id)}?${query.toString()}`,
                { method: 'DELETE' }
            )
            flashNotice('Support removed.')
            await refreshItems(agreementRow.id)
            await refreshAgreements()
        } catch (error) {
            setItemsError(error?.message || 'Failed to remove the support')
        } finally {
            setDeletingLineKey(null)
        }
    }

    if (!canManage) {
        return (
            <section className="space-y-3">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Save the patient first, then you can prepare service agreements here.
                </p>
            </section>
        )
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Service agreements</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        The signed contract governing ongoing supports for {String(domainDisplayName || domain || '').trim() || 'this patient'} —
                        what is provided, how it is funded and paid, the cancellation and notice terms, and consent to claim
                        non-face-to-face work. A quote is the priced proposal; an agreement is what the participant signs before delivery starts.
                        Agreements run for the plan period, so a new plan means a new agreement.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={agreementsLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {agreementsLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowCreateForm((previous) => !previous)
                            setCreateError('')
                            if (!showCreateForm) resetAgreementForm()
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                        {showCreateForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {showCreateForm ? 'Cancel' : 'New agreement'}
                    </button>
                </div>
            </div>

            <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                {NDIS_PRICE_LIMIT_NOTE}{' '}
                <a className="text-blue-700 underline-offset-2 hover:underline" href={NDIS_PRICING_ARRANGEMENTS_URL} target="_blank" rel="noreferrer">Pricing arrangements</a>{' '}
                and the{' '}
                <a className="text-blue-700 underline-offset-2 hover:underline" href={NDIS_SUPPORT_CATALOGUE_URL} target="_blank" rel="noreferrer">support catalogue</a>{' '}
                ({NDIS_CATALOGUE_PERIOD}, effective {NDIS_CATALOGUE_EFFECTIVE_FROM}).
            </p>

            {notice && (
                <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {notice.message}
                </p>
            )}
            {agreementsError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{agreementsError}</p>
            )}

            {showCreateForm && (
                <form onSubmit={handleCreateAgreement} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">New service agreement</h4>
                        {creating && <p className="text-xs text-gray-500">Creating…</p>}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="block md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Base on an existing quote</span>
                            <select
                                value={newAgreementForm.base_quote_id}
                                onChange={(event) => {
                                    baseQuoteChosenByUser.current = true
                                    const value = event.target.value
                                    setNewAgreementForm((previous) => ({ ...previous, base_quote_id: value }))
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="">None — start with an empty schedule</option>
                                {quotesWithSupports.map((quote) => (
                                    <option key={quote.id} value={quote.id}>
                                        {quote.quote_number || `Quote #${quote.id}`} · {quote.item_count} support{Number(quote.item_count) === 1 ? '' : 's'} · {formatCurrency(quote.total)}
                                    </option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-gray-400">
                                {baseQuoteHint}
                            </span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Agreement number</span>
                            <input
                                type="text"
                                value={newAgreementForm.agreement_number}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, agreement_number: event.target.value }))}
                                disabled={Boolean(newAgreementForm.base_quote_id)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder={newAgreementForm.base_quote_id ? 'Auto' : `Auto (e.g. ${formatAgreementNumberPreview(nextNumber)})`}
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Funding</span>
                            <select
                                value={newAgreementForm.funding_type}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, funding_type: event.target.value }))}
                                disabled={Boolean(newAgreementForm.base_quote_id)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                            >
                                {FUNDING_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Plan management</span>
                            <select
                                value={newAgreementForm.plan_management_type}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, plan_management_type: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {PLAN_MANAGEMENT_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-gray-400">
                                Price limits only bind NDIA-managed and plan-managed participants.
                            </span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Plan manager</span>
                            <input
                                type="text"
                                value={newAgreementForm.plan_manager}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, plan_manager: event.target.value }))}
                                disabled={Boolean(newAgreementForm.base_quote_id)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder="Plan manager or self-managed"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">{referenceLabelForAgreement(newAgreementForm.funding_type)}</span>
                            <input
                                type="text"
                                value={newAgreementForm.ndis_number}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, ndis_number: event.target.value }))}
                                disabled={Boolean(newAgreementForm.base_quote_id)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                            />
                            <span className="mt-1 block text-[11px] text-gray-400">
                                {patientFunding.referenceNumber
                                    ? `The patient’s Info tab records ${patientFunding.referenceNumber}.`
                                    : 'Not recorded on this patient’s Info tab.'}
                            </span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Start date</span>
                            <input
                                type="date"
                                value={newAgreementForm.start_date}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, start_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">End date</span>
                            <input
                                type="date"
                                value={newAgreementForm.end_date}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, end_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Review date</span>
                            <input
                                type="date"
                                value={newAgreementForm.review_date}
                                onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, review_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-[11px] text-gray-400">Reminders surface from this date.</span>
                        </label>
                        {!newAgreementForm.base_quote_id && (
                            <>
                                <label className="block">
                                    <span className="text-xs font-medium text-gray-700">Prepared by</span>
                                    <input
                                        type="text"
                                        value={newAgreementForm.prepared_by}
                                        onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, prepared_by: event.target.value }))}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-medium text-gray-700">Cancellation notice (days)</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={newAgreementForm.cancellation_notice_days}
                                        onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, cancellation_notice_days: event.target.value }))}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    />
                                    <span className="mt-1 block text-[11px] text-gray-400">NDIS default is 2 clear business days.</span>
                                </label>
                                <label className="block md:col-span-3">
                                    <span className="text-xs font-medium text-gray-700">Cancellation policy</span>
                                    <textarea
                                        rows={2}
                                        value={newAgreementForm.cancellation_policy}
                                        onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, cancellation_policy: event.target.value }))}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder={`Short-notice cancellations (less than ${newAgreementForm.cancellation_notice_days || DEFAULT_CANCELLATION_NOTICE_DAYS} clear business days) may be charged in line with the NDIS pricing arrangements.`}
                                    />
                                </label>
                                <label className="block md:col-span-3">
                                    <span className="text-xs font-medium text-gray-700">Terms and responsibilities</span>
                                    <textarea
                                        rows={3}
                                        value={newAgreementForm.terms}
                                        onChange={(event) => setNewAgreementForm((previous) => ({ ...previous, terms: event.target.value }))}
                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="Scope of service, responsibilities of each party, complaints and dispute resolution, review and how either party ends the agreement."
                                    />
                                </label>
                            </>
                        )}
                    </div>
                    {createError && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="submit"
                            disabled={creating}
                            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Check className="h-3.5 w-3.5" />
                            {creating ? 'Creating…' : 'Create agreement'}
                        </button>
                    </div>
                </form>
            )}

            {agreementsLoading && agreements.length === 0 && (
                <p className="text-sm text-gray-500">Loading service agreements…</p>
            )}
            {!agreementsLoading && agreements.length === 0 && !showCreateForm && (
                <p className="rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
                    No service agreements yet. Create one, or derive it from an accepted quote.
                </p>
            )}

            {agreements.map((agreementRow) => {
                const metrics = buildServiceAgreementMetrics(agreementRow, now)
                const expanded = isExpanded(agreementRow.id)
                const editingThisAgreement = editingAgreementId === agreementRow.id
                const supports = itemsByAgreement[agreementRow.id] || []
                const supportsLoading = itemsLoadingAgreementId === agreementRow.id
                const lineForm = lineForms[agreementRow.id] || createBlankSupportForm()
                const totals = computeServiceAgreementTotals(supports)
                const ended = ['terminated', 'superseded'].includes(metrics.status)

                return (
                    <div key={agreementRow.id} className="rounded-md border border-gray-200">
                        <div className="flex flex-wrap items-start justify-between gap-3 p-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleExpanded(agreementRow)}
                                        className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900 hover:text-gray-600"
                                    >
                                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        {agreementRow.agreement_number || `Agreement #${agreementRow.id}`}
                                    </button>
                                    <StatusPill status={metrics.status} />
                                    <FundingBadge fundingType={agreementRow.funding_type} />
                                    <PlanManagementBadge planManagementType={agreementRow.plan_management_type} />
                                    <SignatureBadge signatures={metrics.signatures} />
                                    <AttentionPill attention={metrics.attention} />
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    {metrics.itemCount > 0
                                        ? `${metrics.itemCount} support${metrics.itemCount === 1 ? '' : 's'} · ${formatCurrency(metrics.subtotal)}`
                                        : 'No supports listed yet'}
                                    {' • '}
                                    {formatDisplayDate(agreementRow.start_date)} → {formatDisplayDate(agreementRow.end_date)}
                                    {agreementRow.review_date ? ` • review ${formatDisplayDate(agreementRow.review_date)}` : ''}
                                    {agreementRow.source_quote_id ? ' • from a quote' : ''}
                                </p>
                                {(agreementRow.plan_manager || agreementRow.ndis_number) && (
                                    <p className="mt-0.5 text-xs text-gray-400">
                                        {agreementRow.plan_manager ? `Plan manager: ${agreementRow.plan_manager}` : ''}
                                        {agreementRow.plan_manager && agreementRow.ndis_number ? ' • ' : ''}
                                        {agreementRow.ndis_number ? `${referenceLabelForAgreement(agreementRow.funding_type)}: ${agreementRow.ndis_number}` : ''}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {metrics.status === 'draft' && (
                                    <button
                                        type="button"
                                        onClick={() => handleStatusChange(agreementRow, 'sent', 'Agreement marked as sent for signature.')}
                                        disabled={statusBusyId === agreementRow.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                                    >
                                        <Send className="h-3 w-3" />
                                        Send
                                    </button>
                                )}
                                {!ended && !metrics.signatures.providerSigned && (
                                    <button
                                        type="button"
                                        onClick={() => handleSign(agreementRow, 'provider')}
                                        disabled={statusBusyId === agreementRow.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                    >
                                        <Pencil className="h-3 w-3" />
                                        Provider signed
                                    </button>
                                )}
                                {!ended && !metrics.signatures.participantSideSigned && (
                                    <button
                                        type="button"
                                        onClick={() => handleSign(agreementRow, 'participant')}
                                        disabled={statusBusyId === agreementRow.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                    >
                                        <Pencil className="h-3 w-3" />
                                        Participant signed
                                    </button>
                                )}
                                {metrics.status === 'active' && (
                                    <button
                                        type="button"
                                        onClick={() => handleStatusChange(agreementRow, 'terminated', 'Agreement terminated.')}
                                        disabled={statusBusyId === agreementRow.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                                    >
                                        <Ban className="h-3 w-3" />
                                        Terminate
                                    </button>
                                )}
                                {ended && (
                                    <button
                                        type="button"
                                        onClick={() => handleStatusChange(agreementRow, 'draft', 'Agreement reopened as a draft.')}
                                        disabled={statusBusyId === agreementRow.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                    >
                                        <RotateCcw className="h-3 w-3" />
                                        Reopen
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => (editingThisAgreement ? (setEditingAgreementId(null), setEditForm(null)) : startEditingAgreement(agreementRow))}
                                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    <Pencil className="h-3 w-3" />
                                    {editingThisAgreement ? 'Close' : 'Edit'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteAgreement(agreementRow)}
                                    disabled={deletingAgreementId === agreementRow.id}
                                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {deletingAgreementId === agreementRow.id ? 'Deleting…' : 'Delete'}
                                </button>
                            </div>
                        </div>

                        {expanded && (
                            <div className="space-y-3 border-t border-gray-200 p-3">
                                {itemsError && (
                                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{itemsError}</p>
                                )}

                                {editingThisAgreement ? (
                                    <form onSubmit={(event) => handleSaveAgreement(event, agreementRow)} className="rounded-md border border-gray-200 p-3">
                                        <h5 className="text-sm font-semibold text-gray-900">Edit agreement</h5>
                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Agreement number</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.agreement_number || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, agreement_number: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Funding</span>
                                                <select
                                                    value={editForm?.funding_type || 'ndis'}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, funding_type: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {FUNDING_TYPE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Status</span>
                                                <select
                                                    value={editForm?.status || metrics.status}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, status: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {SERVICE_AGREEMENT_STATUS_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Plan management</span>
                                                <select
                                                    value={editForm?.plan_management_type || 'unknown'}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, plan_management_type: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {PLAN_MANAGEMENT_TYPE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Plan manager</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.plan_manager || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, plan_manager: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">{referenceLabelForAgreement(editForm?.funding_type)}</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.ndis_number || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, ndis_number: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Plan start</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.plan_start || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, plan_start: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Plan end</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.plan_end || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, plan_end: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Prepared by</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.prepared_by || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, prepared_by: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Agreement start</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.start_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, start_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Agreement end</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.end_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, end_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Review date</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.review_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, review_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Cancellation notice (days)</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm?.cancellation_notice_days ?? ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, cancellation_notice_days: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Cancellation policy</span>
                                                <textarea
                                                    rows={2}
                                                    value={editForm?.cancellation_policy || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, cancellation_policy: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <div className="md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Claimable activities pre-authorised</span>
                                                <div className="mt-1 flex flex-wrap gap-4">
                                                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(editForm?.telehealth_authorised)}
                                                            onChange={(event) => setEditForm((previous) => ({ ...previous, telehealth_authorised: event.target.checked }))}
                                                            className="h-4 w-4 rounded border-gray-300"
                                                        />
                                                        Telehealth
                                                    </label>
                                                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(editForm?.non_face_to_face_authorised)}
                                                            onChange={(event) => setEditForm((previous) => ({ ...previous, non_face_to_face_authorised: event.target.checked }))}
                                                            className="h-4 w-4 rounded border-gray-300"
                                                        />
                                                        Non-face-to-face supports
                                                    </label>
                                                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(editForm?.travel_claimable)}
                                                            onChange={(event) => setEditForm((previous) => ({ ...previous, travel_claimable: event.target.checked }))}
                                                            className="h-4 w-4 rounded border-gray-300"
                                                        />
                                                        Provider travel
                                                    </label>
                                                </div>
                                            </div>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Terms and responsibilities</span>
                                                <textarea
                                                    rows={3}
                                                    value={editForm?.terms || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, terms: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Participant signatory</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.participant_signatory_name || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, participant_signatory_name: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                                <span className="mt-1 block text-[11px] text-gray-400">
                                                    {agreementRow.participant_signed_at ? `Signed ${formatDisplayDate(agreementRow.participant_signed_at.slice(0, 10))}` : 'Not yet signed'}
                                                </span>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Representative</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.representative_name || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, representative_name: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="If signing on the participant’s behalf"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Representative relationship</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.representative_relationship || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, representative_relationship: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="e.g. Parent, Guardian"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Provider signatory</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.provider_signatory_name || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, provider_signatory_name: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                                <span className="mt-1 block text-[11px] text-gray-400">
                                                    {agreementRow.provider_signed_at ? `Signed ${formatDisplayDate(agreementRow.provider_signed_at.slice(0, 10))}` : 'Not yet signed'}
                                                </span>
                                            </label>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Termination reason</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.termination_reason || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, termination_reason: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="Only needed when the agreement is terminated early"
                                                />
                                            </label>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Notes</span>
                                                <textarea
                                                    rows={2}
                                                    value={editForm?.notes || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, notes: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                        </div>
                                        {editError && (
                                            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
                                        )}
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <button
                                                type="submit"
                                                disabled={savingEdit}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Check className="h-3.5 w-3.5" />
                                                {savingEdit ? 'Saving…' : 'Save changes'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setEditingAgreementId(null); setEditForm(null); setEditError('') }}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                Cancel
                                            </button>
                                            {!metrics.signatures.representativeSigned && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSign(agreementRow, 'representative')}
                                                    disabled={statusBusyId === agreementRow.id}
                                                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    Record representative signature
                                                </button>
                                            )}
                                        </div>
                                    </form>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        {(agreementRow.cancellation_policy || agreementRow.terms || agreementRow.notes) && (
                                            <div className="rounded-md border border-gray-200 p-3 text-xs text-gray-600">
                                                {agreementRow.cancellation_policy && (
                                                    <p><span className="font-semibold text-gray-700">Cancellation:</span> {agreementRow.cancellation_policy}</p>
                                                )}
                                                {agreementRow.terms && (
                                                    <p className="mt-1"><span className="font-semibold text-gray-700">Terms:</span> {agreementRow.terms}</p>
                                                )}
                                                {agreementRow.notes && (
                                                    <p className="mt-1"><span className="font-semibold text-gray-700">Notes:</span> {agreementRow.notes}</p>
                                                )}
                                            </div>
                                        )}
                                        <div className="rounded-md border border-gray-200 p-3 text-xs text-gray-600">
                                            <p className="font-semibold text-gray-700">Pre-authorised activities</p>
                                            <ul className="mt-1 space-y-0.5">
                                                <li className={agreementRow.telehealth_authorised ? 'text-emerald-700' : 'text-gray-400'}>
                                                    {agreementRow.telehealth_authorised ? '✓' : '✕'} Telehealth
                                                </li>
                                                <li className={agreementRow.non_face_to_face_authorised ? 'text-emerald-700' : 'text-gray-400'}>
                                                    {agreementRow.non_face_to_face_authorised ? '✓' : '✕'} Non-face-to-face supports
                                                </li>
                                                <li className={agreementRow.travel_claimable ? 'text-emerald-700' : 'text-gray-400'}>
                                                    {agreementRow.travel_claimable ? '✓' : '✕'} Provider travel
                                                </li>
                                            </ul>
                                            {agreementRow.termination_reason && (
                                                <p className="mt-2 text-gray-500">Ended: {agreementRow.termination_reason}</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-md border border-gray-200 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h5 className="text-sm font-semibold text-gray-900">Schedule of supports</h5>
                                        {supportsLoading ? (
                                            <p className="text-xs text-gray-500">Loading…</p>
                                        ) : supports.length > 0 ? (
                                            <p className="text-xs text-gray-500">
                                                {totals.itemCount} support{totals.itemCount === 1 ? '' : 's'} · {formatCurrency(totals.subtotal)}
                                                {totals.overLimitCount > 0 ? ` · ${totals.overLimitCount} above the price limit` : ''}
                                            </p>
                                        ) : null}
                                    </div>

                                    {supports.length > 0 && (
                                        <ul className="mt-3 space-y-2">
                                            {supports.map((item) => {
                                                const lineKey = `${agreementRow.id}:${item.id}`
                                                const editingThisLine = editingLineKey === lineKey
                                                const unitMeta = getNdisSupportUnit(item.unit)

                                                return (
                                                    <li key={item.id} className="rounded-md border border-gray-200 p-2">
                                                        {editingThisLine && lineEditForm ? (
                                                            <form onSubmit={(event) => handleSaveLine(event, agreementRow, item)} className="space-y-2">
                                                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                                                    <label className="block md:col-span-2">
                                                                        <span className="text-[11px] font-medium text-gray-700">NDIS support item</span>
                                                                        <input
                                                                            type="text"
                                                                            list={`agreement-support-items-${agreementRow.id}`}
                                                                            value={lineEditForm.support_item}
                                                                            onChange={(event) => setLineEditForm((previous) => applyCatalogueSelection(previous, event.target.value, DEFAULT_NDIS_PRICING_REGION))}
                                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                        />
                                                                    </label>
                                                                    <label className="block">
                                                                        <span className="text-[11px] font-medium text-gray-700">Quantity ({unitMeta.plural})</span>
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            min="0"
                                                                            value={lineEditForm.quantity}
                                                                            onChange={(event) => setLineEditForm((previous) => ({ ...previous, quantity: event.target.value }))}
                                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                        />
                                                                    </label>
                                                                    <label className="block">
                                                                        <span className="text-[11px] font-medium text-gray-700">Unit price</span>
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            min="0"
                                                                            value={lineEditForm.unit_price}
                                                                            onChange={(event) => setLineEditForm((previous) => ({ ...previous, unit_price: event.target.value }))}
                                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                        />
                                                                    </label>
                                                                    <label className="block">
                                                                        <span className="text-[11px] font-medium text-gray-700">Price limit</span>
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            min="0"
                                                                            value={lineEditForm.price_limit}
                                                                            onChange={(event) => setLineEditForm((previous) => ({ ...previous, price_limit: event.target.value }))}
                                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                        />
                                                                    </label>
                                                                    <label className="block md:col-span-3">
                                                                        <span className="text-[11px] font-medium text-gray-700">Description</span>
                                                                        <input
                                                                            type="text"
                                                                            value={lineEditForm.description}
                                                                            onChange={(event) => setLineEditForm((previous) => ({ ...previous, description: event.target.value }))}
                                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                        />
                                                                    </label>
                                                                </div>
                                                                {lineEditError && (
                                                                    <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{lineEditError}</p>
                                                                )}
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="submit"
                                                                        disabled={savingLine}
                                                                        className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                                                                    >
                                                                        <Check className="h-3 w-3" />
                                                                        {savingLine ? 'Saving…' : 'Save'}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={cancelEditingLine}
                                                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </form>
                                                        ) : (
                                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-sm text-gray-900">
                                                                        {item.ndis_support_item_name || item.description || 'Support'}
                                                                    </p>
                                                                    {item.ndis_support_item_number && (
                                                                        <p className="text-[11px] text-gray-400">{item.ndis_support_item_number}</p>
                                                                    )}
                                                                    {item.description && item.ndis_support_item_name && (
                                                                        <p className="mt-0.5 text-xs text-gray-600">{item.description}</p>
                                                                    )}
                                                                    <p className="mt-0.5 text-[11px] text-gray-500">
                                                                        {item.quantity} {Number(item.quantity) === 1 ? unitMeta.label : unitMeta.plural}
                                                                        {' @ '}{formatCurrency(item.unit_price)}
                                                                        {' = '}{formatCurrency(item.line_total)}
                                                                    </p>
                                                                    <PriceLimitNote item={item} region={DEFAULT_NDIS_PRICING_REGION} />
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => startEditingLine(agreementRow.id, item)}
                                                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                                                    >
                                                                        <Pencil className="h-3 w-3" />
                                                                        Edit
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleDeleteLine(agreementRow, item)}
                                                                        disabled={deletingLineKey === lineKey}
                                                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                                                                    >
                                                                        <Trash2 className="h-3 w-3" />
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}

                                    <form onSubmit={(event) => handleAddLine(event, agreementRow)} className="mt-3 rounded-md border border-dashed border-gray-300 p-3">
                                        <p className="text-xs font-semibold text-gray-700">Add a support</p>
                                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                                            <label className="block md:col-span-2">
                                                <span className="text-[11px] font-medium text-gray-700">NDIS support item</span>
                                                <input
                                                    type="text"
                                                    list={`agreement-support-items-${agreementRow.id}`}
                                                    value={lineForm.support_item}
                                                    onChange={(event) => updateLineForm(agreementRow.id, 'support_item', event.target.value, DEFAULT_NDIS_PRICING_REGION)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="Search the catalogue, or describe below"
                                                />
                                                <datalist id={`agreement-support-items-${agreementRow.id}`}>
                                                    {catalogOptions.map((option) => (
                                                        <option key={option} value={option} />
                                                    ))}
                                                </datalist>
                                            </label>
                                            <label className="block">
                                                <span className="text-[11px] font-medium text-gray-700">Quantity</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={lineForm.quantity}
                                                    onChange={(event) => updateLineForm(agreementRow.id, 'quantity', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-[11px] font-medium text-gray-700">Unit price</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={lineForm.unit_price}
                                                    onChange={(event) => updateLineForm(agreementRow.id, 'unit_price', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block md:col-span-4">
                                                <span className="text-[11px] font-medium text-gray-700">Description</span>
                                                <input
                                                    type="text"
                                                    value={lineForm.description}
                                                    onChange={(event) => updateLineForm(agreementRow.id, 'description', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="What this support covers"
                                                />
                                            </label>
                                        </div>
                                        {lineForm.quote_required && (
                                            <p className="mt-2 text-[11px] text-amber-700">
                                                The NDIS requires this support to be quoted rather than paid at a price limit.
                                            </p>
                                        )}
                                        {lineAddError && (
                                            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{lineAddError}</p>
                                        )}
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <p className="text-[11px] text-gray-400">
                                                Changing the catalogue item sets the unit and the price limit for {normalizeNdisPricingRegion(DEFAULT_NDIS_PRICING_REGION)}.
                                            </p>
                                            <button
                                                type="submit"
                                                disabled={addingLineAgreementId === agreementRow.id}
                                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                            >
                                                <Plus className="h-3 w-3" />
                                                {addingLineAgreementId === agreementRow.id ? 'Adding…' : 'Add support'}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </section>
    )
}
