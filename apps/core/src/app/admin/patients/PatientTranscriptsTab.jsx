'use client'

import { ArrowDown } from 'lucide-react'
import { formatMicrophonePermissionLabel } from './patientMedia'
import { describeSummaryStyleLabel } from './patientPageConfig'
import { TranscriptRowsDisplay } from './PatientPageParts'
import { formatDraftTimestamp } from './patientUtils'
export default function PatientTranscriptsTab({
    activeSummaryGroupItems,
    activeSummaryGroupKey,
    buildSummaryTranscriptOptionLabel,
    hasSelectedSummary,
    hasStoredSummary,
    liveTranscript,
    liveTranscriptRows,
    onDeleteSummary,
    onDeleteTranscription,
    onRefreshSummary,
    onRefreshTranscriptions,
    onRestoreTranscription,
    onStartRecording,
    onStopRecording,
    overviewAgents,
    previousRecordingsPulse,
    previousRecordingsRef,
    recorderActive,
    recorderBusy,
    recorderHint,
    recorderPermission,
    recorderReady,
    recorderSupported,
    scribeJobLoading,
    scribeJobStatus,
    scribeSummary,
    scribeSummaryActionItems,
    scribeSummaryBulletLines,
    scribeSummaryDeleting,
    scribeSummaryError,
    scribeSummaryEvidenceGroups,
    scribeSummaryLoading,
    scribeSummaryText,
    scribeWorkerPrompt,
    scrollToPreviousRecordings,
    selectedSummary,
    selectedSummaryLabel,
    selectedTranscriptId,
    selectedTranscriptPendingDelete,
    selectedTranscriptRecord,
    selectedTranscriptRows,
    setSelectedSummaryStyle,
    setSelectedSummaryTranscriptId,
    setSelectedTranscriptId,
    setShowSummaryMetadata,
    setShowSummaryPrompt,
    showCurrentTranscriptPanel,
    showFullTranscriptPanel,
    showScribeSummaryActionItems,
    showScribeSummaryBullets,
    showScribeSummaryEvidence,
    showSummariesPanel,
    showSummaryMetadata,
    showSummaryPrompt,
    summaryStyleGroups,
    transcriptionDeletingId,
    transcriptionError,
    transcriptionLoading,
    transcriptionRecords,
}) {
    return (
        <>
<section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-gray-900">Live Meeting Transcripts</h3>
                                <div className="flex items-center gap-2">
                                    {transcriptionRecords.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={scrollToPreviousRecordings}
                                            aria-label={`Scroll to Recordings (${transcriptionRecords.length})`}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            Recordings
                                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                                                {transcriptionRecords.length}
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onRefreshTranscriptions}
                                        disabled={transcriptionLoading || recorderBusy}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {transcriptionLoading ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={recorderActive ? onStopRecording : onStartRecording}
                                        disabled={recorderBusy || (!recorderActive && !recorderReady)}
                                        className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${recorderActive ? 'bg-red-700 hover:bg-red-600' : 'bg-gray-900 hover:bg-gray-700'}`}
                                    >
                                        {recorderActive ? 'Stop Recording' : 'Start Recording'}
                                    </button>
                                </div>
                            </div>

                            <p className="text-xs text-gray-500">
                                Microphone permission: {formatMicrophonePermissionLabel(recorderPermission)}
                            </p>

                            {!recorderSupported && (
                                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    This browser does not support MediaRecorder. Try Chrome, Edge, or a recent Safari.
                                </p>
                            )}

                            {recorderSupported && recorderHint && (
                                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    {recorderHint}
                                </p>
                            )}

                            {showCurrentTranscriptPanel && (
                                <div className="rounded-md border border-gray-200 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current Recording Transcript</p>
                                    <p className="mt-1 text-xs text-gray-500">Transcript text is shown one utterance per row.</p>
                                    {!liveTranscript && (
                                        <p className="mt-2 text-xs text-gray-500">
                                            {recorderActive
                                                ? 'Listening for audio... transcript text will appear here as recording uploads are processed.'
                                                : 'No live transcript yet. Start recording to see text appear here.'}
                                        </p>
                                    )}
                                    <textarea
                                        value={liveTranscriptRows}
                                        readOnly
                                        className="mt-2 min-h-[120px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="Live transcript preview"
                                    />
                                </div>
                            )}

                            {showFullTranscriptPanel && selectedTranscriptRecord && (
                                <div className="rounded-md border border-gray-200 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Full Transcript</p>
                                        <div className="flex items-center gap-2">
                                            {selectedTranscriptPendingDelete && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRestoreTranscription(selectedTranscriptRecord)}
                                                    disabled={transcriptionDeletingId === selectedTranscriptRecord?.id}
                                                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {transcriptionDeletingId === selectedTranscriptRecord?.id ? 'Restoring...' : 'Restore'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setSelectedTranscriptId(null)}
                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Close
                                            </button>
                                        </div>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Created {selectedTranscriptRecord?.created_at ? new Date(selectedTranscriptRecord.created_at).toLocaleString() : 'N/A'}
                                        {' '}• Status {String(selectedTranscriptRecord?.status || '-').trim() || '-'}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">Transcript text is shown one utterance per row.</p>
                                    <div className="mt-2 max-h-[520px] overflow-y-auto rounded-md border border-gray-300 px-3 py-2">
                                        <TranscriptRowsDisplay transcript={selectedTranscriptRows} />
                                    </div>
                                </div>
                            )}

                            {!recorderActive && !selectedTranscriptRecord && (
                                transcriptionRecords.length > 0 ? (
                                    <button
                                        type="button"
                                        onClick={scrollToPreviousRecordings}
                                        className="w-full rounded-md border border-gray-200 bg-gray-50 p-3 text-left text-sm text-gray-600 hover:bg-gray-100"
                                    >
                                        Select a transcript from{' '}
                                        <span className="font-medium text-blue-700 underline underline-offset-2">Recordings</span>
                                        , or start recording to view a live transcript.
                                    </button>
                                ) : (
                                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                                        Select a transcript from Recordings, or start recording to view a live transcript.
                                    </div>
                                )
                            )}

                            {showSummariesPanel && (
                                <section className="space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-900">Summaries</h3>
                                            <p className="mt-1 text-xs text-gray-600">
                                                {overviewAgents.scribe === true
                                                    ? 'Latest Transcript Summariser summaries prepared from completed transcripts.'
                                                    : 'Stored transcript summaries from completed transcripts. Transcript Summariser agent is currently disabled for this patient.'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={onRefreshSummary}
                                                disabled={scribeSummaryLoading || scribeJobLoading || scribeSummaryDeleting}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {scribeSummaryLoading || scribeJobLoading ? 'Refreshing...' : 'Refresh'}
                                            </button>
                                            <details className="relative inline-block">
                                                <summary
                                                    className="list-none cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                                    aria-label="Open summary actions"
                                                >
                                                    ⋮
                                                </summary>
                                                <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault()
                                                            setShowSummaryPrompt(true)
                                                        }}
                                                        disabled={!hasSelectedSummary}
                                                        className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        View {selectedSummaryLabel} prompt
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault()
                                                            setShowSummaryMetadata(true)
                                                        }}
                                                        disabled={!hasSelectedSummary}
                                                        className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        View {selectedSummaryLabel} metadata
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault()
                                                            onDeleteSummary?.(String(selectedSummary?.summaryStyle || '').trim())
                                                        }}
                                                        disabled={!hasSelectedSummary || scribeSummaryDeleting}
                                                        className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {scribeSummaryDeleting ? 'Deleting...' : `Delete ${selectedSummaryLabel}`}
                                                    </button>
                                                </div>
                                            </details>
                                        </div>
                                    </div>

                                    {scribeSummaryError && (
                                        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{scribeSummaryError}</p>
                                    )}

                                    {summaryStyleGroups.length > 1 && (
                                        <div className="flex gap-1 border-b border-gray-200" role="tablist" aria-label="Summary versions">
                                            {summaryStyleGroups.map((group) => {
                                                // Compare against the resolved group rather than the raw
                                                // selection so the highlighted view is always the one shown.
                                                const isActive = group.key === activeSummaryGroupKey
                                                return (
                                                    <button
                                                        key={group.key}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={isActive}
                                                        onClick={() => {
                                                            setSelectedSummaryStyle(group.style)
                                                            setSelectedSummaryTranscriptId(null)
                                                        }}
                                                        className={`border-b-2 px-3 py-2 text-xs font-medium ${isActive ? 'border-sky-600 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                                    >
                                                        {describeSummaryStyleLabel(group.style)}
                                                        {group.items.length > 1 && (
                                                            <span className="ml-1.5 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                                                {group.items.length} transcripts
                                                            </span>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    <div className="rounded-md border border-gray-200 bg-white p-4">
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                                                {scribeJobLoading ? 'Updating...' : String(scribeJobStatus?.statusLabel || (scribeSummary ? 'Ready' : 'Waiting')).trim()}
                                            </span>
                                            {overviewAgents.scribe !== true && hasStoredSummary && (
                                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                                    Transcript Summariser off
                                                </span>
                                            )}
                                            {hasSelectedSummary && (
                                                // Names the style being read even when the patient only has one
                                                // style stored and the version tabs therefore do not render.
                                                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                                                    {selectedSummaryLabel}
                                                </span>
                                            )}
                                            {selectedSummary?.updatedAt && <span>Updated {formatDraftTimestamp(selectedSummary.updatedAt)}</span>}
                                            {activeSummaryGroupItems.length > 1 ? (
                                                <label className="inline-flex items-center gap-1">
                                                    <span className="sr-only">Transcript</span>
                                                    <select
                                                        value={String(selectedSummary?.transcriptionId ?? '')}
                                                        onChange={(event) => setSelectedSummaryTranscriptId(event.target.value)}
                                                        className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700"
                                                    >
                                                        {activeSummaryGroupItems.map((item) => (
                                                            <option key={`summary-transcript-${String(item?.id ?? item?.transcriptionId ?? '')}`} value={String(item?.transcriptionId ?? '')}>
                                                                {buildSummaryTranscriptOptionLabel(item)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            ) : (
                                                selectedSummary?.transcriptionId && <span>Transcript #{String(selectedSummary.transcriptionId)}</span>
                                            )}
                                        </div>

                                        {showScribeSummaryBullets && (
                                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-800">
                                                {scribeSummaryBulletLines.map((line, index) => (
                                                    <li key={`summary-topic-${index}`}>{line}</li>
                                                ))}
                                            </ul>
                                        )}

                                        {showScribeSummaryEvidence && (
                                            <div className="mt-3 space-y-3">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Evidence by functional area</p>
                                                {scribeSummaryEvidenceGroups.map((group) => (
                                                    <div key={`summary-evidence-${group.key}`} className="rounded-md border border-gray-200 p-3">
                                                        <h4 className="text-xs font-semibold text-gray-900">{group.label}</h4>
                                                        <ul className="mt-2 space-y-2">
                                                            {group.items.map((item, index) => (
                                                                <li key={`summary-evidence-${group.key}-${index}`} className="rounded-md bg-gray-50 px-3 py-2">
                                                                    {item.observedIssue && <p className="text-sm text-gray-800">{item.observedIssue}</p>}
                                                                    {item.functionalImpact && (
                                                                        <p className="mt-1 text-xs text-gray-600">
                                                                            <span className="font-semibold text-gray-700">Functional impact: </span>
                                                                            {item.functionalImpact}
                                                                        </p>
                                                                    )}
                                                                    {item.supportImplication && (
                                                                        <p className="mt-1 text-xs text-gray-600">
                                                                            <span className="font-semibold text-gray-700">Support implication: </span>
                                                                            {item.supportImplication}
                                                                        </p>
                                                                    )}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {!showScribeSummaryBullets && !showScribeSummaryEvidence && (
                                            <p className="mt-3 text-sm text-gray-800">
                                                {scribeSummaryText || 'No summary is available yet. Transcript Summariser will summarize completed transcripts after the 5-minute delay window.'}
                                            </p>
                                        )}
                                    </div>

                                    {showScribeSummaryActionItems && (
                                        <div className="rounded-md border border-gray-200 bg-white p-4">
                                            <h4 className="text-sm font-semibold text-gray-900">Action items</h4>
                                            <ul className="mt-3 space-y-2 text-sm text-gray-700">
                                                {scribeSummaryActionItems.map((item, index) => (
                                                    <li key={`action-item-${index}`} className="rounded-md bg-gray-50 px-3 py-2">{item}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {showSummaryPrompt && selectedSummary && (
                                        <div
                                            className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                            role="dialog"
                                            aria-modal="true"
                                            aria-label="Summary worker prompt"
                                            onClick={() => setShowSummaryPrompt(false)}
                                        >
                                            <div
                                                className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                                    <span className="text-sm font-semibold text-gray-900">{selectedSummaryLabel} worker prompt</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSummaryPrompt(false)}
                                                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                                    >
                                                        Close
                                                    </button>
                                                </div>
                                                <div className="overflow-auto p-4">
                                                    <pre className="whitespace-pre-wrap break-words overflow-x-hidden rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800">{scribeWorkerPrompt || 'No worker prompt is recorded for this summary.'}</pre>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {showSummaryMetadata && selectedSummary && (
                                        <div
                                            className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                            role="dialog"
                                            aria-modal="true"
                                            aria-label="Summary metadata"
                                            onClick={() => setShowSummaryMetadata(false)}
                                        >
                                            <div
                                                className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                                    <span className="text-sm font-semibold text-gray-900">{selectedSummaryLabel} metadata</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSummaryMetadata(false)}
                                                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                                    >
                                                        Close
                                                    </button>
                                                </div>
                                                <div className="overflow-auto p-4">
                                                    <pre className="whitespace-pre-wrap break-words overflow-x-hidden rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800">{JSON.stringify(selectedSummary, null, 2)}</pre>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </section>
                            )}

                            <div
                                ref={previousRecordingsRef}
                                className={`space-y-2 rounded-md transition-shadow ${previousRecordingsPulse ? 'ring-2 ring-sky-400 ring-offset-4' : ''}`}
                            >
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recordings</p>
                                <div className="overflow-x-auto rounded-md border border-gray-200">
                                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-semibold text-gray-700">Created</th>
                                                <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                                <th className="px-3 py-2 text-left font-semibold text-gray-700">Preview</th>
                                                <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white">
                                            {transcriptionRecords.map((record) => {
                                                const created = record?.created_at
                                                    ? new Date(record.created_at).toLocaleString()
                                                    : 'N/A'
                                                const preview = String(record?.transcript_text || '').trim() || '-'
                                                const isSelected = String(selectedTranscriptId || '') === String(record?.id || '')
                                                const isPendingDelete = String(record?.status || '').trim().toLowerCase() === 'pending delete'
                                                return (
                                                    <tr key={record.id} className={isSelected ? 'bg-blue-50/40' : isPendingDelete ? 'bg-amber-50/50' : ''}>
                                                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{created}</td>
                                                        <td className="px-3 py-2 text-gray-700">
                                                            {isPendingDelete ? (
                                                                <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Recently deleted</span>
                                                            ) : record?.status || '-'}
                                                        </td>
                                                        <td className="px-3 py-2 text-gray-700">{preview.length > 180 ? `${preview.slice(0, 180)}...` : preview}</td>
                                                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSelectedTranscriptId(record?.id || null)}
                                                                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${isSelected ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                                                                >
                                                                    {isSelected ? 'Viewing' : 'View'}
                                                                </button>
                                                                {!isPendingDelete && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onDeleteTranscription(record)}
                                                                        disabled={transcriptionDeletingId === record?.id}
                                                                        className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                                    >
                                                                        {transcriptionDeletingId === record?.id ? 'Deleting...' : 'Delete'}
                                                                    </button>
                                                                )}
                                                                {isPendingDelete && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onRestoreTranscription(record)}
                                                                        disabled={transcriptionDeletingId === record?.id}
                                                                        className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                                    >
                                                                        {transcriptionDeletingId === record?.id ? 'Restoring...' : 'Restore'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                            {!transcriptionLoading && transcriptionRecords.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                                                        No transcripts for this patient yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {transcriptionError && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{transcriptionError}</p>
                            )}
                        </section>
        </>
    )
}
