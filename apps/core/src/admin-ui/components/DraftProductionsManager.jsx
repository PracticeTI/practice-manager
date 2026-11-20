'use client'

import { useState, useEffect } from 'react'

function formatCacheNotice(domains) {
    const unique = Array.from(new Set((domains || []).filter(Boolean)))
    return unique.length > 0 ? ` Cache cleared for ${unique.join(', ')}.` : ''
}

export default function DraftProductionsManager({ backendOnline }) {
    const [drafts, setDrafts] = useState([])
    const [loading, setLoading] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [editForm, setEditForm] = useState({})
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [successMessage, setSuccessMessage] = useState(null)
    const [statusFilter, setStatusFilter] = useState('all')
    const [deletingAll, setDeletingAll] = useState(false)

    useEffect(() => {
        if (backendOnline) {
            loadDrafts()
        }
    }, [backendOnline])

    async function loadDrafts() {
        setLoading(true)
        setError(null)
        try {
            const response = await fetch('/api/content?type=production&limit=1000', {
                mode: 'cors',
                cache: 'no-store'
            })

            if (response.ok) {
                const result = await response.json()
                // Modern API returns canonical node structure; map it for UI
                const transformed = (result.content || []).map(node => ({
                    id: node.id,
                    name: node.metadata?.presentation?.default?.title || 'Untitled',
                    status: node.attributes?.status || 'draft',
                    borough: node.attributes?.borough || '',
                    neighborhood: node.attributes?.neighborhood || '',
                    area: node.attributes?.area || '',
                    summary: node.metadata?.presentation?.default?.summary || '',
                    description: node.metadata?.presentation?.default?.summary || '',
                    metadata: node.metadata,
                    created_at: node.created_at
                }))
                setDrafts(transformed)
            } else {
                setError(`Error loading drafts: ${response.status}`)
            }
        } catch (err) {
            console.error('Error loading drafts:', err)
            setError('Failed to load drafts')
        } finally {
            setLoading(false)
        }
    }

    const startEdit = (draft) => {
        const summaryText = draft?.metadata?.summary || draft?.summary || draft?.description || ''
        setEditingId(draft.id)
        setEditForm({
            id: draft.id,
            name: draft.name || '',
            summary: summaryText,
            status: draft.status || 'draft',
            borough: draft.borough || '',
            neighborhood: draft.neighborhood || '',
            area: draft.area || ''
        })
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditForm({})
        setError(null)
    }

    const handleInputChange = (field, value) => {
        setEditForm(prev => ({
            ...prev,
            [field]: value
        }))
    }

    const saveEdit = async () => {
        setSaving(true)
        setError(null)
        try {
            const currentDraft = drafts.find((draft) => draft.id === editForm.id)
            const metadata = {
                ...(currentDraft?.metadata || {}),
                presentation: {
                    ...(currentDraft?.metadata?.presentation || {}),
                    default: {
                        ...(currentDraft?.metadata?.presentation?.default || {}),
                        title: editForm.name,
                        summary: editForm.summary || ''
                    }
                }
            }

            const response = await fetch(`/api/content/${editForm.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editForm.name,
                    status: editForm.status,
                    borough: editForm.borough,
                    neighborhood: editForm.neighborhood,
                    area: editForm.area,
                    metadata
                })
            })

            const result = await response.json().catch(() => ({}))

            if (response.ok) {
                await loadDrafts()
                setEditingId(null)
                setEditForm({})
                const cacheNote = formatCacheNotice(result?.cacheInvalidatedDomains)
                if (cacheNote) setSuccessMessage(`Saved.${cacheNote}`)
            } else {
                setError(`Error saving: ${result.error || response.status}`)
            }
        } catch (err) {
            console.error('Error saving production:', err)
            setError('Failed to save production')
        } finally {
            setSaving(false)
        }
    }

    const deleteDraft = async (id) => {
        if (!confirm('Are you sure you want to delete this draft production?')) {
            return
        }

        setError(null)
        try {
            const response = await fetch(`/api/content/${id}`, {
                method: 'DELETE'
            })

            const result = await response.json().catch(() => ({}))

            if (response.ok) {
                await loadDrafts()
                const cacheNote = formatCacheNotice(result?.cacheInvalidatedDomains)
                if (cacheNote) setSuccessMessage(`Deleted.${cacheNote}`)
            } else {
                setError(`Error deleting: ${result.error || response.status}`)
            }
        } catch (err) {
            console.error('Error deleting production:', err)
            setError('Failed to delete production')
        }
    }

    const updateStatus = async (id, newStatus) => {
        setError(null)
        try {
            const response = await fetch(`/api/content/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    published_at: newStatus === 'published' ? new Date().toISOString() : null
                })
            })

            const result = await response.json().catch(() => ({}))

            if (response.ok) {
                await loadDrafts()
                const cacheNote = formatCacheNotice(result?.cacheInvalidatedDomains)
                if (cacheNote) setSuccessMessage(`Status updated.${cacheNote}`)
            } else {
                setError(`Error updating status: ${result.error || response.status}`)
            }
        } catch (err) {
            console.error('Error updating status:', err)
            setError('Failed to update status')
        }
    }

    const deleteAllByStatus = async (status) => {
        if (!['test', 'draft'].includes(status)) {
            setError('Bulk delete is only available for Test or Draft statuses.')
            return
        }

        if (!confirm(`Delete all productions with status "${status}"? This cannot be undone.`)) {
            return
        }

        setDeletingAll(true)
        setError(null)

        try {
            // Get all items with this status
            const itemsToDelete = drafts.filter(d => d.status === status)

            if (itemsToDelete.length === 0) {
                setError('No items found with this status')
                return
            }

            let deleted = 0
            let failed = 0

            // Delete each item using modern API
            for (const item of itemsToDelete) {
                try {
                    const response = await fetch(`/api/content/${item.id}`, {
                        method: 'DELETE'
                    })

                    if (response.ok) {
                        deleted++
                    } else {
                        failed++
                    }
                } catch (err) {
                    console.error('Error deleting item:', item.id, err)
                    failed++
                }
            }

            if (deleted > 0) {
                await loadDrafts()
            }

            if (failed > 0) {
                setError(`Deleted ${deleted} items, ${failed} failed`)
            }
        } catch (err) {
            console.error('Error deleting productions:', err)
            setError('Failed to delete productions')
        } finally {
            setDeletingAll(false)
        }
    }



    const filteredDrafts = statusFilter === 'all'
        ? drafts
        : drafts.filter(d => d.status === statusFilter)

    const statusCounts = drafts.reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1
        return acc
    }, {})

    if (!backendOnline) {
        return (
            <div className="border border-gray-300 p-6">
                <h2 className="text-xl font-semibold mb-4">Productions</h2>
                <p className="text-gray-500">API offline - cannot load productions</p>
            </div>
        )
    }

    return (
        <div className="border border-gray-300 p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Productions</h2>
                <button
                    onClick={loadDrafts}
                    disabled={loading}
                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"
                >
                    {loading ? 'Loading...' : 'Refresh'}
                </button>
            </div>

            <div className="mb-4 flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">Filter by status:</span>
                <div className="flex gap-2">
                    <button
                        onClick={() => setStatusFilter('all')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${statusFilter === 'all'
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        All ({drafts.length})
                    </button>
                    <button
                        onClick={() => setStatusFilter('test')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${statusFilter === 'test'
                            ? 'bg-blue-600 text-white'
                            : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                            }`}
                    >
                        Test ({statusCounts.test || 0})
                    </button>
                    <button
                        onClick={() => setStatusFilter('draft')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${statusFilter === 'draft'
                            ? 'bg-yellow-500 text-white'
                            : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            }`}
                    >
                        Draft ({statusCounts.draft || 0})
                    </button>
                    <button
                        onClick={() => setStatusFilter('published')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${statusFilter === 'published'
                            ? 'bg-green-600 text-white'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                    >
                        Published ({statusCounts.published || 0})
                    </button>
                    <button
                        onClick={() => setStatusFilter('archived')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${statusFilter === 'archived'
                            ? 'bg-gray-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Archived ({statusCounts.archived || 0})
                    </button>
                </div>
                {['test', 'draft'].includes(statusFilter) && (
                    <button
                        onClick={() => deleteAllByStatus(statusFilter)}
                        disabled={deletingAll || loading}
                        className="ml-auto px-3 py-1 text-xs rounded-full transition-colors bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                    >
                        {deletingAll
                            ? 'Deleting...'
                            : `Delete all ${statusFilter === 'test' ? 'Test' : 'Draft'} (${statusCounts[statusFilter] || 0})`}
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                    {error}
                </div>
            )}

            {successMessage && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded flex items-center justify-between">
                    <span>{successMessage}</span>
                    <button onClick={() => setSuccessMessage(null)} className="ml-2 text-green-600 hover:text-green-800 text-xs">✕</button>
                </div>
            )}

            {loading ? (
                <p className="text-gray-500">Loading productions...</p>
            ) : filteredDrafts.length === 0 ? (
                <p className="text-gray-500">No productions found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}</p>
            ) : (
                <div className="space-y-4">
                    {filteredDrafts.map(draft => (
                        <div key={draft.id} className="border border-gray-200 rounded p-4">
                            {editingId === draft.id ? (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Name</label>
                                            <input
                                                type="text"
                                                value={editForm.name}
                                                onChange={(e) => handleInputChange('name', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Status</label>
                                            <select
                                                value={editForm.status}
                                                onChange={(e) => handleInputChange('status', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded"
                                            >
                                                <option value="test">Test</option>
                                                <option value="draft">Draft</option>
                                                <option value="published">Published</option>
                                                <option value="archived">Archived</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Borough</label>
                                            <input
                                                type="text"
                                                value={editForm.borough}
                                                onChange={(e) => handleInputChange('borough', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded"
                                                placeholder="e.g., Brooklyn, Manhattan"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Neighborhood</label>
                                            <input
                                                type="text"
                                                value={editForm.neighborhood}
                                                onChange={(e) => handleInputChange('neighborhood', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded"
                                                placeholder="e.g., Williamsburg, SoHo"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-sm font-medium mb-1">Area</label>
                                            <input
                                                type="text"
                                                value={editForm.area}
                                                onChange={(e) => handleInputChange('area', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded"
                                                placeholder="e.g., Bedford Ave & N 7th St"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Summary</label>
                                        <textarea
                                            value={editForm.summary || ''}
                                            onChange={(e) => handleInputChange('summary', e.target.value)}
                                            rows={4}
                                            className="w-full px-3 py-2 border border-gray-300 rounded"
                                        />
                                    </div>
                                    {/* Hidden field - may be used later
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Image URL</label>
                                        <input
                                            type="text"
                                            value={editForm.image_url}
                                            onChange={(e) => handleInputChange('image_url', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded"
                                        />
                                    </div>
                                    */}
                                    <div className="flex gap-2 pt-2">
                                        <button
                                            onClick={saveEdit}
                                            disabled={saving}
                                            className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"
                                        >
                                            {saving ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={cancelEdit}
                                            disabled={saving}
                                            className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h3 className="font-semibold text-lg">{draft.name}</h3>
                                            <p className="text-xs text-gray-500">ID: {draft.id}</p>
                                        </div>
                                        <span className={`px-2 py-1 text-xs rounded ${draft.status === 'published'
                                            ? 'bg-green-100 text-green-800'
                                            : draft.status === 'archived'
                                                ? 'bg-gray-100 text-gray-800'
                                                : draft.status === 'test'
                                                    ? 'bg-blue-100 text-blue-800'
                                                    : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {draft.status}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                        {draft.borough && <p><span className="font-medium">Borough:</span> {draft.borough}</p>}
                                        {draft.neighborhood && <p><span className="font-medium">Neighborhood:</span> {draft.neighborhood}</p>}
                                        {draft.area && <p><span className="font-medium">Area:</span> {draft.area}</p>}
                                    </div>

                                    {(draft?.metadata?.summary || draft?.summary || draft?.description) && (
                                        <p className="text-sm text-gray-700 mb-3">
                                            <span className="font-medium">Summary:</span>{' '}
                                            {draft?.metadata?.summary || draft?.summary || draft?.description}
                                        </p>
                                    )}

                                    <div className="text-xs text-gray-500 mb-3">
                                        Created: {new Date(draft.created_at).toLocaleString()}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => startEdit(draft)}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => updateStatus(draft.id, 'published')}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Publish
                                        </button>
                                        <button
                                            onClick={() => deleteDraft(draft.id)}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
