'use client'

import { useState } from 'react'

export default function AsanaContactSetupModal({
    isOpen,
    onClose,
    asanaContactSettings,
    onUpdate,
    onSave,
    loading,
    saving,
    asanaContactStatus,
    asanaAccessToken,
    showAsanaAccessToken,
    loadingAsanaAccessToken,
    onToggleAsanaAccessTokenVisibility
}) {
    if (!isOpen) return null

    const handleFieldChange = (field, value) => {
        onUpdate(field, value)
    }

    const handleSave = async () => {
        await onSave()
    }

    const accessTokenLabel = asanaContactStatus.accessTokenConfigured
        ? (showAsanaAccessToken
            ? asanaAccessToken || 'Loading token...'
            : 'Configured (hidden)')
        : 'Missing ASANA_ACCESS_TOKEN'

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-gray-300 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Website Contact to Asana</h2>
                        <p className="text-sm text-gray-600 mt-1">Configure Asana contact task routing</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="border border-gray-300 p-4">
                        <h3 className="font-semibold text-gray-900 mb-2">About this integration</h3>
                        <p className="text-sm text-gray-700 mb-2">
                            Public submissions from /contact create Asana tasks in your configured project. Make sure your ASANA_ACCESS_TOKEN is set in your environment.
                        </p>
                        <div className="mt-3 space-y-2 text-xs text-gray-500">
                            <div className="flex flex-wrap items-center gap-2">
                                <p>
                                    Access token: <span className="font-mono text-gray-700 break-all">{accessTokenLabel}</span>
                                </p>
                                {asanaContactStatus.accessTokenConfigured && (
                                    <button
                                        type="button"
                                        onClick={onToggleAsanaAccessTokenVisibility}
                                        disabled={loading || saving || loadingAsanaAccessToken}
                                        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {showAsanaAccessToken ? 'Hide' : (loadingAsanaAccessToken ? 'Loading...' : 'Show')}
                                    </button>
                                )}
                            </div>
                            <p>Live status: {asanaContactStatus.configured ? '✅ Ready for public submissions' : '⚠️ Incomplete configuration'}</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="asana-contact-enabled"
                                checked={asanaContactSettings.enabled}
                                onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                                disabled={loading || saving}
                            />
                            <label htmlFor="asana-contact-enabled" className="text-sm font-medium text-gray-700">
                                Enable public contact routing
                            </label>
                        </div>
                    </div>

                    <div className="space-y-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="text-sm text-gray-700">
                            <span className="font-medium">Task name prefix</span>
                            <input
                                type="text"
                                value={asanaContactSettings.taskNamePrefix}
                                onChange={(e) => handleFieldChange('taskNamePrefix', e.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                disabled={loading || saving}
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            <span className="font-medium">Project GID</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={asanaContactSettings.projectGid}
                                onChange={(e) => handleFieldChange('projectGid', e.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                placeholder="1200000000000000"
                                disabled={loading || saving}
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            <span className="font-medium">Section GID</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={asanaContactSettings.sectionGid}
                                onChange={(e) => handleFieldChange('sectionGid', e.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                placeholder="Optional"
                                disabled={loading || saving}
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            <span className="font-medium">Assignee GID</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={asanaContactSettings.assigneeGid}
                                onChange={(e) => handleFieldChange('assigneeGid', e.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                placeholder="Optional"
                                disabled={loading || saving}
                            />
                        </label>

                        <label className="text-sm text-gray-700 md:col-span-2">
                            <span className="font-medium">Tag GIDs</span>
                            <input
                                type="text"
                                value={asanaContactSettings.tagGids.join(', ')}
                                onChange={(e) => handleFieldChange('tagGids', e.target.value)}
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                placeholder="Comma-separated, optional"
                                disabled={loading || saving}
                            />
                        </label>
                    </div>

                    <p className="text-xs text-gray-500">
                        Save the destination here, then set the homepage Contact CTA link to /contact in Homepage settings.
                    </p>

                    <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                        <button
                            onClick={onClose}
                            disabled={loading || saving}
                            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading || saving}
                            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
