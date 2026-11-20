'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPageBlock, getPageBlockTypeOptions, normalizePageBlocks } from '@/lib/pageBlocks'
import { resolvePageBlockPostItem, toPageBlockPostOption } from '@/lib/pageBlockPosts'
import { normalizeLatestPostsLayout } from '@/lib/latestPosts'

export default function PageBlocksEditor({
    blocks = [],
    onChange,
    isReadOnly = false,
    emptyMessage = 'No blocks yet.',
    title = 'Page Blocks',
    description = 'Add optional structured sections below the standard description.',
    additionalBlockTypeOptions = [],
    excludedBlockTypes = [],
    availablePostItems = [],
    excludePostIds = [],
    onCreatePostForBlock,
    onEditPostForBlock,
    previewPanel = null
}) {
    const normalizedBlocks = normalizePageBlocks(blocks)
    const [collapsedBlockIds, setCollapsedBlockIds] = useState({})
    const [editorView, setEditorView] = useState('edit')
    const excludedTypeSet = useMemo(
        () => new Set((Array.isArray(excludedBlockTypes) ? excludedBlockTypes : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)),
        [excludedBlockTypes]
    )
    const pageBlockTypeOptions = [
        ...getPageBlockTypeOptions(),
        ...additionalBlockTypeOptions
    ].filter((option, index, collection) => {
        const optionValue = String(option?.value || '').trim().toLowerCase()
        if (optionValue && excludedTypeSet.has(optionValue)) return false
        return collection.findIndex((candidate) => candidate.value === option.value) === index
    })
    const isPreviewView = !isReadOnly && editorView === 'preview'
    const effectiveIsReadOnly = isReadOnly || isPreviewView
    const effectiveCollapsedBlockIds = useMemo(() => {
        const next = {}
        normalizedBlocks.forEach((block) => {
            const blockId = String(block.id || '').trim()
            if (!blockId) return

            if (Object.prototype.hasOwnProperty.call(collapsedBlockIds, blockId)) {
                next[blockId] = Boolean(collapsedBlockIds[blockId])
                return
            }

            // Default new/loaded blocks to collapsed.
            next[blockId] = true
        })
        return next
    }, [collapsedBlockIds, normalizedBlocks])

    const updateBlocks = (nextBlocks) => {
        if (typeof onChange !== 'function') return
        onChange(normalizePageBlocks(nextBlocks))
    }

    const addPageBlock = (type) => {
        const nextBlock = createPageBlock(type)
        const nextBlockId = String(nextBlock?.id || '').trim()

        updateBlocks([...normalizedBlocks, nextBlock])

        if (nextBlockId) {
            setCollapsedBlockIds((prev) => ({
                ...prev,
                [nextBlockId]: true
            }))
        }
    }

    const updatePageBlock = (blockId, updates) => {
        updateBlocks(normalizedBlocks.map((block) => (
            block.id === blockId ? { ...block, ...updates } : block
        )))
    }

    const removePageBlock = (blockId) => {
        updateBlocks(normalizedBlocks.filter((block) => block.id !== blockId))
    }

    const movePageBlock = (blockId, direction) => {
        const index = normalizedBlocks.findIndex((block) => block.id === blockId)
        if (index < 0) return

        const nextIndex = direction === 'up' ? index - 1 : index + 1
        if (nextIndex < 0 || nextIndex >= normalizedBlocks.length) return

        const nextBlocks = [...normalizedBlocks]
        const [moved] = nextBlocks.splice(index, 1)
        nextBlocks.splice(nextIndex, 0, moved)
        updateBlocks(nextBlocks)
    }

    const toggleBlockCollapsed = (blockId) => {
        const normalizedId = String(blockId || '').trim()
        if (!normalizedId) return

        setCollapsedBlockIds((prev) => ({
            ...prev,
            [normalizedId]: !prev[normalizedId]
        }))
    }

    const setAllBlocksCollapsed = (collapsed) => {
        const nextState = normalizedBlocks.reduce((acc, block) => {
            const blockId = String(block.id || '').trim()
            if (!blockId) return acc
            acc[blockId] = Boolean(collapsed)
            return acc
        }, {})
        setCollapsedBlockIds(nextState)
    }

    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                    <h3 className="text-sm font-medium text-gray-700">{title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{description}</p>
                </div>
                <div className="flex items-center gap-2">
                    {!effectiveIsReadOnly && (
                        <select
                            defaultValue=""
                            onChange={(e) => {
                                if (!e.target.value) return
                                addPageBlock(e.target.value)
                                e.target.value = ''
                            }}
                            className="admin-select w-44 text-sm"
                        >
                            <option value="">Add block...</option>
                            {pageBlockTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    )}

                    {!isReadOnly && (
                        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
                            <button
                                type="button"
                                onClick={() => setEditorView('edit')}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${editorView === 'edit'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditorView('preview')}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${editorView === 'preview'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                Preview
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {normalizedBlocks.length > 0 && !isPreviewView && (
                <div className="mb-3 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setAllBlocksCollapsed(false)}
                        className="px-2 py-1 text-xs admin-btn"
                    >
                        Expand all
                    </button>
                    <button
                        type="button"
                        onClick={() => setAllBlocksCollapsed(true)}
                        className="px-2 py-1 text-xs admin-btn"
                    >
                        Collapse all
                    </button>
                </div>
            )}

            {isPreviewView && previewPanel ? (
                <div>{previewPanel}</div>
            ) : normalizedBlocks.length === 0 ? (
                <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    {emptyMessage}
                </div>
            ) : (
                <div className="space-y-3">
                    {normalizedBlocks.map((block, index) => {
                        const blockId = String(block.id || '').trim()
                        const isCollapsed = Boolean(effectiveCollapsedBlockIds[blockId])

                        return (
                            <div key={block.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <p className="text-sm font-medium text-gray-800">
                                            {formatPageBlockTypeLabel(block.type)}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            Block {index + 1}
                                            {isCollapsed ? ' • Collapsed' : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => toggleBlockCollapsed(blockId)}
                                            className="px-2 py-1 text-xs admin-btn"
                                            aria-expanded={!isCollapsed}
                                        >
                                            {isCollapsed ? 'Expand' : 'Collapse'}
                                        </button>

                                        {!effectiveIsReadOnly && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => movePageBlock(block.id, 'up')}
                                                    disabled={index === 0}
                                                    className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                                >
                                                    Up
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => movePageBlock(block.id, 'down')}
                                                    disabled={index === normalizedBlocks.length - 1}
                                                    className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                                >
                                                    Down
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removePageBlock(block.id)}
                                                    className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
                                                >
                                                    Remove
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {!isCollapsed && renderPageBlockFields({
                                    block,
                                    isReadOnly: effectiveIsReadOnly,
                                    onUpdate: (updates) => updatePageBlock(block.id, updates),
                                    availablePostItems,
                                    excludePostIds,
                                    onCreatePostForBlock,
                                    onEditPostForBlock
                                })}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function formatPageBlockTypeLabel(type) {
    if (type === 'latest_posts') return 'Latest Posts Feed'
    if (type === 'industry_news') return 'Industry News'
    if (type === 'single_post') return 'Single Post'
    if (type === 'three_panel') return 'Three Panel Feature'
    if (type === 'cards') return 'Cards Grid'

    return String(type || '')
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Block'
}

function toAnchorSlug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
}

function updateHeadingWithAutoSlug({ block, onUpdate, nextHeading, field = 'heading' }) {
    const currentSlug = String(block?.slug || '').trim()
    const previousHeading = String(block?.[field] || '')
    const previousAutoSlug = toAnchorSlug(previousHeading)
    const nextAutoSlug = toAnchorSlug(nextHeading)
    const shouldAutoUpdateSlug = !currentSlug || currentSlug === previousAutoSlug

    onUpdate({
        [field]: nextHeading,
        ...(shouldAutoUpdateSlug ? { slug: nextAutoSlug } : {})
    })
}

function renderPageBlockFields({ block, isReadOnly, onUpdate, availablePostItems = [], excludePostIds = [], onCreatePostForBlock, onEditPostForBlock }) {
    const sharedTextareaClass = `admin-input min-h-[7rem] ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''}`
    const sharedInputClass = `admin-input ${isReadOnly ? 'bg-gray-50 text-gray-600' : ''}`

    switch (block.type) {
        case 'eyebrow':
            return (
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Text</label>
                    {isReadOnly ? (
                        <div className="admin-input bg-gray-50 text-gray-700 whitespace-pre-line">{block.text || 'No eyebrow text'}</div>
                    ) : (
                        <input
                            type="text"
                            value={block.text || ''}
                            onChange={(e) => onUpdate({ text: e.target.value })}
                            className={sharedInputClass}
                        />
                    )}
                </div>
            )
        case 'heading':
            return (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-3">
                        <label className="block text-xs text-gray-500 mb-1">Text</label>
                        {isReadOnly ? (
                            <div className="admin-input bg-gray-50 text-gray-700 whitespace-pre-line">{block.text || 'No heading text'}</div>
                        ) : (
                            <input
                                type="text"
                                value={block.text || ''}
                                onChange={(e) => onUpdate({ text: e.target.value })}
                                className={sharedInputClass}
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Level</label>
                        {isReadOnly ? (
                            <div className="admin-input bg-gray-50 text-gray-700">H{block.level || 2}</div>
                        ) : (
                            <select
                                value={block.level || 2}
                                onChange={(e) => onUpdate({ level: Number(e.target.value) })}
                                className="admin-select w-full text-base"
                            >
                                <option value={2}>H2</option>
                                <option value={3}>H3</option>
                                <option value={4}>H4</option>
                            </select>
                        )}
                    </div>
                </div>
            )
        case 'paragraph':
            return (
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Text</label>
                    {isReadOnly ? (
                        <div className="admin-input bg-gray-50 text-gray-700 whitespace-pre-line">{block.text || 'No paragraph text'}</div>
                    ) : (
                        <textarea
                            value={block.text || ''}
                            onChange={(e) => onUpdate({ text: e.target.value })}
                            rows="5"
                            className={sharedTextareaClass}
                        />
                    )}
                </div>
            )
        case 'image':
            return (
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Image URL</label>
                        <input
                            type="text"
                            value={block.src || ''}
                            onChange={(e) => onUpdate({ src: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Alt Text</label>
                        <input
                            type="text"
                            value={block.alt || ''}
                            onChange={(e) => onUpdate({ alt: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Caption</label>
                        <input
                            type="text"
                            value={block.caption || ''}
                            onChange={(e) => onUpdate({ caption: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                </div>
            )
        case 'quote':
            return (
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Quote</label>
                        {isReadOnly ? (
                            <div className="admin-input bg-gray-50 text-gray-700 whitespace-pre-line">{block.quote || 'No quote text'}</div>
                        ) : (
                            <textarea
                                value={block.quote || ''}
                                onChange={(e) => onUpdate({ quote: e.target.value })}
                                rows="4"
                                className={sharedTextareaClass}
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Attribution</label>
                        <input
                            type="text"
                            value={block.attribution || ''}
                            onChange={(e) => onUpdate({ attribution: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                </div>
            )
        case 'cta':
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Button Text</label>
                        <input
                            type="text"
                            value={block.text || ''}
                            onChange={(e) => onUpdate({ text: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Link URL</label>
                        <input
                            type="text"
                            value={block.href || ''}
                            onChange={(e) => onUpdate({ href: e.target.value })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                </div>
            )
        case 'contact':
            return (
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Title</label>
                        <input
                            type="text"
                            value={block.title || ''}
                            onChange={(e) => onUpdate({ title: e.target.value })}
                            disabled={isReadOnly}
                            placeholder="Contact"
                            className={sharedInputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Heading</label>
                        <input
                            type="text"
                            value={block.heading || ''}
                            onChange={(e) => onUpdate({ heading: e.target.value })}
                            disabled={isReadOnly}
                            placeholder="Let's talk"
                            className={sharedInputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Description</label>
                        <textarea
                            value={block.description || ''}
                            onChange={(e) => onUpdate({ description: e.target.value })}
                            disabled={isReadOnly}
                            rows={3}
                            placeholder="Tell visitors what to expect when they reach out."
                            className={sharedTextareaClass}
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Primary Link Text</label>
                            <input
                                type="text"
                                value={block.ctaText || ''}
                                onChange={(e) => onUpdate({ ctaText: e.target.value })}
                                disabled={isReadOnly}
                                placeholder="Schedule an intro call"
                                className={sharedInputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Primary Link URL</label>
                            <input
                                type="text"
                                value={block.ctaHref || ''}
                                onChange={(e) => onUpdate({ ctaHref: e.target.value })}
                                disabled={isReadOnly}
                                placeholder="/contact"
                                className={sharedInputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Secondary Link Text (optional)</label>
                            <input
                                type="text"
                                value={block.secondaryCtaText || ''}
                                onChange={(e) => onUpdate({ secondaryCtaText: e.target.value })}
                                disabled={isReadOnly}
                                placeholder="Or see how I work"
                                className={sharedInputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Secondary Link URL (optional)</label>
                            <input
                                type="text"
                                value={block.secondaryCtaHref || ''}
                                onChange={(e) => onUpdate({ secondaryCtaHref: e.target.value })}
                                disabled={isReadOnly}
                                placeholder="/how-i-work"
                                className={sharedInputClass}
                            />
                        </div>
                    </div>
                </div>
            )
        case 'latest_posts':
            return (
                <LatestPostsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    availablePostItems={availablePostItems}
                    excludePostIds={excludePostIds}
                />
            )
        case 'industry_news':
            return (
                <IndustryNewsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'single_post':
            return (
                <SinglePostBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    availablePostItems={availablePostItems}
                    excludePostIds={excludePostIds}
                    onCreatePostForBlock={onCreatePostForBlock}
                    onEditPostForBlock={onEditPostForBlock}
                />
            )
        case 'three_panel':
            return (
                <ThreePanelBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedTextareaClass={sharedTextareaClass}
                    sharedInputClass={sharedInputClass}
                    availablePostItems={availablePostItems}
                    excludePostIds={excludePostIds}
                />
            )
        case 'cards':
            return (
                <CardsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedTextareaClass={sharedTextareaClass}
                    sharedInputClass={sharedInputClass}
                    availablePostItems={availablePostItems}
                    excludePostIds={excludePostIds}
                    onCreatePostForBlock={onCreatePostForBlock}
                    onEditPostForBlock={onEditPostForBlock}
                />
            )
        case 'faq':
            return (
                <FaqBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedTextareaClass={sharedTextareaClass}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'divider':
            return <p className="text-sm text-gray-500">Renders a simple horizontal divider.</p>
        case 'hero':
            return (
                <HeroBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'testimonials':
            return (
                <TestimonialsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        case 'stats':
            return (
                <StatsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'logo_marquee':
            return (
                <LogoMarqueeBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'feature_comparison':
            return (
                <FeatureComparisonBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                />
            )
        case 'steps':
            return (
                <StepsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        case 'pricing':
            return (
                <PricingBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        case 'bio_profile':
            return (
                <BioProfileBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        case 'icon_cards':
            return (
                <IconCardsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        case 'proof_points':
            return (
                <ProofPointsBlockFields
                    block={block}
                    isReadOnly={isReadOnly}
                    onUpdate={onUpdate}
                    sharedInputClass={sharedInputClass}
                    sharedTextareaClass={sharedTextareaClass}
                />
            )
        default:
            return null
    }
}

function IndustryNewsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass }) {
    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-500">
                Renders the latest generated practice industry news item for the configured topic.
            </p>
            <div>
                <label className="block text-xs text-gray-500 mb-1">Heading</label>
                <input
                    type="text"
                    value={block.heading || ''}
                    onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })}
                    disabled={isReadOnly}
                    placeholder="Industry News"
                    className={sharedInputClass}
                />
            </div>
            <div>
                <label className="block text-xs text-gray-500 mb-1">Topic</label>
                <input
                    type="text"
                    value={block.topic || ''}
                    onChange={(e) => onUpdate({ topic: e.target.value })}
                    disabled={isReadOnly}
                    placeholder="Small Business Operations"
                    className={sharedInputClass}
                />
            </div>
        </div>
    )
}

function FaqBlockFields({ block, isReadOnly, onUpdate, sharedTextareaClass, sharedInputClass }) {
    const items = Array.isArray(block.items) ? block.items : []

    const addItem = () => {
        onUpdate({ items: [...items, { question: '', answer: '' }] })
    }

    const removeItem = (index) => {
        onUpdate({ items: items.filter((_, i) => i !== index) })
    }

    const updateItem = (index, field, value) => {
        onUpdate({ items: items.map((item, i) => i === index ? { ...item, [field]: value } : item) })
    }

    const moveItem = (index, direction) => {
        const next = index + direction
        if (next < 0 || next >= items.length) return
        const nextItems = [...items]
        const [moved] = nextItems.splice(index, 1)
        nextItems.splice(next, 0, moved)
        onUpdate({ items: nextItems })
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">
                A list of expandable question-and-answer pairs.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Section heading (optional)</label>
                    <input
                        type="text"
                        value={block.heading || ''}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })}
                        disabled={isReadOnly}
                        placeholder="e.g. Frequently Asked Questions"
                        className={sharedInputClass}
                    />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input
                        type="text"
                        value={block.slug || ''}
                        onChange={(e) => onUpdate({ slug: e.target.value })}
                        disabled={isReadOnly}
                        placeholder="faq"
                        className={sharedInputClass}
                    />
                </div>
            </div>
            <div className="space-y-3">
                {items.length === 0 && (
                    <p className="rounded border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
                        No questions yet. Click &ldquo;Add Question&rdquo; below.
                    </p>
                )}
                {items.map((item, index) => (
                    <div key={`faq-item-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-sm font-medium text-gray-800">Q{index + 1}</p>
                            {!isReadOnly && (
                                <div className="flex items-center gap-1">
                                    <button type="button" onClick={() => removeItem(index)} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
                                </div>
                            )}
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Question</label>
                                <input
                                    type="text"
                                    value={item.question || ''}
                                    onChange={(e) => updateItem(index, 'question', e.target.value)}
                                    disabled={isReadOnly}
                                    placeholder="e.g. How much does it cost?"
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Answer</label>
                                <textarea
                                    value={item.answer || ''}
                                    onChange={(e) => updateItem(index, 'answer', e.target.value)}
                                    disabled={isReadOnly}
                                    rows={3}
                                    className={sharedTextareaClass}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="text-sm admin-btn">
                    + Add Question
                </button>
            )}
        </div>
    )
}

function SinglePostBlockFields({
    block,
    isReadOnly,
    onUpdate,
    sharedInputClass,
    availablePostItems = [],
    excludePostIds = [],
    onCreatePostForBlock,
    onEditPostForBlock
}) {
    const excludedIds = new Set((Array.isArray(excludePostIds) ? excludePostIds : []).map((item) => String(item || '').trim()).filter(Boolean))
    const normalizedItems = (Array.isArray(availablePostItems) ? availablePostItems : [])
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id && !excludedIds.has(item.id))
    const selectedItem = resolvePageBlockPostItem({
        items: normalizedItems,
        postId: block.postId,
        postSlug: block.postSlug
    })

    useEffect(() => {
        if (!selectedItem) return

        const currentTitle = String(block.title || '').trim()
        const currentHeading = String(block.heading || '').trim()
        const nextTitle = String(selectedItem.title || '').trim()
        const nextHeading = String(selectedItem.heading || '').trim()

        const updates = {}
        if (!currentTitle && nextTitle) {
            updates.title = nextTitle
        }
        if (!currentHeading && (nextHeading || nextTitle)) {
            updates.heading = nextHeading || nextTitle
        }

        if (Object.keys(updates).length > 0) {
            onUpdate(updates)
        }
    }, [selectedItem, block.title, block.heading, onUpdate])

    const selectPost = (postId) => {
        const normalizedId = String(postId || '').trim()
        if (!normalizedId) return

        const nextItem = normalizedItems.find((item) => item.id === normalizedId)
        onUpdate({
            title: nextItem?.title || '',
            heading: nextItem?.heading || nextItem?.title || '',
            postId: normalizedId,
            postSlug: nextItem?.slug || block.postSlug || ''
        })
    }

    const clearPost = () => {
        onUpdate({ postId: '', postSlug: '' })
    }

    const requestCreatePost = () => {
        if (typeof onCreatePostForBlock !== 'function') return
        onCreatePostForBlock(block.id)
    }

    const requestEditPost = typeof onEditPostForBlock === 'function'
        ? () => {
            if (!selectedItem?.id) return
            onEditPostForBlock({
                blockId: block.id,
                postId: selectedItem.id,
                postSlug: selectedItem.slug || ''
            })
        }
        : undefined

    return (
        <div className="space-y-4">
            <PageBlockPostSelectorFields
                block={block}
                isReadOnly={isReadOnly}
                onUpdate={onUpdate}
                sharedInputClass={sharedInputClass}
                normalizedItems={normalizedItems}
                selectedItem={selectedItem}
                onSelectPost={selectPost}
                onClearPost={clearPost}
                eyebrowLabel="Title"
                eyebrowField="title"
                headingLabel="Heading"
                headingField="heading"
                showSlugField
                slugPlaceholder="single-post"
                postLabel="Selected post"
                emptyLabel="No posts are available yet."
                emptySelectionLabel="No post selected yet."
                onRequestCreatePost={requestCreatePost}
                onRequestEditPost={requestEditPost}
            />
        </div>
    )
}

function PageBlockPostSelectorFields({
    block,
    isReadOnly,
    onUpdate,
    sharedInputClass,
    normalizedItems,
    selectedItem,
    onSelectPost,
    onClearPost,
    eyebrowLabel,
    eyebrowField = 'eyebrow',
    headingLabel,
    headingField = 'heading',
    showSlugField = false,
    slugPlaceholder = 'section-anchor',
    postLabel,
    emptyLabel,
    emptySelectionLabel,
    onRequestCreatePost,
    onRequestEditPost
}) {
    const createNewOptionValue = '__add_new_post__'
    const canCreatePost = typeof onRequestCreatePost === 'function'
    const showEmptyState = normalizedItems.length === 0 && !canCreatePost

    const eyebrowInput = (
        <div>
            <label className="block text-xs text-gray-500 mb-1">{eyebrowLabel}</label>
            <input
                type="text"
                value={block[eyebrowField] || ''}
                onChange={(e) => onUpdate({ [eyebrowField]: e.target.value })}
                disabled={isReadOnly}
                className={sharedInputClass}
            />
        </div>
    )

    const slugInput = showSlugField ? (
        <div>
            <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
            <input
                type="text"
                value={block.slug || ''}
                onChange={(e) => onUpdate({ slug: e.target.value })}
                disabled={isReadOnly}
                className={sharedInputClass}
                placeholder={slugPlaceholder}
            />
        </div>
    ) : null

    return (
        <>
            {showSlugField ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {eyebrowInput}
                    {slugInput}
                </div>
            ) : eyebrowInput}

            {headingLabel ? (
                <div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">{headingLabel}</label>
                        <input
                            type="text"
                            value={block[headingField] || ''}
                            onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value, field: headingField })}
                            disabled={isReadOnly}
                            className={sharedInputClass}
                        />
                    </div>
                </div>
            ) : null}

            <div>
                <label className="block text-xs text-gray-500 mb-1">{postLabel}</label>
                {showEmptyState ? (
                    <p className="rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-sm text-amber-700">
                        {emptyLabel}
                    </p>
                ) : (
                    <select
                        value={block.postId || ''}
                        onChange={(e) => {
                            if (e.target.value === createNewOptionValue) {
                                if (typeof onRequestCreatePost === 'function') {
                                    onRequestCreatePost()
                                }
                                e.target.value = block.postId || ''
                                return
                            }

                            if (!e.target.value) {
                                onClearPost()
                                return
                            }
                            onSelectPost(e.target.value)
                        }}
                        disabled={isReadOnly}
                        className="admin-select w-full text-base"
                    >
                        <option value="">No post selected</option>
                        {canCreatePost && (
                            <option value={createNewOptionValue}>Add New...</option>
                        )}
                        {normalizedItems.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.title} {item.type ? `(${item.type})` : ''}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div>
                <p className="text-xs font-medium text-gray-600">Selection details</p>
                <div className="mt-2">
                    {!selectedItem ? (
                        <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                            {emptySelectionLabel}
                        </p>
                    ) : (
                        <div className="rounded border border-gray-200 bg-white px-4 py-3">
                            <p className="text-sm font-medium text-gray-900">{selectedItem.title}</p>
                            <p className="mt-1 text-xs text-gray-500">
                                {selectedItem.type || 'post'}
                                {selectedItem.slug ? ` • /${selectedItem.slug}` : ''}
                                {selectedItem.status ? ` • ${selectedItem.status}` : ''}
                            </p>
                            {selectedItem.summary ? (
                                <p className="mt-3 text-sm leading-6 text-gray-600">{selectedItem.summary}</p>
                            ) : null}
                            {selectedItem.heading ? (
                                <p className="mt-2 text-sm leading-6 text-gray-700">
                                    <span className="font-medium text-gray-800">Heading:</span> {selectedItem.heading}
                                </p>
                            ) : null}
                            {(!isReadOnly || typeof onRequestEditPost === 'function') && (
                                <div className="mt-3 flex items-center gap-2">
                                    {typeof onRequestEditPost === 'function' && (
                                        <button
                                            type="button"
                                            onClick={onRequestEditPost}
                                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                        >
                                            Edit selected post
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onClearPost}
                                        disabled={isReadOnly}
                                        className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                                    >
                                        Clear selection
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

function ThreePanelBlockFields({
    block,
    isReadOnly,
    onUpdate,
    sharedTextareaClass,
    sharedInputClass,
    availablePostItems = [],
    excludePostIds = []
}) {
    const excludedIds = new Set((Array.isArray(excludePostIds) ? excludePostIds : []).map((item) => String(item || '').trim()).filter(Boolean))
    const normalizedItems = (Array.isArray(availablePostItems) ? availablePostItems : [])
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id && !excludedIds.has(item.id))
    const selectedItem = resolvePageBlockPostItem({
        items: normalizedItems,
        postId: block.postId,
        postSlug: block.postSlug
    })

    useEffect(() => {
        if (!selectedItem) return

        const currentTitle = String(block.title || '').trim()
        const currentHeading = String(block.heading || '').trim()
        const nextTitle = String(selectedItem.title || '').trim()
        const nextHeading = String(selectedItem.heading || '').trim()

        const updates = {}
        if (!currentTitle && nextTitle) {
            updates.title = nextTitle
        }
        if (!currentHeading && (nextHeading || nextTitle)) {
            updates.heading = nextHeading || nextTitle
        }

        if (Object.keys(updates).length > 0) {
            onUpdate(updates)
        }
    }, [selectedItem, block.title, block.heading, onUpdate])
    const items = Array.isArray(block.items) ? block.items.slice(0, 3) : []
    while (items.length < 3) {
        items.push({ eyebrow: '', heading: '', body: '', body2: '', body3: '', body4: '' })
    }

    const selectPost = (postId) => {
        const normalizedId = String(postId || '').trim()
        if (!normalizedId) return

        const nextItem = normalizedItems.find((item) => item.id === normalizedId)
        onUpdate({
            title: nextItem?.title || block.title || '',
            heading: nextItem?.heading || nextItem?.title || '',
            postId: normalizedId,
            postSlug: nextItem?.slug || block.postSlug || ''
        })
    }

    const clearPost = () => {
        onUpdate({ postId: '', postSlug: '' })
    }

    const updateItem = (index, field, value) => {
        const nextItems = items.map((item, itemIndex) => (
            itemIndex === index ? { ...item, [field]: value } : item
        ))
        onUpdate({ items: nextItems })
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">
                Create a three-column feature row with an emphasized top band and supporting copy below.
            </p>
            <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 shadow-sm">
                <div className="space-y-4">
                    <PageBlockPostSelectorFields
                        block={block}
                        isReadOnly={isReadOnly}
                        onUpdate={onUpdate}
                        sharedInputClass={sharedInputClass}
                        normalizedItems={normalizedItems}
                        selectedItem={selectedItem}
                        onSelectPost={selectPost}
                        onClearPost={clearPost}
                        eyebrowLabel="Title"
                        eyebrowField="title"
                        headingLabel="Heading"
                        headingField="heading"
                        showSlugField
                        slugPlaceholder="three-panel"
                        postLabel="Intro article"
                        emptyLabel="No articles are available yet."
                        emptySelectionLabel="No intro article selected yet."
                    />
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <div className="mb-3 max-w-xs">
                            <label className="block text-xs text-gray-500 mb-1">Heading background</label>
                            <select
                                value={block.headingBackgroundColor || 'color1'}
                                onChange={(e) => onUpdate({ headingBackgroundColor: e.target.value })}
                                disabled={isReadOnly}
                                className="admin-select w-full"
                            >
                                <option value="color1">Color 1</option>
                                <option value="color2">Color 2</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium text-gray-800">Auto-advance panel body text</p>
                                <p className="text-xs text-gray-500">Automatically cycle body items with a slide animation.</p>
                            </div>
                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={block.autoAdvancePanels === true}
                                    onChange={(e) => onUpdate({ autoAdvancePanels: e.target.checked })}
                                    disabled={isReadOnly}
                                    className="h-4 w-4 cursor-pointer"
                                />
                                Enabled
                            </label>
                        </div>
                        <div className="mt-3 max-w-xs">
                            <label className="block text-xs text-gray-500 mb-1">Auto-advance interval (ms)</label>
                            <input
                                type="number"
                                min="1800"
                                max="20000"
                                step="100"
                                value={block.autoAdvanceIntervalMs ?? 5200}
                                onChange={(e) => onUpdate({ autoAdvanceIntervalMs: e.target.value })}
                                disabled={isReadOnly || block.autoAdvancePanels !== true}
                                className={sharedInputClass}
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {items.map((item, index) => (
                    <div key={`three-panel-item-${index}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-sm font-medium text-gray-800">Panel {index + 1}</p>
                        <div className="mt-3 space-y-3">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Title</label>
                                <input
                                    type="text"
                                    value={item.eyebrow || ''}
                                    onChange={(e) => updateItem(index, 'eyebrow', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Heading</label>
                                <input
                                    type="text"
                                    value={item.heading || ''}
                                    onChange={(e) => updateItem(index, 'heading', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Body 1</label>
                                <input
                                    type="text"
                                    value={item.body || ''}
                                    onChange={(e) => updateItem(index, 'body', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Body 2</label>
                                <input
                                    type="text"
                                    value={item.body2 || ''}
                                    onChange={(e) => updateItem(index, 'body2', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Body 3</label>
                                <input
                                    type="text"
                                    value={item.body3 || ''}
                                    onChange={(e) => updateItem(index, 'body3', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Body 4</label>
                                <input
                                    type="text"
                                    value={item.body4 || ''}
                                    onChange={(e) => updateItem(index, 'body4', e.target.value)}
                                    disabled={isReadOnly}
                                    className={sharedInputClass}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function LatestPostsBlockFields({
    block,
    isReadOnly,
    onUpdate,
    sharedInputClass,
    availablePostItems = [],
    excludePostIds = []
}) {
    const selectedPostIds = Array.isArray(block.postIds) ? block.postIds : []
    const excludedIds = new Set((Array.isArray(excludePostIds) ? excludePostIds : []).map((item) => String(item || '').trim()).filter(Boolean))
    const visibleAvailablePostItems = (Array.isArray(availablePostItems) ? availablePostItems : []).filter((item) => {
        const itemId = String(item?.id || '').trim()
        return itemId && !excludedIds.has(itemId)
    })
    const byId = new Map(visibleAvailablePostItems.map((item) => [String(item?.id || '').trim(), item]))
    const selectedItems = selectedPostIds.map((id) => byId.get(id)).filter(Boolean)

    const addPost = (postId) => {
        const normalizedId = String(postId || '').trim()
        if (!normalizedId || selectedPostIds.includes(normalizedId)) return

        const selectedPost = byId.get(normalizedId)
        onUpdate({
            postIds: [...selectedPostIds, normalizedId],
            postSlugs: selectedPost?.slug
                ? [...(Array.isArray(block.postSlugs) ? block.postSlugs : []).filter((slug) => slug !== selectedPost.slug), selectedPost.slug]
                : block.postSlugs
        })
    }

    const removePost = (postId) => {
        const normalizedId = String(postId || '').trim()
        if (!normalizedId) return

        const selectedPost = byId.get(normalizedId)
        onUpdate({
            postIds: selectedPostIds.filter((id) => id !== normalizedId),
            postSlugs: selectedPost?.slug
                ? (Array.isArray(block.postSlugs) ? block.postSlugs : []).filter((slug) => slug !== selectedPost.slug)
                : block.postSlugs
        })
    }

    const movePost = (postId, direction) => {
        const normalizedId = String(postId || '').trim()
        const currentIndex = selectedPostIds.findIndex((id) => id === normalizedId)
        if (currentIndex < 0) return

        const nextIndex = currentIndex + direction
        if (nextIndex < 0 || nextIndex >= selectedPostIds.length) return

        const nextPostIds = [...selectedPostIds]
        const [movedId] = nextPostIds.splice(currentIndex, 1)
        nextPostIds.splice(nextIndex, 0, movedId)

        onUpdate({
            postIds: nextPostIds,
            postSlugs: nextPostIds
                .map((id) => byId.get(id)?.slug || '')
                .filter(Boolean)
        })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input
                        type="text"
                        value={block.heading || ''}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })}
                        disabled={isReadOnly}
                        className={sharedInputClass}
                    />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Item limit</label>
                    <input
                        type="number"
                        min="1"
                        max="24"
                        value={block.limit || 4}
                        onChange={(e) => onUpdate({ limit: e.target.value })}
                        disabled={isReadOnly}
                        className={sharedInputClass}
                    />
                </div>
            </div>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Layout</label>
                <select
                    value={normalizeLatestPostsLayout(block.layout)}
                    onChange={(e) => onUpdate({ layout: e.target.value })}
                    disabled={isReadOnly}
                    className="admin-select w-full max-w-xs text-base"
                >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                    <option value="compact">Compact cards</option>
                </select>
            </div>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Order mode</label>
                <select
                    value={block.orderMode || 'newest'}
                    onChange={(e) => onUpdate({ orderMode: e.target.value })}
                    disabled={isReadOnly}
                    className="admin-select w-full max-w-xs text-base"
                >
                    <option value="newest">Newest first</option>
                    <option value="manual">Manual</option>
                </select>
            </div>

            {block.orderMode === 'manual' && (
                <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                        <p className="text-xs font-medium text-gray-600">Available posts</p>
                        <div className="mt-2 max-h-72 overflow-y-auto rounded border border-gray-200 bg-white">
                            {visibleAvailablePostItems.length === 0 ? (
                                <p className="px-3 py-4 text-sm text-gray-500">No posts are available yet.</p>
                            ) : (
                                visibleAvailablePostItems.map((item) => {
                                    const itemId = String(item?.id || '').trim()
                                    const isSelected = selectedPostIds.includes(itemId)

                                    return (
                                        <div key={itemId} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                                                <p className="truncate text-xs text-gray-500">
                                                    {item.type || 'post'}
                                                    {item.slug ? ` • /${item.slug}` : ''}
                                                    {item.status ? ` • ${item.status}` : ''}
                                                </p>
                                            </div>
                                            {!isReadOnly && (
                                                <button
                                                    type="button"
                                                    disabled={isSelected}
                                                    onClick={() => addPost(itemId)}
                                                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    {isSelected ? 'Added' : 'Add'}
                                                </button>
                                            )}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>

                    <div>
                        <p className="text-xs font-medium text-gray-600">Selected order</p>
                        <div className="mt-2 space-y-2">
                            {selectedItems.length === 0 ? (
                                <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                                    No posts selected yet.
                                </p>
                            ) : (
                                selectedItems.map((item, index) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                                            <p className="truncate text-xs text-gray-500">
                                                {item.type || 'post'}
                                                {item.slug ? ` • /${item.slug}` : ''}
                                            </p>
                                        </div>
                                        {!isReadOnly && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => movePost(item.id, -1)}
                                                    disabled={index === 0}
                                                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    Up
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => movePost(item.id, 1)}
                                                    disabled={index === selectedItems.length - 1}
                                                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    Down
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removePost(item.id)}
                                                    className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function CardsCardItemFields({
    item,
    index,
    isReadOnly,
    onUpdateCard,
    onRemoveCard,
    normalizedPostItems,
    onRequestCreatePost,
    onRequestEditPost,
    sharedInputClass,
    sharedTextareaClass
}) {
    const selectedItem = resolvePageBlockPostItem({
        items: normalizedPostItems,
        postId: item.postId,
        postSlug: item.postSlug
    })

    const createNewOptionValue = '__add_new_post__'
    const canCreatePost = typeof onRequestCreatePost === 'function'

    const selectPost = (postId) => {
        const normalizedId = String(postId || '').trim()
        if (!normalizedId) return
        const next = normalizedPostItems.find((p) => p.id === normalizedId)
        onUpdateCard({
            postId: normalizedId,
            postSlug: next?.slug || '',
            title: next?.title || '',
            body: next?.summary || '',
            href: next?.href || ''
        })
    }

    const clearPost = () => {
        onUpdateCard({ postId: '', postSlug: '', title: '', body: '', href: '' })
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-sm font-medium text-gray-800">Card {index + 1}</p>
                {!isReadOnly && (
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={onRemoveCard} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {/* Post selector */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Assign post (optional)</label>
                    {normalizedPostItems.length === 0 && !canCreatePost ? (
                        <p className="rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">No posts available yet.</p>
                    ) : (
                        <select
                            value={item.postId || ''}
                            onChange={(e) => {
                                if (e.target.value === createNewOptionValue) {
                                    if (typeof onRequestCreatePost === 'function') onRequestCreatePost()
                                    e.target.value = item.postId || ''
                                    return
                                }
                                if (!e.target.value) { clearPost(); return }
                                selectPost(e.target.value)
                            }}
                            disabled={isReadOnly}
                            className="admin-select w-full text-base"
                        >
                            <option value="">No post selected</option>
                            {canCreatePost && <option value={createNewOptionValue}>Add New...</option>}
                            {normalizedPostItems.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.title} {p.type ? `(${p.type})` : ''}
                                </option>
                            ))}
                        </select>
                    )}
                    {selectedItem && (
                        <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{selectedItem.title}</p>
                                <p className="text-xs text-gray-500">
                                    {selectedItem.type || 'post'}
                                    {selectedItem.slug ? ` • /${selectedItem.slug}` : ''}
                                    {selectedItem.status ? ` • ${selectedItem.status}` : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                {typeof onRequestEditPost === 'function' && (
                                    <button
                                        type="button"
                                        onClick={onRequestEditPost}
                                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                    >
                                        Edit
                                    </button>
                                )}
                                {!isReadOnly && (
                                    <button
                                        type="button"
                                        onClick={clearPost}
                                        className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <label className="block text-xs text-gray-500 mb-1">Eyebrow (optional)</label>
                    <input type="text" value={item.eyebrow || ''} onChange={(e) => onUpdateCard({ eyebrow: e.target.value })} disabled={isReadOnly} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Title</label>
                    <input type="text" value={item.title || ''} onChange={(e) => onUpdateCard({ title: e.target.value })} disabled={isReadOnly} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Body</label>
                    <textarea value={item.body || ''} onChange={(e) => onUpdateCard({ body: e.target.value })} rows="3" disabled={isReadOnly} className={sharedTextareaClass} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Link URL (optional)</label>
                        <input type="text" value={item.href || ''} onChange={(e) => onUpdateCard({ href: e.target.value })} disabled={isReadOnly} placeholder="https://... or /page-slug" className={sharedInputClass} />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Link label (optional)</label>
                        <input type="text" value={item.linkText || ''} onChange={(e) => onUpdateCard({ linkText: e.target.value })} disabled={isReadOnly} placeholder="Learn more" className={sharedInputClass} />
                    </div>
                </div>
            </div>
        </div>
    )
}

function CardsBlockFields({ block, isReadOnly, onUpdate, sharedTextareaClass, sharedInputClass, availablePostItems = [], excludePostIds = [], onCreatePostForBlock, onEditPostForBlock }) {
    const items = Array.isArray(block.items) ? block.items : []

    const excludedIds = new Set((Array.isArray(excludePostIds) ? excludePostIds : []).map((item) => String(item || '').trim()).filter(Boolean))
    const normalizedPostItems = (Array.isArray(availablePostItems) ? availablePostItems : [])
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id && !excludedIds.has(item.id))

    const addCard = () => {
        onUpdate({ items: [...items, { eyebrow: '', title: '', body: '', href: '', linkText: '', postId: '', postSlug: '' }] })
    }

    const removeCard = (index) => {
        onUpdate({ items: items.filter((_, i) => i !== index) })
    }

    const updateCard = (index, updates) => {
        const normalizedUpdates = updates && typeof updates === 'object' ? updates : {}
        onUpdate({ items: items.map((item, i) => i === index ? { ...item, ...normalizedUpdates } : item) })
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">
                A flexible grid of content cards, each with an optional eyebrow, title, body, and link. Assign a post to auto-populate card fields.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Section heading (optional)</label>
                    <input
                        type="text"
                        value={block.heading || ''}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })}
                        disabled={isReadOnly}
                        placeholder="e.g. Why Choose Us"
                        className={sharedInputClass}
                    />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input
                        type="text"
                        value={block.slug || ''}
                        onChange={(e) => onUpdate({ slug: e.target.value })}
                        disabled={isReadOnly}
                        placeholder="cards"
                        className={sharedInputClass}
                    />
                </div>
            </div>

            <div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Columns</label>
                    <select
                        value={block.columns || 2}
                        onChange={(e) => onUpdate({ columns: Number(e.target.value) })}
                        disabled={isReadOnly}
                        className="admin-select w-full text-base"
                    >
                        <option value={1}>1 column</option>
                        <option value={2}>2 columns</option>
                        <option value={3}>3 columns</option>
                        <option value={4}>4 columns</option>
                    </select>
                </div>
            </div>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Background Style</label>
                <select
                    value={block.showBackground !== false ? 'solid' : 'transparent'}
                    onChange={(e) => onUpdate({ showBackground: e.target.value === 'solid' })}
                    disabled={isReadOnly}
                    className="admin-select w-full text-base"
                >
                    <option value="solid">Solid Background</option>
                    <option value="transparent">Transparent</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">Applies to this Cards Grid block only.</p>
            </div>

            <div className="space-y-3">
                {items.length === 0 && (
                    <p className="rounded border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
                        No cards yet. Click &ldquo;Add Card&rdquo; below.
                    </p>
                )}
                {items.map((item, index) => (
                    <CardsCardItemFields
                        key={`card-item-${index}`}
                        item={item}
                        index={index}
                        isReadOnly={isReadOnly}
                        onUpdateCard={(updates) => updateCard(index, updates)}
                        onRemoveCard={() => removeCard(index)}
                        normalizedPostItems={normalizedPostItems}
                        onRequestCreatePost={typeof onCreatePostForBlock === 'function'
                            ? () => onCreatePostForBlock(`${block.id}::card::${index}`)
                            : undefined}
                        onRequestEditPost={typeof onEditPostForBlock === 'function' && item.postId
                            ? () => onEditPostForBlock({ blockId: `${block.id}::card::${index}`, postId: item.postId, postSlug: item.postSlug || '' })
                            : undefined}
                        sharedInputClass={sharedInputClass}
                        sharedTextareaClass={sharedTextareaClass}
                    />
                ))}
            </div>

            {!isReadOnly && (
                <button
                    type="button"
                    onClick={addCard}
                    className="px-3 py-1.5 text-sm admin-btn"
                >
                    + Add Card
                </button>
            )}
        </div>
    )
}

// ── Shared colour picker sub-section ─────────────────────────────────────────

function BlockStylesEditor({ styles = {}, fields, isReadOnly, onStyleChange }) {
    return (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Block Styles (optional overrides)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {fields.map(({ key, label }) => (
                    <div key={key}>
                        <label className="block text-xs text-gray-500 mb-1">{label}</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={styles[key] || '#888888'}
                                disabled={isReadOnly}
                                onChange={(e) => onStyleChange(key, e.target.value)}
                                className="h-8 w-10 cursor-pointer rounded border border-gray-300 p-0.5"
                            />
                            <input
                                type="text"
                                value={styles[key] || ''}
                                disabled={isReadOnly}
                                onChange={(e) => onStyleChange(key, e.target.value)}
                                placeholder="inherit"
                                className="admin-input flex-1 font-mono text-xs"
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function HeroBlockFields({ block, isReadOnly, onUpdate, sharedInputClass }) {
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Headline</label>
                    <input type="text" value={block.headline || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value, field: 'headline' })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="hero" />
                </div>
            </div>
            <div>
                <label className="block text-xs text-gray-500 mb-1">Subheadline</label>
                <input type="text" value={block.subheadline || ''} disabled={isReadOnly}
                    onChange={(e) => onUpdate({ subheadline: e.target.value })} className={sharedInputClass} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">CTA Button Text</label>
                    <input type="text" value={block.ctaText || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ ctaText: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">CTA Button URL</label>
                    <input type="text" value={block.ctaHref || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ ctaHref: e.target.value })} className={sharedInputClass} />
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Background Type</label>
                    <select value={block.backgroundType || 'color'} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ backgroundType: e.target.value })}
                        className="admin-select w-full text-base">
                        <option value="color">Solid Colour</option>
                        <option value="gradient">CSS Gradient</option>
                        <option value="image">Image URL</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">
                        {block.backgroundType === 'image' ? 'Image URL' : 'Background Value'}
                    </label>
                    <input type="text" value={block.backgroundType === 'image' ? (block.imageUrl || '') : (block.backgroundValue || '')}
                        disabled={isReadOnly}
                        onChange={(e) => {
                            if (block.backgroundType === 'image') onUpdate({ imageUrl: e.target.value })
                            else onUpdate({ backgroundValue: e.target.value })
                        }}
                        placeholder={block.backgroundType === 'gradient' ? 'linear-gradient(...)' : block.backgroundType === 'image' ? 'https://...' : '#1e3a8a'}
                        className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Text Alignment</label>
                    <select value={block.textAlign || 'center'} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ textAlign: e.target.value })}
                        className="admin-select w-full text-base">
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                </div>
            </div>
            <BlockStylesEditor
                styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'headlineColor', label: 'Headline Colour' },
                    { key: 'subheadlineColor', label: 'Subheadline Colour' },
                    { key: 'ctaBgColor', label: 'CTA Background' },
                    { key: 'ctaTextColor', label: 'CTA Text' },
                    { key: 'overlayColor', label: 'Overlay Colour' }
                ]}
            />
        </div>
    )
}

// ── Testimonials ──────────────────────────────────────────────────────────────

function TestimonialsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { quote: '', author: '', role: '', company: '', avatarUrl: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })
    const moveItem = (i, dir) => {
        const next = i + dir
        if (next < 0 || next >= items.length) return
        const arr = [...items];[arr[i], arr[next]] = [arr[next], arr[i]]
        onUpdate({ items: arr })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="testimonials" />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Display Variant</label>
                    <select value={block.variant || 'marquee'} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ variant: e.target.value })}
                        className="admin-select w-full text-base">
                        <option value="marquee">Scrolling Marquee</option>
                        <option value="carousel">Carousel</option>
                        <option value="grid">Grid</option>
                    </select>
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Testimonials ({items.length})</p>
            <div className="space-y-3">
                {items.map((item, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">#{i + 1}</span>
                            {!isReadOnly && (
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs admin-btn-danger">Remove</button>
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Quote</label>
                            <textarea value={item.quote || ''} rows={3} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'quote', e.target.value)} className={sharedTextareaClass} />
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {['author', 'role', 'company'].map((field) => (
                                <div key={field}>
                                    <label className="block text-xs text-gray-500 mb-1 capitalize">{field}</label>
                                    <input type="text" value={item[field] || ''} disabled={isReadOnly}
                                        onChange={(e) => updateItem(i, field, e.target.value)} className={sharedInputClass} />
                                </div>
                            ))}
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Avatar URL</label>
                                <input type="text" value={item.avatarUrl || ''} disabled={isReadOnly}
                                    onChange={(e) => updateItem(i, 'avatarUrl', e.target.value)} className={sharedInputClass} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Testimonial</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'cardBg', label: 'Card Background' },
                    { key: 'cardBorder', label: 'Card Border' },
                    { key: 'textColor', label: 'Quote Text' },
                    { key: 'accentColor', label: 'Accent / Avatar' },
                    { key: 'nameColor', label: 'Author Name' }
                ]}
            />
        </div>
    )
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { value: '', label: '', prefix: '', suffix: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading (optional)</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="stats" />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Layout</label>
                    <select value={block.variant || 'row'} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ variant: e.target.value })}
                        className="admin-select w-full text-base">
                        <option value="row">Row (horizontal)</option>
                        <option value="centered">Centered (stacked)</option>
                    </select>
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Stats ({items.length})</p>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-4 gap-2 rounded-xl border border-gray-200 bg-white p-3 items-end">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Prefix</label>
                            <input type="text" value={item.prefix || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'prefix', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Value *</label>
                            <input type="text" value={item.value || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'value', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Suffix</label>
                            <input type="text" value={item.suffix || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'suffix', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Label</label>
                            <input type="text" value={item.label || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'label', e.target.value)} className={sharedInputClass} />
                        </div>
                        {!isReadOnly && (
                            <button type="button" onClick={() => removeItem(i)} className="col-span-4 px-2 py-1 text-xs admin-btn-danger">Remove</button>
                        )}
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Stat</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'valueColor', label: 'Value Colour' },
                    { key: 'labelColor', label: 'Label Colour' }
                ]}
            />
        </div>
    )
}

// ── Logo Marquee ──────────────────────────────────────────────────────────────

function LogoMarqueeBlockFields({ block, isReadOnly, onUpdate, sharedInputClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { name: '', filePath: '', imageUrl: '', href: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })

    const [smartFolder, setSmartFolder] = useState('')
    const [smartLoading, setSmartLoading] = useState(false)
    const [smartError, setSmartError] = useState('')
    const [smartPreview, setSmartPreview] = useState(null)

    const handleSmartImport = async () => {
        if (!smartFolder.trim()) return
        setSmartLoading(true)
        setSmartError('')
        setSmartPreview(null)
        try {
            const res = await fetch('/api/openai/logo-marquee-smart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: smartFolder.trim() })
            })
            const data = await res.json()
            if (!res.ok) {
                setSmartError(data?.error || 'Smart import failed')
                return
            }
            if (Array.isArray(data.items) && data.items.length > 0) {
                setSmartPreview(data.items)
            } else {
                setSmartError('No image files found in that folder')
            }
        } catch (err) {
            setSmartError(err?.message || 'Unexpected error')
        } finally {
            setSmartLoading(false)
        }
    }

    const handleSmartApply = () => {
        if (smartPreview) {
            onUpdate({ items: smartPreview })
            setSmartPreview(null)
            setSmartFolder('')
        }
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading (e.g. &ldquo;As Seen In&rdquo;)</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="logos" />
                </div>
            </div>

            {!isReadOnly && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">&#10024; Smart Import</p>
                    <p className="text-xs text-indigo-500">Enter a folder under <code className="bg-indigo-100 px-1 rounded">public/</code> — company names and URLs will be inferred automatically.</p>
                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                            <label className="block text-xs text-gray-500 mb-1">Folder (e.g. employers/acme)</label>
                            <input
                                type="text"
                                value={smartFolder}
                                onChange={(e) => setSmartFolder(e.target.value)}
                                placeholder="employers/acme"
                                className={sharedInputClass}
                            />
                        </div>
                        <button
                            type="button"
                            disabled={smartLoading || !smartFolder.trim()}
                            onClick={handleSmartImport}
                            className="px-3 py-1.5 text-sm admin-btn shrink-0 disabled:opacity-50"
                        >
                            {smartLoading ? 'Importing…' : 'Import'}
                        </button>
                    </div>
                    {smartError && <p className="text-xs text-red-600">{smartError}</p>}
                    {smartPreview && (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-indigo-700">Detected {smartPreview.length} logo{smartPreview.length !== 1 ? 's' : ''} — review then apply:</p>
                            <div className="rounded-lg border border-indigo-200 bg-white divide-y divide-indigo-100 text-xs">
                                {smartPreview.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-1.5 gap-2">
                                        <span className="font-medium text-gray-800 truncate">{item.name}</span>
                                        {item.href
                                            ? <span className="text-indigo-500 truncate">{item.href.replace(/^https?:\/\/(www\.)?/, '')}</span>
                                            : <span className="text-gray-400 italic">no URL found</span>
                                        }
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={handleSmartApply} className="px-3 py-1.5 text-sm admin-btn">Apply to block</button>
                                <button type="button" onClick={() => setSmartPreview(null)} className="px-3 py-1.5 text-sm admin-btn-secondary">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Logos ({items.length})</p>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-3 items-end">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Name *</label>
                            <input type="text" value={item.name || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'name', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">File Path (e.g. /logos/acme.svg)</label>
                            <input type="text" value={item.filePath || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'filePath', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Image URL (external)</label>
                            <input type="text" value={item.imageUrl || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'imageUrl', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Link URL</label>
                            <input type="text" value={item.href || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'href', e.target.value)} className={sharedInputClass} />
                        </div>
                        {!isReadOnly && (
                            <button type="button" onClick={() => removeItem(i)} className="col-span-2 px-2 py-1 text-xs admin-btn-danger">Remove</button>
                        )}
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Logo</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'headingColor', label: 'Heading Colour' }
                ]}
            />
        </div>
    )
}

// ── Feature Comparison ────────────────────────────────────────────────────────

function FeatureComparisonBlockFields({ block, isReadOnly, onUpdate, sharedInputClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { label: '', included: true }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Eyebrow</label>
                    <input type="text" value={block.eyebrow || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ eyebrow: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="comparison" />
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Items ({items.length})</p>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
                        <input type="checkbox" checked={item.included !== false} disabled={isReadOnly}
                            onChange={(e) => updateItem(i, 'included', e.target.checked)}
                            className="h-4 w-4 cursor-pointer" />
                        <input type="text" value={item.label || ''} disabled={isReadOnly}
                            onChange={(e) => updateItem(i, 'label', e.target.value)}
                            placeholder="Feature label"
                            className={`${sharedInputClass} flex-1`} />
                        {!isReadOnly && (
                            <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs admin-btn-danger shrink-0">Remove</button>
                        )}
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Item</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'eyebrowColor', label: 'Eyebrow Colour' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'checkColor', label: 'Check Icon' },
                    { key: 'crossColor', label: 'Cross Icon' },
                    { key: 'labelColor', label: 'Label Text' }
                ]}
            />
        </div>
    )
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function StepsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { title: '', body: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })
    const moveItem = (i, dir) => {
        const next = i + dir
        if (next < 0 || next >= items.length) return
        const arr = [...items];[arr[i], arr[next]] = [arr[next], arr[i]]
        onUpdate({ items: arr })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Eyebrow</label>
                    <input type="text" value={block.eyebrow || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ eyebrow: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="steps" />
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Steps ({items.length})</p>
            <div className="space-y-3">
                {items.map((item, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500">Step {i + 1}</span>
                            {!isReadOnly && (
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs admin-btn-danger">Remove</button>
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Title</label>
                            <input type="text" value={item.title || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'title', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Body</label>
                            <textarea value={item.body || ''} rows={2} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'body', e.target.value)} className={sharedTextareaClass} />
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Step</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'eyebrowColor', label: 'Eyebrow Colour' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'stepNumberBg', label: 'Step Number BG' },
                    { key: 'stepNumberColor', label: 'Step Number Text' },
                    { key: 'titleColor', label: 'Step Title' },
                    { key: 'bodyColor', label: 'Step Body' },
                    { key: 'connectorColor', label: 'Connector Line' }
                ]}
            />
        </div>
    )
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function PricingBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addPlan = () => onUpdate({ items: [...items, { name: 'New Plan', price: '', period: 'per month', description: '', features: [], ctaText: 'Get Started', ctaHref: '', highlighted: false }] })
    const removePlan = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updatePlan = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })
    const updateFeatures = (i, raw) => {
        const features = raw.split('\n').map((f) => f.trim()).filter(Boolean)
        updatePlan(i, 'features', features)
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="pricing" />
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Plans ({items.length})</p>
            <div className="space-y-4">
                {items.map((plan, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-600">{plan.name || `Plan ${i + 1}`}</span>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                    <input type="checkbox" checked={plan.highlighted === true} disabled={isReadOnly}
                                        onChange={(e) => updatePlan(i, 'highlighted', e.target.checked)} className="h-3.5 w-3.5" />
                                    Highlighted
                                </label>
                                {!isReadOnly && (
                                    <button type="button" onClick={() => removePlan(i)} className="px-2 py-1 text-xs admin-btn-danger">Remove</button>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Plan Name *</label>
                                <input type="text" value={plan.name || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'name', e.target.value)} className={sharedInputClass} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Price</label>
                                <input type="text" value={plan.price || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'price', e.target.value)} className={sharedInputClass} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Period</label>
                                <input type="text" value={plan.period || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'period', e.target.value)} className={sharedInputClass} placeholder="per month" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">CTA Text</label>
                                <input type="text" value={plan.ctaText || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'ctaText', e.target.value)} className={sharedInputClass} />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Description</label>
                                <input type="text" value={plan.description || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'description', e.target.value)} className={sharedInputClass} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">CTA URL</label>
                                <input type="text" value={plan.ctaHref || ''} disabled={isReadOnly}
                                    onChange={(e) => updatePlan(i, 'ctaHref', e.target.value)} className={sharedInputClass} />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Features (one per line)</label>
                            <textarea
                                value={Array.isArray(plan.features) ? plan.features.join('\n') : ''}
                                rows={4} disabled={isReadOnly}
                                onChange={(e) => updateFeatures(i, e.target.value)}
                                className={sharedTextareaClass}
                                placeholder="Unlimited tasks&#10;Priority support&#10;Weekly check-ins"
                            />
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addPlan} className="px-3 py-1.5 text-sm admin-btn">+ Add Plan</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'cardBg', label: 'Card Background' },
                    { key: 'highlightedBg', label: 'Highlighted BG' },
                    { key: 'ctaBg', label: 'CTA Background' },
                    { key: 'ctaTextColor', label: 'CTA Text' }
                ]}
            />
        </div>
    )
}

// ── Bio / Profile ─────────────────────────────────────────────────────────────

function BioProfileBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Eyebrow</label>
                    <input type="text" value={block.eyebrow || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ eyebrow: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading / Name</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="bio" />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Photo URL</label>
                    <input type="text" value={block.imageUrl || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ imageUrl: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Photo Alt Text</label>
                    <input type="text" value={block.imageAlt || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ imageAlt: e.target.value })} className={sharedInputClass} />
                </div>
            </div>
            <div>
                <label className="block text-xs text-gray-500 mb-1">Bio Text</label>
                <textarea value={block.body || ''} rows={5} disabled={isReadOnly}
                    onChange={(e) => onUpdate({ body: e.target.value })} className={sharedTextareaClass} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">CTA Button Text</label>
                    <input type="text" value={block.ctaText || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ ctaText: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">CTA Button URL</label>
                    <input type="text" value={block.ctaHref || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ ctaHref: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Image Position</label>
                    <select value={block.imagePosition || 'left'} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ imagePosition: e.target.value })}
                        className="admin-select w-full text-base">
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                    </select>
                </div>
            </div>
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'eyebrowColor', label: 'Eyebrow Colour' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'bodyColor', label: 'Body Text' },
                    { key: 'ctaBg', label: 'CTA Background' },
                    { key: 'ctaTextColor', label: 'CTA Text' }
                ]}
            />
        </div>
    )
}

// ── Icon Cards ────────────────────────────────────────────────────────────────

function IconCardsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { icon: '✦', title: '', body: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })
    const moveItem = (i, dir) => {
        const next = i + dir
        if (next < 0 || next >= items.length) return
        const arr = [...items];[arr[i], arr[next]] = [arr[next], arr[i]]
        onUpdate({ items: arr })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Eyebrow</label>
                    <input type="text" value={block.eyebrow || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ eyebrow: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="services" />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Columns</label>
                    <select value={block.columns || 3} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ columns: Number(e.target.value) })}
                        className="admin-select w-full text-base">
                        <option value={2}>2 columns</option>
                        <option value={3}>3 columns</option>
                        <option value={4}>4 columns</option>
                    </select>
                </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Cards ({items.length})</p>
            <div className="space-y-3">
                {items.map((item, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Card {i + 1}</span>
                            {!isReadOnly && (
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs admin-btn-danger">Remove</button>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Icon (emoji or URL)</label>
                                <input type="text" value={item.icon || ''} disabled={isReadOnly}
                                    onChange={(e) => updateItem(i, 'icon', e.target.value)} className={sharedInputClass} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Title</label>
                                <input type="text" value={item.title || ''} disabled={isReadOnly}
                                    onChange={(e) => updateItem(i, 'title', e.target.value)} className={sharedInputClass} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Body</label>
                                <input type="text" value={item.body || ''} disabled={isReadOnly}
                                    onChange={(e) => updateItem(i, 'body', e.target.value)} className={sharedInputClass} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Card</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'eyebrowColor', label: 'Eyebrow Colour' },
                    { key: 'headingColor', label: 'Heading Colour' },
                    { key: 'cardBg', label: 'Card Background' },
                    { key: 'cardBorder', label: 'Card Border' },
                    { key: 'iconBg', label: 'Icon Background' },
                    { key: 'titleColor', label: 'Card Title' },
                    { key: 'bodyColor', label: 'Card Body' }
                ]}
            />
        </div>
    )
}

// ── Proof Points ──────────────────────────────────────────────────────────────

function ProofPointsBlockFields({ block, isReadOnly, onUpdate, sharedInputClass, sharedTextareaClass }) {
    const items = Array.isArray(block.items) ? block.items : []
    const styles = block.styles || {}
    const onStyleChange = (key, value) => onUpdate({ styles: { ...styles, [key]: value } })

    const addItem = () => onUpdate({ items: [...items, { heading: '', body: '' }] })
    const removeItem = (i) => onUpdate({ items: items.filter((_, idx) => idx !== i) })
    const updateItem = (i, field, value) => onUpdate({ items: items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) })
    const moveItem = (i, dir) => {
        const next = i + dir
        if (next < 0 || next >= items.length) return
        const arr = [...items];[arr[i], arr[next]] = [arr[next], arr[i]]
        onUpdate({ items: arr })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Heading</label>
                    <input type="text" value={block.heading || ''} disabled={isReadOnly}
                        onChange={(e) => updateHeadingWithAutoSlug({ block, onUpdate, nextHeading: e.target.value })} className={sharedInputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Slug (optional)</label>
                    <input type="text" value={block.slug || ''} disabled={isReadOnly}
                        onChange={(e) => onUpdate({ slug: e.target.value })} className={sharedInputClass}
                        placeholder="proof-points" />
                </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={!!block.reverse} disabled={isReadOnly}
                    onChange={(e) => onUpdate({ reverse: e.target.checked })} className="rounded" />
                Reverse scroll direction
            </label>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Proof Points ({items.length})</p>
            <div className="space-y-3">
                {items.map((item, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">#{i + 1}</span>
                            {!isReadOnly && (
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs admin-btn-danger">Remove</button>
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Heading</label>
                            <input type="text" value={item.heading || ''} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'heading', e.target.value)} className={sharedInputClass} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Body</label>
                            <textarea value={item.body || ''} rows={3} disabled={isReadOnly}
                                onChange={(e) => updateItem(i, 'body', e.target.value)} className={sharedTextareaClass} />
                        </div>
                    </div>
                ))}
            </div>
            {!isReadOnly && (
                <button type="button" onClick={addItem} className="px-3 py-1.5 text-sm admin-btn">+ Add Proof Point</button>
            )}
            <BlockStylesEditor styles={styles} isReadOnly={isReadOnly} onStyleChange={onStyleChange}
                fields={[
                    { key: 'sectionBg', label: 'Section Background' },
                    { key: 'headingColor', label: 'Section Heading Colour' },
                    { key: 'cardBg', label: 'Card Background' },
                    { key: 'cardBorder', label: 'Card Border' },
                    { key: 'itemHeadingColor', label: 'Item Heading Colour' },
                    { key: 'bodyColor', label: 'Body Text Colour' },
                    { key: 'accentColor', label: 'Accent Bar Colour' }
                ]}
            />
        </div>
    )
}