'use client'

import { useState, useEffect } from 'react'

export default function DomainBackendModal({
    isOpen,
    onClose,
    onSetup,
    domainBackendStatus,
    onTestConnection,
    testingConnection
}) {
    const [url, setUrl] = useState('')
    const [secret, setSecret] = useState('')
    const [showSecret, setShowSecret] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)

    useEffect(() => {
        // Reset form when modal closes
        if (!isOpen) {
            const timeoutId = window.setTimeout(() => {
                setUrl('')
                setSecret('')
                setShowSecret(false)
                setSaveError(null)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [isOpen])

    const handleSave = async () => {
        if (!url.trim()) {
            setSaveError('Domain Backend URL is required')
            return
        }
        if (!secret.trim()) {
            setSaveError('Domain Backend Secret is required')
            return
        }

        setSaving(true)
        setSaveError(null)
        try {
            await onSetup({ url, secret })
            onClose()
        } catch (error) {
            setSaveError(error.message)
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">Domain Backend Configuration</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label="Close"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Info Box */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div className="text-sm text-blue-800">
                                    <p className="font-medium mb-1">About Domain Backend</p>
                                    <p>The domain backend is a dedicated service that handles scheduled workers and specialized processing for the practice platform.</p>
                                </div>
                            </div>
                        </div>

                        {/* Status */}
                        {domainBackendStatus && (
                            <div className={`border rounded-lg p-4 ${domainBackendStatus.online ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
                                <div className="flex items-center gap-3">
                                    <span className={`inline-block w-3 h-3 rounded-full ${domainBackendStatus.online ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                                    <div>
                                        <p className={`font-medium ${domainBackendStatus.online ? 'text-green-900' : 'text-orange-900'}`}>
                                            {domainBackendStatus.online ? '✅ Online' : '⚠️ Offline'}
                                        </p>
                                        {domainBackendStatus.version && (
                                            <p className="text-xs text-gray-600 mt-1">Version: {domainBackendStatus.version}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {saveError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <p className="text-sm text-red-800">{saveError}</p>
                            </div>
                        )}

                        {/* Domain Backend URL */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Domain Backend URL *
                            </label>
                            <input
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="http://localhost:3003"
                                className="w-full px-3 py-2 border border-gray-300 rounded text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 font-mono text-sm"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                The URL where your domain backend is running
                            </p>
                        </div>

                        {/* Domain Backend Secret */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Domain Backend Secret *
                            </label>
                            <div className="relative">
                                <input
                                    type={showSecret ? 'text' : 'password'}
                                    value={secret}
                                    onChange={(e) => setSecret(e.target.value)}
                                    placeholder="dev-practice-shared-secret-XXXX"
                                    className="w-full px-3 py-2 border border-gray-300 rounded text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 font-mono text-sm pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showSecret ? (
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-14-14zM2 10a8 8 0 1113.657-3.657L2 13.657V10zm9.165-7.02a1 1 0 011.414 0A8 8 0 0110 18a8 8 0 01-7.02-14.165l1.414 1.414A6 6 0 0110 14a6 6 0 005.165-9.02z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                                Shared secret for authentication (must match CORE_BACKEND_SECRET in domain backend)
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-8 pt-6 border-t border-gray-200">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium rounded"
                        >
                            Cancel
                        </button>
                        {domainBackendStatus?.online && (
                            <button
                                onClick={onTestConnection}
                                disabled={testingConnection}
                                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {testingConnection ? 'Testing...' : 'Test Connection'}
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="ml-auto px-4 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
