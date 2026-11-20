'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Ban,
    Check,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Send,
    Trash2,
    X,
} from 'lucide-react'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
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
    getNdisPriceLimit,
    getNdisSupportUnit,
    isNdisQuoteRequired,
    normalizeNdisPricingRegion,
    resolveNdisSupportItemSelection,
} from '@/lib/ndisSupportCatalogue'
import {
    DEFAULT_FUNDING_TYPE,
    DEFAULT_QUOTE_VALIDITY_DAYS,
    PATIENT_REFERENCE_NUMBER_LABEL,
    buildQuoteLineMetrics,
    computeQuoteTotals,
    isNdisFunding,
    referenceNumberLabelFor,
    resolvePatientFundingContext,
} from '@/lib/patientQuotes'
import { describeQuoteProvenanceBadge, isQuoteWriterQuote, isUnreviewedWorkerQuote } from '@/lib/workerProvenance'
import {
    FUNDING_TYPE_OPTIONS,
    QUOTE_STATUS_OPTIONS,
    STATUS_LABELS,
    STATUS_PILL_STYLES,
    buildQuoteMetrics,
    deriveQuoteStatus,
    formatCurrency,
    formatDisplayDate,
    formatQuoteNumberPreview,
} from '@/lib/patientQuoteDisplay'

function toLocalDateString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0))
    return toLocalDateString(next)
}

function createBlankQuoteForm(patientFunding = null) {
    const today = new Date()
    return {
        quote_number: '',
        // The funding scheme and the participant/claim number are captured once on
        // the patient's Info tab, so a new quote starts from those values.
        funding_type: patientFunding?.fundingType || DEFAULT_FUNDING_TYPE,
        pricing_region: DEFAULT_NDIS_PRICING_REGION,
        plan_manager: '',
        ndis_number: patientFunding?.referenceNumber || '',
        quote_date: toLocalDateString(today),
        valid_until: addDays(today, DEFAULT_QUOTE_VALIDITY_DAYS),
        prepared_by: '',
        gst_applicable: false,
        notes: '',
    }
}

