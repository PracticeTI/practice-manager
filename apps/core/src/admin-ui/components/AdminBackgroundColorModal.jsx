'use client'

import { useState, useEffect } from 'react'

export default function AdminBackgroundColorModal({ isOpen, onClose, domain, onSave, loading }) {
    const [color, setColor] = useState('#f8fafc')
    const [defaultColor, setDefaultColor] = useState('#f8fafc')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)

    useEffect(() => {
        if (!isOpen || !domain) return

        const fetchSettings = async () => {
            try {
                const response = await fetch(`/api/settings/admin-background-color?domain=${encodeURIComponent(domain)}`, {
                    cache: 'no-store'
                })
                if (!response.ok) return

                const data = await response.json()
                setDefaultColor(data.defaultColor || '#f8fafc')
                setColor(data.settings?.color || data.defaultColor || '#f8fafc')
            } catch (error) {
                console.error('Failed to fetch admin background color:', error)
            }
        }

        fetchSettings()
    }, [isOpen, domain])

    if (!isOpen) return null

    const handleSave = async () => {
        if (!domain) {
            alert('Domain is required')
            return
        }

        setSaving(true)
        setSaveError(null)

        try {
            await onSave({
                domain,
                settings: { color },
                adminToken: localStorage.getItem('adminToken')
            })
            onClose()
        } catch (error) {
            setSaveError(error?.message || 'Failed to save admin background color')
        } finally {
            setSaving(false)
        }
    }

    const handleReset = () => {
        setColor(defaultColor)
        setSaveError(null)
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-gray-300 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Admin Panel Background Color</h2>
                        <p className="text-sm text-gray-600 mt-1">Customize the background color for {domain} admin pages</p>
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
                    <div className="border border-gray-300 p-4 bg-gray-50">
                        <h3 className="font-semibold text-gray-900 mb-2">Current Configuration</h3>
                        <p className="text-sm text-gray-700">
                            <span className="font-medium">Homepage Color:</span> {defaultColor}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                            Leave the admin background color empty to match the homepage.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Admin Background Color
                            </label>
                            <div className="flex gap-3 items-end">
                                <div className="flex-1">
                                    <input
                                        type="color"
                                        value={color}
                                        onChange={(e) => setColor(e.target.value)}
                                        className="w-full h-12 border border-gray-300 cursor-pointer"
                                        title="Pick a color"
                                    />
                                </div>
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        value={color}
                                        onChange={(e) => {
                                            const val = e.target.value.trim()
                                            if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
                                                setColor(val)
                                            }
                                        }}
                                        placeholder="#f8fafc"
                                        className="w-full px-3 py-2 border border-gray-300 font-mono text-sm"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Enter a hex color code (e.g., #f8fafc) or use the color picker
                            </p>
                        </div>

                        <div className="border-t border-gray-200 pt-4">
                            <p className="text-sm font-medium text-gray-700 mb-2">Preview</p>
                            <div
                                className="border border-gray-300 p-8 rounded"
                                style={{ backgroundColor: color }}
                            >
                                <p className="text-gray-600 text-center">Admin Panel Background</p>
                            </div>
                        </div>

                        {saveError && (
                            <p className="text-sm text-red-600">{saveError}</p>
                        )}

                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving || loading}
                                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                            >
                                {saving || loading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                onClick={handleReset}
                                disabled={saving || loading}
                                className="px-4 py-2 bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                            >
                                Reset to Homepage Color
                            </button>
                            <button
                                onClick={onClose}
                                disabled={saving || loading}
                                className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
