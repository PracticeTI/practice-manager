'use client'

import { MoreVertical } from 'lucide-react'
import { resolveSourcingReplyTo, resolveSourcingSenderEmail } from '@/lib/equipmentQuoteRequest'
import { isSourcingInProgress, normalizeSourcingStatus, SOURCING_STATUS_QUOTE_RECEIVED, sourcingStatusBadgeClass, sourcingStatusLabel } from '@/lib/equipmentSourcingStatus'
import { formatEquipmentMatchReason, SourcingSupplierLogo } from './PatientPageParts'
import { formatDraftTimestamp } from './patientUtils'
export default function PatientEquipmentTab({
    closeSourcingWizard,
    confirmSourcingItemDetails,
    equipmentItemDrafts,
    equipmentSourcing,
    equipmentSourcingError,
    equipmentSourcingLoading,
    equipmentSuggestionMenuIndex,
    equipmentSuggestionResettingIndex,
    expandedSourcingSupplierIds,
    onRefreshEquipmentSourcing,
    openSourcingReplyMessage,
    prepareSourcingQuoteDraft,
    resetEquipmentSuggestionStatus,
    sendSourcingQuoteRequest,
    setEquipmentSuggestionMenuIndex,
    setShowSourcingEmailOptions,
    setShowSourcingReplyToAddress,
    setSourcingBccReplyTo,
    setSourcingQuoteDraft,
    setSourcingQuoteViewType,
    setSourcingSupplierId,
    setSourcingWizardItem,
    showSourcingEmailOptions,
    showSourcingReplyToAddress,
    sourcingBccReplyTo,
    sourcingPracticeName,
    sourcingQuoteDraft,
    sourcingQuoteSent,
    sourcingQuoteViewType,
    sourcingReplyToEmail,
    sourcingReplyToName,
    sourcingSupplierId,
    sourcingSuppliers,
    sourcingWizardError,
    sourcingWizardItem,
    sourcingWizardSaving,
    toggleSourcingSupplierDetails,
}) {
    return (
        <>
<section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">Equipment suggestions</h3>
                                    <p className="mt-1 text-xs text-gray-600">Suggestions extracted from the latest TAC OTF10 report.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={onRefreshEquipmentSourcing}
                                    disabled={equipmentSourcingLoading}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {equipmentSourcingLoading ? 'Refreshing...' : 'Refresh'}
                                </button>
                            </div>

                            {equipmentSourcingError && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{equipmentSourcingError}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-700">
                                    {equipmentSourcingLoading ? 'Updating...' : equipmentSourcing?.statusLabel || 'Waiting'}
                                </span>
                                {equipmentSourcing?.result?.sourceReportId && <span>Source report #{equipmentSourcing.result.sourceReportId}</span>}
                                {equipmentSourcing?.result?.updatedAt && <span>Updated {formatDraftTimestamp(equipmentSourcing.result.updatedAt)}</span>}
                            </div>

                            {equipmentSourcing?.latest?.errorMessage && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{equipmentSourcing.latest.errorMessage}</p>
                            )}

                            <div className="overflow-x-auto rounded-md border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Equipment</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Supplier</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Trial</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {(equipmentSourcing?.result?.suggestions || []).map((suggestion, index) => {
                                            const itemKey = `${suggestion.equipmentType || 'equipment'}-${index}`
                                            const itemDraft = equipmentItemDrafts[itemKey] || {}
                                            const itemName = itemDraft.name || suggestion.equipmentType || ''
                                            const itemDescription = itemDraft.description || suggestion.description || suggestion.justification || ''
                                            const sourcingStatus = normalizeSourcingStatus(suggestion.sourcingStatus)
                                            const inSourcing = isSourcingInProgress(sourcingStatus)
                                            const quoteResponse = suggestion.quoteResponse && typeof suggestion.quoteResponse === 'object'
                                                ? suggestion.quoteResponse
                                                : null
                                            const quoteReplyMessageId = sourcingStatus === SOURCING_STATUS_QUOTE_RECEIVED
                                                ? String(quoteResponse?.inboundMessageId ?? '').trim()
                                                : ''
                                            const quoteReplySubject = String(quoteResponse?.subject || '').trim()
                                            const quoteReplyReceivedAt = quoteResponse?.receivedAt || null
                                            return (
                                                <tr key={itemKey}>
                                                    <td className="px-3 py-3 align-top font-medium text-gray-900">{itemName || '-'}</td>
                                                    <td className="px-3 py-3 align-top">
                                                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${sourcingStatusBadgeClass(sourcingStatus)}`}>
                                                            {sourcingStatusLabel(sourcingStatus)}
                                                        </span>
                                                        {quoteReplyMessageId && (
                                                            <button
                                                                type="button"
                                                                onClick={() => openSourcingReplyMessage(quoteReplyMessageId)}
                                                                title={[
                                                                    quoteReplySubject ? `Open supplier reply: ${quoteReplySubject}` : 'Open the supplier reply',
                                                                    quoteReplyReceivedAt ? `Received ${formatDraftTimestamp(quoteReplyReceivedAt)}` : null,
                                                                ].filter(Boolean).join(' — ')}
                                                                className="mt-1.5 flex items-center gap-1 rounded text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:underline"
                                                            >
                                                                View reply
                                                                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                                                                    <path d="M7.5 4.5L13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 align-top text-gray-700">{suggestion.quoteRequest?.supplierName || suggestion.supplier || '-'}</td>
                                                    <td className="px-3 py-3 align-top text-gray-700">{suggestion.trialSummary || '-'}</td>
                                                    <td className="max-w-sm px-3 py-3 align-top text-gray-700">{itemDescription || '-'}</td>
                                                    <td className="px-3 py-3 text-right align-top">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    closeSourcingWizard()
                                                                    setSourcingWizardItem({ key: itemKey, index, name: itemName, description: itemDescription, step: 1 })
                                                                }}
                                                                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                                                            >
                                                                {inSourcing ? 'Re-source' : 'Source'}
                                                            </button>
                                                            <div className="relative">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEquipmentSuggestionMenuIndex((current) => current === index ? null : index)}
                                                                    className="rounded-md border border-gray-300 px-2 py-1.5 text-lg leading-none text-gray-600 hover:bg-gray-50"
                                                                    aria-label={`Open actions for ${itemName || 'equipment suggestion'}`}
                                                                    aria-expanded={equipmentSuggestionMenuIndex === index}
                                                                >
                                                                    ⋮
                                                                </button>
                                                                {equipmentSuggestionMenuIndex === index && (
                                                                    <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 text-left shadow-lg">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => resetEquipmentSuggestionStatus(index)}
                                                                            disabled={equipmentSuggestionResettingIndex === index}
                                                                            className="block w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                                        >
                                                                            {equipmentSuggestionResettingIndex === index ? 'Resetting...' : 'Reset status'}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        {!equipmentSourcingLoading && (equipmentSourcing?.result?.suggestions || []).length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="px-3 py-5 text-center text-gray-500">
                                                    {equipmentSourcing?.status === 'completed'
                                                        ? 'The latest TAC OTF10 report contains no equipment suggestions.'
                                                        : 'Equipment suggestions will appear after the worker completes.'}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {sourcingWizardItem && (
                                <div
                                    className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/50 p-4"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-labelledby="equipment-sourcing-wizard-title"
                                    onClick={closeSourcingWizard}
                                >
                                    <div
                                        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-none border border-gray-300 bg-white shadow-2xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div className="border-b border-gray-200 px-5 py-4">
                                            <p className="text-xs font-semibold uppercase text-gray-500">
                                                {sourcingWizardItem.step === 3
                                                    ? 'Step 3 · Request a quote'
                                                    : sourcingWizardItem.step === 2
                                                        ? 'Step 2 · Choose a supplier'
                                                        : 'Step 1 · Confirm item'}
                                            </p>
                                            <h4 id="equipment-sourcing-wizard-title" className="mt-1 text-base font-semibold text-gray-900">
                                                Source equipment
                                            </h4>
                                        </div>
                                        <div className="flex-1 space-y-4 overflow-y-auto p-5">
                                            {sourcingWizardError && (
                                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sourcingWizardError}</p>
                                            )}
                                            {sourcingQuoteSent && (
                                                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{sourcingQuoteSent}</p>
                                            )}

                                            {sourcingWizardItem.step === 1 && (
                                                <>
                                                    <label className="block">
                                                        <span className="text-xs font-medium text-gray-700">Item name</span>
                                                        <input
                                                            type="text"
                                                            value={sourcingWizardItem.name}
                                                            onChange={(event) => setSourcingWizardItem((current) => ({ ...current, name: event.target.value }))}
                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            autoFocus
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-xs font-medium text-gray-700">Description</span>
                                                        <textarea
                                                            value={sourcingWizardItem.description}
                                                            onChange={(event) => setSourcingWizardItem((current) => ({ ...current, description: event.target.value }))}
                                                            className="mt-1 min-h-40 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        />
                                                    </label>
                                                </>
                                            )}

                                            {sourcingWizardItem.step === 2 && (
                                                <>
                                                    <p className="text-xs text-gray-600">
                                                        Top catalog matches for <span className="font-medium text-gray-900">{sourcingWizardItem.name}</span>. Each shows a one-line reason it was ranked — expand one for its full contact and catalogue details.
                                                    </p>
                                                    {sourcingSuppliers.length === 0 && (
                                                        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                                                            No catalog suppliers with an email address matched this item. Add a supplier in Supplier Settings and try again.
                                                        </p>
                                                    )}
                                                    {sourcingSuppliers.map((supplier) => {
                                                        const selected = sourcingSupplierId === supplier.id
                                                        const expanded = expandedSourcingSupplierIds.includes(supplier.id)
                                                        const reasonText = formatEquipmentMatchReason(supplier)
                                                        return (
                                                            <div key={supplier.id} className={`rounded-md border text-sm ${selected ? 'border-gray-900' : 'border-gray-200'}`}>
                                                                <label className={`flex cursor-pointer items-start gap-3 px-3 py-3 ${selected ? 'bg-gray-50' : ''}`}>
                                                                    <input
                                                                        type="radio"
                                                                        name="sourcing-supplier"
                                                                        className="mt-1"
                                                                        checked={selected}
                                                                        onChange={() => setSourcingSupplierId(supplier.id)}
                                                                    />
                                                                    <SourcingSupplierLogo supplier={supplier} />
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block font-medium text-gray-900">{supplier.supplier}</span>
                                                                        {reasonText ? (
                                                                            <span className="mt-0.5 block text-xs leading-snug text-gray-600">
                                                                                <span className="font-medium text-gray-700">Why it matches:</span> {reasonText}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="mt-0.5 block break-all text-xs text-gray-500">{supplier.email}</span>
                                                                        )}
                                                                    </span>
                                                                </label>
                                                                <div className="flex items-center justify-end border-t border-gray-100 px-3 py-1.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleSourcingSupplierDetails(supplier.id)}
                                                                        aria-expanded={expanded}
                                                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                                                    >
                                                                        <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25-4.51a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                                                        </svg>
                                                                        {expanded ? 'Hide details' : 'Show details'}
                                                                    </button>
                                                                </div>
                                                                {expanded && (
                                                                    <dl className="space-y-1.5 border-t border-gray-100 bg-gray-50/50 px-3 py-3 text-xs text-gray-600">
                                                                        {supplier.email && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Email</dt><dd className="min-w-0 break-all">{supplier.email}</dd></div>
                                                                        )}
                                                                        {supplier.phone && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Phone</dt><dd className="min-w-0 break-all">{supplier.phone}</dd></div>
                                                                        )}
                                                                        {supplier.website_url && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Website</dt><dd className="min-w-0 break-all">{supplier.website_url}</dd></div>
                                                                        )}
                                                                        {supplier.typical_response_time && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Response time</dt><dd className="min-w-0">{supplier.typical_response_time}</dd></div>
                                                                        )}
                                                                        {(supplier.equipment_categories || []).length > 0 && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Category</dt><dd className="min-w-0">{supplier.equipment_categories.join(', ')}</dd></div>
                                                                        )}
                                                                        {(supplier.product_types || []).length > 0 && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Product types</dt><dd className="min-w-0">{supplier.product_types.join(', ')}</dd></div>
                                                                        )}
                                                                        {(supplier.funding || []).length > 0 && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Funding</dt><dd className="min-w-0">{supplier.funding.join(', ')}</dd></div>
                                                                        )}
                                                                        {supplier.quotes && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">Quotes</dt><dd className="min-w-0">Accepts quote requests</dd></div>
                                                                        )}
                                                                        {supplier.description && (
                                                                            <div className="flex gap-2"><dt className="w-20 shrink-0 font-medium text-gray-500">About</dt><dd className="min-w-0">{supplier.description}</dd></div>
                                                                        )}
                                                                    </dl>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </>
                                            )}

                                            {sourcingWizardItem.step === 3 && sourcingQuoteDraft && (
                                                <>
                                                    <div className="space-y-3">
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">To</span>
                                                            <input
                                                                type="email"
                                                                value={sourcingQuoteDraft.toEmail}
                                                                onChange={(event) => setSourcingQuoteDraft((current) => ({ ...current, toEmail: event.target.value }))}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            />
                                                        </label>
                                                        <div className="relative rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 shadow-sm">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Reply To</p>
                                                                    <p className="truncate text-sm font-semibold text-gray-900">
                                                                        {sourcingReplyToName || sourcingReplyToEmail || 'the default practice mailbox'}
                                                                    </p>
                                                                </div>
                                                                {sourcingReplyToEmail && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setShowSourcingReplyToAddress((current) => !current)}
                                                                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-gray-700"
                                                                        aria-expanded={showSourcingReplyToAddress}
                                                                        aria-label={showSourcingReplyToAddress ? 'Hide Reply To address' : 'Show Reply To address'}
                                                                    >
                                                                        <svg className={`h-3.5 w-3.5 transition-transform ${showSourcingReplyToAddress ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25-4.51a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {showSourcingReplyToAddress && sourcingReplyToEmail && (
                                                                <p className="mt-1 border-t border-gray-200 pt-1 text-xs text-gray-600">
                                                                    {resolveSourcingReplyTo(sourcingReplyToName, sourcingReplyToEmail)}
                                                                </p>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowSourcingEmailOptions((current) => !current)}
                                                                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-lg leading-none text-gray-600 hover:bg-gray-50"
                                                                aria-label="Open email actions"
                                                                aria-expanded={showSourcingEmailOptions}
                                                            >
                                                                <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                                                            </button>
                                                            {showSourcingEmailOptions && (
                                                                <div className="absolute right-0 top-10 z-10 w-72 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg">
                                                                    {sourcingReplyToEmail && (
                                                                        <p className="mb-3 border-b border-gray-100 pb-3 text-xs text-gray-600">
                                                                            <span className="font-medium text-gray-800">Reply To:</span>{' '}
                                                                            <span className="break-all">{resolveSourcingReplyTo(sourcingReplyToName, sourcingReplyToEmail)}</span>
                                                                        </p>
                                                                    )}
                                                                    <p className="text-xs text-gray-500">
                                                                        Sent from <span className="font-medium text-gray-800">{resolveSourcingSenderEmail(sourcingPracticeName) || 'the default practice mailbox'}</span>
                                                                    </p>
                                                                    {sourcingReplyToEmail && (
                                                                        <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={sourcingBccReplyTo}
                                                                                onChange={(event) => setSourcingBccReplyTo(event.target.checked)}
                                                                            />
                                                                            Bcc: {sourcingReplyToEmail}
                                                                        </label>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <label className="block">
                                                        <span className="text-xs font-medium text-gray-700">Subject</span>
                                                        <input
                                                            type="text"
                                                            value={sourcingQuoteDraft.subject}
                                                            onChange={(event) => setSourcingQuoteDraft((current) => ({ ...current, subject: event.target.value }))}
                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-xs font-medium text-gray-700">Message</span>
                                                            <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSourcingQuoteViewType('html')}
                                                                    className={`rounded px-2 py-1 text-xs font-medium ${sourcingQuoteViewType === 'html' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                                                                >
                                                                    HTML
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSourcingQuoteViewType('text')}
                                                                    className={`rounded px-2 py-1 text-xs font-medium ${sourcingQuoteViewType === 'text' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                                                                >
                                                                    Text
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {sourcingQuoteViewType === 'html' ? (
                                                            <div
                                                                className="mt-1 min-h-[32rem] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 overflow-auto"
                                                                dangerouslySetInnerHTML={{ __html: sourcingQuoteDraft.html || '' }}
                                                            />
                                                        ) : (
                                                            <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-3">
                                                                <p className="text-xs font-medium text-gray-700">Plain Text Fallback</p>
                                                                <p className="mt-1 text-[11px] text-gray-500">This is the plain text version sent alongside the HTML email.</p>
                                                                <pre className="mt-2 min-h-[32rem] whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 text-xs text-gray-800">{sourcingQuoteDraft.body || ''}</pre>
                                                            </div>
                                                        )}
                                                    </label>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                                            <button
                                                type="button"
                                                onClick={closeSourcingWizard}
                                                disabled={sourcingWizardSaving}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                {sourcingQuoteSent ? 'Close' : 'Cancel'}
                                            </button>
                                            {sourcingWizardItem.step > 1 && !sourcingQuoteSent && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSourcingWizardItem((current) => current && { ...current, step: current.step - 1 })}
                                                    disabled={sourcingWizardSaving}
                                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    Back
                                                </button>
                                            )}
                                            {sourcingWizardItem.step === 1 && (
                                                <button
                                                    type="button"
                                                    onClick={confirmSourcingItemDetails}
                                                    disabled={sourcingWizardSaving || !sourcingWizardItem.name.trim()}
                                                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {sourcingWizardSaving ? 'Searching...' : 'Confirm and find suppliers'}
                                                </button>
                                            )}
                                            {sourcingWizardItem.step === 2 && (
                                                <button
                                                    type="button"
                                                    onClick={prepareSourcingQuoteDraft}
                                                    disabled={sourcingWizardSaving || !sourcingSupplierId}
                                                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Draft quote request
                                                </button>
                                            )}
                                            {sourcingWizardItem.step === 3 && !sourcingQuoteSent && (
                                                <button
                                                    type="button"
                                                    onClick={sendSourcingQuoteRequest}
                                                    disabled={sourcingWizardSaving || !sourcingQuoteDraft?.toEmail.trim() || !sourcingQuoteDraft?.subject.trim() || !sourcingQuoteDraft?.body.trim()}
                                                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {sourcingWizardSaving ? 'Sending...' : 'Send quote request'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
        </>
    )
}
