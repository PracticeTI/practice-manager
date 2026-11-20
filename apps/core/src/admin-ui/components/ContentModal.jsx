'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import PageContentArticle from '@/components/PageContentArticle'
import PageBlocksEditor from '@/admin-ui/components/PageBlocksEditor'
import SmartPageEditor from '@/admin-ui/components/SmartPageEditor'
import { getDomainPageStyles } from '@/lib/domainPageStyles'
import { attachResolvedSinglePostBlocks } from '@/lib/pageBlockPosts'
import { normalizePageBlocks } from '@/lib/pageBlocks'
import { DEFAULT_DOMAIN_MODE, VALID_DOMAIN_MODES, getDomainLabel } from '@/lib/domainMode'

const DOMAIN_OPTIONS = [
    { value: '', label: 'Unspecified' },
    ...VALID_DOMAIN_MODES.map((mode) => ({ value: mode, label: getDomainLabel(mode) })),
    { value: 'core', label: 'Core' }
]

export default function ContentModal({
    isOpen,
    item,
    typeConfig,           // Pass type configuration
    domain,              // Track which domain this belongs to
    allowRelationships = true,
    isReadOnly,
    onChange,
    onSave,
    onClose,
    onSwitchToEdit,
    isSaving,
    error,
    // Relationship management
    allRecords,
    availablePostItems = [],
    postFieldVisibility = { description: true, body: true },
    onCreatePostForBlock,
    onEditPostForBlock,
    relationshipTypeOptions,
    targetTypeOptions,
    onCreateRelationship,
    onDeleteRelationship,
}) {
    const DESCRIPTION_MIN_HEIGHT_PX = 56
    const DESCRIPTION_MAX_HEIGHT_PX = 224

    const getTypeLabel = (type) => {
        const normalized = String(type || '').trim().toLowerCase()
        if (normalized === 'article') return 'post'
        return normalized || ''
    }

    const getDefaultLinkForm = (itemType) => ({
        relationshipType: itemType === 'company' ? 'logo' : 'related_to',
        targetType: itemType === 'company' ? 'image' : 'all',
        targetQuery: '',
        targetId: '',
        saving: false,
        error: '',
        success: ''
    })

    const [linkForm, setLinkForm] = useState(() => getDefaultLinkForm(item?.type))
    const [pageEditorView, setPageEditorView] = useState('edit')
    const descriptionTextareaRef = useRef(null)
    const bodyTextareaRef = useRef(null)

    const resizeDescriptionTextarea = (textarea) => {
        if (!textarea) return
        textarea.style.height = 'auto'
        const nextHeight = Math.min(Math.max(textarea.scrollHeight, DESCRIPTION_MIN_HEIGHT_PX), DESCRIPTION_MAX_HEIGHT_PX)
        textarea.style.height = `${nextHeight}px`
        textarea.style.overflowY = textarea.scrollHeight > DESCRIPTION_MAX_HEIGHT_PX ? 'auto' : 'hidden'
    }

    const updateLinkForm = (updates) => setLinkForm(prev => ({ ...prev, ...updates }))

    const getContentLabel = (record) => {
        if (!record) return ''
        return record?.metadata?.presentation?.default?.title || record?.title || record?.name || `#${record.id}`
    }

    const linkCandidates = allowRelationships && Array.isArray(allRecords) ? allRecords
        .filter(c => Number(c.id) !== Number(item?.id))
        .filter(c => linkForm.targetType === 'all' || String(c.type || '').toLowerCase() === linkForm.targetType)
        .filter(c => {
            if (!linkForm.targetQuery) return true
            const q = linkForm.targetQuery.toLowerCase()
            return getContentLabel(c).toLowerCase().includes(q) ||
                String(c.slug || '').toLowerCase().includes(q) ||
                String(c.id).includes(q)
        })
        .slice(0, 8) : []

    const selectedTarget = allowRelationships && Array.isArray(allRecords)
        ? allRecords.find(c => Number(c.id) === Number(linkForm.targetId)) || null
        : null

    const handleCreateRelationship = async () => {
        const relType = linkForm.relationshipType.trim()
        const targetId = Number(linkForm.targetId)
        if (!relType || !Number.isFinite(targetId) || targetId <= 0) {
            updateLinkForm({ error: 'Select a target and relationship type.', success: '' })
            return
        }
        updateLinkForm({ saving: true, error: '', success: '' })
        try {
            await onCreateRelationship(targetId, relType)
            updateLinkForm({ saving: false, success: 'Relationship created.', targetId: '', targetQuery: '', error: '' })
        } catch (err) {
            updateLinkForm({ saving: false, error: err?.message || 'Failed to create relationship.', success: '' })
        }
    }

    const summaryParagraphs = String(item?.preview || '')
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n+/)
        .map((part) => part.trim())
        .filter(Boolean)

    const bodyParagraphs = String(item?.body || '')
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n+/)
        .map((part) => part.trim())
        .filter(Boolean)

    useEffect(() => {
        // Handle Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            return () => document.removeEventListener('keydown', handleEscape)
        }
    }, [isOpen, onClose])

    useEffect(() => {
        if (!isOpen || isReadOnly) return
        if (descriptionTextareaRef.current) resizeDescriptionTextarea(descriptionTextareaRef.current)
        if (bodyTextareaRef.current) resizeDescriptionTextarea(bodyTextareaRef.current)
    }, [isOpen, isReadOnly, item?.id, item?.preview, item?.body])

    if (!isOpen || !item) return null

    // Domain-aware styling
    const domainStyles = {
        core: 'border-gray-300'
    }
    const borderColor = domainStyles[domain] || domainStyles.core
    const relationships = Array.isArray(item?.relationships) ? item.relationships : []
    const isPageRecord = item?.type === 'page'
    const isSmartPageRecord = item?.type === 'smart_page'
    const parsedAttributes = safeJsonValue(item?.attributes, {})
    const parsedMetadata = safeJsonValue(item?.metadata, {})
    const pageBlocks = isPageRecord ? normalizePageBlocks(parsedMetadata?.blocks) : []
    const previewPageBlocks = isPageRecord ? attachResolvedSinglePostBlocks(pageBlocks, availablePostItems) : []

    const parsedTemplate = safeJsonValue(parsedAttributes?.template, {})
    const templateSections = Array.isArray(parsedTemplate?.sections) ? parsedTemplate.sections : []

    const visibleTemplateSections = templateSections
    const canEditTemplateSections = false

    const sectionLabels = {
        hero: 'Hero',
        featured_productions: 'Featured Productions',
        featured_companies: 'Featured Companies',
        featured_actors: 'Featured Actors',
        latest_posts: 'Latest Posts'
    }

    const formatSectionLabel = (key) => {
        const normalized = String(key || '').trim().toLowerCase()
        if (!normalized) return 'Section'
        if (sectionLabels[normalized]) return sectionLabels[normalized]
        return normalized
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
    }

    const updateAttributes = (nextAttributes) => {
        onChange('attributes', nextAttributes)
    }

    const updateMetadata = (nextMetadata) => {
        onChange('metadata', nextMetadata)
    }

    const updatePageBlocks = (nextBlocks) => {
        updateMetadata({
            ...parsedMetadata,
            blocks: normalizePageBlocks(nextBlocks)
        })
    }

    const updateTemplateSectionEnabled = (sectionKey, enabled) => {
        const normalizedKey = String(sectionKey || '').trim().toLowerCase()
        if (!normalizedKey) return

        const nextSections = templateSections.map((section) => {
            const key = String(section?.key || '').trim().toLowerCase()
            if (key !== normalizedKey) return section
            return {
                ...section,
                enabled: Boolean(enabled)
            }
        })

        updateAttributes({
            ...parsedAttributes,
            template: {
                ...parsedTemplate,
                sections: nextSections
            }
        })
    }

    const getAttributeValue = (attr) => {
        const direct = parsedAttributes?.[attr]
        if (direct !== null && direct !== undefined && direct !== '') {
            return typeof direct === 'object' ? JSON.stringify(direct) : String(direct)
        }

        // Backward compatibility for older production records that store a nested location object.
        if (attr === 'borough' || attr === 'neighborhood' || attr === 'area') {
            const legacy = parsedAttributes?.location?.[attr]
            return legacy ?? ''
        }

        return ''
    }

    const getImagePreviewUrl = () => {
        const fromAttributes = [
            item?.attributes?.url,
            item?.attributes?.image_url,
            item?.attributes?.source_url
        ]

        for (const value of fromAttributes) {
            if (typeof value === 'string' && value.trim()) return value.trim()
        }

        const fromMetadata = [
            item?.metadata?.source_url,
            item?.metadata?.url,
            item?.metadata?.presentation?.default?.image_url
        ]

        for (const value of fromMetadata) {
            if (typeof value === 'string' && value.trim()) return value.trim()
        }

        return ''
    }

    const imagePreviewUrl = item?.type === 'image' ? getImagePreviewUrl() : ''
    const pagePreviewMode = normalizePreviewMode(parsedAttributes?.domain || parsedMetadata?.domain || domain)
    const pagePreviewStyles = getDomainPageStyles(pagePreviewMode)
    const isPagePreviewMode = isPageRecord && !isReadOnly && pageEditorView === 'preview'
    const showAuthoringSections = !isPagePreviewMode
    const isPostRecord = getTypeLabel(item?.type) === 'post'
    const showPostDescriptionField = !isPostRecord || postFieldVisibility?.description !== false
    const showPostBodyField = isPostRecord && postFieldVisibility?.body !== false
    const headingValue = String(parsedMetadata?.presentation?.default?.heading || '')
    const domainValue = resolveDomainEditorValue({
        attributes: parsedAttributes,
        metadata: parsedMetadata,
        modalDomain: domain,
        typeConfigDomain: typeConfig?.domain
    })
    const editableAttributes = Array.isArray(typeConfig?.attributes)
        ? typeConfig.attributes.filter((attr) => {
            if (attr === 'domain') return false
            return true
        })
        : []

    const updateDomainValue = (nextValue) => {
        const normalizedValue = normalizeDomainEditorValue(nextValue)
        const nextAttributes = { ...parsedAttributes }
        const nextMetadata = { ...parsedMetadata }

        if (normalizedValue) {
            nextAttributes.domain = normalizedValue
        } else {
            delete nextAttributes.domain
        }

        if (Object.prototype.hasOwnProperty.call(nextMetadata, 'domain')) {
            delete nextMetadata.domain
        }

        updateAttributes(nextAttributes)
        updateMetadata(nextMetadata)
    }

    const updateHeadingValue = (nextHeading) => {
        onChange('heading', nextHeading)

        const presentation = typeof parsedMetadata?.presentation === 'object' && parsedMetadata.presentation !== null
            ? parsedMetadata.presentation
            : {}
        const defaultPresentation = typeof presentation.default === 'object' && presentation.default !== null
            ? presentation.default
            : {}

        updateMetadata({
            ...parsedMetadata,
            presentation: {
                ...presentation,
                default: {
                    ...defaultPresentation,
                    heading: nextHeading
                }
            }
        })
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className={`bg-white rounded-lg shadow-xl w-full max-w-[96vw] lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl max-h-[92vh] overflow-hidden border-l-4 ${borderColor}`}>
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {isReadOnly ? 'View' : 'Edit'} {getTypeLabel(item.type)}
                    </h2>
                    <div className="flex items-center gap-2">
                        {isPageRecord && !isReadOnly && (
                            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => setPageEditorView('edit')}
                                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${pageEditorView === 'edit'
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900'
                                        }`}
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPageEditorView('preview')}
                                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${pageEditorView === 'preview'
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900'
                                        }`}
                                >
                                    Preview
                                </button>
                            </div>
                        )}
                        {isReadOnly && typeof onSwitchToEdit === 'function' && (
                            <button
                                type="button"
                                onClick={() => {
                                    setPageEditorView('edit')
                                    onSwitchToEdit()
                                }}
                                className="h-9 w-9 inline-flex items-center justify-center admin-btn"
                                aria-label="Switch to edit mode"
                                title="Edit"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 py-4 overflow-y-auto max-h-[calc(92vh-150px)]">
                    {isPagePreviewMode && (
                        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-medium">
                                Slug: {item.slug || 'unsaved-page'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-medium">
                                Status: {item.status || 'draft'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-medium">
                                {getDomainLabel(pagePreviewMode)} Preview
                            </span>
                        </div>
                    )}

                    {showAuthoringSections && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Title */}
                            <div className={isPageRecord || isPostRecord ? 'lg:col-span-1' : 'lg:col-span-2'}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Title
                                </label>
                                <input
                                    type="text"
                                    value={item.title || ''}
                                    onChange={(e) => onChange('title', e.target.value)}
                                    disabled={isReadOnly}
                                    className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                        }`}
                                />
                            </div>

                            {!isPageRecord && isPostRecord && (
                                <div className="lg:col-span-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Slug
                                    </label>
                                    <input
                                        type="text"
                                        value={item.slug || ''}
                                        onChange={(e) => onChange('slug', e.target.value)}
                                        disabled={isReadOnly}
                                        className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''}`}
                                    />
                                </div>
                            )}

                            {isPageRecord && (
                                <div className="lg:col-span-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Slug
                                    </label>
                                    <input
                                        type="text"
                                        value={item.slug || ''}
                                        onChange={(e) => onChange('slug', e.target.value)}
                                        disabled={isReadOnly}
                                        className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                            }`}
                                    />
                                </div>
                            )}

                            {/* Type (Read-only) */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Type
                                </label>
                                <input
                                    type="text"
                                    value={getTypeLabel(item.type)}
                                    disabled
                                    className="admin-input bg-gray-50 text-gray-600"
                                />
                            </div>

                            {/* Status */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Status
                                </label>
                                <select
                                    value={item.status || 'draft'}
                                    onChange={(e) => onChange('status', e.target.value)}
                                    disabled={isReadOnly}
                                    className={`admin-select w-full text-base ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                        }`}
                                >
                                    <option value="draft">Draft</option>
                                    <option value="published">Published</option>
                                    <option value="archived">Archived</option>
                                    <option value="curated">Curated</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Domain
                                </label>
                                <select
                                    value={domainValue}
                                    onChange={(e) => updateDomainValue(e.target.value)}
                                    disabled={isReadOnly}
                                    className={`admin-select w-full text-base ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''}`}
                                >
                                    {DOMAIN_OPTIONS.map((option) => (
                                        <option key={option.value || 'unspecified'} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* TTL */}
                            {(() => {
                                const meta = typeof item?.metadata === 'string' ? (() => { try { return JSON.parse(item.metadata) } catch { return {} } })() : (item?.metadata || {})
                                const ttlDays = Number(meta.ttl_days)
                                if (!ttlDays || !Number.isFinite(ttlDays)) return null
                                const createdAt = item?.created_at ? new Date(item.created_at).getTime() : null
                                let expiryLabel = `${ttlDays} day${ttlDays !== 1 ? 's' : ''}`
                                if (createdAt && Number.isFinite(createdAt)) {
                                    const expiresAt = new Date(createdAt + ttlDays * 24 * 60 * 60 * 1000)
                                    const dateStr = expiresAt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                                    expiryLabel = `${ttlDays}d — expires ${dateStr}`
                                }
                                return (
                                    <div className="lg:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">TTL</label>
                                        <div className="admin-input bg-gray-50 text-gray-600">{expiryLabel}</div>
                                    </div>
                                )
                            })()}

                            {/* Slug */}
                            {!isPageRecord && (
                                <div className="lg:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {isPostRecord ? 'Heading' : 'Slug'}
                                    </label>
                                    {isPostRecord ? (
                                        <input
                                            type="text"
                                            value={headingValue}
                                            onChange={(e) => updateHeadingValue(e.target.value)}
                                            disabled={isReadOnly}
                                            className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''}`}
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            value={item.slug || ''}
                                            onChange={(e) => onChange('slug', e.target.value)}
                                            disabled={isReadOnly}
                                            className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                                }`}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Preview/Description */}
                            {showPostDescriptionField && (
                                <div className="lg:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Description
                                    </label>
                                    {isReadOnly ? (
                                        <div className="admin-input min-h-[3.5rem] bg-gray-50 text-gray-700 whitespace-pre-line">
                                            {summaryParagraphs.length > 0 ? (
                                                <div className="space-y-4">
                                                    {summaryParagraphs.map((paragraph, index) => (
                                                        <p key={index} className="leading-relaxed">
                                                            {paragraph}
                                                        </p>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-gray-500">No description</p>
                                            )}
                                        </div>
                                    ) : (
                                        <textarea
                                            ref={descriptionTextareaRef}
                                            value={item.preview || ''}
                                            onChange={(e) => {
                                                const textarea = e.target
                                                resizeDescriptionTextarea(textarea)
                                                onChange('preview', textarea.value)
                                            }}
                                            disabled={isReadOnly}
                                            rows="8"
                                            className={`admin-input resize-none min-h-[3.5rem] max-h-56 ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                                }`}
                                        />
                                    )}
                                </div>
                            )}

                            {showPostBodyField && (
                                <div className="lg:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Body
                                    </label>
                                    {isReadOnly ? (
                                        <div className="admin-input min-h-[3.5rem] bg-gray-50 text-gray-700 whitespace-pre-line">
                                            {bodyParagraphs.length > 0 ? (
                                                <div className="space-y-4">
                                                    {bodyParagraphs.map((paragraph, index) => (
                                                        <p key={index} className="leading-relaxed">
                                                            {paragraph}
                                                        </p>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-gray-500">No body</p>
                                            )}
                                        </div>
                                    ) : (
                                        <textarea
                                            ref={bodyTextareaRef}
                                            value={item.body || ''}
                                            onChange={(e) => {
                                                const textarea = e.target
                                                resizeDescriptionTextarea(textarea)
                                                onChange('body', textarea.value)
                                            }}
                                            disabled={isReadOnly}
                                            rows="10"
                                            className={`admin-input resize-none min-h-[3.5rem] max-h-56 ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                                }`}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Image Preview (Image records) */}
                            {item?.type === 'image' && (
                                <div className="lg:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Image Preview
                                    </label>
                                    {imagePreviewUrl ? (
                                        <div className="border border-gray-200 rounded-lg bg-gray-50 p-3">
                                            <Image
                                                src={imagePreviewUrl}
                                                alt={item?.title || 'Image preview'}
                                                unoptimized
                                                width={1200}
                                                height={720}
                                                className="max-h-72 w-full object-contain bg-white border border-gray-200 rounded"
                                            />
                                            <p className="text-xs text-gray-500 mt-2 break-all">
                                                {imagePreviewUrl}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="admin-input bg-gray-50 text-gray-500">
                                            No image URL found on this record.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Type-Specific Fields */}
                    {showAuthoringSections && editableAttributes.length > 0 && (
                        <div className="border-t pt-4 mt-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-3">
                                {typeConfig.label} Details
                            </h3>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {editableAttributes.map((attr) => (
                                    <div key={attr}>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {attr.charAt(0).toUpperCase() + attr.slice(1).replace(/_/g, ' ')}
                                        </label>
                                        <input
                                            type="text"
                                            value={getAttributeValue(attr)}
                                            onChange={(e) => updateAttributes({ ...parsedAttributes, [attr]: e.target.value })}
                                            disabled={isReadOnly}
                                            className={`admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''
                                                }`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {showAuthoringSections && canEditTemplateSections && (
                        <div className="border-t pt-4 mt-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-3">Home Page Sections</h3>
                            <div className="space-y-2">
                                {visibleTemplateSections.map((section, index) => {
                                    const key = String(section?.key || '').trim()
                                    const enabled = section?.enabled !== false
                                    const label = formatSectionLabel(key)

                                    return (
                                        <label key={key || `section-${index}`} className="flex items-center justify-between gap-3 border border-gray-200 rounded px-3 py-2 bg-gray-50">
                                            <div>
                                                <p className="text-sm font-medium text-gray-800">{label}</p>
                                                {section?.limit ? (
                                                    <p className="text-xs text-gray-500">Limit: {section.limit}</p>
                                                ) : null}
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={enabled}
                                                onChange={(e) => updateTemplateSectionEnabled(key, e.target.checked)}
                                                disabled={isReadOnly}
                                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                                            />
                                        </label>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {showAuthoringSections && isSmartPageRecord && (
                        <div className="border-t pt-4 mt-4">
                            <SmartPageEditor
                                item={item}
                                editingData={item}
                                isReadOnly={isReadOnly}
                                isSaving={isSaving}
                                error={error}
                                onChange={(field, value) => {
                                    if (field === 'attributes') {
                                        onChange?.('attributes', value)
                                    } else {
                                        onChange?.(field, value)
                                    }
                                }}
                            />
                        </div>
                    )}

                    {showAuthoringSections && isPageRecord && (
                        <div className="border-t pt-4 mt-4">
                            <PageBlocksEditor
                                blocks={pageBlocks}
                                onChange={updatePageBlocks}
                                isReadOnly={isReadOnly}
                                availablePostItems={availablePostItems}
                                onCreatePostForBlock={onCreatePostForBlock}
                                onEditPostForBlock={onEditPostForBlock}
                            />
                        </div>
                    )}

                    {(isReadOnly || isPagePreviewMode) && isPageRecord && (
                        <div className="border-t pt-4 mt-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700">Page Preview</h3>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Renders this page using the same article layout as the public page.
                                    </p>
                                </div>
                                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
                                    {getDomainLabel(pagePreviewMode)} Preview
                                </span>
                            </div>

                            <div className={pagePreviewStyles.layout.page}>
                                <div className={`${pagePreviewStyles.detail.content} max-w-none`}>
                                    <PageContentArticle
                                        pageTitle={item.title || 'Untitled Page'}
                                        summaryParagraphs={summaryParagraphs}
                                        bodyParagraphs={[]}
                                        blocks={previewPageBlocks}
                                        pageStyles={pagePreviewStyles}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {showAuthoringSections && allowRelationships && relationships.length > 0 && (
                        <div className="border-t pt-4 mt-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-3">
                                Relationships ({relationships.length})
                            </h3>
                            <div className="space-y-2">
                                {relationships.map((rel) => (
                                    <div key={rel.id || `${rel.source_id}-${rel.target_id}-${rel.type}`} className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 flex items-start justify-between gap-2">
                                        <div>
                                            <p>
                                                <span className="font-medium">{rel.source_label}</span>
                                                <span className="mx-1 text-gray-500">--{rel.type}--&gt;</span>
                                                <span className="font-medium">{rel.target_label}</span>
                                            </p>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {rel.direction === 'out' ? 'Outgoing' : 'Incoming'}
                                                {rel.role ? ` | role: ${rel.role}` : ''}
                                                {(rel.position !== null && rel.position !== undefined) ? ` | position: ${rel.position}` : ''}
                                            </p>
                                        </div>
                                        {!isReadOnly && typeof onDeleteRelationship === 'function' && rel.id && (
                                            <button
                                                type="button"
                                                onClick={() => onDeleteRelationship(rel.id)}
                                                className="text-gray-400 hover:text-red-600 shrink-0 mt-0.5"
                                                title="Remove relationship"
                                            >
                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M18 6 6 18M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Add Relationship */}
                    {showAuthoringSections && allowRelationships && !isReadOnly && typeof onCreateRelationship === 'function' && (
                        <div className="border-t pt-4 mt-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-3">Add Relationship</h3>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Relationship Type</label>
                                    <select
                                        value={linkForm.relationshipType}
                                        onChange={(e) => updateLinkForm({ relationshipType: e.target.value, error: '', success: '' })}
                                        className="admin-select w-full text-sm"
                                    >
                                        {(relationshipTypeOptions || ['related_to', 'production_company', 'cast', 'logo', 'featured_in', 'mentions']).map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Target Type</label>
                                    <select
                                        value={linkForm.targetType}
                                        onChange={(e) => updateLinkForm({ targetType: e.target.value, targetId: '', error: '', success: '' })}
                                        className="admin-select w-full text-sm"
                                    >
                                        {(targetTypeOptions || ['all', 'production', 'company', 'actor', 'image', 'location', 'post', 'document']).map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Search Target</label>
                                    <input
                                        type="text"
                                        value={linkForm.targetQuery}
                                        onChange={(e) => updateLinkForm({ targetQuery: e.target.value, targetId: '', error: '', success: '' })}
                                        placeholder="Title, slug, or ID"
                                        className="admin-input text-sm"
                                    />
                                </div>
                            </div>

                            {/* Candidates */}
                            <div className="bg-gray-50 border border-gray-200 rounded p-2 max-h-32 overflow-y-auto mb-3">
                                {linkCandidates.length === 0 ? (
                                    <p className="text-xs text-gray-500">No matching records</p>
                                ) : (
                                    linkCandidates.map(candidate => (
                                        <button
                                            key={candidate.id}
                                            type="button"
                                            onClick={() => updateLinkForm({ targetId: candidate.id, error: '', success: '' })}
                                            className={`w-full text-left text-xs px-2 py-1 rounded mb-1 last:mb-0 ${Number(linkForm.targetId) === Number(candidate.id)
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                                                }`}
                                        >
                                            #{candidate.id} {getContentLabel(candidate)} <span className="opacity-60">({candidate.type || 'unknown'})</span>
                                            {candidate.attributes?.category && <span className="opacity-60"> — {candidate.attributes.category}</span>}
                                        </button>
                                    ))
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-gray-600">
                                    {selectedTarget
                                        ? `Selected: #${selectedTarget.id} ${getContentLabel(selectedTarget)} (${selectedTarget.type || 'unknown'})`
                                        : 'Select a target record above'}
                                </p>
                                <button
                                    type="button"
                                    onClick={handleCreateRelationship}
                                    disabled={linkForm.saving || !linkForm.targetId}
                                    className="px-3 py-1 text-xs admin-btn-primary disabled:opacity-50"
                                >
                                    {linkForm.saving ? 'Linking...' : 'Create Link'}
                                </button>
                            </div>

                            {linkForm.error && <p className="mt-2 text-xs text-red-600">{linkForm.error}</p>}
                            {linkForm.success && <p className="mt-2 text-xs text-green-700">{linkForm.success}</p>}
                        </div>
                    )}


                    {/* Error Message */}
                    {error && (
                        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 admin-btn font-medium"
                    >
                        {isReadOnly ? 'Close' : 'Cancel'}
                    </button>
                    {!isReadOnly && (
                        <button
                            onClick={onSave}
                            disabled={isSaving}
                            className="px-4 py-2 admin-btn-active font-medium disabled:opacity-60"
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

function safeJsonValue(value, fallback = {}) {
    if (value === null || value === undefined) return fallback
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return fallback
        }
    }
    return fallback
}

function normalizePreviewMode(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (VALID_DOMAIN_MODES.includes(normalized)) {
        return normalized
    }
    return DEFAULT_DOMAIN_MODE
}

function normalizeDomainEditorValue(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (VALID_DOMAIN_MODES.includes(normalized) || normalized === 'core') {
        return normalized
    }
    return ''
}

function resolveDomainEditorValue({ attributes, metadata, modalDomain, typeConfigDomain }) {
    const explicit = normalizeDomainEditorValue(attributes?.domain || metadata?.domain)
    if (explicit) return explicit

    const typeLevel = normalizeDomainEditorValue(typeConfigDomain)
    if (typeLevel && typeLevel !== 'core') return typeLevel

    const modalLevel = normalizeDomainEditorValue(modalDomain)
    return modalLevel
}
