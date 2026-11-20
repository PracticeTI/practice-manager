'use client'

import { useState, useEffect } from 'react'
import ContentModal from './ContentModal'

const DEFAULT_FILTER_CONFIGS = [
    {
        id: 'productions',
        table: 'content',
        title: 'Productions',
        displayFields: ['title', 'slug', 'status', 'published_at'],
        icon: '🎬',
        type: 'production'
    },
    {
        id: 'actors',
        table: 'content',
        title: 'Actors',
        displayFields: ['name', 'slug', 'nationality', 'dob'],
        icon: '👤',
        type: 'actor'
    },
    {
        id: 'companies',
        table: 'content',
        title: 'Companies',
        displayFields: ['name', 'slug', 'country', 'founded_on'],
        icon: '🏢',
        type: 'company'
    },
    {
        id: 'posts',
        table: 'content',
        title: 'Posts',
        displayFields: ['title', 'slug', 'status', 'published_at'],
        icon: '📝',
        type: 'post'
    },
    {
        id: 'images',
        table: 'content',
        title: 'Images',
        displayFields: ['title', 'slug', 'alt_text', 'file_size'],
        icon: '🖼️',
        type: 'image'
    },
    {
        id: 'documents',
        table: 'content',
        title: 'Documents',
        displayFields: ['title', 'slug', 'file_type', 'file_size'],
        icon: '📄',
        type: 'document'
    }
]

const FILTER_TEMPLATE_OPTIONS = [
    {
        id: 'production',
        label: 'Production',
        icon: '🎬',
        title: 'Productions',
        table: 'content',
        type: 'production',
        displayFields: ['title', 'slug', 'status', 'published_at']
    },
    {
        id: 'actor',
        label: 'Actor',
        icon: '👤',
        title: 'Actors',
        table: 'content',
        type: 'actor',
        displayFields: ['name', 'slug', 'nationality', 'dob']
    },
    {
        id: 'company',
        label: 'Company',
        icon: '🏢',
        title: 'Companies',
        table: 'content',
        type: 'company',
        displayFields: ['name', 'slug', 'country', 'founded_on']
    },
    {
        id: 'post',
        label: 'Post',
        icon: '📝',
        title: 'Posts',
        table: 'content',
        type: 'post',
        displayFields: ['title', 'slug', 'status', 'published_at']
    },
    {
        id: 'image',
        label: 'Image',
        icon: '🖼️',
        title: 'Images',
        table: 'content',
        type: 'image',
        displayFields: ['title', 'slug', 'alt_text', 'file_size']
    },
    {
        id: 'document',
        label: 'Document',
        icon: '📄',
        title: 'Documents',
        table: 'content',
        type: 'document',
        displayFields: ['title', 'slug', 'file_type', 'file_size']
    }
]

const FILTER_CONFIG_STORAGE_KEY = 'contentExplorer.filterConfigs.v1'
const ACTIVE_FILTER_STORAGE_KEY = 'contentExplorer.activeFilter.v1'

