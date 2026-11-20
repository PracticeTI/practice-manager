'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import ContentModal from '@/admin-ui/components/ContentModal'
import { getAdminAuthHeaders, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { toPageBlockPostOption } from '@/lib/pageBlockPosts'
import { normalizePageBlocks } from '@/lib/pageBlocks'
import { getAdminDomainMode } from '@/lib/adminActiveDomain'
import { DEFAULT_DISPLAY_POLICY, normalizeDisplayPolicy, shouldShowPracticeContent } from '@/lib/displayPolicy'
import { DEFAULT_CONTENT_DOMAIN, DEFAULT_DOMAIN_MODE, VALID_DOMAIN_MODES, getDomainLabel } from '@/lib/domainMode'
import { getPrivateContentTypeOwner, getPrivateDomainModesWithFlag, hasPrivateDomainTrait } from '@/lib/domainExtension'

const DEFAULT_CONTENT_TYPE_FILTERS = [
    { id: 'all', label: 'All Content', icon: '📋', showRecords: true, showFilter: true },
    { id: 'production', label: 'Productions', icon: '🎬', showRecords: true, showFilter: true },
    { id: 'image', label: 'Images', icon: '🖼️', showRecords: true, showFilter: true },
    { id: 'page', label: 'Pages', icon: '📄', showRecords: true, showFilter: true },
    { id: 'smart_page', label: 'Smart Pages', icon: '🤖', showRecords: true, showFilter: true },
    { id: 'post', label: 'Posts', icon: '📝', showRecords: true, showFilter: true }
]

const getDefaultContentTypeFilters = () => DEFAULT_CONTENT_TYPE_FILTERS.map((filter) => ({ ...filter }))

const CONTENT_TYPE_FILTER_STORAGE_KEY = 'admin.content.typeFilters.v2'

const POST_MODAL_DOMAIN_OPTIONS = VALID_DOMAIN_MODES.map((mode) => ({
    id: mode,
    label: getDomainLabel(mode)
}))

const DEFAULT_POST_MODAL_FIELD_VISIBILITY = POST_MODAL_DOMAIN_OPTIONS.reduce((acc, domain) => {
    acc[domain.id] = { description: true, body: true }
    return acc
}, {})

const getDefaultPostModalFieldVisibility = () => JSON.parse(JSON.stringify(DEFAULT_POST_MODAL_FIELD_VISIBILITY))

function normalizePostModalDomain(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized || normalized === 'core') return DEFAULT_CONTENT_DOMAIN
    return POST_MODAL_DOMAIN_OPTIONS.some((domain) => domain.id === normalized) ? normalized : DEFAULT_CONTENT_DOMAIN
}

function normalizePostModalFieldVisibility(rawValue) {
    const normalized = getDefaultPostModalFieldVisibility()
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {}

    for (const domain of POST_MODAL_DOMAIN_OPTIONS) {
        const domainValue = source[domain.id]
        if (!domainValue || typeof domainValue !== 'object') continue

        normalized[domain.id] = {
            description: domainValue.description !== false,
            body: domainValue.body !== false
        }
    }

    return normalized
}

const CONTENT_TYPE_CONFIGS = {
    page: {
        id: 'page',
        label: 'Page',
        icon: '📄',
        domain: 'core',
        attributes: ['domain']
    },
    smart_page: {
        id: 'smart_page',
        label: 'Smart Page',
        icon: '🤖',
        domain: getPrivateContentTypeOwner('smart_page') || 'core',
        attributes: ['domain', 'editor_mode', 'wit_source_payload', 'ai_state'],
        aiEnrichable: true
    },
    post: {
        id: 'post',
        label: 'Post',
        icon: '📝',
        domain: 'core',
        attributes: ['domain', 'category', 'borough', 'neighborhood', 'featured_productions']
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
        icon: '📎',
        domain: 'core',
        attributes: ['file_type', 'file_size', 'pages']
    }
}

const STATUS_FILTERS = [
    { id: 'all', label: 'All', color: 'gray' },
    { id: 'draft', label: 'Draft', color: 'yellow' },
    { id: 'published', label: 'Published', color: 'green' },
    { id: 'archived', label: 'Archived', color: 'gray' }
]

const POST_CATEGORY_FILTERS = [
    { id: 'all', label: 'All Post Categories' },
    { id: 'history', label: 'History' },
    { id: 'location', label: 'Location' },
    { id: 'news', label: 'News' },
    { id: 'uncategorized', label: 'Uncategorized' }
]

const POST_DOMAIN_FILTERS = [
    { id: 'all', label: 'All Domains' },
    ...getPrivateDomainModesWithFlag('postDomainFilter').map((mode) => ({ id: mode, label: getDomainLabel(mode) })),
    { id: DEFAULT_CONTENT_DOMAIN, label: getDomainLabel(DEFAULT_CONTENT_DOMAIN) }
]

const CONTENT_FETCH_TYPES = Array.from(new Set([...Object.keys(CONTENT_TYPE_CONFIGS), 'key_art']))

function cloneSerializable(value) {
    if (value === null || value === undefined) return value

    try {
        return JSON.parse(JSON.stringify(value))
    } catch {
        return value
    }
}

function assignPostToSinglePostBlock(editingData, { blockId, postOption }) {
    const normalizedBlockId = String(blockId || '').trim()
    if (!normalizedBlockId || !editingData) return editingData

    const normalizedPostOption = toPageBlockPostOption(postOption)
    if (!normalizedPostOption?.id) return editingData

    const metadata = typeof editingData.metadata === 'object' && editingData.metadata !== null
        ? editingData.metadata
        : {}
    const blocks = normalizePageBlocks(metadata.blocks)

    // Handle card item encoding: "${realBlockId}::card::${index}"
    const cardItemMatch = normalizedBlockId.match(/^(.+)::card::(\d+)$/)
    if (cardItemMatch) {
        const realBlockId = cardItemMatch[1]
        const cardIndex = parseInt(cardItemMatch[2], 10)
        const hasBlock = blocks.some((block) => String(block?.id || '').trim() === realBlockId)
        if (!hasBlock) return editingData

        const nextBlocks = blocks.map((block) => {
            if (String(block?.id || '').trim() !== realBlockId) return block
            const currentItems = Array.isArray(block.items) ? block.items : []
            if (cardIndex < 0 || cardIndex >= currentItems.length) return block
            const nextItems = currentItems.map((item, i) => {
                if (i !== cardIndex) return item
                return {
                    ...item,
                    title: item.title || normalizedPostOption.title || '',
                    body: item.body || normalizedPostOption.summary || '',
                    href: item.href || normalizedPostOption.href || '',
                    postId: normalizedPostOption.id,
                    postSlug: normalizedPostOption.slug || item.postSlug || ''
                }
            })
            return { ...block, items: nextItems }
        })

        return { ...editingData, metadata: { ...metadata, blocks: nextBlocks } }
    }

    const hasBlock = blocks.some((block) => String(block?.id || '').trim() === normalizedBlockId)
    if (!hasBlock) return editingData

    const nextBlocks = blocks.map((block) => {
        if (String(block?.id || '').trim() !== normalizedBlockId) return block
        return {
            ...block,
            postId: normalizedPostOption.id,
            postSlug: normalizedPostOption.slug || block?.postSlug || ''
        }
    })

    return {
        ...editingData,
        metadata: {
            ...metadata,
            blocks: nextBlocks
        }
    }
}

function isTypeAllowedForDomainMode(typeId, domainMode) {
    if (typeId === 'all') return true
    const typeConfig = CONTENT_TYPE_CONFIGS[typeId]
    if (!typeConfig) return false
    if (typeConfig.domain === 'core') return true
    return typeConfig.domain === domainMode
}

function parseMaybeJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return {}
        }
    }
    return {}
}

function isHiddenFromContentManagementList(item) {
    if (!item) return false

    const status = String(item?.status || '').trim().toLowerCase()
    if (status === 'pending delete') return true

    return (
        String(item?.type || '').toLowerCase() === 'page' &&
        String(item?.subtype || '').toLowerCase() === 'home'
    )
}

function isSystemContentRecord(item) {
    if (!item) return false

    const metadata = parseMaybeJsonObject(item.metadata)

    return (
        metadata?.system_record === true ||
        metadata?.is_system === true ||
        metadata?.read_only === true
    )
}

function toDisplayCategory(type) {
    const normalized = String(type || '').toLowerCase()
    if (normalized === 'general' || normalized === 'key_art') return 'Key Art'
    if (normalized === 'actor') return 'Actor'
    if (normalized === 'company') return 'Company'
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Key Art'
}

function normalizeModelToGptLabel(model) {
    const normalized = String(model || '').trim()
    if (!normalized) return null
    if (!/^gpt/i.test(normalized)) return null
    const suffix = normalized.replace(/^gpt[-\s]*/i, '')
    return suffix ? `GPT ${suffix}` : 'GPT'
}

function getContentProvenanceBadges(item, fallbackModel = null) {
    const metadata = item?.metadata || {}
    const attributes = item?.attributes || {}
    const createdVia = String(metadata?.created_via || '').toLowerCase()
    const generationMethod = String(metadata?.generation_method || metadata?.generationMethod || '').toLowerCase()
    const source = String(metadata?.source || '').toLowerCase()
    const authorName = String(metadata?.author || metadata?.created_by || attributes?.author || '').trim()
    const permitLookupFailed = metadata?.fallback_flow_used === true || metadata?.permit_lookup_success === false

    const isSystemGenerated =
        metadata?.ai_generated === true ||
        createdVia.includes('web-search') ||
        createdVia.startsWith('auto-') ||
        generationMethod.includes('agent') ||
        generationMethod.includes('web-search') ||
        source === 'root-search'

    const actorLabel = authorName || (isSystemGenerated ? 'Agent' : 'User')
    const actorBadgeClass = authorName || !isSystemGenerated
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-indigo-50 text-indigo-700 border-indigo-200'

    const permitInferred = !permitLookupFailed && (
        metadata?.permit_inferred === true ||
        (Number(metadata?.permit_record_count || 0) > 0 && Boolean(metadata?.permit_reference?.event_id)) ||
        generationMethod.includes('permit')
    )

    const webUsed =
        metadata?.web_search_used === true ||
        createdVia.includes('web-search') ||
        (Array.isArray(metadata?.source_urls) && metadata.source_urls.length > 0)

    const explicitGptLabel =
        normalizeModelToGptLabel(metadata?.ai_model) ||
        normalizeModelToGptLabel(metadata?.ai_summary_model)

    // Only infer model badges from global settings for system-generated records.
    const inferredGptLabel = isSystemGenerated
        ? normalizeModelToGptLabel(fallbackModel)
        : null

    const gptLabel = explicitGptLabel || inferredGptLabel

    const isAgentLabel = actorLabel.toLowerCase() === 'agent'
    const shouldShowActorBadge = !isAgentLabel || !gptLabel

    const badges = []

    if (shouldShowActorBadge) {
        badges.push({
            id: `actor-${actorLabel}`,
            label: actorLabel,
            className: actorBadgeClass
        })
    }

    if (permitInferred) {
        badges.push({
            id: 'permit',
            label: 'Permit',
            className: 'bg-amber-50 text-amber-700 border-amber-200'
        })
    }

    if (webUsed) {
        badges.push({
            id: 'web',
            label: 'Web',
            className: 'bg-sky-50 text-sky-700 border-sky-200'
        })
    }

    if (gptLabel) {
        badges.push({
            id: `gpt-${gptLabel}`,
            label: gptLabel,
            className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
        })
    }

    const itemDomain = String(attributes?.domain || '').trim().toLowerCase()
    if (item?.type === 'post' && itemDomain !== '' && itemDomain !== DEFAULT_CONTENT_DOMAIN) {
        badges.push({
            id: `domain-${itemDomain}`,
            label: getDomainLabel(itemDomain),
            className: hasPrivateDomainTrait(itemDomain, 'skyDomainBadge')
                ? 'bg-sky-50 text-sky-700 border-sky-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
        })
    }

    return badges
}