function createBlankLineForm(unit = 'H') {
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

/** Highest QTE-nxx number already used, so the create form can preview the next one. */
function nextQuoteSequence(quotes) {
    let max = 0
    for (const quote of Array.isArray(quotes) ? quotes : []) {
        const match = /^QTE-(\d+)$/i.exec(String(quote?.quote_number || '').trim())
        if (match) max = Math.max(max, Number.parseInt(match[1], 10))
    }
    return max + 1
}

function StatusPill({ status }) {
    const key = status || 'draft'
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_PILL_STYLES[key] || STATUS_PILL_STYLES.draft}`}>
            {STATUS_LABELS[key] || String(key)}
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

/** Shows the NDIS price limit for a line and warns when the price is above it. */
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

export default function PatientQuotesPanel({
    patientId,
    patientName,
    domain,
    domainDisplayName,
    patientAnswers,
    patientLabelledAnswers,
    openCreate = false,
    onOpenCreateHandled,
    onWorkerContentChange,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    // The participant/claim number and the funding scheme live on the patient's
    // intake record (Info tab), so they are read once here and reused for every
    // quote rather than being retyped. A quote still stores its own copy, so a
    // sent quote keeps the number as at its issue date.
    const patientFunding = useMemo(
        () => resolvePatientFundingContext({ answers: patientAnswers, labelledAnswers: patientLabelledAnswers }),
        [patientAnswers, patientLabelledAnswers]
    )

    // One intake field carries the NDIS, TAC and WorkCover numbers, so the heading
    // follows the quote's funding scheme and falls back to the patient's.
    const referenceLabelForQuote = useCallback((fundingType) => referenceNumberLabelFor(
        isNdisFunding(fundingType) ? 'ndis' : (patientFunding.fundingSource || fundingType)
    ), [patientFunding.fundingSource])

    const [quotes, setQuotes] = useState([])
    const [quotesLoading, setQuotesLoading] = useState(false)
    const [quotesError, setQuotesError] = useState('')
    const [notice, setNotice] = useState(null)

    const [showCreateForm, setShowCreateForm] = useState(false)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState('')
    const [newQuoteForm, setNewQuoteForm] = useState(() => createBlankQuoteForm(patientFunding))

    const [expandedIds, setExpandedIds] = useState([])
    const [itemsByQuote, setItemsByQuote] = useState({})
    const [itemsLoadingQuoteId, setItemsLoadingQuoteId] = useState(null)
    const [itemsError, setItemsError] = useState('')

    const [lineForms, setLineForms] = useState({})
    const [addingLineQuoteId, setAddingLineQuoteId] = useState(null)
    const [lineAddError, setLineAddError] = useState('')
    const [deletingLineKey, setDeletingLineKey] = useState(null)

    const [editingLineKey, setEditingLineKey] = useState(null)
    const [lineEditForm, setLineEditForm] = useState(null)
    const [savingLine, setSavingLine] = useState(false)
    const [lineEditError, setLineEditError] = useState('')

    const [editingQuoteId, setEditingQuoteId] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const [editError, setEditError] = useState('')
    const [deletingQuoteId, setDeletingQuoteId] = useState(null)
    const [statusBusyId, setStatusBusyId] = useState(null)

    // Quote Writer (the AI worker that drafts priced quotes). `proposals`
    // holds lines suggested for an *existing* quote, which are only written when
    // the practitioner accepts them.
    const [workerBusy, setWorkerBusy] = useState(false)
    const [workerError, setWorkerError] = useState('')
    const [proposals, setProposals] = useState(null)
    const [insertingProposals, setInsertingProposals] = useState(false)

    // Expiry and "expires in n days" are relative to the day the panel was opened.
    const [now] = useState(() => new Date())

    const catalogOptions = useMemo(
        () => NDIS_SUPPORT_ITEMS.map(formatNdisSupportItemOption),
        []
    )
    const nextNumber = useMemo(() => nextQuoteSequence(quotes), [quotes])

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    const refreshQuotes = useCallback(async () => {
        if (!canManage) return
        // Defer the busy flag so a mount effect doesn't synchronously cascade renders.
        await Promise.resolve()
        setQuotesLoading(true)
        setQuotesError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '200',
            })
            const data = await requestJson(`/api/database/quotes?${query.toString()}`, { cache: 'no-store' })
            const rows = Array.isArray(data?.data) ? data.data : []
            setQuotes(rows)
            onWorkerContentChange?.(rows.some(isQuoteWriterQuote))
        } catch (error) {
            setQuotesError(error?.message || 'Failed to load quotes')
        } finally {
            setQuotesLoading(false)
        }
    }, [canManage, domain, numericPatientId, onWorkerContentChange])

    const refreshItems = useCallback(async (quoteId) => {
        if (!quoteId || !domain) return
        setItemsLoadingQuoteId(quoteId)
        setItemsError('')
        try {
            const query = new URLSearchParams({ domain })
            const data = await requestJson(`/api/database/quotes/${encodeURIComponent(quoteId)}/items?${query.toString()}`, { cache: 'no-store' })
            setItemsByQuote((previous) => ({
                ...previous,
                [quoteId]: Array.isArray(data?.data) ? data.data : [],
            }))
        } catch (error) {
            setItemsError(error?.message || 'Failed to load quote lines')
        } finally {
            setItemsLoadingQuoteId(null)
        }
    }, [domain])

    // The panel is rendered with a `key` per (domain, patient), so its state starts
    // fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // Loading on mount is a deliberate external-data fetch (not a derived state
        // update); the rule below flags the loading-state setter inside refreshQuotes.
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
        onOpenCreateHandled?.()
    }, [openCreate, onOpenCreateHandled])

    const isExpanded = useCallback((quoteId) => expandedIds.includes(quoteId), [expandedIds])

    const toggleExpanded = useCallback(async (quoteRow) => {
        const quoteId = quoteRow?.id
        if (!quoteId) return

        if (isExpanded(quoteId)) {
            setExpandedIds((previous) => previous.filter((id) => id !== quoteId))
            return
        }

        setExpandedIds((previous) => [...previous, quoteId])
        if (!(quoteId in itemsByQuote)) {
            await refreshItems(quoteId)
        }
    }, [isExpanded, itemsByQuote, refreshItems])

    // Quotes are collapsed by default so a list of them stays scannable, but a
    // lone quote has nothing to choose between, so it opens as soon as it arrives.
    // The ref keeps this to one automatic open per quote, so collapsing it by hand
    // — or a later refresh — doesn't spring it back open.
    const autoOpenedQuoteId = useRef(null)
    useEffect(() => {
        if (quotes.length !== 1) return
        const onlyQuote = quotes[0]
        const onlyQuoteId = onlyQuote?.id
        if (!onlyQuoteId || autoOpenedQuoteId.current === onlyQuoteId) return
        autoOpenedQuoteId.current = onlyQuoteId
        if (isExpanded(onlyQuoteId)) return
        // Opening the only quote is the point of the effect, not a derived state update.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        toggleExpanded(onlyQuote)
    }, [quotes, isExpanded, toggleExpanded])

    const handleRefresh = useCallback(async () => {
        await refreshQuotes()
        for (const quoteId of expandedIds) {
            await refreshItems(quoteId)
        }
    }, [expandedIds, refreshQuotes, refreshItems])

    const handleCreateQuote = async (event) => {
        event.preventDefault()
        if (!canManage) return
        setCreating(true)
        setCreateError('')
        try {
            const data = await requestJson('/api/database/quotes', {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    ...newQuoteForm,
                }),
            })
            const created = data?.quote
            flashNotice(`Quote ${created?.quote_number || ''} created.`)
            setNewQuoteForm(createBlankQuoteForm(patientFunding))
            setShowCreateForm(false)
            await refreshQuotes()
            if (created?.id) {
                setExpandedIds((previous) => (previous.includes(created.id) ? previous : [...previous, created.id]))
            }
        } catch (error) {
            setCreateError(error?.message || 'Failed to create quote')
        } finally {
            setCreating(false)
        }
    }

    const handleDeleteQuote = async (quoteRow) => {
        if (!quoteRow?.id) return
        const lineCount = itemsByQuote[quoteRow.id]?.length ?? quoteRow.item_count ?? 0
        const confirmed = window.confirm(
            `Delete quote ${quoteRow.quote_number || ''}?${lineCount > 0 ? ` This will also delete its ${lineCount} line${lineCount === 1 ? '' : 's'}.` : ''} This action cannot be undone.`
        )
        if (!confirmed) return

        setDeletingQuoteId(quoteRow.id)
        setQuotesError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/quotes/${encodeURIComponent(quoteRow.id)}?${query.toString()}`, {
                method: 'DELETE',
            })
            flashNotice(`Quote ${quoteRow.quote_number || ''} deleted.`)
            setExpandedIds((previous) => previous.filter((id) => id !== quoteRow.id))
            setItemsByQuote((previous) => {
                const next = { ...previous }
                delete next[quoteRow.id]
                return next
            })
            await refreshQuotes()
        } catch (error) {
            setQuotesError(error?.message || 'Failed to delete quote')
        } finally {
            setDeletingQuoteId(null)
        }
    }

    const handleStatusChange = async (quoteRow, status, successMessage) => {
        if (!quoteRow?.id) return
        setStatusBusyId(quoteRow.id)
        setQuotesError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/quotes/${encodeURIComponent(quoteRow.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ status }),
            })
            flashNotice(successMessage)
            await refreshQuotes()
        } catch (error) {
            setQuotesError(error?.message || 'Failed to update quote status')
        } finally {
            setStatusBusyId(null)
        }
    }

    /**
     * Asks the Quote Writer for a priced draft.
     *
     * The worker owns exactly one quote per patient (marked with
     * `external_source = 'quote-writer'`), so this creates that draft or refreshes
     * it — it can never touch a quote the practitioner has already sent, accepted
     * or declined, and a refresh only replaces the worker's own lines.
     */
    const handleDraftWithWorker = async () => {
        if (!canManage) return
        setWorkerBusy(true)
        setWorkerError('')
        setProposals(null)
        try {
            const data = await requestJson('/api/database/quotes/assist', {
                method: 'POST',
                body: JSON.stringify({ domain, patient_id: numericPatientId, mode: 'draft' }),
            })
            const lineCount = Number(data?.producedLineCount || 0)

            if (data?.skippedReason === 'quote-already-actioned') {
                setWorkerError('The worker\u2019s draft for this patient has already been sent, accepted or declined. Reopen it as a draft, or use \u201cSuggest lines\u201d on another quote.')
            } else if (data?.skippedReason === 'no-supported-lines') {
                setWorkerError('The worker read this patient\u2019s record but could not match any support to the NDIS catalogue. Add notes or a report, or build the quote by hand.')
            } else {
                flashNotice(`Quote Writer drafted ${lineCount} line${lineCount === 1 ? '' : 's'}${data?.created === false ? ' (refreshed the existing draft)' : ''}. Review and edit before sending.`)
            }

            await refreshQuotes()
            if (data?.quoteId) {
                setExpandedIds((previous) => (previous.includes(data.quoteId) ? previous : [...previous, data.quoteId]))
                await refreshItems(data.quoteId)
            }
        } catch (error) {
            setWorkerError(error?.message || 'Failed to draft a quote')
        } finally {
            setWorkerBusy(false)
        }
    }

    /**
     * Suggests lines for an existing quote without writing anything. The
     * practitioner adds the ones they want, so a hand-tuned quote is never
     * rewritten behind their back.
     */
    const handleSuggestLines = async (quoteRow) => {
        if (!quoteRow?.id) return
        setWorkerBusy(true)
        setWorkerError('')
        try {
            const data = await requestJson('/api/database/quotes/assist', {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    patient_id: numericPatientId,
                    quote_id: quoteRow.id,
                    mode: 'propose',
                }),
            })
            const lines = Array.isArray(data?.lines) ? data.lines : []
            setProposals({
                quoteId: quoteRow.id,
                lines,
                dropped: Array.isArray(data?.dropped) ? data.dropped : [],
                summary: data?.summary || '',
                totals: data?.totals || null,
            })
            setExpandedIds((previous) => (previous.includes(quoteRow.id) ? previous : [...previous, quoteRow.id]))
            if (!lines.length) {
                setWorkerError('No quotable supports were found in this patient\u2019s record.')
            }
        } catch (error) {
            setWorkerError(error?.message || 'Failed to suggest quote lines')
        } finally {
            setWorkerBusy(false)
        }
    }

    /** Writes the accepted suggestions as ordinary quote lines. */
    const handleAddProposedLines = async () => {
        const proposal = proposals
        if (!proposal?.quoteId || !proposal.lines.length) return

        setInsertingProposals(true)
        setWorkerError('')
        try {
            for (const line of proposal.lines) {
                await requestJson(`/api/database/quotes/${encodeURIComponent(proposal.quoteId)}/items`, {
                    method: 'POST',
                    body: JSON.stringify({
                        domain,
                        quantity: line.quantity,
                        unit_price: line.unit_price,
                        price_limit: line.price_limit,
                        ndis_support_item_number: line.ndis_support_item_number,
                        ndis_support_item_name: line.ndis_support_item_name,
                        registration_group_number: line.registration_group_number,
                        registration_group_name: line.registration_group_name,
                        support_category_number: line.support_category_number,
                        support_category_name: line.support_category_name,
                        unit: line.unit,
                        quote_required: line.quote_required,
                        description: line.description || null,
                    }),
                })
            }
            flashNotice(`${proposal.lines.length} line${proposal.lines.length === 1 ? '' : 's'} added from the Quote Writer.`)
            setProposals(null)
            await refreshItems(proposal.quoteId)
            await refreshQuotes()
        } catch (error) {
            setWorkerError(error?.message || 'Failed to add the suggested lines')
        } finally {
            setInsertingProposals(false)
        }
    }

    const startEditingQuote = (quoteRow) => {
        setEditingQuoteId(quoteRow.id)
        setEditError('')
        setEditForm({
            quote_number: quoteRow.quote_number || '',
            funding_type: quoteRow.funding_type || 'ndis',
            status: deriveQuoteStatus(quoteRow),
            pricing_region: normalizeNdisPricingRegion(quoteRow.pricing_region),
            plan_manager: quoteRow.plan_manager || '',
            ndis_number: quoteRow.ndis_number || '',
            quote_date: quoteRow.quote_date || '',
            valid_until: quoteRow.valid_until || '',
            prepared_by: quoteRow.prepared_by || '',
            gst_applicable: Boolean(quoteRow.gst_applicable),
            notes: quoteRow.notes || '',
        })
        setExpandedIds((previous) => (previous.includes(quoteRow.id) ? previous : [...previous, quoteRow.id]))
    }

    const handleSaveQuote = async (event, quoteRow) => {
        event.preventDefault()
        if (!quoteRow?.id || !editForm) return
        setSavingEdit(true)
        setEditError('')
        try {
            const query = new URLSearchParams({ domain })
            const data = await requestJson(`/api/database/quotes/${encodeURIComponent(quoteRow.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ ...editForm, gst_applicable: Boolean(editForm.gst_applicable) }),
            })
            flashNotice(`Quote ${data?.quote?.quote_number || ''} updated.`)
            setEditingQuoteId(null)
            setEditForm(null)
            await refreshQuotes()
        } catch (error) {
            setEditError(error?.message || 'Failed to update quote')
        } finally {
            setSavingEdit(false)
        }
    }

    /**
     * Applies a picker selection to a line form. A catalogue item fills in its
     * identity, unit, "quote required" flag and the price limit for the quote's
     * region, and pre-fills the price with that limit (the maximum a provider may
     * charge an NDIA- or plan-managed participant).
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

    const updateLineForm = (quoteId, field, value, region) => {
        setLineForms((previous) => {
            const current = previous[quoteId] || createBlankLineForm()
            const next = field === 'support_item'
                ? applyCatalogueSelection(current, value, region)
                : { ...current, [field]: value }
            return { ...previous, [quoteId]: next }
        })
    }

    const handleAddLine = async (event, quoteRow) => {
        event.preventDefault()
        if (!quoteRow?.id) return

        const form = lineForms[quoteRow.id] || createBlankLineForm()
        const quantity = Number(form.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setLineAddError('Quantity must be greater than zero.')
            return
        }
        if (!String(form.ndis_support_item_name || '').trim() && !String(form.description || '').trim()) {
            setLineAddError('Choose an NDIS support item or describe what the line covers.')
            return
        }

        setAddingLineQuoteId(quoteRow.id)
        setLineAddError('')
        try {
            await requestJson(`/api/database/quotes/${encodeURIComponent(quoteRow.id)}/items`, {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    quantity,
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
                }),
            })
            flashNotice('Quote line added.')
            setLineForms((previous) => ({ ...previous, [quoteRow.id]: createBlankLineForm() }))
            await refreshItems(quoteRow.id)
            await refreshQuotes()
        } catch (error) {
            setLineAddError(error?.message || 'Failed to add the quote line')
        } finally {
            setAddingLineQuoteId(null)
        }
    }

    const startEditingLine = (quoteId, item) => {
        setEditingLineKey(`${quoteId}:${item.id}`)
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

    const handleSaveLine = async (event, quoteRow, item) => {
        event.preventDefault()
        if (!quoteRow?.id || !item?.id || !lineEditForm) return

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
                `/api/database/quotes/${encodeURIComponent(quoteRow.id)}/items/${encodeURIComponent(item.id)}?${query.toString()}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        quantity,
                        unit_price: lineEditForm.unit_price === '' ? 0 : Number(lineEditForm.unit_price),
                        price_limit: lineEditForm.price_limit === '' ? null : Number(lineEditForm.price_limit),
                        ndis_support_item_number: resolveNdisSupportItemSelection(lineEditForm.support_item)?.number || item.ndis_support_item_number || null,
                        ndis_support_item_name: lineEditForm.ndis_support_item_name || null,
                        registration_group_number: lineEditForm.registration_group_number || null,
                        registration_group_name: lineEditForm.registration_group_name || null,
                        support_category_number: lineEditForm.support_category_number || null,
                        support_category_name: lineEditForm.support_category_name || null,
                        unit: lineEditForm.unit || null,
                        quote_required: Boolean(lineEditForm.quote_required),
                        description: lineEditForm.description || null,
                    }),
                }
            )
            flashNotice('Quote line updated.')
            cancelEditingLine()
            await refreshItems(quoteRow.id)
            await refreshQuotes()
        } catch (error) {
            setLineEditError(error?.message || 'Failed to update the quote line')
        } finally {
            setSavingLine(false)
        }
    }

    const handleDeleteLine = async (quoteRow, item) => {
        if (!quoteRow?.id || !item?.id) return
        const confirmed = window.confirm('Delete this quote line? This action cannot be undone.')
        if (!confirmed) return

        const key = `${quoteRow.id}:${item.id}`
        setDeletingLineKey(key)
        setItemsError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(
                `/api/database/quotes/${encodeURIComponent(quoteRow.id)}/items/${encodeURIComponent(item.id)}?${query.toString()}`,
                { method: 'DELETE' }
            )
            flashNotice('Quote line deleted.')
            await refreshItems(quoteRow.id)
            await refreshQuotes()
        } catch (error) {
            setItemsError(error?.message || 'Failed to delete the quote line')
        } finally {
            setDeletingLineKey(null)
        }
    }

    if (!canManage) {
        return (
            <section className="space-y-3">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Save the patient first, then you can prepare NDIS quotes here.
                </p>
            </section>
        )
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Quotes</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Price up supports for {String(domainDisplayName || domain || '').trim() || 'this patient'} before delivering them.
                        NDIS-quoted supports (assistive technology, home modifications) are priced here; therapy hours are checked
                        against the published NDIS price limit for the quote&apos;s region.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={quotesLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {quotesLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowCreateForm((previous) => !previous)
                            setCreateError('')
                            if (!showCreateForm) setNewQuoteForm(createBlankQuoteForm(patientFunding))
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                        {showCreateForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {showCreateForm ? 'Cancel' : 'New quote'}
                    </button>
                    <button
                        type="button"
                        onClick={handleDraftWithWorker}
                        disabled={workerBusy}
                        title="Read this patient's notes, transcripts, reports and equipment recommendations and draft a priced NDIS quote"
                        className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <AssistantAvatar domainKey={domain} iconClassName="h-3.5 w-3.5" imageClassName="h-3.5 w-3.5" />
                        {workerBusy ? 'Drafting\u2026' : 'Draft with agent'}
                    </button>
                </div>
            </div>

            {notice && (
                <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {notice.message}
                </p>
            )}
            {quotesError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{quotesError}</p>
            )}
            {workerError && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{workerError}</p>
            )}

            {showCreateForm && (
                <form onSubmit={handleCreateQuote} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">New Quote</h4>
                        {creating && <p className="text-xs text-gray-500">Creating…</p>}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Quote number</span>
                            <input
                                type="text"
                                value={newQuoteForm.quote_number}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, quote_number: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder={`Auto (e.g. ${formatQuoteNumberPreview(nextNumber)})`}
                            />
                            <span className="mt-1 block text-[11px] text-gray-400">Leave blank to auto-generate. You can edit it later.</span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Funding</span>
                            <select
                                value={newQuoteForm.funding_type}
                                onChange={(event) => setNewQuoteForm((previous) => ({
                                    ...previous,
                                    funding_type: event.target.value,
                                    // NDIS supports are GST-free, so the flag cannot survive a switch to NDIS.
                                    gst_applicable: isNdisFunding(event.target.value) ? false : previous.gst_applicable,
                                }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {FUNDING_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">NDIS pricing region</span>
                            <select
                                value={newQuoteForm.pricing_region}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, pricing_region: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {NDIS_PRICING_REGIONS.map((region) => (
                                    <option key={region.value} value={region.value}>{region.label}</option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-gray-400">
                                {NDIS_PRICING_REGIONS.find((region) => region.value === newQuoteForm.pricing_region)?.description}
                            </span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Plan manager</span>
                            <input
                                type="text"
                                value={newQuoteForm.plan_manager}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, plan_manager: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Plan manager or self-managed"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">{referenceLabelForQuote(newQuoteForm.funding_type)}</span>
                            <input
                                type="text"
                                value={newQuoteForm.ndis_number}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, ndis_number: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="e.g. 430000000"
                            />
                            <span className="mt-1 block text-[11px] text-gray-400">
                                {patientFunding.referenceNumber
                                    ? `From the patient's Info tab (${PATIENT_REFERENCE_NUMBER_LABEL}).`
                                    : 'Not recorded on this patient’s Info tab — add it there, or enter one on the quote.'}
                            </span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Prepared by</span>
                            <input
                                type="text"
                                value={newQuoteForm.prepared_by}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, prepared_by: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Therapist name"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Quote date</span>
                            <input
                                type="date"
                                value={newQuoteForm.quote_date}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, quote_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Valid until</span>
                            <input
                                type="date"
                                value={newQuoteForm.valid_until}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, valid_until: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="flex items-end gap-2 pb-2">
                            <input
                                type="checkbox"
                                checked={Boolean(newQuoteForm.gst_applicable)}
                                disabled={isNdisFunding(newQuoteForm.funding_type)}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, gst_applicable: event.target.checked }))}
                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500 disabled:opacity-50"
                            />
                            <span className="text-xs font-medium text-gray-700">
                                Add GST {isNdisFunding(newQuoteForm.funding_type) ? '(not applicable — NDIS supports are GST-free)' : '(private work only)'}
                            </span>
                        </label>
                        <label className="block md:col-span-3">
                            <span className="text-xs font-medium text-gray-700">Notes</span>
                            <textarea
                                value={newQuoteForm.notes}
                                onChange={(event) => setNewQuoteForm((previous) => ({ ...previous, notes: event.target.value }))}
                                className="mt-1 min-h-[72px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="What the quote covers, funding reference, assumptions"
                            />
                        </label>
                    </div>

                    {createError && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>
                    )}

                    <div className="mt-3 flex items-center justify-end">
                        <button
                            type="submit"
                            disabled={creating}
                            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {creating ? 'Creating…' : 'Create quote'}
                        </button>
                    </div>
                </form>
            )}

            {quotes.length === 0 && quotesLoading && (
                <p className="px-2 text-sm text-gray-500">Loading quotes…</p>
            )}

            {quotes.length === 0 && !quotesLoading && (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                    No quotes yet for this patient. Click “New quote” to price up supports — NDIS assistive technology and
                    home modifications are usually quoted before they can be purchased.
                </p>
            )}

            {quotes.map((quoteRow) => {
                const quoteId = quoteRow.id
                const metrics = buildQuoteMetrics(quoteRow, now)
                const expanded = isExpanded(quoteId)
                const lines = itemsByQuote[quoteId] || []
                const lineForm = lineForms[quoteId] || createBlankLineForm()
                const editingThisQuote = editingQuoteId === quoteId
                const busy = statusBusyId === quoteId
                const awaitingDecision = metrics.awaitingDecision
                // Provenance, from the shared vocabulary: "Worker draft" only while the
                // row is still in the state the worker left it in. Sending or accepting
                // it is the practitioner taking it on, so the badge changes to
                // "Worker-assisted" rather than keeping a claim that is no longer true.
                const provenanceBadge = describeQuoteProvenanceBadge(quoteRow)
                const provenanceIsWorkerDraft = isUnreviewedWorkerQuote(quoteRow)

                return (
                    <div key={quoteId} className="rounded-md border border-gray-200">
                        <div className="border-b border-gray-100 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleExpanded(quoteRow)}
                                        className="inline-flex items-center gap-1 rounded text-sm font-semibold text-gray-900 hover:text-gray-600"
                                        title={expanded ? 'Collapse quote' : 'Expand quote'}
                                    >
                                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        {quoteRow.quote_number || `Quote #${quoteId}`}
                                    </button>
                                    <FundingBadge fundingType={quoteRow.funding_type} />
                                    <StatusPill status={metrics.status} />
                                    <AttentionPill attention={metrics.attention} />
                                    {provenanceBadge && (
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${provenanceBadge.className}`}
                                            title={provenanceBadge.title}
                                        >
                                            {provenanceIsWorkerDraft && (
                                                <AssistantAvatar domainKey={domain} iconClassName="h-3 w-3" imageClassName="h-3 w-3" />
                                            )}
                                            {provenanceBadge.label}
                                        </span>
                                    )}
                                    {quoteRow.prepared_by && (
                                        <span className="text-xs text-gray-500">· {quoteRow.prepared_by}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {!editingThisQuote && (
                                        <button
                                            type="button"
                                            onClick={() => startEditingQuote(quoteRow)}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            <Pencil className="h-3 w-3" /> Edit
                                        </button>
                                    )}
                                    {metrics.status === 'draft' && (
                                        <button
                                            type="button"
                                            onClick={() => handleSuggestLines(quoteRow)}
                                            disabled={workerBusy}
                                            title="Suggest extra lines for this quote from the patient's record"
                                            className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <AssistantAvatar domainKey={domain} iconClassName="h-3 w-3" imageClassName="h-3 w-3" /> Suggest lines
                                        </button>
                                    )}
                                    {awaitingDecision && (
                                        <button
                                            type="button"
                                            onClick={() => handleStatusChange(quoteRow, 'sent', `Quote ${quoteRow.quote_number || ''} marked as sent.`)}
                                            disabled={busy}
                                            className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                                        >
                                            <Send className="h-3 w-3" /> Mark sent
                                        </button>
                                    )}
                                    {awaitingDecision && (
                                        <button
                                            type="button"
                                            onClick={() => handleStatusChange(quoteRow, 'accepted', `Quote ${quoteRow.quote_number || ''} accepted.`)}
                                            disabled={busy}
                                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                        >
                                            <Check className="h-3 w-3" /> Accepted
                                        </button>
                                    )}
                                    {awaitingDecision && (
                                        <button
                                            type="button"
                                            onClick={() => handleStatusChange(quoteRow, 'declined', `Quote ${quoteRow.quote_number || ''} declined.`)}
                                            disabled={busy}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                        >
                                            <Ban className="h-3 w-3" /> Declined
                                        </button>
                                    )}
                                    {!awaitingDecision && metrics.status !== 'accepted' && (
                                        <button
                                            type="button"
                                            onClick={() => handleStatusChange(quoteRow, 'draft', `Quote ${quoteRow.quote_number || ''} reopened as a draft.`)}
                                            disabled={busy}
                                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                        >
                                            <RotateCcw className="h-3 w-3" /> Reopen
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteQuote(quoteRow)}
                                        disabled={deletingQuoteId === quoteId}
                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {deletingQuoteId === quoteId ? 'Deleting…' : <Trash2 className="h-3 w-3" />}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-500 md:grid-cols-4">
                                <span>
                                    Prepared: <span className="font-medium text-gray-700">{formatDisplayDate(quoteRow.quote_date)}</span>
                                </span>
                                <span>
                                    Valid until: <span className="font-medium text-gray-700">{formatDisplayDate(quoteRow.valid_until)}</span>
                                </span>
                                <span>
                                    Region: <span className="font-medium text-gray-700">{NDIS_PRICING_REGIONS.find((region) => region.value === normalizeNdisPricingRegion(quoteRow.pricing_region))?.label}</span>
                                </span>
                                <span className="md:text-right">
                                    {metrics.itemCount} line{metrics.itemCount === 1 ? '' : 's'} ·{' '}
                                    <span className="font-semibold text-gray-900">{formatCurrency(metrics.total)}</span>
                                    {metrics.total > metrics.subtotal ? ' inc. GST' : ''}
                                </span>
                            </div>
                        </div>

                        {expanded && (
                            <div className="space-y-4 p-4">
                                {proposals?.quoteId === quoteId && (
                                    <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <AssistantAvatar
                                                    domainKey={domain}
                                                    iconClassName="h-3.5 w-3.5 text-sky-600"
                                                    imageClassName="h-3.5 w-3.5"
                                                />
                                                <h5 className="text-sm font-semibold text-sky-900">Quote Writer suggestions</h5>
                                                <span className="text-xs text-sky-700">
                                                    {proposals.lines.length} line{proposals.lines.length === 1 ? '' : 's'}
                                                    {proposals.totals ? ` · ${formatCurrency(proposals.totals.subtotal)}` : ''}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={handleAddProposedLines}
                                                    disabled={insertingProposals || !proposals.lines.length}
                                                    className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2 py-1 text-xs font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {insertingProposals
                                                        ? 'Adding…'
                                                        : `Add ${proposals.lines.length} line${proposals.lines.length === 1 ? '' : 's'}`}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setProposals(null)}
                                                    disabled={insertingProposals}
                                                    className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-white px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                                                >
                                                    Discard
                                                </button>
                                            </div>
                                        </div>
                                        {proposals.summary && (
                                            <p className="mt-2 text-xs text-sky-800">{proposals.summary}</p>
                                        )}
                                        {proposals.lines.length > 0 && (
                                            <ul className="mt-2 space-y-1.5">
                                                {proposals.lines.map((line, index) => (
                                                    <li key={`${line.ndis_support_item_number}-${index}`} className="rounded border border-sky-100 bg-white p-2">
                                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                            <span className="text-xs font-medium text-gray-900">{line.ndis_support_item_name}</span>
                                                            <span className="text-xs text-gray-500">
                                                                {line.quantity} × {line.price_limit === null ? 'quote required' : formatCurrency(line.unit_price)}
                                                            </span>
                                                        </div>
                                                        <div className="mt-0.5 font-mono text-[11px] text-gray-400">{line.ndis_support_item_number}</div>
                                                        {line.description && (
                                                            <p className="mt-1 text-xs text-gray-600">{line.description}</p>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {proposals.dropped?.length > 0 && (
                                            <p className="mt-2 text-[11px] text-sky-700">
                                                {proposals.dropped.length} proposed line{proposals.dropped.length === 1 ? '' : 's'} could not be matched to the NDIS catalogue and {proposals.dropped.length === 1 ? 'was' : 'were'} left out.
                                            </p>
                                        )}
                                    </div>
                                )}
                                {editingThisQuote ? (
                                    <form onSubmit={(event) => handleSaveQuote(event, quoteRow)} className="rounded-md border border-gray-200 p-3">
                                        <h5 className="text-sm font-semibold text-gray-900">Edit quote</h5>
                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Quote number</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.quote_number || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, quote_number: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Funding</span>
                                                <select
                                                    value={editForm?.funding_type || 'ndis'}
                                                    onChange={(event) => setEditForm((previous) => ({
                                                        ...previous,
                                                        funding_type: event.target.value,
                                                        gst_applicable: isNdisFunding(event.target.value) ? false : previous.gst_applicable,
                                                    }))}
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
                                                    value={editForm?.status || deriveQuoteStatus(quoteRow)}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, status: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {QUOTE_STATUS_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">NDIS pricing region</span>
                                                <select
                                                    value={editForm?.pricing_region || DEFAULT_NDIS_PRICING_REGION}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, pricing_region: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {NDIS_PRICING_REGIONS.map((region) => (
                                                        <option key={region.value} value={region.value}>{region.label}</option>
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
                                                <span className="text-xs font-medium text-gray-700">{referenceLabelForQuote(editForm?.funding_type)}</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.ndis_number || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, ndis_number: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                                <span className="mt-1 block text-[11px] text-gray-400">
                                                    {patientFunding.referenceNumber
                                                        ? `The patient’s Info tab records ${patientFunding.referenceNumber}.`
                                                        : 'Not recorded on this patient’s Info tab.'}
                                                </span>
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
                                                <span className="text-xs font-medium text-gray-700">Quote date</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.quote_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, quote_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Valid until</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.valid_until || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, valid_until: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="flex items-center gap-2 md:col-span-3">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(editForm?.gst_applicable)}
                                                    disabled={isNdisFunding(editForm?.funding_type)}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, gst_applicable: event.target.checked }))}
                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500 disabled:opacity-50"
                                                />
                                                <span className="text-xs font-medium text-gray-700">Add GST (private work only)</span>
                                            </label>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Notes</span>
                                                <textarea
                                                    value={editForm?.notes || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, notes: event.target.value }))}
                                                    className="mt-1 min-h-[64px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                        </div>

                                        {editError && (
                                            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
                                        )}

                                        <div className="mt-3 flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingQuoteId(null)
                                                    setEditForm(null)
                                                    setEditError('')
                                                }}
                                                className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={savingEdit}
                                                className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {savingEdit ? 'Saving…' : 'Save changes'}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-gray-600 md:grid-cols-2">
                                        <div>
                                            <span className="font-semibold text-gray-900">Plan manager:</span> {quoteRow.plan_manager || '-'}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">{referenceLabelForQuote(quoteRow.funding_type)}:</span>{' '}
                                            {quoteRow.ndis_number || patientFunding.referenceNumber || '-'}
                                            {!quoteRow.ndis_number && patientFunding.referenceNumber && (
                                                <span className="ml-1 text-[11px] text-gray-400">(from the Info tab)</span>
                                            )}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">Prepared by:</span> {quoteRow.prepared_by || '-'}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">Subtotal:</span> {formatCurrency(metrics.subtotal)}
                                            {metrics.total > metrics.subtotal ? ` · GST ${formatCurrency(metrics.total - metrics.subtotal)}` : ''}
                                        </div>
                                        {quoteRow.notes && (
                                            <div className="md:col-span-2 whitespace-pre-wrap">
                                                <span className="font-semibold text-gray-900">Notes:</span> {quoteRow.notes}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="rounded-md border border-gray-200">
                                    <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                                        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quote lines</h5>
                                        {itemsLoadingQuoteId === quoteId && <span className="text-[11px] text-gray-400">Loading…</span>}
                                    </div>

                                    {itemsError && (
                                        <p className="px-3 py-2 text-sm text-red-700">{itemsError}</p>
                                    )}

                                    {lines.length === 0 && itemsLoadingQuoteId !== quoteId && (
                                        <p className="px-3 py-4 text-center text-xs text-gray-500">
                                            No lines yet. Add an NDIS support item below, or describe a custom line.
                                        </p>
                                    )}

                                    {lines.length > 0 && (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-gray-100 text-xs">
                                                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                                                    <tr>
                                                        <th className="px-3 py-2 font-semibold">Support item</th>
                                                        <th className="px-3 py-2 font-semibold">Unit</th>
                                                        <th className="px-3 py-2 font-semibold text-right">Qty</th>
                                                        <th className="px-3 py-2 font-semibold text-right">Unit price</th>
                                                        <th className="px-3 py-2 font-semibold text-right">Line total</th>
                                                        <th className="px-3 py-2" />
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {lines.map((item) => {
                                                        const lineKey = `${quoteId}:${item.id}`
                                                        const lineMetrics = buildQuoteLineMetrics(item)
                                                        const editingThisLine = editingLineKey === lineKey

                                                        if (editingThisLine && lineEditForm) {
                                                            return (
                                                                <tr key={lineKey} className="bg-gray-50 align-top">
                                                                    <td className="px-3 py-3" colSpan={6}>
                                                                        <form onSubmit={(event) => handleSaveLine(event, quoteRow, item)} className="space-y-3">
                                                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                                                                <label className="block md:col-span-2">
                                                                                    <span className="text-xs font-medium text-gray-700">NDIS support item</span>
                                                                                    <input
                                                                                        type="text"
                                                                                        list={`ndis-support-items-${quoteId}`}
                                                                                        value={lineEditForm.support_item}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({
                                                                                            ...applyCatalogueSelection(previous, event.target.value, normalizeNdisPricingRegion(quoteRow.pricing_region)),
                                                                                        }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                        placeholder="Search or type a custom line"
                                                                                    />
                                                                                </label>
                                                                                <label className="block">
                                                                                    <span className="text-xs font-medium text-gray-700">Unit</span>
                                                                                    <input
                                                                                        type="text"
                                                                                        value={lineEditForm.unit}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, unit: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                                <label className="block">
                                                                                    <span className="text-xs font-medium text-gray-700">Quantity</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        step="0.25"
                                                                                        value={lineEditForm.quantity}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, quantity: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                                <label className="block">
                                                                                    <span className="text-xs font-medium text-gray-700">Unit price ($)</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        step="0.01"
                                                                                        value={lineEditForm.unit_price}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, unit_price: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                                <label className="block">
                                                                                    <span className="text-xs font-medium text-gray-700">NDIS price limit ($)</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        step="0.01"
                                                                                        value={lineEditForm.price_limit}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, price_limit: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                                <label className="block md:col-span-2">
                                                                                    <span className="text-xs font-medium text-gray-700">Item name</span>
                                                                                    <input
                                                                                        type="text"
                                                                                        value={lineEditForm.ndis_support_item_name}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, ndis_support_item_name: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                                <label className="block md:col-span-4">
                                                                                    <span className="text-xs font-medium text-gray-700">Description</span>
                                                                                    <input
                                                                                        type="text"
                                                                                        value={lineEditForm.description}
                                                                                        onChange={(event) => setLineEditForm((previous) => ({ ...previous, description: event.target.value }))}
                                                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                    />
                                                                                </label>
                                                                            </div>

                                                                            {lineEditError && (
                                                                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{lineEditError}</p>
                                                                            )}

                                                                            <div className="flex items-center justify-end gap-2">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={cancelEditingLine}
                                                                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                                                >
                                                                                    Cancel
                                                                                </button>
                                                                                <button
                                                                                    type="submit"
                                                                                    disabled={savingLine}
                                                                                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                                                >
                                                                                    {savingLine ? 'Saving…' : 'Save line'}
                                                                                </button>
                                                                            </div>
                                                                        </form>
                                                                    </td>
                                                                </tr>
                                                            )
                                                        }

                                                        return (
                                                            <tr key={lineKey} className="align-top">
                                                                <td className="px-3 py-2">
                                                                    <div className="font-medium text-gray-900">
                                                                        {item.ndis_support_item_name || item.description || 'Custom line'}
                                                                    </div>
                                                                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                                                                        {item.ndis_support_item_number && <span className="font-mono">{item.ndis_support_item_number}</span>}
                                                                        {item.registration_group_name && <span>{item.registration_group_name}</span>}
                                                                        {item.quote_required && (
                                                                            <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-indigo-700">
                                                                                Quote required
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {item.description && item.ndis_support_item_name && (
                                                                        <div className="mt-0.5 text-[11px] text-gray-500">{item.description}</div>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2 text-gray-600">{getNdisSupportUnit(item.unit).label}</td>
                                                                <td className="px-3 py-2 text-right text-gray-700">
                                                                    {Number.isInteger(item.quantity) ? item.quantity : Number(item.quantity).toFixed(2)}
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                    <div className="text-gray-700">{formatCurrency(item.unit_price)}</div>
                                                                    <PriceLimitNote item={item} region={normalizeNdisPricingRegion(quoteRow.pricing_region)} />
                                                                </td>
                                                                <td className="px-3 py-2 text-right font-semibold text-gray-900">
                                                                    {formatCurrency(lineMetrics.lineTotal)}
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                    <div className="flex items-center justify-end gap-1">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => startEditingLine(quoteId, item)}
                                                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                                                        >
                                                                            <Pencil className="h-3 w-3" /> Edit
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleDeleteLine(quoteRow, item)}
                                                                            disabled={deletingLineKey === lineKey}
                                                                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                                                                        >
                                                                            {deletingLineKey === lineKey ? '…' : <Trash2 className="h-3 w-3" />}
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                                <tfoot>
                                                    <tr className="border-t border-gray-200 bg-gray-50">
                                                        <td className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500" colSpan={4}>
                                                            Subtotal{metrics.total > metrics.subtotal ? ' (+ GST)' : ''}
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-semibold text-gray-900" colSpan={2}>
                                                            {formatCurrency(metrics.total)}
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    )}

                                    <form onSubmit={(event) => handleAddLine(event, quoteRow)} className="border-t border-gray-100 p-3">
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                            <label className="block md:col-span-2">
                                                <span className="text-xs font-medium text-gray-700">NDIS support item</span>
                                                <input
                                                    type="text"
                                                    list={`ndis-support-items-${quoteId}`}
                                                    value={lineForm.support_item}
                                                    onChange={(event) => updateLineForm(quoteId, 'support_item', event.target.value, normalizeNdisPricingRegion(quoteRow.pricing_region))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="Search the NDIS catalogue or type a custom line"
                                                />
                                                <span className="mt-1 block text-[11px] text-gray-400">
                                                    Picking a catalogue item fills the unit, item name and the price limit for this quote&apos;s region.
                                                </span>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Quantity</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.25"
                                                    value={lineForm.quantity}
                                                    onChange={(event) => updateLineForm(quoteId, 'quantity', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Unit price ($)</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={lineForm.unit_price}
                                                    onChange={(event) => updateLineForm(quoteId, 'unit_price', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="_"
                                                />
                                                {lineForm.price_limit !== '' && (
                                                    <span className="mt-1 block text-[11px] text-gray-400">
                                                        NDIS limit {formatCurrency(Number(lineForm.price_limit))}
                                                    </span>
                                                )}
                                            </label>
                                            <label className="block md:col-span-4">
                                                <span className="text-xs font-medium text-gray-700">Description</span>
                                                <input
                                                    type="text"
                                                    value={lineForm.description}
                                                    onChange={(event) => updateLineForm(quoteId, 'description', event.target.value)}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="What this line covers (e.g. bathroom grab rails supply and install)"
                                                />
                                            </label>
                                        </div>

                                        <datalist id={`ndis-support-items-${quoteId}`}>
                                            {catalogOptions.map((option) => (
                                                <option key={option} value={option} />
                                            ))}
                                        </datalist>

                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                            <div className="text-[11px] text-gray-500">
                                                {(() => {
                                                    const preview = computeQuoteTotals([{
                                                        quantity: Number(lineForm.quantity) || 0,
                                                        unit_price: Number(lineForm.unit_price) || 0,
                                                    }])
                                                    const selectedNumber = resolveNdisSupportItemSelection(lineForm.support_item)?.number || null
                                                    const region = normalizeNdisPricingRegion(quoteRow.pricing_region)
                                                    const limit = selectedNumber ? getNdisPriceLimit(selectedNumber, region) : null
                                                    const overLimit = limit !== null && (Number(lineForm.unit_price) || 0) > limit
                                                    const requiresQuote = selectedNumber
                                                        ? isNdisQuoteRequired(selectedNumber)
                                                        : Boolean(lineForm.quote_required)

                                                    return (
                                                        <>
                                                            Line total {formatCurrency(preview.total)}
                                                            {overLimit && (
                                                                <span className="ml-2 font-semibold text-red-600">
                                                                    Above the NDIS limit of {formatCurrency(limit)}
                                                                </span>
                                                            )}
                                                            {requiresQuote && !overLimit && (
                                                                <span className="ml-2 text-indigo-700">
                                                                    This support is quoted rather than price-limited
                                                                </span>
                                                            )}
                                                        </>
                                                    )
                                                })()}
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={addingLineQuoteId === quoteId}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                                {addingLineQuoteId === quoteId ? 'Adding…' : 'Add line'}
                                            </button>
                                        </div>

                                        {lineAddError && (
                                            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{lineAddError}</p>
                                        )}
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}

            <details className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700">
                    NDIS pricing reference (catalogue {NDIS_CATALOGUE_PERIOD}, effective {NDIS_CATALOGUE_EFFECTIVE_FROM})
                </summary>
                <div className="mt-2 space-y-2">
                    <p>{NDIS_PRICE_LIMIT_NOTE}</p>
                    <p>
                        Supports the NDIS asks to be quoted (assistive technology, home modifications, prosthetics, vehicle
                        modifications and SDA) have no published price limit — the quote itself sets the price, and the line is
                        flagged “Quote required”.
                    </p>
                    <p className="flex flex-wrap gap-3">
                        <a
                            href={NDIS_PRICING_ARRANGEMENTS_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-gray-900 underline hover:text-gray-600"
                        >
                            NDIS pricing arrangements <ExternalLink className="h-3 w-3" />
                        </a>
                        <a
                            href={NDIS_SUPPORT_CATALOGUE_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-gray-900 underline hover:text-gray-600"
                        >
                            NDIS support catalogue <ExternalLink className="h-3 w-3" />
                        </a>
                    </p>
                    <p className="text-[11px] text-gray-400">
                        Price limits are a guide only and change each financial year — always confirm against the current NDIS
                        publication before sending a quote.
                    </p>
                </div>
            </details>
        </section>
    )
}