export default function ContentExplorer({ dbStatus, backendOnline }) {
    const [filterConfigs, setFilterConfigs] = useState(DEFAULT_FILTER_CONFIGS)
    const [activeFilter, setActiveFilter] = useState(DEFAULT_FILTER_CONFIGS[0].id)
    const [showFilterManager, setShowFilterManager] = useState(false)
    const [newFilterTemplateId, setNewFilterTemplateId] = useState(FILTER_TEMPLATE_OPTIONS[0].id)
    const [newFilterTitle, setNewFilterTitle] = useState(FILTER_TEMPLATE_OPTIONS[0].title)
    const [newFilterIcon, setNewFilterIcon] = useState(FILTER_TEMPLATE_OPTIONS[0].icon)
    const [newFilterFields, setNewFilterFields] = useState(FILTER_TEMPLATE_OPTIONS[0].displayFields.join(', '))
    const [tableData, setTableData] = useState({})
    const [loading, setLoading] = useState(false)
    const [expanded, setExpanded] = useState({})
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingRecord, setEditingRecord] = useState(null)
    const [editingTypeConfig, setEditingTypeConfig] = useState(null)
    const [linkForms, setLinkForms] = useState({})
    const [postSubFilter, setPostSubFilter] = useState('all')

    async function loadContentData() {
        setLoading(true)
        try {
            const backendUrl = ''
            const tables = ['content', 'content_relationships']

            const data = {}
            for (const table of tables) {
                try {
                    const response = await fetch(`${backendUrl}/api/database/fetch-table?table=${table}&limit=1000`, {
                        mode: 'cors',
                        cache: 'no-store'
                    })

                    if (response.ok) {
                        const result = await response.json()
                        data[table] = result.records || []
                    } else {
                        console.error(`Error fetching ${table}: ${response.status}`)
                        data[table] = []
                    }
                } catch (err) {
                    console.error(`Error fetching ${table}:`, err)
                    data[table] = []
                }
            }

            setTableData(data)
        } catch (err) {
            console.error('Error loading content data:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (backendOnline) {
            const timeoutId = window.setTimeout(() => {
                loadContentData()
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [backendOnline])

    useEffect(() => {
        // Log table data changes for debugging
        console.log('ContentExplorer table data:', tableData)
    }, [tableData])

    useEffect(() => {
        if (typeof window === 'undefined') return

        try {
            const storedConfigsRaw = window.localStorage.getItem(FILTER_CONFIG_STORAGE_KEY)
            const storedActiveFilter = window.localStorage.getItem(ACTIVE_FILTER_STORAGE_KEY)

            if (storedConfigsRaw) {
                const parsed = JSON.parse(storedConfigsRaw)
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const normalized = parsed.filter((item) => item && item.id && item.title && item.table)
                    if (normalized.length > 0) {
                        const timeoutId = window.setTimeout(() => {
                            setFilterConfigs(normalized)
                        }, 0)
                        return () => window.clearTimeout(timeoutId)
                    }
                }
            }

            if (storedActiveFilter) {
                const timeoutId = window.setTimeout(() => {
                    setActiveFilter(storedActiveFilter)
                }, 0)
                return () => window.clearTimeout(timeoutId)
            }
        } catch (error) {
            console.error('Failed to restore content explorer filters:', error)
        }
    }, [])

    useEffect(() => {
        const hasActiveFilter = filterConfigs.some((filter) => filter.id === activeFilter)
        if (!hasActiveFilter && filterConfigs.length > 0) {
            const timeoutId = window.setTimeout(() => {
                setActiveFilter(filterConfigs[0].id)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [activeFilter, filterConfigs])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(FILTER_CONFIG_STORAGE_KEY, JSON.stringify(filterConfigs))
    }, [filterConfigs])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(ACTIVE_FILTER_STORAGE_KEY, activeFilter)
    }, [activeFilter])

    const toggleExpansion = (id) => {
        setExpanded(prev => ({
            ...prev,
            [id]: !prev[id]
        }))
    }

    const typeConfigs = {
        post: {
            id: 'post',
            label: 'Post',
            icon: '📝',
            domain: 'core',
            attributes: []
        },
        post: {
            id: 'post',
            label: 'Post',
            icon: '📝',
            domain: 'core',
            attributes: []
        },
        image: {
            id: 'image',
            label: 'Image',
            icon: '🖼️',
            domain: 'core',
            attributes: ['alt_text', 'width', 'height', 'file_size']
        },
        video: {
            id: 'video',
            label: 'Video',
            icon: '🎥',
            domain: 'core',
            attributes: ['duration', 'width', 'height', 'file_size']
        },
        document: {
            id: 'document',
            label: 'Document',
            icon: '📄',
            domain: 'core',
            attributes: ['file_type', 'file_size', 'pages']
        }
    }

    const getTemplateById = (templateId) => {
        return FILTER_TEMPLATE_OPTIONS.find((template) => template.id === templateId) || FILTER_TEMPLATE_OPTIONS[0]
    }

    const moveFilter = (index, direction) => {
        const targetIndex = index + direction
        if (targetIndex < 0 || targetIndex >= filterConfigs.length) return

        setFilterConfigs((prev) => {
            const next = [...prev]
            const [moved] = next.splice(index, 1)
            next.splice(targetIndex, 0, moved)
            return next
        })
    }

    const removeFilter = (filterId) => {
        setFilterConfigs((prev) => {
            if (prev.length <= 1) return prev

            const next = prev.filter((filter) => filter.id !== filterId)
            if (activeFilter === filterId && next.length > 0) {
                setActiveFilter(next[0].id)
            }
            return next
        })
    }

    const addFilter = () => {
        const template = getTemplateById(newFilterTemplateId)
        const normalizedFields = String(newFilterFields || '')
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean)

        const displayFields = normalizedFields.length > 0 ? normalizedFields : template.displayFields
        const title = String(newFilterTitle || '').trim() || template.title
        const icon = String(newFilterIcon || '').trim() || template.icon
        const filterIdBase = `${template.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        const uniqueId = `${filterIdBase}-${Date.now()}`

        const newFilter = {
            id: uniqueId,
            table: template.table,
            title,
            displayFields,
            icon,
            type: template.type
        }

        setFilterConfigs((prev) => [...prev, newFilter])
        setActiveFilter(uniqueId)
    }

    const handleTemplateChange = (templateId) => {
        const template = getTemplateById(templateId)
        setNewFilterTemplateId(template.id)
        setNewFilterTitle(template.title)
        setNewFilterIcon(template.icon)
        setNewFilterFields(template.displayFields.join(', '))
    }

    const openEditModal = (record) => {
        const typeConfig = typeConfigs[record.type]
        if (typeConfig) {
            const { outgoing, incoming } = getRecordRelationships(record.id)
            const relationshipDetails = [...outgoing, ...incoming].map((rel) => {
                const sourceNode = allRecords.find((node) => Number(node.id) === Number(rel.source_id)) || null
                const targetNode = allRecords.find((node) => Number(node.id) === Number(rel.target_id)) || null

                return {
                    id: rel.id,
                    direction: Number(rel.source_id) === Number(record.id) ? 'out' : 'in',
                    type: rel.relationship_type,
                    role: rel.role,
                    position: rel.position,
                    source_id: rel.source_id,
                    target_id: rel.target_id,
                    source_label: getContentLabel(sourceNode) || `#${rel.source_id}`,
                    target_label: getContentLabel(targetNode) || `#${rel.target_id}`
                }
            })

            setEditingRecord({
                ...record,
                relationships: relationshipDetails
            })
            setEditingTypeConfig(typeConfig)
            setShowEditModal(true)
        }
    }

    const handleEditChange = (field, value) => {
        setEditingRecord(prev => ({
            ...prev,
            [field]: value
        }))
    }

    const handleEditSave = async () => {
        try {
            const response = await fetch(`/api/content/${editingRecord.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: editingRecord.title,
                    heading: editingRecord.heading,
                    slug: editingRecord.slug,
                    status: editingRecord.status,
                    preview: editingRecord.preview,
                    attributes: editingRecord.attributes
                })
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(errorText || `HTTP ${response.status}`)
            }

            const data = await response.json().catch(() => ({}))
            const invalidatedDomains = Array.from(new Set((data?.cacheInvalidatedDomains || []).filter(Boolean)))
            const cacheMessage = invalidatedDomains.length > 0
                ? ` Cache cleared for ${invalidatedDomains.join(', ')}.`
                : ''

            alert(`✅ Record updated successfully.${cacheMessage}`)
            setShowEditModal(false)
            setEditingRecord(null)
            loadContentData() // Refresh the list
        } catch (error) {
            alert(`Failed to update record: ${error.message}`)
        }
    }

    const ensureLinkForm = (record) => {
        const recordId = Number(record?.id)
        if (!recordId) return

        setLinkForms((prev) => {
            if (prev[recordId]) return prev

            return {
                ...prev,
                [recordId]: {
                    relationshipType: record?.type === 'company' ? 'logo' : 'related_to',
                    targetType: record?.type === 'company' ? 'image' : 'all',
                    targetQuery: '',
                    targetId: '',
                    saving: false,
                    error: '',
                    success: ''
                }
            }
        })
    }

    const updateLinkForm = (recordId, updates) => {
        setLinkForms((prev) => ({
            ...prev,
            [recordId]: {
                ...(prev[recordId] || {}),
                ...updates
            }
        }))
    }

    const createRelationshipFromForm = async (record) => {
        const recordId = Number(record?.id)
        if (!recordId) return

        const form = linkForms[recordId] || {}
        const relationshipType = String(form.relationshipType || '').trim()
        const targetId = Number(form.targetId)

        if (!relationshipType) {
            updateLinkForm(recordId, { error: 'Relationship type is required.', success: '' })
            return
        }

        if (!Number.isFinite(targetId) || targetId <= 0) {
            updateLinkForm(recordId, { error: 'Select a target record first.', success: '' })
            return
        }

        if (targetId === recordId) {
            updateLinkForm(recordId, { error: 'Cannot link a record to itself.', success: '' })
            return
        }

        updateLinkForm(recordId, { saving: true, error: '', success: '' })

        try {
            const response = await fetch('/api/relationships', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    source_id: recordId,
                    target_id: targetId,
                    type: relationshipType
                })
            })

            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || `HTTP ${response.status}`)
            }

            updateLinkForm(recordId, {
                saving: false,
                error: '',
                success: payload?.reused ? 'Relationship already existed.' : 'Relationship created.',
                targetQuery: '',
                targetId: ''
            })

            await loadContentData()
        } catch (error) {
            updateLinkForm(recordId, {
                saving: false,
                error: error?.message || 'Failed to create relationship.',
                success: ''
            })
        }
    }

    const config = filterConfigs.find((filter) => filter.id === activeFilter) || filterConfigs[0] || DEFAULT_FILTER_CONFIGS[0]
    const allRecords = tableData[config.table] || []
    const allRelationships = tableData.content_relationships || []

    const getContentLabel = (record) => {
        if (!record) return ''

        const metadataTitle = record?.metadata?.presentation?.default?.title
        const directTitle = record?.title || record?.name
        return metadataTitle || directTitle || `#${record.id}`
    }

    const getRecordRelationships = (recordId) => {
        if (!recordId) return { outgoing: [], incoming: [] }

        const outgoing = allRelationships.filter((rel) => Number(rel.source_id) === Number(recordId))
        const incoming = allRelationships.filter((rel) => Number(rel.target_id) === Number(recordId))

        return { outgoing, incoming }
    }

    const renderRelationshipRow = ({ rel, direction }) => {
        const sourceNode = allRecords.find((node) => Number(node.id) === Number(rel.source_id)) || null
        const targetNode = allRecords.find((node) => Number(node.id) === Number(rel.target_id)) || null
        const sourceLabel = getContentLabel(sourceNode) || `#${rel.source_id}`
        const targetLabel = getContentLabel(targetNode) || `#${rel.target_id}`

        return (
            <div key={`${direction}-${rel.id || `${rel.source_id}-${rel.target_id}-${rel.relationship_type}`}`} className="text-xs text-gray-700 py-1 border-b border-gray-100 last:border-b-0">
                <span className="font-medium">{sourceLabel}</span>
                <span className="mx-1 text-gray-500">--{rel.relationship_type}--&gt;</span>
                <span className="font-medium">{targetLabel}</span>
                {rel.role && <span className="ml-2 text-gray-500">(role: {rel.role})</span>}
                {rel.position !== null && rel.position !== undefined && <span className="ml-2 text-gray-500">(position: {rel.position})</span>}
            </div>
        )
    }

    const relationshipTypeOptions = [
        'related_to',
        'production_company',
        'cast',
        'logo',
        'featured_in',
        'mentions'
    ]

    const targetTypeOptions = ['all', 'production', 'company', 'actor', 'image', 'location', 'post', 'document']

    const getLinkCandidates = ({ sourceRecord, form }) => {
        const sourceId = Number(sourceRecord?.id)
        const queryToken = String(form?.targetQuery || '').trim().toLowerCase()
        const selectedType = String(form?.targetType || 'all').trim().toLowerCase()

        return allRecords
            .filter((candidate) => Number(candidate.id) !== sourceId)
            .filter((candidate) => selectedType === 'all' || String(candidate.type || '').toLowerCase() === selectedType)
            .filter((candidate) => {
                if (!queryToken) return true
                const label = getContentLabel(candidate).toLowerCase()
                const slug = String(candidate?.slug || '').toLowerCase()
                return label.includes(queryToken) || slug.includes(queryToken) || String(candidate.id).includes(queryToken)
            })
            .slice(0, 8)
    }
    // Filter by type if it's the content table
    const typeFilteredRecords = config.type ? allRecords.filter(r => r.type === config.type) : allRecords

    const getRecordCategory = (record) => {
        const parseJson = (v) => {
            if (!v) return null
            if (typeof v === 'object') return v
            try { return JSON.parse(v) } catch { return null }
        }
        const attrs = parseJson(record?.attributes)
        const meta = parseJson(record?.metadata)
        return String(attrs?.category || meta?.category || '').toLowerCase()
    }

    const records = (config.type === 'post' && postSubFilter !== 'all')
        ? postSubFilter === 'news'
            ? typeFilteredRecords.filter(r => getRecordCategory(r).includes('news'))
            : typeFilteredRecords.filter(r => getRecordCategory(r) === postSubFilter)
        : typeFilteredRecords

    const postCategories = (() => {
        if (config.type !== 'post') return []
        const cats = new Set()
        const hasNews = typeFilteredRecords.some(r => getRecordCategory(r).includes('news'))
        if (hasNews) cats.add('news')
        for (const r of typeFilteredRecords) {
            const cat = getRecordCategory(r)
            if (cat && !cat.includes('news')) cats.add(cat)
        }
        return ['all', ...Array.from(cats).sort()]
    })()

    return (
        <>
            {/* Edit Modal */}
            {editingTypeConfig && (
                <ContentModal
                    isOpen={showEditModal}
                    item={editingRecord}
                    typeConfig={editingTypeConfig}
                    domain={editingTypeConfig.domain}
                    isReadOnly={false}
                    onChange={handleEditChange}
                    onSave={handleEditSave}
                    onClose={() => {
                        setShowEditModal(false)
                        setEditingRecord(null)
                        setEditingTypeConfig(null)
                    }}
                    isSaving={false}
                    error={null}
                    allRecords={allRecords}
                    relationshipTypeOptions={relationshipTypeOptions}
                    targetTypeOptions={targetTypeOptions}
                    onCreateRelationship={async (targetId, relType) => {
                        const sourceId = Number(editingRecord?.id)
                        if (!sourceId) throw new Error('No source record')
                        const response = await fetch('/api/relationships', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ source_id: sourceId, target_id: targetId, type: relType })
                        })
                        const payload = await response.json().catch(() => ({}))
                        if (!response.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${response.status}`)
                        // Append the new relationship to the open modal immediately
                        const targetNode = allRecords.find(n => Number(n.id) === Number(targetId)) || null
                        const sourceNode = allRecords.find(n => Number(n.id) === sourceId) || null
                        const newRel = {
                            id: payload.relationship?.id,
                            direction: 'out',
                            type: relType,
                            role: null,
                            position: null,
                            source_id: sourceId,
                            target_id: targetId,
                            source_label: getContentLabel(sourceNode) || `#${sourceId}`,
                            target_label: getContentLabel(targetNode) || `#${targetId}`
                        }
                        setEditingRecord(prev => prev ? { ...prev, relationships: [...(prev.relationships || []), newRel] } : prev)
                        await loadContentData()
                    }}
                    onDeleteRelationship={async (relId) => {
                        const response = await fetch('/api/relationships', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: relId })
                        })
                        const payload = await response.json().catch(() => ({}))
                        if (!response.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${response.status}`)
                        await loadContentData()
                        setEditingRecord(prev => {
                            if (!prev) return prev
                            return { ...prev, relationships: (prev.relationships || []).filter(r => r.id !== relId) }
                        })
                    }}
                />
            )}

            <div className="border border-gray-300 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">Content</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFilterManager((prev) => !prev)}
                            className="px-3 py-2 admin-btn text-sm font-medium"
                        >
                            {showFilterManager ? 'Hide Filter Manager' : 'Manage Filters'}
                        </button>
                        <button
                            onClick={loadContentData}
                            disabled={loading}
                            className="px-3 py-2 admin-btn disabled:opacity-50 text-sm font-medium"
                        >
                            {loading ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {showFilterManager && (
                    <div className="mb-6 border border-gray-200 bg-gray-50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Filter Manager</p>

                        <div className="space-y-2 mb-3">
                            {filterConfigs.map((filter, index) => (
                                <div key={filter.id} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded px-3 py-2">
                                    <p className="text-sm text-gray-700">
                                        <span className="mr-2">{filter.icon}</span>
                                        <span className="font-medium">{filter.title}</span>
                                        <span className="ml-2 text-xs text-gray-500">({filter.type || 'all'})</span>
                                    </p>

                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => moveFilter(index, -1)}
                                            disabled={index === 0}
                                            className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                        >
                                            Up
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveFilter(index, 1)}
                                            disabled={index === filterConfigs.length - 1}
                                            className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                        >
                                            Down
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeFilter(filter.id)}
                                            disabled={filterConfigs.length <= 1}
                                            className="px-2 py-1 text-xs admin-btn-danger disabled:opacity-50"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                            <div>
                                <label className="text-xs text-gray-500">Template</label>
                                <select
                                    value={newFilterTemplateId}
                                    onChange={(e) => handleTemplateChange(e.target.value)}
                                    className="admin-select w-full text-sm"
                                >
                                    {FILTER_TEMPLATE_OPTIONS.map((template) => (
                                        <option key={template.id} value={template.id}>{template.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-gray-500">Title</label>
                                <input
                                    type="text"
                                    value={newFilterTitle}
                                    onChange={(e) => setNewFilterTitle(e.target.value)}
                                    className="admin-input text-sm"
                                />
                            </div>

                            <div>
                                <label className="text-xs text-gray-500">Icon</label>
                                <input
                                    type="text"
                                    value={newFilterIcon}
                                    onChange={(e) => setNewFilterIcon(e.target.value)}
                                    className="admin-input text-sm"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="text-xs text-gray-500">Display Fields (comma separated)</label>
                                <input
                                    type="text"
                                    value={newFilterFields}
                                    onChange={(e) => setNewFilterFields(e.target.value)}
                                    className="admin-input text-sm"
                                />
                            </div>
                        </div>

                        <div className="mt-2 flex justify-end">
                            <button
                                type="button"
                                onClick={addFilter}
                                className="px-3 py-2 text-sm admin-btn-primary"
                            >
                                Add Filter
                            </button>
                        </div>
                    </div>
                )}

                {/* Filter Buttons */}
                <div className="flex gap-2 mb-3 flex-wrap">
                    {filterConfigs.map((filter) => {
                        const label = `${filter.icon} ${filter.title}`
                        return (
                            <button
                                key={filter.id}
                                onClick={() => {
                                    setActiveFilter(filter.id)
                                    setPostSubFilter('all')
                                }}
                                className={`px-4 py-2 text-sm font-medium ${activeFilter === filter.id
                                    ? 'admin-btn-active'
                                    : 'admin-btn'
                                    }`}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>

                {/* Posts Sub-filter */}
                {config.type === 'post' && postCategories.length > 1 && (
                    <div className="flex gap-1.5 mb-5 flex-wrap">
                        {postCategories.map((sub) => (
                            <button
                                key={sub}
                                onClick={() => setPostSubFilter(sub)}
                                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${postSubFilter === sub
                                        ? 'bg-gray-800 text-white border-gray-800'
                                        : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                                    }`}
                            >
                                {sub === 'all' ? 'All' : sub.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                            </button>
                        ))}
                    </div>
                )}

                {/* Record Count */}
                <div className="mb-4 text-sm text-gray-600">
                    <strong>{records.length.toLocaleString()}</strong> {config.title.toLowerCase()} found
                </div>

                {/* Records List */}
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-gray-500">
                        <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Loading {config.title.toLowerCase()}...
                    </div>
                ) : records.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No {config.title.toLowerCase()} found
                    </div>
                ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {records.map((record, idx) => {
                            const { outgoing, incoming } = getRecordRelationships(record.id)
                            const relationshipCount = outgoing.length + incoming.length

                            return (
                                <div
                                    key={idx}
                                    className="border border-gray-300 p-3 hover:bg-gray-50 transition-colors"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div
                                            onClick={() => toggleExpansion(idx)}
                                            className="flex-1 cursor-pointer"
                                        >
                                            <p className="font-medium text-gray-900">
                                                {record.title || record.name || `${config.title} ${idx + 1}`}
                                            </p>
                                            <p className="text-xs text-gray-600">
                                                {record.slug && `ID: ${record.slug}`}
                                                {` `}
                                                <span className="text-gray-500">({relationshipCount} relationship{relationshipCount === 1 ? '' : 's'})</span>
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => openEditModal(record)}
                                            className="px-2 py-1 text-xs admin-btn-primary whitespace-nowrap"
                                        >
                                            Edit
                                        </button>
                                        <svg
                                            onClick={() => toggleExpansion(idx)}
                                            className={`w-4 h-4 text-gray-500 transition-transform cursor-pointer ${expanded[idx] ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                        </svg>
                                    </div>

                                    {expanded[idx] && (
                                        <div className="mt-3 pt-3 border-t border-gray-200 text-sm">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {config.displayFields.map((field) => (
                                                    <div key={field}>
                                                        <p className="text-xs text-gray-500 uppercase font-semibold">{field}</p>
                                                        <p className="text-gray-700 break-words">
                                                            {record[field] ? String(record[field]) : '—'}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>

                                            {(outgoing.length > 0 || incoming.length > 0) && (
                                                <div className="mt-3 pt-3 border-t border-gray-200">
                                                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Relationships</p>
                                                    {outgoing.length > 0 && (
                                                        <div className="mb-2">
                                                            <p className="text-xs text-gray-500 mb-1">Outgoing</p>
                                                            <div className="bg-gray-50 rounded p-2">
                                                                {outgoing.map((rel) => renderRelationshipRow({ rel, direction: 'out' }))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {incoming.length > 0 && (
                                                        <div>
                                                            <p className="text-xs text-gray-500 mb-1">Incoming</p>
                                                            <div className="bg-gray-50 rounded p-2">
                                                                {incoming.map((rel) => renderRelationshipRow({ rel, direction: 'in' }))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {record.attributes && Object.keys(record.attributes).length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-gray-200">
                                                    <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Attributes</p>
                                                    <pre className="text-xs text-gray-600 bg-gray-50 p-2 overflow-auto rounded">
                                                        {JSON.stringify(record.attributes, null, 2)}
                                                    </pre>
                                                </div>
                                            )}

                                            {(() => {
                                                const recordId = Number(record.id)
                                                const form = linkForms[recordId] || {
                                                    relationshipType: record?.type === 'company' ? 'logo' : 'related_to',
                                                    targetType: record?.type === 'company' ? 'image' : 'all',
                                                    targetQuery: '',
                                                    targetId: '',
                                                    saving: false,
                                                    error: '',
                                                    success: ''
                                                }

                                                const candidates = getLinkCandidates({ sourceRecord: record, form })
                                                const selectedTarget = allRecords.find((node) => Number(node.id) === Number(form.targetId)) || null

                                                return (
                                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                                        <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Create Relationship</p>

                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                            <div>
                                                                <label className="text-xs text-gray-500">Type</label>
                                                                <select
                                                                    value={form.relationshipType}
                                                                    onFocus={() => ensureLinkForm(record)}
                                                                    onChange={(e) => updateLinkForm(recordId, { relationshipType: e.target.value, error: '', success: '' })}
                                                                    className="admin-select w-full text-sm"
                                                                >
                                                                    {relationshipTypeOptions.map((option) => (
                                                                        <option key={option} value={option}>{option}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div>
                                                                <label className="text-xs text-gray-500">Target Type</label>
                                                                <select
                                                                    value={form.targetType}
                                                                    onFocus={() => ensureLinkForm(record)}
                                                                    onChange={(e) => updateLinkForm(recordId, { targetType: e.target.value, targetId: '', error: '', success: '' })}
                                                                    className="admin-select w-full text-sm"
                                                                >
                                                                    {targetTypeOptions.map((option) => (
                                                                        <option key={option} value={option}>{option}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div>
                                                                <label className="text-xs text-gray-500">Find Target</label>
                                                                <input
                                                                    type="text"
                                                                    value={form.targetQuery}
                                                                    onFocus={() => ensureLinkForm(record)}
                                                                    onChange={(e) => updateLinkForm(recordId, { targetQuery: e.target.value, targetId: '', error: '', success: '' })}
                                                                    placeholder="Search title, slug, or ID"
                                                                    className="admin-input text-sm"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="mt-2 bg-gray-50 border border-gray-200 rounded p-2 max-h-32 overflow-y-auto">
                                                            {candidates.length === 0 ? (
                                                                <p className="text-xs text-gray-500">No matching targets</p>
                                                            ) : (
                                                                candidates.map((candidate) => (
                                                                    <button
                                                                        key={candidate.id}
                                                                        type="button"
                                                                        onClick={() => updateLinkForm(recordId, { targetId: candidate.id, error: '', success: '' })}
                                                                        className={`w-full text-left text-xs px-2 py-1 rounded mb-1 last:mb-0 ${Number(form.targetId) === Number(candidate.id)
                                                                            ? 'bg-gray-900 text-white'
                                                                            : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                                                                            }`}
                                                                    >
                                                                        #{candidate.id} {getContentLabel(candidate)} ({candidate.type || 'unknown'})
                                                                    </button>
                                                                ))
                                                            )}
                                                        </div>

                                                        <div className="mt-2 flex items-center justify-between gap-2">
                                                            <p className="text-xs text-gray-600">
                                                                {selectedTarget
                                                                    ? `Selected: #${selectedTarget.id} ${getContentLabel(selectedTarget)} (${selectedTarget.type || 'unknown'})`
                                                                    : 'Select a target to create relationship.'}
                                                            </p>

                                                            <button
                                                                type="button"
                                                                onClick={() => createRelationshipFromForm(record)}
                                                                disabled={form.saving || !form.targetId}
                                                                className="px-3 py-1 text-xs admin-btn-primary disabled:opacity-50"
                                                            >
                                                                {form.saving ? 'Linking...' : 'Create Link'}
                                                            </button>
                                                        </div>

                                                        {form.error && (
                                                            <p className="mt-2 text-xs text-red-600">{form.error}</p>
                                                        )}
                                                        {form.success && (
                                                            <p className="mt-2 text-xs text-green-700">{form.success}</p>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </>
    )
}