function detectImageSourceLabel(item) {
    const metadata = item?.metadata || {}
    const source = String(metadata?.source || '').trim().toLowerCase()
    const provider = String(metadata?.provider || '').trim().toLowerCase()
    const sourceProvider = String(metadata?.source_provider || metadata?.sourceProvider || '').trim().toLowerCase()
    const searchProvider = String(metadata?.search_provider || metadata?.searchProvider || '').trim().toLowerCase()
    const searchService = String(metadata?.search_service || metadata?.searchService || '').trim().toLowerCase()
    const sourceUrl = String(metadata?.source_url || '').trim().toLowerCase()
    const pageUrl = String(metadata?.page_url || metadata?.pageUrl || '').trim().toLowerCase()

    const searchable = [source, provider, sourceProvider, searchProvider, searchService, sourceUrl, pageUrl].filter(Boolean).join(' ')
    if (!searchable) return null

    if (searchable.includes('pexels')) return 'Pexels'
    if (searchable.includes('wikimedia') || searchable.includes('commons.wikimedia.org') || searchable.includes('wikipedia.org')) return 'Wikimedia'
    if (searchable.includes('brave')) return 'Brave'
    if (searchable.includes('unsplash')) return 'Unsplash'
    if (searchable.includes('pixabay')) return 'Pixabay'

    return null
}

function isHumanCuratedImage(item) {
    if (item?.type !== 'image') return false

    const metadata = item?.metadata || {}
    const attributes = item?.attributes || {}
    const status = String(item?.status || '').trim().toLowerCase()
    const createdVia = String(metadata?.created_via || '').trim().toLowerCase()
    const author = String(metadata?.author || metadata?.created_by || attributes?.author || '').trim().toLowerCase()

    if (metadata?.curated === true || metadata?.human_curated === true || attributes?.curated === true) {
        return true
    }

    if (status === 'curated') {
        return author ? author !== 'agent' : true
    }

    return createdVia.includes('curat')
}

