'use client'

export default function PatientReportTab({
    completedReportRows,
    currentReportRow,
    deleteReportRows,
    onRefreshFormalReport,
    onRefreshReportDrafts,
    openReportEditor,
    reportActionMessage,
    reportActionTone,
    reportBulkDeleting,
    reportDeletingKey,
    reportDraftsError,
    reportDraftsLoading,
    reportTableRows,
    reportTypeGroups,
    selectedReportKeys,
    selectedReportRows,
    setReportVersionSelection,
    setSelectedReportKeys,
    workingDraftRow,
}) {
    return (
        <>
<section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">Reports</h3>
                                    <p className="mt-1 text-xs text-gray-600">
                                        {completedReportRows.length} completed report(s){workingDraftRow ? ' and 1 working draft' : ''} for this patient.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {selectedReportRows.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => deleteReportRows(selectedReportRows)}
                                            disabled={reportBulkDeleting}
                                            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {reportBulkDeleting ? 'Deleting...' : `Delete selected (${selectedReportRows.length})`}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onRefreshFormalReport?.()
                                            onRefreshReportDrafts?.()
                                        }}
                                        disabled={reportDraftsLoading}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {reportDraftsLoading ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                </div>
                            </div>

                            {reportActionMessage && (
                                <p className={`rounded-md border px-3 py-2 text-sm ${reportActionTone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                                    {reportActionMessage}
                                </p>
                            )}

                            {reportDraftsError && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reportDraftsError}</p>
                            )}

                            <section className="rounded-lg border-2 border-sky-200 bg-sky-50/40 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Current report</p>
                                        <h4 className="mt-1 text-base font-semibold text-gray-900">
                                            {currentReportRow ? (currentReportRow.patientName ? `${currentReportRow.patientName} report` : 'Latest report') : 'No current report yet'}
                                        </h4>
                                        {currentReportRow?.timestampLabel && <p className="mt-1 text-xs text-gray-600">Updated {currentReportRow.timestampLabel}</p>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {currentReportRow && (
                                            <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                                {String(currentReportRow.statusLabel || currentReportRow.status || 'Ready')}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => currentReportRow && openReportEditor(currentReportRow)}
                                            disabled={!currentReportRow?.reportMarkdown}
                                            className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Open current report
                                        </button>
                                    </div>
                                </div>
                                <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-700">
                                    {currentReportRow?.preview || currentReportRow?.reportMarkdown || 'A current report will appear here after the worker finishes generating it.'}
                                </p>
                            </section>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                                <div>
                                    <h4 className="text-sm font-semibold text-gray-900">Report versions</h4>
                                    <p className="mt-1 text-xs text-gray-500">
                                        {completedReportRows.length} completed report(s) across {reportTypeGroups.length} report type(s). Pick a version to review an older completed report.
                                    </p>
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-md border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="w-10 px-3 py-2 text-left font-semibold text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    aria-label="Select all reports"
                                                    checked={reportTableRows.length > 0 && selectedReportKeys.length === reportTableRows.length}
                                                    onChange={(event) => {
                                                        setSelectedReportKeys(event.target.checked
                                                            ? reportTableRows.map((row) => String(row?.key || '')).filter(Boolean)
                                                            : [])
                                                    }}
                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                />
                                            </th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Report</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Version</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Updated</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {reportTableRows.map((row) => {
                                            const report = row.report || {}
                                            const reportId = String(report?.id || '').trim()
                                            const reportKey = String(row?.key || '')
                                            const reportStatus = String(report?.statusLabel || report?.status || 'Ready').trim() || 'Ready'
                                            const normalizedStatus = reportStatus.toLowerCase()
                                            const statusClass = normalizedStatus === 'ready' || normalizedStatus === 'completed'
                                                ? 'border-green-200 bg-green-50 text-green-700'
                                                : normalizedStatus === 'failed'
                                                    ? 'border-red-200 bg-red-50 text-red-700'
                                                    : normalizedStatus === 'updating' || normalizedStatus === 'update pending'
                                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                        : 'border-blue-200 bg-blue-50 text-blue-700'
                                            const sourceTable = String(report?.sourceTable || '').trim().toLowerCase()
                                            const canOpen = row.kind !== 'in-progress' && Boolean(String(report?.reportMarkdown || '').trim())
                                            const canDelete = Boolean(reportId && sourceTable && sourceTable !== 'pending-ui')
                                            const deletingThisReport = reportDeletingKey === reportKey || reportDeletingKey === reportId

                                            return (
                                                <tr key={row.key}>
                                                    <td className="px-3 py-2 text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Select ${row.label}`}
                                                            checked={selectedReportKeys.includes(reportKey)}
                                                            onChange={(event) => {
                                                                setSelectedReportKeys((prev) => event.target.checked
                                                                    ? Array.from(new Set([...prev, reportKey]))
                                                                    : prev.filter((key) => key !== reportKey))
                                                            }}
                                                            className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                                                        <span className="font-medium text-gray-800">{row.label}</span>
                                                        {row.kind === 'working' && (
                                                            <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">In progress</span>
                                                        )}
                                                        {row.kind === 'completed' && row.versions.length > 1 && (
                                                            <span className="ml-2 text-[11px] text-gray-500">{row.versions.length} versions</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                                        {row.versions && row.versions.length > 1 ? (
                                                            <select
                                                                value={row.versionValue}
                                                                onChange={(event) => setReportVersionSelection((prev) => ({
                                                                    ...prev,
                                                                    [row.groupKey]: event.target.value,
                                                                }))}
                                                                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                                                                aria-label={`Version of ${row.label}`}
                                                            >
                                                                {row.versions.map((version, index) => (
                                                                    <option key={version.rowKey || version.id} value={String(version.rowKey || '')}>
                                                                        {`v${row.versions.length - index} · ${version.timestampLabel || 'Unknown date'}`}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                                                            {reportStatus}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{report.timestampLabel || '-'}</td>
                                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => openReportEditor(report)}
                                                                disabled={!canOpen}
                                                                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Open/Edit
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => deleteReportRows([report])}
                                                                disabled={!canDelete || deletingThisReport || reportBulkDeleting}
                                                                className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                {deletingThisReport ? 'Deleting...' : 'Delete'}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        {!reportDraftsLoading && reportTableRows.length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="px-3 py-4 text-center text-gray-500">
                                                    No reports for this patient yet.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                        </section>
        </>
    )
}
