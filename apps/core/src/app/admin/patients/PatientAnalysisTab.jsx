'use client'

import InfoTooltip from '@/components/InfoTooltip'
import { AnalysisSupportSourceBadges } from './PatientPageParts'
import { formatDraftTimestamp } from './patientUtils'
export default function PatientAnalysisTab({
    analysisAddressedInterventions,
    analysisDeleting,
    analysisDocuments,
    analysisJobLoading,
    analysisJobStatus,
    analysisRecommendedInterventions,
    analysisRerunning,
    analysisStats,
    analysisSummaryText,
    analysisWorkerPrompt,
    onDeleteAnalysis,
    onRefreshAnalysis,
    onRerunAnalysis,
    patientAnalysis,
    patientAnalysisError,
    patientAnalysisLoading,
    selectedSummaryLabel,
    setShowAnalysisMetadata,
    setShowAnalysisPrompt,
    showAnalysisMetadata,
    showAnalysisPrompt,
}) {
    return (
        <>
<section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">Analysis</h3>
                                    <p className="mt-1 text-xs text-gray-600">
                                        FCA Analyst recommendations prepared from patient notes and transcripts.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={onRefreshAnalysis}
                                        disabled={patientAnalysisLoading || analysisJobLoading || analysisDeleting}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {patientAnalysisLoading || analysisJobLoading ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                    <details className="relative inline-block">
                                        <summary
                                            className="list-none cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                            aria-label="Open analysis actions"
                                        >
                                            ⋮
                                        </summary>
                                        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                                            <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                Actions for {selectedSummaryLabel}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.preventDefault()
                                                    setShowAnalysisPrompt(true)
                                                }}
                                                disabled={!patientAnalysis}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                View prompt
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.preventDefault()
                                                    setShowAnalysisMetadata(true)
                                                }}
                                                disabled={!patientAnalysis}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                View metadata
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.preventDefault()
                                                    onRerunAnalysis?.()
                                                }}
                                                disabled={analysisRerunning || analysisDeleting}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {analysisRerunning ? 'Queuing...' : 'Re-run analysis'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.preventDefault()
                                                    onDeleteAnalysis?.()
                                                }}
                                                disabled={!patientAnalysis || analysisDeleting}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {analysisDeleting ? 'Deleting...' : 'Delete analysis'}
                                            </button>
                                        </div>
                                    </details>
                                </div>
                            </div>

                            {patientAnalysisError && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{patientAnalysisError}</p>
                            )}

                            <div className="rounded-md border border-gray-200 bg-white p-4">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                                        {analysisJobLoading ? 'Updating...' : String(analysisJobStatus?.statusLabel || (patientAnalysis ? 'Ready' : 'Waiting')).trim()}
                                    </span>
                                    {patientAnalysis?.updatedAt && <span>Updated {formatDraftTimestamp(patientAnalysis.updatedAt)}</span>}
                                    {analysisStats && (
                                        <span>
                                            {Number(analysisStats.sourceSentenceCount || 0)} source sentence(s) · {Number(analysisStats.transcriptCount || 0)} transcript(s)
                                        </span>
                                    )}
                                    {analysisDocuments.summaryLabel && (
                                        <InfoTooltip
                                            text={analysisDocuments.title}
                                            label="About the reference documents this analysis used"
                                            widthClassName="w-72"
                                            triggerClassName={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${analysisDocuments.tone === 'used'
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : analysisDocuments.tone === 'unused'
                                                    ? 'bg-amber-50 text-amber-800'
                                                    : 'bg-gray-100 text-gray-700'
                                                }`}
                                        >
                                            {analysisDocuments.summaryLabel}
                                        </InfoTooltip>
                                    )}
                                </div>
                                <p className="mt-3 text-sm text-gray-800">
                                    {analysisSummaryText || 'No analysis is available yet. The FCA Analyst worker will prepare intervention recommendations after the next worker run.'}
                                </p>
                            </div>

                            {(analysisAddressedInterventions.length > 0 || analysisRecommendedInterventions.length > 0) ? (
                                <div className="space-y-4">
                                    {analysisAddressedInterventions.length > 0 && (
                                        <div>
                                            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
                                                <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">Addressed</span>
                                                <span className="font-normal normal-case text-gray-500">already in place ({analysisAddressedInterventions.length})</span>
                                            </h4>
                                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                                {analysisAddressedInterventions.map((item, index) => (
                                                    <article key={`addressed-${item?.intervention || 'support'}-${index}`} className="rounded-md border border-sky-200 border-l-4 bg-white p-4">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <h5 className="text-sm font-semibold text-gray-900">
                                                                {String(item?.intervention || 'Support').trim() || 'Support'}
                                                            </h5>
                                                            <span className="inline-flex shrink-0 items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">Addressed</span>
                                                        </div>
                                                        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                                                            {String(item?.justification || '').trim() || 'No justification recorded.'}
                                                        </p>
                                                        <AnalysisSupportSourceBadges sources={item?.sources} sourceNames={item?.sourceNames} />
                                                    </article>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {analysisRecommendedInterventions.length > 0 && (
                                        <div>
                                            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Recommended</span>
                                                <span className="font-normal normal-case text-gray-500">new or increased ({analysisRecommendedInterventions.length})</span>
                                            </h4>
                                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                                {analysisRecommendedInterventions.map((item, index) => (
                                                    <article key={`recommended-${item?.intervention || 'recommendation'}-${index}`} className="rounded-md border border-emerald-200 border-l-4 bg-white p-4">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <h5 className="text-sm font-semibold text-gray-900">
                                                                {String(item?.intervention || 'Recommendation').trim() || 'Recommendation'}
                                                            </h5>
                                                            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Recommended</span>
                                                        </div>
                                                        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                                                            {String(item?.justification || '').trim() || 'No justification recorded.'}
                                                        </p>
                                                        <AnalysisSupportSourceBadges sources={item?.sources} sourceNames={item?.sourceNames} />
                                                    </article>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : patientAnalysis && !patientAnalysisLoading ? (
                                <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                                    <p className="text-sm text-amber-900">
                                        No intervention recommendations are available yet. Refresh analysis after the next FCA Analyst run.
                                    </p>
                                </div>
                            ) : null}

                            {showAnalysisPrompt && patientAnalysis && (
                                <div
                                    className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-label="Analysis worker prompt"
                                    onClick={() => setShowAnalysisPrompt(false)}
                                >
                                    <div
                                        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                            <span className="text-sm font-semibold text-gray-900">Analysis worker prompt</span>
                                            <button
                                                type="button"
                                                onClick={() => setShowAnalysisPrompt(false)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Close
                                            </button>
                                        </div>
                                        <div className="overflow-auto p-4">
                                            <pre className="whitespace-pre-wrap break-words overflow-x-hidden rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800">{analysisWorkerPrompt || 'No worker prompt is recorded for this analysis.'}</pre>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {showAnalysisMetadata && patientAnalysis && (
                                <div
                                    className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-label="Analysis metadata"
                                    onClick={() => setShowAnalysisMetadata(false)}
                                >
                                    <div
                                        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                            <span className="text-sm font-semibold text-gray-900">Analysis metadata</span>
                                            <button
                                                type="button"
                                                onClick={() => setShowAnalysisMetadata(false)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Close
                                            </button>
                                        </div>
                                        <div className="overflow-auto p-4">
                                            <pre className="whitespace-pre-wrap break-words overflow-x-hidden rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800">{JSON.stringify(patientAnalysis, null, 2)}</pre>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
        </>
    )
}