export default function ContentPage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(null)
    const [contentItems, setContentItems] = useState([])
    const [selectedType, setSelectedType] = useState('all')
    const [contentTypeFilters, setContentTypeFilters] = useState(getDefaultContentTypeFilters)
    const [postModalFieldVisibility, setPostModalFieldVisibility] = useState(getDefaultPostModalFieldVisibility)
    const [showFilterManager, setShowFilterManager] = useState(false)
    const [newFilterTypeId, setNewFilterTypeId] = useState('production')
    const [newFilterLabel, setNewFilterLabel] = useState('Productions')
    const [newFilterIcon, setNewFilterIcon] = useState('🎬')
    const [selectedImageCategory, setSelectedImageCategory] = useState('all')
    const [selectedPostCategory, setSelectedPostCategory] = useState('all')
    const [selectedPostDomain, setSelectedPostDomain] = useState('all')
    const [selectedStatus, setSelectedStatus] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)
    const [activeAutocompleteIndex, setActiveAutocompleteIndex] = useState(-1)
    const [sortBy, setSortBy] = useState('updated') // updated, created, title
    const [modalOpen, setModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState(null)
    const [editingData, setEditingData] = useState(null)
    const [isReadOnly, setIsReadOnly] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [modalError, setModalError] = useState('')
    const [actionNotice, setActionNotice] = useState(null)
    const [selectedContentTypeForCreate, setSelectedContentTypeForCreate] = useState(null)
    const [activeModalTypeConfig, setActiveModalTypeConfig] = useState(null)
    const [pageModalReturnState, setPageModalReturnState] = useState(null)
    const [pendingPageBlockPostSelection, setPendingPageBlockPostSelection] = useState(null)
    const [showTypeSelector, setShowTypeSelector] = useState(false)
    const [selectedItemIds, setSelectedItemIds] = useState([])
    const [modalRelationships, setModalRelationships] = useState([])
    const [adminUsername, setAdminUsername] = useState('')
    const [selectedOpenAiModel, setSelectedOpenAiModel] = useState('')
    const [activeDomainMode, setActiveDomainMode] = useState(DEFAULT_DOMAIN_MODE)
    const [displayPolicy, setDisplayPolicy] = useState(DEFAULT_DISPLAY_POLICY)
    const autocompleteMouseDownRef = useRef(false)
    const router = useRouter()

    useEffect(() => {
        document.title = 'Content'
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const timeoutId = window.setTimeout(() => {
            try {
                setActiveDomainMode(getAdminDomainMode())
            } catch {
                setActiveDomainMode(DEFAULT_DOMAIN_MODE)
            }
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [])

    const buildImagePreview = useCallback((image) => {
        const category = image?.category ? `Category: ${image.category}` : null
        const searchPhrase = image?.searchPhrase ? `Search: ${image.searchPhrase}` : null
        return [category, searchPhrase].filter(Boolean).join(' • ')
    }, [])

    const extractSourceFromUrl = useCallback((url) => {
        try {
            return new URL(url).hostname.replace('www.', '')
        } catch {
            return null
        }
    }, [])

    const mapContentNodeToRow = useCallback((item) => {
        const metadata = item?.metadata || {}
        const attributes = item?.attributes || {}
        const originalType = item?.type || 'page'
        const isImageSubtype = item?.subtype === 'image' || originalType === 'image'
        const normalizedType = isImageSubtype ? 'image' : originalType

        const title =
            metadata?.presentation?.default?.title ||
            item?.title ||
            item?.name ||
            attributes?.location?.neighborhood ||
            attributes?.neighborhood ||
            attributes?.location?.area ||
            attributes?.area ||
            attributes?.location?.borough ||
            attributes?.borough ||
            'Untitled Content'

        const summary =
            metadata?.presentation?.default?.summary ||
            item?.summary ||
            ''
        const fullSummary = summary ? String(summary) : ''

        const sourceUrl = metadata?.source_url || null
        const imageCategory = isImageSubtype
            ? (metadata?.category || toDisplayCategory(originalType))
            : null
        const imageSearchPhrase = isImageSubtype
            ? (metadata?.search_phrase || metadata?.searchPhrase || '')
            : null

        return {
            id: item?.id,
            rowKey: `${normalizedType}-${item?.id}`,
            type: normalizedType,
            originalType,
            subtype: item?.subtype || null,
            title,
            slug: metadata?.slug || null,
            body: String(item?.body || ''),
            status: item?.status || (isImageSubtype ? 'curated' : 'draft'),
            created_at: item?.created_at,
            updated_at: item?.updated_at,
            author: String(metadata?.author || metadata?.created_by || attributes?.author || '').trim() || 'Admin',
            preview: isImageSubtype
                ? buildImagePreview({ category: imageCategory, searchPhrase: imageSearchPhrase })
                : (fullSummary ? fullSummary.slice(0, 150) : ''),
            fullDescription: isImageSubtype ? '' : fullSummary,
            metadata: {
                ...metadata,
                source_url: sourceUrl,
                source: metadata?.source || extractSourceFromUrl(sourceUrl),
                category: imageCategory,
                search_phrase: imageSearchPhrase,
                image_original_type: originalType
            },
            attributes
        }
    }, [buildImagePreview, extractSourceFromUrl])

    const normalizeImageCategory = (value) => String(value || '').trim().toLowerCase()

    const getImageCategory = (item) => normalizeImageCategory(item?.metadata?.category)

    const isCuratedCategoryImage = (item, category) => {
        if (!item || item.type !== 'image') return false
        return getImageCategory(item) === normalizeImageCategory(category)
    }

    const normalizePostCategory = (value) => String(value || '').trim().toLowerCase()

    const getPostCategory = (item) => {
        if (item?.type === 'location') return 'location'
        return normalizePostCategory(item?.attributes?.category)
    }

    const IMAGE_CATEGORY_FILTERS = [
        { id: 'all', label: 'All Image Categories' },
        { id: 'key art', label: 'Key Art' },
        { id: 'actor', label: 'Actor' },
        { id: 'company', label: 'Company' },
        { id: 'producer', label: 'Producer' },
        { id: 'uncategorized', label: 'Uncategorized' }
    ]

    const getPostDomain = (item) => String(item?.attributes?.domain || item?.metadata?.domain || '').trim().toLowerCase()

    const getPostFilterDomain = (item) => {
        const explicitDomain = getPostDomain(item)
        if (explicitDomain) {
            if (explicitDomain === 'core') return DEFAULT_CONTENT_DOMAIN
            return explicitDomain
        }

        return getEffectiveItemDomain(item)
    }

    const getEffectiveItemDomain = (item) => {
        const explicitDomain = String(item?.attributes?.domain || item?.metadata?.domain || '').trim().toLowerCase()
        if (explicitDomain) {
            if (explicitDomain === 'core') return DEFAULT_CONTENT_DOMAIN
            return explicitDomain
        }

        return DEFAULT_CONTENT_DOMAIN
    }

    const isPublicDomainItem = (item) => getEffectiveItemDomain(item) === DEFAULT_CONTENT_DOMAIN

    async function loadDisplayPolicy() {
        try {
            const response = await fetch('/api/settings/display-policy', { cache: 'no-store' })
            if (!response.ok) return

            const data = await response.json().catch(() => ({}))
            setDisplayPolicy(normalizeDisplayPolicy(data?.policy))
        } catch (error) {
            console.error('Failed to load display policy:', error)
        }
    }

    // Load content from API
    const loadContent = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const domainModeParam = activeDomainMode ? `&domainMode=${encodeURIComponent(activeDomainMode)}` : ''
            const responses = await Promise.all(
                CONTENT_FETCH_TYPES.map((type) =>
                    fetch(`/api/content?type=${encodeURIComponent(type)}&limit=500${domainModeParam}`)
                )
            )

            const failedResponses = responses.filter(r => !r.ok)
            if (failedResponses.length === responses.length) {
                const firstFailed = failedResponses[0]
                const errData = await firstFailed.json().catch(() => ({}))
                throw new Error(errData?.error || `HTTP ${firstFailed.status} — check DATABASE_URL and server logs`)
            }

            const items = []
            for (const response of responses) {
                if (!response.ok) continue
                const data = await response.json().catch(() => ({}))
                const mapped = (data?.content || [])
                    .map(mapContentNodeToRow)
                    .filter((item) => !isHiddenFromContentManagementList(item))
                items.push(...mapped)
            }

            const deduped = new Map()
            for (const item of items) {
                deduped.set(item.id, item)
            }

            setContentItems(Array.from(deduped.values()))
        } catch (error) {
            console.error('Error loading content:', error)
            setLoadError(error.message || 'Failed to load content')
        } finally {
            setLoading(false)
        }
    }, [activeDomainMode, mapContentNodeToRow])

    // Authentication check
    useEffect(() => {
        let cancelled = false

        async function bootstrapAdmin() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) {
                return
            }

            if (!token) {
                router.push('/login')
                return
            }

            const localUsername = localStorage.getItem('adminUsername')
            if (localUsername) setAdminUsername(localUsername)

            setIsAuthenticated(true)
            const timeoutId = window.setTimeout(() => {
                loadDisplayPolicy()
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        bootstrapAdmin()

        return () => {
            cancelled = true
        }
    }, [router])

    useEffect(() => {
        if (!isAuthenticated) return
        const timeoutId = window.setTimeout(() => {
            loadContent()
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [isAuthenticated, loadContent])

    const getAdminAuthHeaders = useCallback(() => {
        if (typeof window === 'undefined') return {}
        const token = window.localStorage.getItem('adminToken')
        return token ? { Authorization: `Bearer ${token}` } : {}
    }, [])

    const loadPostModalFieldVisibilitySettings = useCallback(async () => {
        try {
            const response = await fetch('/api/settings/domains/post-modal-fields', {
                headers: getAdminAuthHeaders(),
                cache: 'no-store',
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to load post modal field settings')
            }

            setPostModalFieldVisibility(normalizePostModalFieldVisibility(data?.postModalFieldVisibility))
        } catch (error) {
            console.error('Failed to load post modal field visibility settings:', error)
        }
    }, [getAdminAuthHeaders])

    const showPracticeBackendContent = shouldShowPracticeContent({
        surface: 'backend',
        policy: displayPolicy,
    })

    const isVisibleForCurrentDomainAndPolicy = (item) => {
        if (!isTypeAllowedForDomainMode(item?.type, activeDomainMode)) return false

        if (activeDomainMode === DEFAULT_CONTENT_DOMAIN && !isPublicDomainItem(item)) {
            return false
        }

        // Brands that only ever publish their own content scope the list to their domain.
        if (hasPrivateDomainTrait(activeDomainMode, 'exclusiveContentFiltering')
            && getEffectiveItemDomain(item) !== activeDomainMode) {
            return false
        }

        return true
    }

    const enabledPostDomainFilters = POST_DOMAIN_FILTERS.filter((domainFilter) => {
        if (domainFilter.id !== DEFAULT_CONTENT_DOMAIN) return true
        return showPracticeBackendContent
    })

    const availablePostDomainIds = Array.from(new Set(
        contentItems
            .filter((item) => {
                if (item.type !== 'post' && item.type !== 'location') return false
                return isVisibleForCurrentDomainAndPolicy(item)
            })
            .map((item) => getPostFilterDomain(item))
            .filter(Boolean)
    ))

    const availablePostDomainTypeFilters = enabledPostDomainFilters.filter((domainFilter) => (
        domainFilter.id !== 'all' && availablePostDomainIds.includes(domainFilter.id)
    ))

    const shouldShowPostDomainFilter = availablePostDomainTypeFilters.length > 0

    const visiblePostDomainFilters = shouldShowPostDomainFilter
        ? [
            enabledPostDomainFilters.find((domainFilter) => domainFilter.id === 'all') || POST_DOMAIN_FILTERS[0],
            ...availablePostDomainTypeFilters
        ]
        : []

    useEffect(() => {
        if (typeof window === 'undefined') return

        try {
            const raw = window.localStorage.getItem(CONTENT_TYPE_FILTER_STORAGE_KEY)
            if (raw) {
                const parsed = JSON.parse(raw)
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const normalized = parsed
                        .filter((filter) => filter && filter.id && filter.label && filter.icon)
                        .map((filter) => ({
                            ...filter,
                            showRecords: filter.showRecords !== false,
                            showFilter: filter.showFilter !== false
                        }))
                    if (normalized.length > 0) {
                        const timeoutId = window.setTimeout(() => {
                            setContentTypeFilters(normalized)
                        }, 0)
                        return () => window.clearTimeout(timeoutId)
                    }
                }
            }
        } catch {
            const timeoutId = window.setTimeout(() => {
                setContentTypeFilters(getDefaultContentTypeFilters())
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        const timeoutId = window.setTimeout(() => {
            setPostModalFieldVisibility(getDefaultPostModalFieldVisibility())
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(CONTENT_TYPE_FILTER_STORAGE_KEY, JSON.stringify(contentTypeFilters))
    }, [contentTypeFilters])

    useEffect(() => {
        if (!isAuthenticated) return
        const timeoutId = window.setTimeout(() => {
            loadPostModalFieldVisibilitySettings()
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [isAuthenticated, loadPostModalFieldVisibilitySettings])

    useEffect(() => {
        if (contentTypeFilters.length === 0) return

        const allowedFilters = contentTypeFilters.filter((filter) => {
            if (filter.id === 'all') return true

            const config = CONTENT_TYPE_CONFIGS[filter.id]
            if (!config) return false
            return true
        })

        const validFilterIds = new Set(allowedFilters.map((filter) => filter.id))
        if (!validFilterIds.has(selectedType)) {
            const timeoutId = window.setTimeout(() => {
                setSelectedType(allowedFilters[0]?.id || contentTypeFilters[0].id)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        const selectedFilter = allowedFilters.find((filter) => filter.id === selectedType)
        if (selectedFilter?.showFilter === false) {
            const firstVisible = allowedFilters.find((filter) => filter.showFilter !== false)
            if (firstVisible) {
                const timeoutId = window.setTimeout(() => {
                    setSelectedType(firstVisible.id)
                }, 0)
                return () => window.clearTimeout(timeoutId)
            }
        }
    }, [contentTypeFilters, selectedType, activeDomainMode])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const params = new URLSearchParams(window.location.search)
        const typeParam = params.get('type')
        const qParam = params.get('q')

        const normalizedTypeParam = typeParam === 'article' ? 'post' : typeParam
        if (normalizedTypeParam && (normalizedTypeParam === 'all' || Object.keys(CONTENT_TYPE_CONFIGS).includes(normalizedTypeParam))) {
            const timeoutId = window.setTimeout(() => {
                setSelectedType(normalizedTypeParam)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        if (qParam) {
            const timeoutId = window.setTimeout(() => {
                setSearchQuery(qParam)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        const loadSelectedOpenAiModel = async () => {
            try {
                const response = await fetch('/api/openai/check', {
                    cache: 'no-store',
                    headers: await getAdminAuthHeaders(),
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok || cancelled) return
                const model = typeof data?.model === 'string' ? data.model.trim() : ''
                if (!cancelled) setSelectedOpenAiModel(model)
            } catch {
                if (!cancelled) setSelectedOpenAiModel('')
            }
        }

        loadSelectedOpenAiModel()
        return () => {
            cancelled = true
        }
    }, [getAdminAuthHeaders])

    useEffect(() => {
        if (!actionNotice) return
        const timeout = setTimeout(() => setActionNotice(null), 3500)
        return () => clearTimeout(timeout)
    }, [actionNotice])

    useEffect(() => {
        if (selectedType !== 'image') {
            const timeoutId = window.setTimeout(() => {
                setSelectedImageCategory('all')
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
        if (selectedType !== 'post') {
            const timeoutId = window.setTimeout(() => {
                setSelectedPostCategory('all')
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [selectedType])

    useEffect(() => {
        if (!shouldShowPostDomainFilter) {
            if (selectedPostDomain !== 'all') {
                const timeoutId = window.setTimeout(() => {
                    setSelectedPostDomain('all')
                }, 0)
                return () => window.clearTimeout(timeoutId)
            }
            return
        }

        const validDomainIds = new Set(['all', ...availablePostDomainTypeFilters.map((domainFilter) => domainFilter.id)])
        if (!validDomainIds.has(selectedPostDomain)) {
            const timeoutId = window.setTimeout(() => {
                setSelectedPostDomain('all')
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [shouldShowPostDomainFilter, availablePostDomainTypeFilters, selectedPostDomain])

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setSelectedItemIds(prev => prev.filter(id => contentItems.some(item => item.id === id)))
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [contentItems])

    const showNotice = (type, message) => {
        setActionNotice({ type, message })
    }

    const formatCacheInvalidationNotice = (domains) => {
        const uniqueDomains = Array.from(new Set((domains || []).filter(Boolean)))
        if (uniqueDomains.length === 0) return ''
        return ` Cache cleared for ${uniqueDomains.join(', ')}.`
    }

    const hiddenTypeIds = new Set([
        ...contentTypeFilters
            .filter((filter) => filter.id !== 'all' && filter.showRecords === false)
            .map((filter) => filter.id),
        ...Object.keys(CONTENT_TYPE_CONFIGS).filter((typeId) => !isTypeAllowedForDomainMode(typeId, activeDomainMode))
    ])

    const searchTerm = String(searchQuery || '').trim().toLowerCase()

    const getItemSearchText = (item) => {
        const metadata = item?.metadata || {}
        const attributes = item?.attributes || {}
        const location = attributes?.location || {}
        const title = String(item?.title || item?.name || '')
        const slug = String(item?.slug || metadata?.slug || '')
        const presentationTitle = String(metadata?.presentation?.default?.title || '')
        const borough = String(location?.borough || attributes?.borough || '')
        const neighborhood = String(location?.neighborhood || attributes?.neighborhood || '')
        const area = String(location?.area || attributes?.area || '')

        return [title, slug, presentationTitle, borough, neighborhood, area]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
    }

    const getTypeDisplay = (typeId) => {
        if (typeId === 'post') return { label: 'Post', icon: '📝' }
        const config = CONTENT_TYPE_CONFIGS[typeId]
        return {
            label: config?.label || typeId,
            icon: config?.icon || '📄'
        }
    }

    const autocompleteSuggestions = searchTerm
        ? contentItems
            .filter((item) => {
                if (!item?.id) return false
                if (!isVisibleForCurrentDomainAndPolicy(item)) return false
                if (selectedType === 'all' && hiddenTypeIds.has(item.type)) return false
                const isPostLikeType = selectedType === 'post' && item.type === 'location'
                if (selectedType !== 'all' && !isPostLikeType && item.type !== selectedType) return false
                if (selectedStatus !== 'all' && item.status !== selectedStatus) return false
                if (selectedType === 'image' && selectedImageCategory !== 'all') {
                    const category = getImageCategory(item)
                    if (selectedImageCategory === 'uncategorized') {
                        if (category) return false
                    } else if (category !== selectedImageCategory) {
                        return false
                    }
                }
                if (selectedType === 'post' && selectedPostCategory !== 'all') {
                    const category = getPostCategory(item)
                    if (selectedPostCategory === 'uncategorized') {
                        if (category) return false
                    } else if (selectedPostCategory === 'news') {
                        if (!category.includes('news')) return false
                    } else if (category !== selectedPostCategory) {
                        return false
                    }
                }
                if (selectedType === 'post' && selectedPostDomain !== 'all') {
                    if (getPostFilterDomain(item) !== selectedPostDomain) return false
                }

                return getItemSearchText(item).includes(searchTerm)
            })
            .sort((a, b) => {
                const aTitle = String(a?.title || a?.name || '')
                const bTitle = String(b?.title || b?.name || '')
                const aStarts = aTitle.toLowerCase().startsWith(searchTerm)
                const bStarts = bTitle.toLowerCase().startsWith(searchTerm)

                if (aStarts !== bStarts) return aStarts ? -1 : 1
                return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
            })
            .slice(0, 8)
        : []

    const showAutocomplete = isSearchInputFocused && autocompleteSuggestions.length > 0 && Boolean(searchTerm)

    const isTypeAllowedForCurrentDomain = useCallback((typeId) => isTypeAllowedForDomainMode(typeId, activeDomainMode), [activeDomainMode])

    const availableFilterTypeOptions = Object.values(CONTENT_TYPE_CONFIGS)
        .filter((type) => isTypeAllowedForCurrentDomain(type.id) && !type.isPostCategory)

    const visibleManagedTypeFilters = contentTypeFilters
        .map((filter, index) => ({ filter, index }))
        .filter(({ filter }) => isTypeAllowedForCurrentDomain(filter.id))

    useEffect(() => {
        if (isTypeAllowedForCurrentDomain(newFilterTypeId)) return

        const fallbackTypeId = availableFilterTypeOptions[0]?.id || 'all'
        const timeoutId = window.setTimeout(() => {
            setNewFilterTypeId(fallbackTypeId)
        }, 0)
        if (fallbackTypeId === 'all') {
            const timeoutIdForLabel = window.setTimeout(() => {
                setNewFilterLabel('All Content')
                setNewFilterIcon('📋')
            }, 0)
            return () => {
                window.clearTimeout(timeoutId)
                window.clearTimeout(timeoutIdForLabel)
            }
        }

        const config = CONTENT_TYPE_CONFIGS[fallbackTypeId]
        if (!config) return

        if (fallbackTypeId === 'post') {
            const timeoutIdForLabel = window.setTimeout(() => {
                setNewFilterLabel('Posts')
                setNewFilterIcon('📝')
            }, 0)
            return () => {
                window.clearTimeout(timeoutId)
                window.clearTimeout(timeoutIdForLabel)
            }
        }

        if (fallbackTypeId === 'production') {
            const timeoutIdForLabel = window.setTimeout(() => {
                setNewFilterLabel('Productions')
                setNewFilterIcon(config.icon || '🎬')
            }, 0)
            return () => {
                window.clearTimeout(timeoutId)
                window.clearTimeout(timeoutIdForLabel)
            }
        }

        if (fallbackTypeId === 'image') {
            const timeoutIdForLabel = window.setTimeout(() => {
                setNewFilterLabel('Images')
                setNewFilterIcon(config.icon || '🖼️')
            }, 0)
            return () => {
                window.clearTimeout(timeoutId)
                window.clearTimeout(timeoutIdForLabel)
            }
        }

        const timeoutIdForLabel = window.setTimeout(() => {
            setNewFilterLabel(config.label || fallbackTypeId)
            setNewFilterIcon(config.icon || '📋')
        }, 0)
        return () => {
            window.clearTimeout(timeoutId)
            window.clearTimeout(timeoutIdForLabel)
        }
    }, [activeDomainMode, newFilterTypeId, availableFilterTypeOptions, isTypeAllowedForCurrentDomain])

    // Filter and sort content
    const filteredContent = contentItems
        .filter(item => {
            if (!isVisibleForCurrentDomainAndPolicy(item)) return false

            const itemTitle = String(item.title || item.name || '')
            const selectedFilter = contentTypeFilters.find((filter) => filter.id === selectedType)

            if (selectedType !== 'all' && selectedFilter?.showRecords === false) {
                return false
            }

            if (selectedType === 'all' && hiddenTypeIds.has(item.type)) {
                return false
            }

            if (selectedType === 'image') {
                if (item.type !== 'image') return false
                if (selectedImageCategory !== 'all') {
                    const category = getImageCategory(item)
                    if (selectedImageCategory === 'uncategorized') {
                        if (category) return false
                    } else if (category !== selectedImageCategory) {
                        return false
                    }
                }
            } else if (selectedType === 'post') {
                if (item.type !== 'post' && item.type !== 'location') return false
                if (selectedPostCategory !== 'all') {
                    const category = getPostCategory(item)
                    if (selectedPostCategory === 'uncategorized') {
                        if (category) return false
                    } else if (selectedPostCategory === 'news') {
                        if (!category.includes('news')) return false
                    } else if (category !== selectedPostCategory) {
                        return false
                    }
                }
                if (selectedPostDomain !== 'all') {
                    const postDomain = getPostFilterDomain(item)
                    if (postDomain !== selectedPostDomain) return false
                }
            } else if (selectedType !== 'all' && item.type !== selectedType) {
                return false
            }
            if (selectedStatus !== 'all' && item.status !== selectedStatus) return false
            if (searchQuery && !itemTitle.toLowerCase().includes(searchQuery.toLowerCase())) return false
            return true
        })
        .sort((a, b) => {
            if (sortBy === 'title') {
                const aTitle = String(a.title || a.name || '')
                const bTitle = String(b.title || b.name || '')
                return aTitle.localeCompare(bTitle)
            }
            if (sortBy === 'created') return new Date(b.created_at) - new Date(a.created_at)
            return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
        })

    const selectableIds = filteredContent
        .map(item => item.id)
        .filter(Boolean)
    const selectedVisibleIds = selectableIds.filter(id => selectedItemIds.includes(id))
    const allVisibleSelected = selectableIds.length > 0 && selectedVisibleIds.length === selectableIds.length

    // Get stats for each type
    const getTypeCount = (typeId) => {
        if (typeId === 'all') {
            return contentItems.filter((item) => {
                return isVisibleForCurrentDomainAndPolicy(item) && !hiddenTypeIds.has(item.type)
            }).length
        }

        if (!isTypeAllowedForCurrentDomain(typeId)) return 0

        const filter = contentTypeFilters.find((entry) => entry.id === typeId)
        if (filter?.showRecords === false) return 0
        return contentItems.filter((item) => {
            const matchesType = item.type === typeId || (typeId === 'post' && item.type === 'location')
            return matchesType && isVisibleForCurrentDomainAndPolicy(item)
        }).length
    }

    const getImageCategoryCount = (categoryId) => {
        const images = contentItems.filter(item => item.type === 'image' && isVisibleForCurrentDomainAndPolicy(item))
        if (categoryId === 'all') return images.length
        if (categoryId === 'uncategorized') {
            return images.filter(item => !getImageCategory(item)).length
        }
        return images.filter(item => getImageCategory(item) === categoryId).length
    }

    const getPostCategoryCount = (categoryId) => {
        const posts = contentItems.filter(item => (item.type === 'post' || item.type === 'location') && isVisibleForCurrentDomainAndPolicy(item))
        if (categoryId === 'all') return posts.length
        if (categoryId === 'uncategorized') {
            return posts.filter(item => !getPostCategory(item)).length
        }
        if (categoryId === 'news') {
            return posts.filter(item => getPostCategory(item).includes('news')).length
        }
        return posts.filter(item => getPostCategory(item) === categoryId).length
    }

    const getPostDomainCount = (domainId) => {
        const posts = contentItems.filter(item => (item.type === 'post' || item.type === 'location') && isVisibleForCurrentDomainAndPolicy(item))
        if (domainId === 'all') return posts.length
        return posts.filter(item => getPostFilterDomain(item) === domainId).length
    }

    // Modal handlers
    // Content relationship modules are no longer available; always clear any stale state.
    const loadRelationshipsForItem = () => {
        setModalRelationships([])
    }

    const openEditModal = (item) => {
        if (isSystemContentRecord(item)) {
            openViewModal(item)
            return
        }

        setPageModalReturnState(null)
        setPendingPageBlockPostSelection(null)

        const typeConfig = CONTENT_TYPE_CONFIGS[item.type]
        setEditingItem(item)
        setEditingData({
            ...item,
            body: item.body || '',
            preview: item.fullDescription ?? item.preview ?? ''
        })
        setActiveModalTypeConfig(typeConfig || null)
        setSelectedContentTypeForCreate(null)
        setIsReadOnly(false)
        setModalError('')
        setModalOpen(true)
        loadRelationshipsForItem(item)
    }

    const openViewModal = (item) => {
        setPageModalReturnState(null)
        setPendingPageBlockPostSelection(null)

        const typeConfig = CONTENT_TYPE_CONFIGS[item.type]
        setEditingItem(item)
        setEditingData({
            ...item,
            body: item.body || '',
            preview: item.fullDescription ?? item.preview ?? ''
        })
        setActiveModalTypeConfig(typeConfig || null)
        setSelectedContentTypeForCreate(null)
        setIsReadOnly(true)
        setModalError('')
        setModalOpen(true)
        loadRelationshipsForItem(item)
    }

    const closeModal = () => {
        setModalOpen(false)
        setEditingItem(null)
        setEditingData(null)
        setActiveModalTypeConfig(null)
        setPageModalReturnState(null)
        setPendingPageBlockPostSelection(null)
        setSelectedContentTypeForCreate(null)
        setIsReadOnly(false)
        setModalError('')
        setModalRelationships([])
    }

    const switchModalToEdit = () => {
        setIsReadOnly(false)
        setModalError('')
    }

    const openNewPostForPageBlock = (blockId) => {
        const normalizedBlockId = String(blockId || '').trim()
        if (!normalizedBlockId) return
        if (!editingData || editingData.type !== 'page') return

        setPageModalReturnState({
            editingItem: cloneSerializable(editingItem),
            editingData: cloneSerializable(editingData),
            activeModalTypeConfig: cloneSerializable(activeModalTypeConfig),
            selectedContentTypeForCreate: cloneSerializable(selectedContentTypeForCreate),
            isReadOnly: Boolean(isReadOnly),
            modalRelationships: cloneSerializable(modalRelationships)
        })
        setPendingPageBlockPostSelection({ blockId: normalizedBlockId })
        openNewContentModal('post')
    }

    const openEditPostForPageBlock = ({ postId, postSlug } = {}) => {
        const normalizedPostId = String(postId || '').trim()
        const normalizedPostSlug = String(postSlug || '').trim().toLowerCase()

        const target = contentItems.find((item) => {
            const itemType = String(item?.type || '').trim().toLowerCase()
            if (itemType !== 'post' && itemType !== 'article') return false

            const itemId = String(item?.id || '').trim()
            if (normalizedPostId && itemId === normalizedPostId) return true

            const itemSlug = String(item?.slug || item?.metadata?.slug || '').trim().toLowerCase()
            return Boolean(normalizedPostSlug) && itemSlug === normalizedPostSlug
        })

        if (!target) {
            showNotice('error', 'Selected post could not be opened for editing.')
            return
        }

        openEditModal(target)
    }

    const openNewContentModal = (typeId) => {
        const typeConfig = CONTENT_TYPE_CONFIGS[typeId]
        if (!typeConfig) return
        if (typeConfig.domain !== 'core' && typeConfig.domain !== activeDomainMode) return

        if (typeId !== 'post') {
            setPageModalReturnState(null)
            setPendingPageBlockPostSelection(null)
        }

        const ownsContentDefault = hasPrivateDomainTrait(activeDomainMode, 'ownsContentDefault')
        const postDomain = ownsContentDefault ? activeDomainMode : DEFAULT_CONTENT_DOMAIN

        const pageDomain = ownsContentDefault ? activeDomainMode : DEFAULT_CONTENT_DOMAIN

        const newItem = {
            id: null,
            type: typeId,
            title: '',
            slug: '',
            status: 'draft',
            preview: '',
            body: '',
            metadata: typeId === 'page' || typeId === 'smart_page' ? { blocks: [] } : {},
            attributes:
                typeId === 'post'
                    ? { domain: postDomain }
                    : typeId === 'page'
                        ? { domain: pageDomain }
                        : typeId === 'smart_page'
                            ? { domain: getPrivateContentTypeOwner(typeId) || DEFAULT_CONTENT_DOMAIN, editor_mode: 'smart', ai_state: { status: 'idle', messages: [] } }
                            : {}
        }

        setEditingItem(null)
        setEditingData(newItem)
        setActiveModalTypeConfig(typeConfig)
        setSelectedContentTypeForCreate(typeConfig)
        setIsReadOnly(false)
        setModalError('')
        setModalOpen(true)
        setShowTypeSelector(false)
    }

    const saveNewContent = async () => {
        if (!editingData) return
        setIsSaving(true)
        setModalError('')

        try {
            const payload = {
                type: editingData.type,
                title: editingData.title,
                slug: editingData.slug,
                status: editingData.status,
                summary: editingData.preview,
                body: editingData.body,
                attributes: editingData.attributes,
                metadata: {
                    ...(editingData.metadata || {}),
                    source: 'admin-dashboard',
                    created_via: 'content-modal',
                    author: editingData?.metadata?.author || adminUsername || 'User'
                }
            }

            const response = await fetch('/api/content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })

            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`)
            }

            const createdContent = data?.content || null

            showNotice('success', `${selectedContentTypeForCreate.label} created successfully.${formatCacheInvalidationNotice(data?.cacheInvalidatedDomains)}`)
            await loadContent()

            if (pageModalReturnState && pendingPageBlockPostSelection?.blockId && createdContent) {
                const restoredEditingData = assignPostToSinglePostBlock(pageModalReturnState.editingData, {
                    blockId: pendingPageBlockPostSelection.blockId,
                    postOption: createdContent
                })

                setEditingItem(pageModalReturnState.editingItem || null)
                setEditingData(restoredEditingData)
                setActiveModalTypeConfig(pageModalReturnState.activeModalTypeConfig || null)
                setSelectedContentTypeForCreate(pageModalReturnState.selectedContentTypeForCreate || null)
                setIsReadOnly(Boolean(pageModalReturnState.isReadOnly))
                setModalRelationships(Array.isArray(pageModalReturnState.modalRelationships) ? pageModalReturnState.modalRelationships : [])
                setModalError('')
                setModalOpen(true)
                setPageModalReturnState(null)
                setPendingPageBlockPostSelection(null)
                return
            }

            closeModal()
            setSelectedContentTypeForCreate(null)
        } catch (error) {
            setModalError(`Failed to create content: ${error.message}`)
        } finally {
            setIsSaving(false)
        }
    }

    const handleModalChange = (field, value) => {
        setEditingData(prev => ({
            ...prev,
            [field]: value
        }))
    }

    const saveChanges = async () => {
        if (!editingItem || !editingData) return

        if (isSystemContentRecord(editingData) || isSystemContentRecord(editingItem)) {
            setModalError('System records are read-only and cannot be modified.')
            return
        }

        setIsSaving(true)
        setModalError('')

        try {
            const endpoint = `/api/content/${editingItem.id}`
            const method = 'PATCH'
            const payload = {
                title: editingData.title,
                status: editingData.status,
                slug: editingData.slug,
                summary: editingData.preview,
                body: editingData.body,
                attributes: editingData.attributes || {},
                metadata: editingData.metadata || {}
            }

            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            const data = await response.json().catch(() => ({}))

            if (response.ok) {
                await loadContent()
                showNotice('success', `Content updated successfully.${formatCacheInvalidationNotice(data?.cacheInvalidatedDomains)}`)
                closeModal()
            } else {
                setModalError(data.error || 'Failed to save changes')
            }
        } catch (error) {
            setModalError(error.message || 'Error saving changes')
        } finally {
            setIsSaving(false)
        }
    }

    const duplicateItem = async (item) => {
        if (isSystemContentRecord(item)) {
            showNotice('error', 'System records cannot be duplicated')
            return
        }

        setIsSaving(true)
        try {
            const duplicatePayload = {
                type: item.originalType || item.type,
                subtype: item.subtype || undefined,
                title: `${item.title} (Copy)`,
                slug: item.slug ? `${item.slug}-copy-${Date.now().toString().slice(-6)}` : undefined,
                status: 'draft',
                summary: item.fullDescription || item.preview || '',
                body: item.body || '',
                attributes: item.attributes || {},
                metadata: {
                    ...(item.metadata || {}),
                    source: 'admin-dashboard',
                    duplicated_from_id: item.id,
                    duplicated_at: new Date().toISOString()
                }
            }

            const response = await fetch('/api/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(duplicatePayload)
            })

            const data = await response.json().catch(() => ({}))

            if (response.ok) {
                await loadContent()
                showNotice('success', `Content duplicated successfully.${formatCacheInvalidationNotice(data?.cacheInvalidatedDomains)}`)
            } else {
                showNotice('error', 'Failed to duplicate item: ' + (data.error || 'Unknown error'))
            }
        } catch (error) {
            showNotice('error', 'Error duplicating item: ' + error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const deleteItem = async (item) => {
        if (isSystemContentRecord(item)) {
            showNotice('error', 'System records cannot be deleted')
            return
        }

        if (!confirm(`Move "${item.title}" to Recently Deleted?\n\nYou can restore it from Recycling.`)) {
            return
        }

        setIsSaving(true)
        try {
            const existingMetadata = parseMaybeJsonObject(item?.metadata)
            const existingRecycling = existingMetadata?.recycling && typeof existingMetadata.recycling === 'object'
                ? existingMetadata.recycling
                : {}
            const nextMetadata = {
                ...existingMetadata,
                recycling: {
                    ...existingRecycling,
                    previousStatus: String(item?.status || 'published').trim() || 'published',
                    deletedBy: 'admin-content-single-delete',
                    deletedAt: new Date().toISOString(),
                },
            }

            const response = await fetch(`/api/content/${item.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'pending delete',
                    metadata: nextMetadata,
                }),
            })

            const data = await response.json().catch(() => ({}))

            if (response.ok) {
                // Remove from local state
                setContentItems(prev => prev.filter(i => i.id !== item.id))
                showNotice('success', `Content moved to Recently Deleted.${formatCacheInvalidationNotice(data?.cacheInvalidatedDomains)}`)
            } else {
                showNotice('error', 'Failed to move to recycling: ' + (data.error || 'Unknown error'))
            }
        } catch (error) {
            showNotice('error', 'Error moving item to recycling: ' + error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const toggleSelectItem = (itemId) => {
        if (!itemId) return
        setSelectedItemIds(prev => (
            prev.includes(itemId)
                ? prev.filter(id => id !== itemId)
                : [...prev, itemId]
        ))
    }

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            setSelectedItemIds(prev => prev.filter(id => !selectableIds.includes(id)))
            return
        }

        setSelectedItemIds(prev => Array.from(new Set([...prev, ...selectableIds])))
    }

    const clearSelection = () => {
        setSelectedItemIds([])
    }

    const handleTypeFilterChange = (typeId) => {
        setSelectedType(typeId)
        setSearchQuery('')
        setActiveAutocompleteIndex(-1)
    }

    const getTypeFilterTemplate = useCallback((typeId) => {
        if (!isTypeAllowedForCurrentDomain(typeId)) return null
        if (typeId === 'all') return { id: 'all', label: 'All Content', icon: '📋' }
        const cfg = CONTENT_TYPE_CONFIGS[typeId]
        if (!cfg) return null

        if (typeId === 'post') return { id: 'post', label: 'Posts', icon: '📝' }
        if (typeId === 'production') return { id: 'production', label: 'Productions', icon: cfg.icon || '🎬' }
        if (typeId === 'image') return { id: 'image', label: 'Images', icon: cfg.icon || '🖼️' }

        return { id: typeId, label: cfg.label || typeId, icon: cfg.icon || '📋' }
    }, [isTypeAllowedForCurrentDomain])

    const moveTypeFilter = (index, direction) => {
        const nextIndex = index + direction
        if (nextIndex < 0 || nextIndex >= contentTypeFilters.length) return

        setContentTypeFilters((prev) => {
            const next = [...prev]
            const [moved] = next.splice(index, 1)
            next.splice(nextIndex, 0, moved)
            return next
        })
    }

    const removeTypeFilter = (index) => {
        setContentTypeFilters((prev) => {
            if (prev.length <= 1) return prev

            const removed = prev[index]
            const next = prev.filter((_, i) => i !== index)
            if (removed && selectedType === removed.id && next.length > 0) {
                setSelectedType(next[0].id)
            }
            return next
        })
    }

    const toggleTypeFilterRecords = (index) => {
        setContentTypeFilters((prev) => prev.map((filter, i) => (
            i === index
                ? { ...filter, showRecords: filter.showRecords === false }
                : filter
        )))
    }

    const toggleTypeFilterVisibility = (index) => {
        setContentTypeFilters((prev) => {
            const next = prev.map((filter, i) => (
                i === index
                    ? { ...filter, showFilter: filter.showFilter === false }
                    : filter
            ))

            const visibleCount = next.filter((filter) => filter.showFilter !== false).length
            if (visibleCount === 0) {
                return prev
            }

            const target = next[index]
            if (target && target.showFilter === false && selectedType === target.id) {
                const firstVisible = next.find((filter) => filter.showFilter !== false)
                if (firstVisible) {
                    setSelectedType(firstVisible.id)
                }
            }

            return next
        })
    }

    const addTypeFilter = () => {
        const template = getTypeFilterTemplate(newFilterTypeId)
        if (!template) return

        const label = String(newFilterLabel || '').trim() || template.label
        const icon = String(newFilterIcon || '').trim() || template.icon

        setContentTypeFilters((prev) => [...prev, { id: template.id, label, icon, showRecords: true, showFilter: true }])
        setSelectedType(template.id)
    }

    const resetTypeFiltersToDefaults = () => {
        setContentTypeFilters(getDefaultContentTypeFilters())
        setSelectedType('all')
    }


    const onNewFilterTypeChange = useCallback((typeId) => {
        const template = getTypeFilterTemplate(typeId)
        setNewFilterTypeId(typeId)
        if (template) {
            setNewFilterLabel(template.label)
            setNewFilterIcon(template.icon)
        }
    }, [getTypeFilterTemplate])

    const handleStatusFilterChange = (statusId) => {
        setSelectedStatus(statusId)
        setSearchQuery('')
        setActiveAutocompleteIndex(-1)
    }

    const handleImageCategoryFilterChange = (categoryId) => {
        setSelectedImageCategory(categoryId)
        setSearchQuery('')
        setActiveAutocompleteIndex(-1)
    }

    const handlePostCategoryFilterChange = (categoryId) => {
        setSelectedPostCategory(categoryId)
        setSearchQuery('')
        setActiveAutocompleteIndex(-1)
    }

    const handlePostDomainFilterChange = (domainId) => {
        setSelectedPostDomain(domainId)
        setSearchQuery('')
        setActiveAutocompleteIndex(-1)
    }

    const handleSearchInputChange = (event) => {
        setSearchQuery(event.target.value)
        setActiveAutocompleteIndex(-1)
    }

    const handleAutocompleteSelect = (item) => {
        if (!item) return

        const title = String(item?.title || item?.name || '').trim()
        if (!title) return

        setSearchQuery(title)
        setSelectedType(item.type)
        setSelectedStatus('all')
        setIsSearchInputFocused(false)
        setActiveAutocompleteIndex(-1)
    }

    const handleSearchInputKeyDown = (event) => {
        if (!showAutocomplete) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveAutocompleteIndex((prev) => (prev + 1) % autocompleteSuggestions.length)
            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveAutocompleteIndex((prev) => {
                if (prev <= 0) return autocompleteSuggestions.length - 1
                return prev - 1
            })
            return
        }

        if (event.key === 'Enter' && activeAutocompleteIndex >= 0) {
            event.preventDefault()
            handleAutocompleteSelect(autocompleteSuggestions[activeAutocompleteIndex])
            return
        }

        if (event.key === 'Escape') {
            setIsSearchInputFocused(false)
            setActiveAutocompleteIndex(-1)
        }
    }

    const deleteSelectedItems = async () => {
        const selectedTargets = contentItems.filter(item => selectedItemIds.includes(item.id))
        const targets = selectedTargets.filter(item => !isSystemContentRecord(item))

        if (selectedTargets.length > 0 && targets.length === 0) {
            showNotice('error', 'Selected items are system records and cannot be deleted')
            return
        }

        if (targets.length === 0) {
            showNotice('error', 'No items selected')
            return
        }

        const itemLabel = targets.length === 1 ? 'item' : 'items'
        const confirmed = confirm(`Move ${targets.length} selected ${itemLabel} to Recently Deleted?\n\nYou can restore them from Recycling.`)
        if (!confirmed) return

        setIsSaving(true)
        try {
            const invalidatedDomains = []
            const results = await Promise.allSettled(
                targets.map(async (item) => {
                    const existingMetadata = parseMaybeJsonObject(item?.metadata)
                    const existingRecycling = existingMetadata?.recycling && typeof existingMetadata.recycling === 'object'
                        ? existingMetadata.recycling
                        : {}
                    const nextMetadata = {
                        ...existingMetadata,
                        recycling: {
                            ...existingRecycling,
                            previousStatus: String(item?.status || 'published').trim() || 'published',
                            deletedBy: 'admin-content-bulk-delete',
                            deletedAt: new Date().toISOString(),
                        },
                    }

                    const response = await fetch(`/api/content/${item.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'pending delete',
                            metadata: nextMetadata,
                        }),
                    })
                    const data = await response.json().catch(() => ({}))
                    if (!response.ok) {
                        throw new Error(data?.error || `Failed to move ${item.title || 'item'} to recycling`)
                    }
                    if (Array.isArray(data?.cacheInvalidatedDomains)) {
                        invalidatedDomains.push(...data.cacheInvalidatedDomains)
                    }
                    return item.id
                })
            )

            const movedIds = results
                .filter(result => result.status === 'fulfilled')
                .map(result => result.value)
            const failedCount = results.length - movedIds.length

            if (movedIds.length > 0) {
                setContentItems(prev => prev.filter(item => !movedIds.includes(item.id)))
            }
            setSelectedItemIds(prev => prev.filter(id => !movedIds.includes(id)))

            if (failedCount > 0) {
                showNotice('error', `${movedIds.length} moved to recycling, ${failedCount} failed`)
            } else {
                showNotice('success', `${movedIds.length} ${itemLabel} moved to Recently Deleted.${formatCacheInvalidationNotice(invalidatedDomains)}`)
            }
        } catch (error) {
            showNotice('error', `Error moving selected items to recycling: ${error.message}`)
        } finally {
            setIsSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <AdminHeader title="Content" />
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="text-center text-gray-500">Loading...</div>
                </main>
            </div>
        )
    }

    if (loadError) {
        return (
            <div className="min-h-screen bg-gray-50">
                <AdminHeader title="Content" />
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                        <p className="text-red-700 font-medium mb-1">Failed to load content</p>
                        <p className="text-red-600 text-sm">{loadError}</p>
                        <button
                            onClick={() => loadContent()}
                            className="mt-4 px-4 py-2 text-sm font-medium admin-btn"
                        >
                            Retry
                        </button>
                    </div>
                </main>
            </div>
        )
    }

    if (!isAuthenticated) return null

    const relationshipCandidateRecords = []
    const modalPageBlockDomain = editingData
        ? getEffectiveItemDomain(editingData)
        : DEFAULT_CONTENT_DOMAIN
    const availablePageBlockPosts = contentItems
        .filter((item) => {
            const itemType = String(item?.type || '').trim().toLowerCase()
            return (itemType === 'post' || itemType === 'article') && getEffectiveItemDomain(item) === modalPageBlockDomain
        })
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id && item.title)
        .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))
    const postModalDomain = normalizePostModalDomain(editingData ? getEffectiveItemDomain(editingData) : activeModalTypeConfig?.domain)
    const postFieldVisibility = postModalFieldVisibility[postModalDomain] || DEFAULT_POST_MODAL_FIELD_VISIBILITY[DEFAULT_CONTENT_DOMAIN]
    // Content types owned by the active domain (private overlays add their own).
    const privateDomainContentTypes = Object.values(CONTENT_TYPE_CONFIGS)
        .filter((type) => type.domain === activeDomainMode && type.domain !== 'core')

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Content" />
            {activeModalTypeConfig && (
                <ContentModal
                    key={editingData?.id ? `content-modal-${editingData.id}` : `content-modal-new-${selectedContentTypeForCreate?.id || activeModalTypeConfig?.id || 'default'}`}
                    isOpen={modalOpen}
                    item={editingData ? { ...editingData, relationships: modalRelationships } : editingData}
                    typeConfig={activeModalTypeConfig}
                    domain={editingData ? getEffectiveItemDomain(editingData) : activeModalTypeConfig.domain}
                    allowRelationships={false}
                    isReadOnly={isReadOnly || isSystemContentRecord(editingData)}
                    onChange={handleModalChange}
                    onSave={editingItem ? saveChanges : saveNewContent}
                    onClose={closeModal}
                    onSwitchToEdit={isSystemContentRecord(editingData) ? undefined : switchModalToEdit}
                    isSaving={isSaving}
                    error={modalError}
                    allRecords={relationshipCandidateRecords}
                    availablePostItems={availablePageBlockPosts}
                    postFieldVisibility={postFieldVisibility}
                    onCreatePostForBlock={openNewPostForPageBlock}
                    onEditPostForBlock={openEditPostForPageBlock}
                />
            )}

            {/* Type Selector Modal */}
            {showTypeSelector && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-6">Choose Content Type</h2>
                        <div className={`grid ${privateDomainContentTypes.length > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-6 mb-6`}>
                            {/* Core Types - Left Column */}
                            <div>
                                <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3 pb-2 border-b border-gray-200">Practice Types</h3>
                                <div className="space-y-2">
                                    {Object.values(CONTENT_TYPE_CONFIGS)
                                        .filter(type => type.domain === 'core')
                                        .map(type => (
                                            <button
                                                key={type.id}
                                                onClick={() => openNewContentModal(type.id)}
                                                className="w-full flex items-center gap-3 p-3 border border-gray-300 rounded-xl bg-white hover:bg-gray-50 hover:border-gray-400 transition-all text-left shadow-sm"
                                            >
                                                <span className="text-2xl">{type.icon}</span>
                                                <p className="font-medium text-gray-900 text-sm">{type.label}</p>
                                            </button>
                                        ))}
                                </div>
                            </div>

                            {/* Domain-owned Types - Right Column */}
                            {privateDomainContentTypes.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-teal-600 uppercase mb-3 pb-2 border-b border-teal-200">{getDomainLabel(activeDomainMode)} Types</h3>
                                    <div className="space-y-2">
                                        {privateDomainContentTypes
                                            .map(type => (
                                                <button
                                                    key={type.id}
                                                    onClick={() => openNewContentModal(type.id)}
                                                    className="w-full flex items-center gap-3 p-3 border border-gray-300 rounded-xl bg-white hover:bg-gray-50 hover:border-gray-400 transition-all text-left shadow-sm"
                                                >
                                                    <span className="text-2xl">{type.icon}</span>
                                                    <p className="font-medium text-gray-900 text-sm">{type.label}</p>
                                                </button>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => setShowTypeSelector(false)}
                            className="w-full px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 font-medium transition-all shadow-sm"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {showFilterManager && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-5">Manage Content Filters</h2>

                        <div className="mb-5 border border-gray-200 rounded overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                <div className="col-span-5">Filter</div>
                                <div className="col-span-2 text-center">Show Filter</div>
                                <div className="col-span-2 text-center">Show Records</div>
                                <div className="col-span-3 text-right">Actions</div>
                            </div>

                            <div className="max-h-72 overflow-auto">
                                {visibleManagedTypeFilters.map(({ filter, index }) => (
                                    <div key={`${filter.id}-${index}`} className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 items-center">
                                        <div className="col-span-5 text-sm text-gray-700">
                                            <span className="mr-2">{filter.icon}</span>
                                            <span className="font-medium">{filter.label}</span>
                                        </div>

                                        <div className="col-span-2 flex justify-center">
                                            <button
                                                type="button"
                                                onClick={() => toggleTypeFilterVisibility(index)}
                                                role="switch"
                                                aria-checked={filter.showFilter !== false}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${filter.showFilter !== false ? 'bg-slate-500' : 'bg-slate-300'}`}
                                            >
                                                <span
                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${filter.showFilter !== false ? 'translate-x-6' : 'translate-x-1'}`}
                                                />
                                            </button>
                                        </div>

                                        <div className="col-span-2 flex justify-center">
                                            <button
                                                type="button"
                                                onClick={() => toggleTypeFilterRecords(index)}
                                                role="switch"
                                                aria-checked={filter.showRecords !== false}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${filter.showRecords !== false ? 'bg-slate-500' : 'bg-slate-300'}`}
                                            >
                                                <span
                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${filter.showRecords !== false ? 'translate-x-6' : 'translate-x-1'}`}
                                                />
                                            </button>
                                        </div>

                                        <div className="col-span-3 flex items-center justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => moveTypeFilter(index, -1)}
                                                disabled={index === 0}
                                                className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                            >
                                                Up
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveTypeFilter(index, 1)}
                                                disabled={index === contentTypeFilters.length - 1}
                                                className="px-2 py-1 text-xs admin-btn disabled:opacity-50"
                                            >
                                                Down
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeTypeFilter(index)}
                                                disabled={contentTypeFilters.length <= 1}
                                                className="px-2 py-1 text-xs admin-btn-danger disabled:opacity-50"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="border-t border-gray-200 pt-4">
                            <p className="text-sm font-medium text-gray-900 mb-3">Add Filter</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500">Type</label>
                                    <select
                                        value={newFilterTypeId}
                                        onChange={(e) => onNewFilterTypeChange(e.target.value)}
                                        className="admin-select w-full"
                                    >
                                        <option value="all">All Content</option>
                                        {availableFilterTypeOptions.map((type) => (
                                            <option key={type.id} value={type.id}>{type.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Label</label>
                                    <input
                                        type="text"
                                        value={newFilterLabel}
                                        onChange={(e) => setNewFilterLabel(e.target.value)}
                                        className="admin-input"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Icon</label>
                                    <input
                                        type="text"
                                        value={newFilterIcon}
                                        onChange={(e) => setNewFilterIcon(e.target.value)}
                                        className="admin-input"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={resetTypeFiltersToDefaults}
                                className="px-4 py-2 text-sm font-medium admin-btn"
                            >
                                Reset to Defaults
                            </button>
                            <button
                                type="button"
                                onClick={addTypeFilter}
                                className="px-4 py-2 text-sm font-medium admin-btn-primary"
                            >
                                Add Filter
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowFilterManager(false)}
                                className="px-4 py-2 text-sm font-medium admin-btn"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header Actions */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Content Management</h1>
                    </div>
                    <button
                        className="px-4 py-2 font-medium admin-btn-primary"
                        onClick={() => setShowTypeSelector(true)}
                    >
                        + New Content
                    </button>
                </div>

                {actionNotice && (
                    <div className={`mb-4 border rounded-md px-4 py-3 text-sm ${actionNotice.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                        }`}>
                        {actionNotice.message}
                    </div>
                )}

                {/* Content Type Filters */}
                <div className="admin-card p-4 mb-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                            {contentTypeFilters
                                .filter((type) => type.showFilter !== false && isTypeAllowedForCurrentDomain(type.id))
                                .map((type, index) => {
                                    const count = getTypeCount(type.id)
                                    return (
                                        <button
                                            key={`${type.id}-${index}`}
                                            onClick={() => handleTypeFilterChange(type.id)}
                                            className={`px-4 py-2 text-sm font-medium ${selectedType === type.id
                                                ? 'admin-btn-active'
                                                : 'admin-btn'
                                                }`}
                                        >
                                            <span className="mr-2">{type.icon}</span>
                                            {type.label}
                                            <span className="ml-2 text-xs opacity-70">({count})</span>
                                        </button>
                                    )
                                })}
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowFilterManager(true)}
                            className="px-4 py-2 text-sm font-medium admin-btn ml-auto"
                        >
                            Manage Filters
                        </button>
                    </div>
                </div>

                {/* Search and Filters Bar */}
                <div className="admin-card p-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                placeholder="Search content..."
                                value={searchQuery}
                                onFocus={() => setIsSearchInputFocused(true)}
                                onBlur={() => {
                                    if (autocompleteMouseDownRef.current) return
                                    setIsSearchInputFocused(false)
                                    setActiveAutocompleteIndex(-1)
                                }}
                                onChange={handleSearchInputChange}
                                onKeyDown={handleSearchInputKeyDown}
                                className="admin-input"
                            />

                            {showAutocomplete && (
                                <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
                                    <ul className="max-h-80 overflow-auto py-1">
                                        {autocompleteSuggestions.map((item, index) => {
                                            const display = getTypeDisplay(item.type)
                                            const title = String(item?.title || item?.name || 'Untitled Content')
                                            const isActive = index === activeAutocompleteIndex
                                            return (
                                                <li key={item.rowKey || `${item.type}-${item.id}`}>
                                                    <button
                                                        type="button"
                                                        onMouseDown={() => { autocompleteMouseDownRef.current = true }}
                                                        onMouseUp={() => {
                                                            setTimeout(() => {
                                                                autocompleteMouseDownRef.current = false
                                                            }, 0)
                                                        }}
                                                        onClick={() => handleAutocompleteSelect(item)}
                                                        className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${isActive ? 'bg-gray-50' : ''}`}
                                                    >
                                                        <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
                                                        <div className="mt-0.5 text-xs text-gray-500 flex items-center gap-1">
                                                            <span>{display.icon}</span>
                                                            <span>{display.label}</span>
                                                            <span>•</span>
                                                            <span className="capitalize">{item.status || 'draft'}</span>
                                                        </div>
                                                    </button>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Status Filter */}
                        <div className="flex gap-2">
                            {STATUS_FILTERS.map(status => (
                                <button
                                    key={status.id}
                                    onClick={() => handleStatusFilterChange(status.id)}
                                    className={`px-3 py-2 text-sm font-medium ${selectedStatus === status.id
                                        ? 'admin-btn-active'
                                        : 'admin-btn'
                                        }`}
                                >
                                    {status.label}
                                </button>
                            ))}
                        </div>

                        {/* Sort */}
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="admin-select"
                        >
                            <option value="updated">Last Updated</option>
                            <option value="created">Date Created</option>
                            <option value="title">Title A-Z</option>
                        </select>
                    </div>

                    {selectedType === 'image' && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <div className="flex flex-wrap gap-2">
                                {IMAGE_CATEGORY_FILTERS.map(category => (
                                    <button
                                        key={category.id}
                                        onClick={() => handleImageCategoryFilterChange(category.id)}
                                        className={`px-3 py-2 text-sm font-medium ${selectedImageCategory === category.id
                                            ? 'admin-btn-active'
                                            : 'admin-btn'
                                            }`}
                                    >
                                        {category.label}
                                        <span className="ml-2 text-xs opacity-70">({getImageCategoryCount(category.id)})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {selectedType === 'post' && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            {shouldShowPostDomainFilter && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {visiblePostDomainFilters.map(domainFilter => (
                                        <button
                                            key={domainFilter.id}
                                            onClick={() => handlePostDomainFilterChange(domainFilter.id)}
                                            className={`px-3 py-2 text-sm font-medium ${selectedPostDomain === domainFilter.id
                                                ? 'admin-btn-active'
                                                : 'admin-btn'
                                                }`}
                                        >
                                            {domainFilter.label}
                                            <span className="ml-2 text-xs opacity-70">({getPostDomainCount(domainFilter.id)})</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {POST_CATEGORY_FILTERS.map(category => (
                                    <button
                                        key={category.id}
                                        onClick={() => handlePostCategoryFilterChange(category.id)}
                                        className={`px-3 py-2 text-sm font-medium ${selectedPostCategory === category.id
                                            ? 'admin-btn-active'
                                            : 'admin-btn'
                                            }`}
                                    >
                                        {category.label}
                                        <span className="ml-2 text-xs opacity-70">({getPostCategoryCount(category.id)})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                </div>

                {selectedItemIds.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-gray-700">
                            <span className="font-medium">{selectedItemIds.length}</span> selected
                            <span className="text-gray-500"> ({selectedVisibleIds.length} in current view)</span>
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={toggleSelectAllVisible}
                                className="px-3 py-2 text-sm font-medium admin-btn"
                            >
                                {allVisibleSelected ? 'Unselect Filtered' : 'Select All Filtered'}
                            </button>
                            <button
                                onClick={clearSelection}
                                className="px-3 py-2 text-sm font-medium admin-btn"
                            >
                                Clear
                            </button>
                            <button
                                onClick={deleteSelectedItems}
                                disabled={isSaving}
                                className="px-3 py-2 text-sm font-medium admin-btn-danger disabled:opacity-60"
                            >
                                {isSaving ? 'Deleting...' : 'Delete Selected'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Content List */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    {filteredContent.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            <div className="text-4xl mb-4">📭</div>
                            <p className="text-lg font-medium mb-2">No content found</p>
                            {contentItems.length > 0
                                ? <p className="text-sm">{contentItems.length} record{contentItems.length !== 1 ? 's' : ''} loaded but none match the current filters or domain</p>
                                : <p className="text-sm">Try adjusting your filters or create new content</p>
                            }
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-200">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <div className="col-span-1 flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={allVisibleSelected}
                                        onChange={toggleSelectAllVisible}
                                        aria-label="Select all filtered items"
                                        className="h-4 w-4 border border-gray-300 rounded"
                                    />
                                </div>
                                <div className="col-span-4">Title</div>
                                <div className="col-span-2">Type</div>
                                <div className="col-span-2">Status</div>
                                <div className="col-span-2">Updated</div>
                                <div className="col-span-1 text-right">Actions</div>
                            </div>

                            {/* Content Rows */}
                            {filteredContent.map(item => (
                                <ContentRow
                                    key={item.rowKey || `${item.type}-${item.id}`}
                                    item={item}
                                    activeDomainMode={activeDomainMode}
                                    selectedOpenAiModel={selectedOpenAiModel}
                                    showImageMetadata={selectedType === 'image'}
                                    onEdit={openEditModal}
                                    onView={openEditModal}
                                    onDuplicate={duplicateItem}
                                    onDelete={deleteItem}
                                    isSaving={isSaving}
                                    isSelected={selectedItemIds.includes(item.id)}
                                    onToggleSelect={toggleSelectItem}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Results Count */}
                {filteredContent.length > 0 && (
                    <div className="mt-4 text-sm text-gray-600 text-center">
                        Showing {filteredContent.length} of {contentItems.length} items
                    </div>
                )}
            </main>
        </div>
    )
}

// ContentModal for edit/view

function ContentRow({ item, activeDomainMode, selectedOpenAiModel, showImageMetadata, onEdit, onView, onDuplicate, onDelete, isSaving, isSelected, onToggleSelect }) {
    const [showActions, setShowActions] = useState(false)
    const [thumbError, setThumbError] = useState(false)
    const actionsMenuRef = useRef(null)
    const isSystemRecord = isSystemContentRecord(item)
    const showImageThumbnail = item.type === 'image'
    const rowActionButton = 'h-9 w-9 inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-400 hover:text-gray-800 active:scale-[0.98]'

    const getStatusColor = (status) => {
        switch (status) {
            case 'published': return 'bg-green-100 text-green-800'
            case 'draft': return 'bg-yellow-100 text-yellow-800'
            case 'archived': return 'bg-gray-100 text-gray-800'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    const getTypeIcon = (type) => {
        switch (type) {
            case 'production': return '🎬'
            case 'actor': return '👤'
            case 'company': return '🏢'
            case 'location': return '📍'
            case 'post': return '📝'
            case 'page': return '📄'
            case 'image': return '🖼️'
            case 'video': return '🎥'
            case 'document': return '📄'
            default: return '📋'
        }
    }

    const getTypeLabel = (type) => {
        if (type === 'post') return 'post'
        return type
    }

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A'
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now - date
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays < 7) return `${diffDays}d ago`
        return date.toLocaleDateString()
    }

    const provenanceBadges = (item.type === 'production' || item.type === 'post' || item.type === 'location')
        ? getContentProvenanceBadges(item, selectedOpenAiModel)
        : []
    const imageSourceLabel = item.type === 'image' ? detectImageSourceLabel(item) : null
    const showCuratedImageTag = isHumanCuratedImage(item)

    const formatFieldLabel = (key) => String(key || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())

    const getContentFieldSnippets = () => {
        const typeConfig = CONTENT_TYPE_CONFIGS[item.type]
        if (!typeConfig) return []
        if (!isTypeAllowedForDomainMode(item.type, activeDomainMode)) return []

        const attributes = item?.attributes || {}
        const location = attributes?.location || {}

        return (typeConfig.attributes || [])
            .map((key) => {
                const rawValue = (key === 'borough' || key === 'neighborhood' || key === 'area')
                    ? (location?.[key] ?? attributes?.[key])
                    : attributes?.[key]

                if (rawValue === null || rawValue === undefined || rawValue === '') return null
                if (Array.isArray(rawValue) && rawValue.length === 0) return null

                const value = Array.isArray(rawValue)
                    ? rawValue.filter(Boolean).slice(0, 3).join(', ')
                    : String(rawValue)

                if (!value) return null
                return `${formatFieldLabel(key)}: ${value}`
            })
            .filter(Boolean)
            .slice(0, 3)
    }

    const contentFieldSnippets = getContentFieldSnippets()

    useEffect(() => {
        if (!showActions) return

        const handleOutsideClick = (event) => {
            if (!actionsMenuRef.current) return
            if (!actionsMenuRef.current.contains(event.target)) {
                setShowActions(false)
            }
        }

        document.addEventListener('mousedown', handleOutsideClick)
        document.addEventListener('touchstart', handleOutsideClick)

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick)
            document.removeEventListener('touchstart', handleOutsideClick)
        }
    }, [showActions])

    const openReadModal = () => {
        onView(item)
    }

    return (
        <div
            className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-gray-50 transition-colors items-center cursor-pointer"
            onClick={openReadModal}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openReadModal()
                }
            }}
            role="button"
            tabIndex={0}
            aria-label={`View ${item.title || 'content item'}`}
        >
            <div className="col-span-1 flex items-start pt-1">
                <input
                    type="checkbox"
                    checked={Boolean(isSelected)}
                    onChange={() => onToggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${item.title || 'content item'}`}
                    className="h-4 w-4 border border-gray-300 rounded"
                />
            </div>

            {/* Title */}
            <div className="col-span-4">
                <div className="flex items-start gap-3 min-w-0">
                    {showImageThumbnail && item.metadata?.source_url && !thumbError && (
                        <div className="w-14 h-14 rounded border border-gray-200 bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                            <Image
                                src={item.metadata.source_url}
                                alt={item.title || 'Image thumbnail'}
                                unoptimized
                                width={56}
                                height={56}
                                className="w-full h-full object-contain"
                                onError={() => setThumbError(true)}
                            />
                        </div>
                    )}
                    <div className="min-w-0">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                onView(item)
                            }}
                            className="font-medium text-gray-900 truncate text-left hover:text-gray-700 hover:underline underline-offset-2 transition-colors"
                            title={`View ${item.title || 'content item'}`}
                        >
                            {item.title}
                        </button>
                        {item.preview && (
                            <p className="text-sm text-gray-500 mt-1 whitespace-pre-line line-clamp-3">{item.preview}</p>
                        )}
                        {contentFieldSnippets.length > 0 && (
                            <p className="text-xs text-gray-500 mt-2">{contentFieldSnippets.join(' • ')}</p>
                        )}
                        {((item.type === 'production' || item.type === 'post' || item.type === 'location') && provenanceBadges.length > 0) || (CONTENT_TYPE_CONFIGS[item.type]?.domain && CONTENT_TYPE_CONFIGS[item.type]?.domain !== 'core') || isSystemRecord ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {CONTENT_TYPE_CONFIGS[item.type]?.domain && CONTENT_TYPE_CONFIGS[item.type]?.domain !== 'core' && (
                                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border-blue-200">
                                        {getDomainLabel(CONTENT_TYPE_CONFIGS[item.type]?.domain)}
                                    </span>
                                )}
                                {(item.type === 'production' || item.type === 'post' || item.type === 'location') && provenanceBadges.map((badge) => (
                                    <span
                                        key={badge.id}
                                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                                    >
                                        {badge.label}
                                    </span>
                                ))}
                                {isSystemRecord && (
                                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border-slate-300">
                                        System
                                    </span>
                                )}
                            </div>
                        ) : null}
                        {item.type === 'image' && (showCuratedImageTag || imageSourceLabel) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {showCuratedImageTag && (
                                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                                        Curated
                                    </span>
                                )}
                                {imageSourceLabel && (
                                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium bg-sky-50 text-sky-700 border-sky-200">
                                        {imageSourceLabel}
                                    </span>
                                )}
                            </div>
                        )}
                        {item.type === 'production' && (
                            <div className="text-xs text-gray-500 mt-2">
                                {item?.metadata?.fallback_flow_used !== true && (item?.attributes?.permit_event_id || item?.metadata?.permit_reference?.event_id)
                                    ? `Permit ID: ${item?.attributes?.permit_event_id || item?.metadata?.permit_reference?.event_id}`
                                    : 'Permit ID: Not captured'}
                            </div>
                        )}
                        {showImageMetadata && item.type === 'image' && item.metadata && (
                            <div className="text-xs text-gray-500 mt-2 space-y-1">
                                {item.metadata.category && <p>Category: {item.metadata.category}</p>}
                                {item.metadata.search_phrase && <p>Search: {item.metadata.search_phrase}</p>}
                                {item.metadata.source && <p>Source: {item.metadata.source}</p>}
                                {item.metadata.source_url && (
                                    <p className="truncate" title={item.metadata.source_url}>URL: {item.metadata.source_url}</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Type */}
            <div className="col-span-2">
                <span className="inline-flex items-center text-sm text-gray-700">
                    <span className="mr-2">{getTypeIcon(item.type)}</span>
                    {getTypeLabel(item.type)}
                </span>
            </div>

            {/* Status */}
            <div className="col-span-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                    {item.status}
                </span>
            </div>

            {/* Updated */}
            <div className="col-span-2 text-sm text-gray-600">
                {formatDate(item.updated_at || item.created_at)}
            </div>

            {/* Actions */}
            <div ref={actionsMenuRef} className="col-span-1 text-right relative">
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        setShowActions(!showActions)
                    }}
                    className={rowActionButton}
                >
                    <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                </button>

                {/* Dropdown Menu */}
                {showActions && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                        <div className="py-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onView(item)
                                    setShowActions(false)
                                }}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                                View / Edit
                            </button>
                            {!isSystemRecord && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDuplicate(item)
                                        setShowActions(false)
                                    }}
                                    disabled={isSaving}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                                >
                                    Duplicate
                                </button>
                            )}
                            {isSystemRecord ? (
                                <p className="px-4 py-2 text-xs text-gray-500">System record (read-only)</p>
                            ) : (
                                <>
                                    <div className="border-t border-gray-200 my-1"></div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onDelete(item)
                                            setShowActions(false)
                                        }}
                                        disabled={isSaving}
                                        className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                                    >
                                        Delete
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
