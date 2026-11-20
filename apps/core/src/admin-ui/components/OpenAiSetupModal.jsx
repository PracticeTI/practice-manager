'use client'

import { useEffect, useState } from 'react'

const FALLBACK_MODEL_OPTIONS = [
    'gpt-5.5',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini'
]

export default function OpenAiSetupModal({ isOpen, onClose, onSetup, openAiStatus, onTestOpenAi, testingOpenAi }) {
    const [apiKey, setApiKey] = useState('')
    const [selectedModel, setSelectedModel] = useState(openAiStatus?.model || 'gpt-5.5')
    const [modelOptions, setModelOptions] = useState(FALLBACK_MODEL_OPTIONS)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)

    useEffect(() => {
        if (!isOpen) return

        const statusModel = typeof openAiStatus?.model === 'string' && openAiStatus.model.trim()
            ? openAiStatus.model.trim()
            : 'gpt-5.5'
        const modelTimeoutId = window.setTimeout(() => {
            setSelectedModel(statusModel)
        }, 0)

        let cancelled = false

        const loadModels = async () => {
            try {
                const response = await fetch('/api/openai/models', { cache: 'no-store' })
                const data = await response.json().catch(() => ({}))

                const apiModels = Array.isArray(data?.models)
                    ? data.models.map((model) => String(model || '').trim()).filter(Boolean)
                    : []
                const merged = Array.from(new Set([
                    statusModel,
                    ...apiModels,
                    ...FALLBACK_MODEL_OPTIONS
                ])).filter(Boolean)

                if (!cancelled && merged.length > 0) {
                    setModelOptions(merged)
                }
            } catch {
                // Keep fallback model options when endpoint is unavailable.
                if (!cancelled) {
                    setModelOptions(Array.from(new Set([statusModel, ...FALLBACK_MODEL_OPTIONS])).filter(Boolean))
                }
            }
        }

        loadModels()
        return () => {
            window.clearTimeout(modelTimeoutId)
            cancelled = true
        }
    }, [isOpen, openAiStatus?.model])

    if (!isOpen) return null

    const handleSave = async () => {
        const trimmedApiKey = apiKey.trim()
        const hasConfiguredKey = Boolean(openAiStatus?.configured)

        if (!selectedModel) {
            alert('Please select a model')
            return
        }

        setSaving(true)
        setSaveError(null)

        try {
            await onSetup({
                apiKey: trimmedApiKey,
                model: selectedModel
            })
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
                        <h2 className="text-xl font-semibold text-gray-900">OpenAI API Setup</h2>
                        <p className="text-sm text-gray-600 mt-1">Configure OpenAI API access</p>
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
                        <p className="text-sm text-gray-700 mb-2">Generate an API key from your OpenAI dashboard.</p>
                        <a
                            href="https://platform.openai.com/api-keys"
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
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={openAiStatus?.configured && openAiStatus?.maskedApiKey ? openAiStatus.maskedApiKey : 'sk-...'}
                            className="w-full px-4 py-2 border border-gray-300 focus:ring-1 focus:ring-gray-400 focus:border-gray-400 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 -mt-2">
                            Leave blank to keep the current key. You can save the model selection independently.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 focus:ring-1 focus:ring-gray-400 focus:border-gray-400 text-sm bg-white"
                            >
                                {modelOptions.map((model) => (
                                    <option key={model} value={model}>{model}</option>
                                ))}
                            </select>
                        </div>
                        {saveError && (
                            <p className="text-sm text-red-600">{saveError}</p>
                        )}
                        <div className="flex gap-3">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-4 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                            {onTestOpenAi && (
                                <button
                                    onClick={onTestOpenAi}
                                    disabled={testingOpenAi}
                                    className="px-4 py-2 border border-gray-300 text-gray-900 hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {testingOpenAi ? 'Testing...' : 'Test Key'}
                                </button>
                            )}
                        </div>
                        {openAiStatus && (
                            <p className="text-xs text-gray-600">
                                Status: {openAiStatus.configured ? '✅ Configured' : '⚠️ Not configured'}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
