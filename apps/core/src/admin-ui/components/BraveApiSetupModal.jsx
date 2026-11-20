'use client'

import { useState } from 'react'

export default function BraveApiSetupModal({ isOpen, onClose, onSetup, onTest, testing, braveApiStatus }) {
    const [apiKey, setApiKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)

    if (!isOpen) return null

    const handleSave = async () => {
        if (!apiKey.trim()) {
            alert('Please enter the API key')
            return
        }

        setSaving(true)
        setSaveError(null)

        try {
            await onSetup(apiKey)
            setApiKey('')
        } catch (error) {
            setSaveError(error?.message || 'Failed to save configuration')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-gray-300 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Brave API Setup</h2>
                        <p className="text-sm text-gray-600 mt-1">Configure Brave API access</p>
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
                        <h3 className="font-semibold text-gray-900 mb-2">What you need</h3>
                        <p className="text-sm text-gray-700 mb-2">Generate an API key from your Brave dashboard.</p>
                        <a
                            href="https://api.search.brave.com/app/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-900 underline"
                        >
                            Get setup instructions
                        </a>
                    </div>

                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">API Key</label>
                        <input
                            type="text"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={braveApiStatus?.configured && braveApiStatus?.maskedApiKey ? braveApiStatus.maskedApiKey : 'Brave API Key'}
                            className="w-full px-4 py-2 border border-gray-300 focus:ring-1 focus:ring-gray-400 focus:border-gray-400 font-mono text-sm"
                        />
                        {saveError && (
                            <p className="text-sm text-red-600">{saveError}</p>
                        )}
                        <div className="flex gap-3">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-4 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving...' : 'Save to .env.local'}
                            </button>
                            {onTest && (
                                <button
                                    onClick={onTest}
                                    disabled={testing}
                                    className="px-4 py-2 border border-gray-300 text-gray-900 hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {testing ? 'Testing...' : 'Test Key'}
                                </button>
                            )}
                        </div>
                        {braveApiStatus && (
                            <p className="text-xs text-gray-600">
                                Status: {braveApiStatus.configured ? '✅ Configured' : '⚠️ Not configured'}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
