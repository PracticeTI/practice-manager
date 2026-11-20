'use client'

import { useEffect, useRef, useState } from 'react'

export default function SmartPageEditor({
    item = {},
    editingData = {},
    isReadOnly = false,
    isSaving = false,
    error = '',
    onChange,
    onImportWit,
    onEditWithAgent,
}) {
    const [aiPrompt, setAiPrompt] = useState('')
    const [isImporting, setIsImporting] = useState(false)
    const [showImportForm, setShowImportForm] = useState(false)
    const [witPayloadUrl, setWitPayloadUrl] = useState('')
    const [aiState, setAiState] = useState(() => {
        const attrs = editingData?.attributes || {}
        return attrs.ai_state || { status: 'idle', messages: [] }
    })
    const textareaRef = useRef(null)

    const witPayload = editingData?.attributes?.wit_source_payload || null
    const editorMode = editingData?.attributes?.editor_mode || 'smart'

    const resizeTextarea = (el) => {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 300)}px`
    }

    const handleAiPromptChange = (value) => {
        setAiPrompt(value)
        if (textareaRef.current) {
            resizeTextarea(textareaRef.current)
        }
    }

    const sendAiEdit = async () => {
        if (!aiPrompt.trim() || isReadOnly || isSaving) return

        try {
            setAiState(prev => ({
                ...prev,
                status: 'processing',
                messages: [
                    ...prev.messages,
                    {
                        role: 'user',
                        content: aiPrompt,
                        timestamp: new Date().toISOString()
                    }
                ]
            }))

            const response = await fetch('/api/content/smart-page/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contentId: item?.id,
                    prompt: aiPrompt,
                    currentData: editingData,
                    witPayload: witPayload,
                })
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || `HTTP ${response.status}`)
            }

            const result = await response.json()

            // Update editing data with AI modifications
            if (onChange && result.updatedData) {
                onChange('attributes', {
                    ...editingData.attributes,
                    ai_state: {
                        ...aiState,
                        status: 'idle',
                        messages: [
                            ...aiState.messages,
                            {
                                role: 'assistant',
                                content: result.summary,
                                timestamp: new Date().toISOString(),
                                changes: result.changes
                            }
                        ]
                    }
                })

                if (result.updatedData.title) {
                    onChange('title', result.updatedData.title)
                }
                if (result.updatedData.summary) {
                    onChange('preview', result.updatedData.summary)
                }
                if (result.updatedData.body) {
                    onChange('body', result.updatedData.body)
                }
            }

            setAiPrompt('')
        } catch (err) {
            console.error('AI edit error:', err)
            setAiState(prev => ({
                ...prev,
                status: 'error',
                error: err.message
            }))
        }
    }

    const handleImportWit = async () => {
        if (!witPayloadUrl.trim() || isReadOnly) return

        setIsImporting(true)
        try {
            const response = await fetch('/api/content/smart-page/import-wit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    witUrl: witPayloadUrl,
                    contentId: item?.id,
                })
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || `HTTP ${response.status}`)
            }

            const result = await response.json()

            if (onChange && result.payload) {
                onChange('attributes', {
                    ...editingData.attributes,
                    wit_source_payload: result.payload,
                    editor_mode: 'smart'
                })

                // Populate title and summary from WIT
                if (result.payload.title) {
                    onChange('title', result.payload.title)
                }
                if (result.payload.summary) {
                    onChange('preview', result.payload.summary)
                }
                if (result.payload.body) {
                    onChange('body', result.payload.body)
                }
            }

            setWitPayloadUrl('')
            setShowImportForm(false)
        } catch (err) {
            console.error('WIT import error:', err)
        } finally {
            setIsImporting(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">🤖</span>
                    <div>
                        <h3 className="font-semibold text-gray-900">Smart Page Editor</h3>
                        <p className="text-sm text-gray-600">Powered by AI agent – import from WIT or edit with natural language</p>
                    </div>
                </div>
            </div>

            {/* Import Section */}
            {!witPayload && (
                <div className="border border-dashed border-gray-300 rounded-lg p-4">
                    {!showImportForm ? (
                        <button
                            onClick={() => setShowImportForm(true)}
                            disabled={isReadOnly}
                            className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-center text-gray-600 hover:text-blue-600 font-medium"
                        >
                            📥 Import from WIT
                        </button>
                    ) : (
                        <div className="space-y-3">
                            <label className="block text-sm font-medium text-gray-700">
                                WIT Payload URL or Path
                            </label>
                            <input
                                type="text"
                                value={witPayloadUrl}
                                onChange={e => setWitPayloadUrl(e.target.value)}
                                placeholder="e.g., https://exports.example.com/api/exports/default/8"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                disabled={isImporting}
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleImportWit}
                                    disabled={!witPayloadUrl.trim() || isImporting}
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                                >
                                    {isImporting ? 'Importing...' : 'Import'}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowImportForm(false)
                                        setWitPayloadUrl('')
                                    }}
                                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* WIT Source Info */}
            {witPayload && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <span className="text-lg">📋</span>
                        <div className="flex-1">
                            <h4 className="font-medium text-gray-900 mb-1">WIT Source Loaded</h4>
                            <p className="text-sm text-gray-600 mb-3">
                                {witPayload.title || 'Untitled source'} – Ready for AI edits
                            </p>
                            <button
                                onClick={() => {
                                    if (onChange) {
                                        onChange('attributes', {
                                            ...editingData.attributes,
                                            wit_source_payload: null
                                        })
                                    }
                                }}
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                                Clear source
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Conversation */}
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-4">
                <h4 className="font-semibold text-gray-900">AI Agent Conversation</h4>

                {/* Messages */}
                {aiState.messages.length > 0 && (
                    <div className="space-y-3 bg-white rounded-lg p-3 max-h-64 overflow-y-auto">
                        {aiState.messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-3 ${msg.role === 'assistant' ? 'bg-blue-50 p-3 rounded' : ''}`}>
                                <span className="text-lg flex-shrink-0 mt-1">
                                    {msg.role === 'user' ? '👤' : '🤖'}
                                </span>
                                <div className="flex-1">
                                    <p className="text-sm text-gray-700">{msg.content}</p>
                                    {msg.changes && (
                                        <div className="text-xs text-gray-500 mt-2 space-y-1">
                                            <p className="font-medium">Changes made:</p>
                                            <ul className="list-disc list-inside">
                                                {Object.entries(msg.changes).map(([key, val]) => (
                                                    <li key={key}>{key}: {String(val).substring(0, 50)}...</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {aiState.error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                        Error: {aiState.error}
                    </div>
                )}

                {/* Prompt Input */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Tell the agent what to edit
                    </label>
                    <textarea
                        ref={textareaRef}
                        value={aiPrompt}
                        onChange={e => handleAiPromptChange(e.target.value)}
                        placeholder="e.g., 'Make the title more compelling' or 'Add details about services' or 'Rewrite the summary to be more professional'"
                        disabled={isReadOnly || isSaving || aiState.status === 'processing'}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono resize-none disabled:bg-gray-100"
                        style={{ minHeight: '80px' }}
                    />
                    <button
                        onClick={sendAiEdit}
                        disabled={!aiPrompt.trim() || isReadOnly || isSaving || aiState.status === 'processing'}
                        className="w-full py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                        {aiState.status === 'processing' ? 'Processing...' : '✨ Edit with AI'}
                    </button>
                </div>
            </div>

            {/* Direct Edit Section */}
            <div className="space-y-4 border-t pt-4">
                <h4 className="font-semibold text-gray-900">Direct Edits</h4>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                    <input
                        type="text"
                        value={editingData?.title || ''}
                        onChange={e => onChange?.('title', e.target.value)}
                        disabled={isReadOnly}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        placeholder="Page title"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Summary</label>
                    <textarea
                        value={editingData?.preview || ''}
                        onChange={e => onChange?.('preview', e.target.value)}
                        disabled={isReadOnly}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
                        rows="3"
                        placeholder="Brief summary"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Body</label>
                    <textarea
                        value={editingData?.body || ''}
                        onChange={e => onChange?.('body', e.target.value)}
                        disabled={isReadOnly}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
                        rows="8"
                        placeholder="Full page content"
                    />
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                    {error}
                </div>
            )}
        </div>
    )
}
