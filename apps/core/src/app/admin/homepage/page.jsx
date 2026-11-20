'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toPng } from 'html-to-image'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import PageBlocksEditor from '@/admin-ui/components/PageBlocksEditor'
import PageContentArticle from '@/components/PageContentArticle'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { BG_GRADIENT_PRESETS, DEFAULT_BG_GRADIENT_TREATMENT, getDomainPageStyles, getDomainTemplateColors, withAlpha } from '@/lib/domainPageStyles'
import { attachResolvedSinglePostBlocks, toPageBlockPostOption } from '@/lib/pageBlockPosts'
import { normalizePageBlocks } from '@/lib/pageBlocks'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'
import {
    normalizeLatestPostsLayout,
    resolveLatestPostItems
} from '@/lib/latestPosts'
import {
    getSiteTitleFromTemplate,
    shouldShowSiteTitleOnPublicSite
} from '@/lib/siteTitle'
import { getEffectiveAdminDomainModeFromStorage } from '@/lib/adminActiveDomain'
import { DEFAULT_CONTENT_DOMAIN, DEFAULT_DOMAIN_MODE, getDomainLabel } from '@/lib/domainMode'
import { getHomepageHeroSettingsEndpoint, getPrivateHomepageDefaultPalettes, getPrivateHomepageScopes } from '@/lib/domainExtension'

const DEFAULT_LATEST_POSTS_ORDER_MODE = 'newest'
// Domain the homepage editor opens on when the admin session resolves to the
// platform default. `resolveHomepageScope` still buckets it to the shared
// homepage scope that stores the home-page system node.
const DEFAULT_HOME_DOMAIN = DEFAULT_DOMAIN_MODE
const HOMEPAGE_SCOPES = [...new Set([DEFAULT_CONTENT_DOMAIN, ...getPrivateHomepageScopes()])]
const HERO_SCREENSHOT_VIEWPORT_WIDTH = 880
const HERO_SCREENSHOT_VIEWPORT_HEIGHT = 640
const DESIGNER_MINI_PREVIEW_SCALE = 0.2
const DESIGNER_MINI_PREVIEW_WIDTH = 1200
const DESIGNER_MINI_PREVIEW_HEIGHT = 2400
const DESIGNER_PRESET_PALETTES = [
    {
        key: 'sunrise-editorial',
        label: 'Sunrise Editorial',
        description: 'Warm highlights with cool supporting tones.',
        colors: {
            color1: '#f59e0b',
            color2: '#0284c7',
            color3: '#0f172a',
            backgroundColor: '#f8fafc',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',
            infoColor: '#0284c7'
        }
    },
    {
        key: 'forest-journal',
        label: 'Forest Journal',
        description: 'Organic greens balanced by a deep slate contrast.',
        colors: {
            color1: '#84cc16',
            color2: '#166534',
            color3: '#1f2937',
            backgroundColor: '#f6f9f4',
            successColor: '#22c55e',
            warningColor: '#ea580c',
            errorColor: '#dc2626',
            infoColor: '#0369a1'
        }
    },
    {
        key: 'coral-studio',
        label: 'Coral Studio',
        description: 'Vibrant coral accents with rich ocean depth.',
        colors: {
            color1: '#fb7185',
            color2: '#0ea5e9',
            color3: '#1e3a8a',
            backgroundColor: '#fff7f5',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#f43f5e',
            infoColor: '#0284c7'
        }
    },
    {
        key: 'midnight-signal',
        label: 'Midnight Signal',
        description: 'High-contrast dark palette with vivid electric accents.',
        colors: {
            color1: '#facc15',
            color2: '#7c3aed',
            color3: '#020617',
            backgroundColor: '#e2e8f0',
            successColor: '#4ade80',
            warningColor: '#fbbf24',
            errorColor: '#f87171',
            infoColor: '#818cf8'
        }
    },
    {
        key: 'ocean-depth',
        label: 'Ocean Depth',
        description: 'Cool blues and teals for professional, calm aesthetics.',
        colors: {
            color1: '#06b6d4',
            color2: '#0369a1',
            color3: '#164e63',
            backgroundColor: '#f0f9ff',
            successColor: '#06b6d4',
            warningColor: '#f59e0b',
            errorColor: '#dc2626',
            infoColor: '#0284c7'
        }
    },
    {
        key: 'sunset-glow',
        label: 'Sunset Glow',
        description: 'Warm oranges and reds with golden highlights.',
        colors: {
            color1: '#f97316',
            color2: '#dc2626',
            color3: '#7c2d12',
            backgroundColor: '#fffbeb',
            successColor: '#22c55e',
            warningColor: '#f97316',
            errorColor: '#dc2626',
            infoColor: '#3b82f6'
        }
    },
    {
        key: 'professional-steel',
        label: 'Professional Steel',
        description: 'Clean grays and steel blues for corporate elegance.',
        colors: {
            color1: '#475569',
            color2: '#1e293b',
            color3: '#0f172a',
            backgroundColor: '#f8fafc',
            successColor: '#059669',
            warningColor: '#d97706',
            errorColor: '#dc2626',
            infoColor: '#2563eb'
        }
    },
    {
        key: 'vibrant-purple',
        label: 'Vibrant Purple',
        description: 'Bold purples with electric pink accents.',
        colors: {
            color1: '#a855f7',
            color2: '#ec4899',
            color3: '#581c87',
            backgroundColor: '#faf5ff',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#f43f5e',
            infoColor: '#a855f7'
        }
    },
    {
        key: 'emerald-luxury',
        label: 'Emerald Luxury',
        description: 'Rich emeralds paired with warm gold accents.',
        colors: {
            color1: '#10b981',
            color2: '#047857',
            color3: '#064e3b',
            backgroundColor: '#f0fdf4',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',
            infoColor: '#0ea5e9'
        }
    },
    {
        key: 'charcoal-modern',
        label: 'Charcoal Modern',
        description: 'Dark sophisticated palette with neon accents.',
        colors: {
            color1: '#67e8f9',
            color2: '#c4b5fd',
            color3: '#e2e8f0',
            backgroundColor: '#0b1220',
            successColor: '#86efac',
            warningColor: '#fde68a',
            errorColor: '#fca5a5',
            infoColor: '#93c5fd'
        }
    },
    {
        key: 'rose-garden',
        label: 'Rose Garden',
        description: 'Soft pinks and roses with cool slate accents.',
        colors: {
            color1: '#f472b6',
            color2: '#db2777',
            color3: '#831843',
            backgroundColor: '#fdf2f8',
            successColor: '#34d399',
            warningColor: '#fbbf24',
            errorColor: '#f472b6',
            infoColor: '#60a5fa'
        }
    },
    {
        key: 'electric-thunder',
        label: 'Electric Thunder',
        description: 'High-energy neon with intense contrast.',
        colors: {
            color1: '#00ff00',
            color2: '#ff00ff',
            color3: '#000000',
            backgroundColor: '#f5f5f5',
            successColor: '#00ff00',
            warningColor: '#ffff00',
            errorColor: '#ff0000',
            infoColor: '#00ffff'
        }
    },
    {
        key: 'vintage-archive',
        label: 'Vintage Archive',
        description: 'Muted earth tones and warm neutrals.',
        colors: {
            color1: '#c2410c',
            color2: '#92400e',
            color3: '#5a3a1a',
            backgroundColor: '#faf5f0',
            successColor: '#7c2d12',
            warningColor: '#c2410c',
            errorColor: '#b91c1c',
            infoColor: '#92400e'
        }
    },
    {
        key: 'indigo-dreams',
        label: 'Indigo Dreams',
        description: 'Deep indigos with silver-blue highlights.',
        colors: {
            color1: '#4f46e5',
            color2: '#3730a3',
            color3: '#1e1b4b',
            backgroundColor: '#f5f3ff',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',
            infoColor: '#4f46e5'
        }
    },
    {
        key: 'solar-flare',
        label: 'Solar Flare',
        description: 'Brilliant yellows and reds for maximum impact.',
        colors: {
            color1: '#eab308',
            color2: '#dc2626',
            color3: '#78350f',
            backgroundColor: '#fffbeb',
            successColor: '#16a34a',
            warningColor: '#eab308',
            errorColor: '#dc2626',
            infoColor: '#3b82f6'
        }
    },
    {
        key: 'arctic-frost',
        label: 'Arctic Frost',
        description: 'Crisp whites and icy blues with a cool, minimal edge.',
        colors: {
            color1: '#38bdf8',
            color2: '#0369a1',
            color3: '#0c4a6e',
            backgroundColor: '#f0f9ff',
            successColor: '#22d3ee',
            warningColor: '#f59e0b',
            errorColor: '#f43f5e',
            infoColor: '#38bdf8'
        }
    }
]

const MENU_BLOCK_TYPE_LABELS = {
    single_post: 'Single Post',
    three_panel: 'Three Panel Feature',
    faq: 'FAQ',
    hero: 'Hero',
    cards: 'Cards Grid',
    testimonials: 'Testimonials',
    stats: 'Stats',
    logo_marquee: 'Logo Marquee',
    feature_comparison: 'Feature Comparison',
    steps: 'Steps',
    pricing: 'Pricing',
    bio_profile: 'Bio / Profile',
    icon_cards: 'Icon Cards',
    proof_points: 'Proof Points'
}
const DESIGNER_DEFAULT_PALETTE_BY_SCOPE = {
    ...getPrivateHomepageDefaultPalettes(),
    [DEFAULT_CONTENT_DOMAIN]: 'sunrise-editorial'
}

function getDesignerDefaultPaletteKey(scope) {
    const normalizedScope = String(scope || '').trim().toLowerCase()
    const configuredKey = DESIGNER_DEFAULT_PALETTE_BY_SCOPE[normalizedScope]
    if (configuredKey && DESIGNER_PRESET_PALETTES.some((palette) => palette.key === configuredKey)) {
        return configuredKey
    }
    return DESIGNER_PRESET_PALETTES[0]?.key || ''
}

function getDefaultTemplateColorsForScope(scope) {
    const defaultPaletteKey = getDesignerDefaultPaletteKey(scope)
    const defaultPalette = DESIGNER_PRESET_PALETTES.find((palette) => palette.key === defaultPaletteKey)
    if (!defaultPalette?.colors) {
        return getDomainTemplateColors({}, scope)
    }
    return getDomainTemplateColors({ colors: defaultPalette.colors }, scope)
}

function resolveHomepageScope(domainMode) {
    return getPrivateHomepageScopes().includes(domainMode) ? domainMode : DEFAULT_CONTENT_DOMAIN
}

function getHeroBannerSettingsEndpoint(scope) {
    return getHomepageHeroSettingsEndpoint('banner', scope)
}

function getHeroThumbnailSettingsEndpoint(scope) {
    return getHomepageHeroSettingsEndpoint('thumbnail', scope)
}

const HOME_TEMPLATE_SECTION_DEFINITIONS = [
    {
        key: 'hero',
        label: '',
        description: '',
        scopes: HOMEPAGE_SCOPES,
        supportsLimit: false,
        supportsHeading: true,
        supportsSubheading: true,
        supportsLabel: true,
        defaultEnabled: true
    },
    {
        key: 'contact_cta_top',
        label: 'Contact CTA (Top)',
        description: 'Optional call-to-action row shown below the Hero and above Page Blocks.',
        scopes: HOMEPAGE_SCOPES,
        defaultEnabled: true
    },
    {
        key: 'contact_cta_bottom',
        label: 'Contact CTA (Bottom)',
        description: 'Optional call-to-action row shown below Page Blocks and above the menu footer area.',
        scopes: HOMEPAGE_SCOPES,
        defaultEnabled: true
    }
]

function normalizePublicAssetUrl(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
    return raw.startsWith('/') ? raw : `/${raw}`
}

function isLocalOrDataAsset(value) {
    const src = String(value || '').trim().toLowerCase()
    if (!src) return false
    if (src.startsWith('data:')) return true
    if (src.startsWith('/')) return true
    if (src.startsWith('http://localhost') || src.startsWith('https://localhost')) return true
    if (src.startsWith('http://127.0.0.1') || src.startsWith('https://127.0.0.1')) return true
    return false
}

function sectionSupportsScope(definition, scope) {
    const normalizedScope = String(scope || '').trim().toLowerCase()
    if (!normalizedScope) return true

    const scopes = Array.isArray(definition?.scopes)
        ? definition.scopes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : []

    if (scopes.length === 0) return true
    return scopes.includes(normalizedScope)
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

function migrateLegacyContactBlockIntoSection(templateSections, homePageBlocks) {
    const normalizedSections = Array.isArray(templateSections) ? templateSections : []
    const normalizedBlocks = Array.isArray(homePageBlocks) ? homePageBlocks : []
    const legacyContactBlock = normalizedBlocks.find((block) => String(block?.type || '').trim().toLowerCase() === 'contact') || null
    const legacyContactSection = normalizedSections.find((section) => String(section?.key || '').trim().toLowerCase() === 'contact_cta') || null

    if (!legacyContactBlock && !legacyContactSection) {
        return {
            migrated: false,
            sections: normalizedSections,
            blocks: normalizedBlocks
        }
    }

    const migratedSections = normalizedSections.map((section) => {
        const sectionKey = String(section?.key || '').trim().toLowerCase()
        if (sectionKey !== 'contact_cta_top' && sectionKey !== 'contact_cta_bottom') return section

        const existingPrimaryText = String(section?.ctaText || '').trim()
        const existingPrimaryHref = String(section?.ctaHref || '').trim()
        const existingSecondaryText = String(section?.secondaryCtaText || '').trim()
        const existingSecondaryHref = String(section?.secondaryCtaHref || '').trim()
        const existingLinkedIn = String(section?.linkedinUsername || '').trim()
        const existingTitle = String(section?.title || section?.label || '').trim()
        const existingHeading = String(section?.heading || '').trim()
        const existingDescription = String(section?.description || section?.subheading || '').trim()

        const legacyPrimaryText = String(legacyContactSection?.ctaText || legacyContactSection?.text || '').trim()
        const legacyPrimaryHref = String(legacyContactSection?.ctaHref || legacyContactSection?.href || '').trim()
        const legacySecondaryText = String(legacyContactSection?.secondaryCtaText || legacyContactSection?.secondaryText || legacyContactSection?.altCtaText || '').trim()
        const legacySecondaryHref = String(legacyContactSection?.secondaryCtaHref || legacyContactSection?.secondaryHref || legacyContactSection?.altCtaHref || '').trim()
        const legacyLinkedIn = String(legacyContactSection?.linkedinUsername || legacyContactSection?.linkedinUser || '').trim()

        const migratedSection = {
            ...section,
            enabled: typeof section?.enabled === 'boolean' ? section.enabled : true,
            ctaText: existingPrimaryText || legacyPrimaryText || String(legacyContactBlock?.ctaText || legacyContactBlock?.text || '').trim(),
            ctaHref: existingPrimaryHref || legacyPrimaryHref || String(legacyContactBlock?.ctaHref || legacyContactBlock?.href || '').trim(),
            secondaryCtaText: existingSecondaryText || legacySecondaryText || String(legacyContactBlock?.secondaryCtaText || '').trim(),
            secondaryCtaHref: existingSecondaryHref || legacySecondaryHref || String(legacyContactBlock?.secondaryCtaHref || '').trim(),
            linkedinUsername: existingLinkedIn || legacyLinkedIn || String(legacyContactBlock?.linkedinUsername || legacyContactBlock?.linkedinUser || '').trim()
        }

        if (sectionKey === 'contact_cta_bottom') {
            migratedSection.title = existingTitle || String(legacyContactBlock?.title || legacyContactBlock?.label || '').trim()
            migratedSection.heading = existingHeading || String(legacyContactBlock?.heading || '').trim()
            migratedSection.description = existingDescription || String(legacyContactBlock?.description || legacyContactBlock?.subheading || '').trim()
        }

        return migratedSection
    })

    return {
        migrated: true,
        sections: migratedSections,
        blocks: normalizedBlocks.filter((block) => String(block?.type || '').trim().toLowerCase() !== 'contact')
    }
}

function getContentItemTitle(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)
    return String(
        metadata?.presentation?.default?.title ||
        item?.title ||
        item?.name ||
        metadata?.slug ||
        item?.slug ||
        ''
    ).trim()
}

function normalizeSectionLimit(value, fallback, min = 1, max = 24) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const rounded = Math.floor(parsed)
    if (rounded < min) return min
    if (rounded > max) return max
    return rounded
}

function slugifyTitle(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

function buildEditableTemplateSections(template, scope = resolveHomepageScope(DEFAULT_HOME_DOMAIN)) {
    const rawSections = Array.isArray(template?.sections) ? template.sections : []
    const byKey = rawSections.reduce((acc, section) => {
        const key = String(section?.key || '').trim().toLowerCase()
        if (!key) return acc
        acc[key] = section
        return acc
    }, {})

    return HOME_TEMPLATE_SECTION_DEFINITIONS
        .filter((definition) => sectionSupportsScope(definition, scope))
        .map((definition) => {
            const existing = byKey[definition.key] || {}
            const isContactCtaSection = definition.key === 'contact_cta_top' || definition.key === 'contact_cta_bottom'
            const legacyContactSection = byKey.contact_cta || {}
            const contactSection = isContactCtaSection
                ? (Object.keys(existing).length > 0 ? existing : legacyContactSection)
                : existing
            return {
                key: definition.key,
                enabled: isContactCtaSection
                    ? (typeof contactSection.enabled === 'boolean' ? contactSection.enabled : definition.defaultEnabled)
                    : (typeof existing.enabled === 'boolean' ? existing.enabled : definition.defaultEnabled),
                limit: definition.supportsLimit
                    ? normalizeSectionLimit(existing.limit, definition.defaultLimit, definition.minLimit, definition.maxLimit)
                    : null,
                orderMode: definition.key === 'latest_posts'
                    ? String(existing.orderMode || DEFAULT_LATEST_POSTS_ORDER_MODE).trim().toLowerCase() || DEFAULT_LATEST_POSTS_ORDER_MODE
                    : DEFAULT_LATEST_POSTS_ORDER_MODE,
                postIds: definition.key === 'latest_posts' && Array.isArray(existing.postIds)
                    ? existing.postIds.map((id) => String(id || '').trim()).filter(Boolean)
                    : [],
                postSlugs: definition.key === 'latest_posts' && Array.isArray(existing.postSlugs)
                    ? existing.postSlugs.map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean)
                    : [],
                label: definition.supportsLabel ? String(existing.label || '') : '',
                homePostLabel: definition.key === 'hero' ? String(existing.homePostLabel || '') : '',
                homeProductionLabel: definition.key === 'hero' ? String(existing.homeProductionLabel || '') : '',
                logoImage: definition.key === 'hero' ? normalizePublicAssetUrl(existing.logoImage) : '',
                ctaText: isContactCtaSection ? String(contactSection.ctaText || contactSection.text || '') : '',
                ctaHref: isContactCtaSection ? String(contactSection.ctaHref || contactSection.href || '') : '',
                secondaryCtaText: isContactCtaSection ? String(contactSection.secondaryCtaText || contactSection.secondaryText || contactSection.altCtaText || '') : '',
                secondaryCtaHref: isContactCtaSection ? String(contactSection.secondaryCtaHref || contactSection.secondaryHref || contactSection.altCtaHref || '') : '',
                linkedinUsername: isContactCtaSection ? String(contactSection.linkedinUsername || contactSection.linkedinUser || '') : '',
                title: definition.key === 'contact_cta_bottom' ? String(contactSection.title || contactSection.label || '') : '',
                heading: definition.supportsHeading
                    ? String(existing.heading || '')
                    : (definition.key === 'contact_cta_bottom' ? String(contactSection.heading || '') : ''),
                description: definition.key === 'contact_cta_bottom' ? String(contactSection.description || contactSection.subheading || '') : '',
                subheading: definition.supportsSubheading ? String(existing.subheading || '') : '',
                postId: definition.key === 'hero' ? String(existing.postId || existing.selectedPostId || '') : '',
                postSlug: definition.key === 'hero' ? String(existing.postSlug || existing.selectedPostSlug || '') : '',
                postType: definition.key === 'hero' ? String(existing.postType || existing.selectedPostType || '') : ''
            }
        })
}

export default function PracticeHomePage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeTab, setActiveTab] = useState('content')
    const [activeDomainMode, setActiveDomainMode] = useState(DEFAULT_HOME_DOMAIN)
    const [loading, setLoading] = useState(true)
    const [loadingHomeTemplate, setLoadingHomeTemplate] = useState(false)
    const [savingTemplateSettings, setSavingTemplateSettings] = useState(false)
    const [savingHomePageBlocks, setSavingHomePageBlocks] = useState(false)
    const [savingPracticeMenu, setSavingPracticeMenu] = useState(false)
    const [homeTemplateError, setHomeTemplateError] = useState('')
    const [homeTemplateNotice, setHomeTemplateNotice] = useState('')
    const [homePageSystemNodeId, setHomePageSystemNodeId] = useState(null)
    const [homeTemplateBase, setHomeTemplateBase] = useState({})
    const [homeTemplateColors, setHomeTemplateColors] = useState(() => getDefaultTemplateColorsForScope(resolveHomepageScope(DEFAULT_HOME_DOMAIN)))
    const [bgGradientTreatment, setBgGradientTreatment] = useState(DEFAULT_BG_GRADIENT_TREATMENT)
    const [scrollReveal, setScrollReveal] = useState(true)
    const [showSemanticColors, setShowSemanticColors] = useState(false)
    const [homeTemplateSections, setHomeTemplateSections] = useState(() => buildEditableTemplateSections({}, resolveHomepageScope(DEFAULT_HOME_DOMAIN)))
    const [designerMiniPreviewScale, setDesignerMiniPreviewScale] = useState(DESIGNER_MINI_PREVIEW_SCALE)
    const [homePageBlocks, setHomePageBlocks] = useState([])
    const [availablePracticePosts, setAvailablePracticePosts] = useState([])
    const [heroBannerUrl, setHeroBannerUrl] = useState('')
    const [heroBannerGradientEnabled, setHeroBannerGradientEnabled] = useState(true)
    const [heroThumbnailPath, setHeroThumbnailPath] = useState('')
    const [heroThumbnailUrl, setHeroThumbnailUrl] = useState('')
    const [heroThumbnailUpdatedAt, setHeroThumbnailUpdatedAt] = useState('')
    const [savingHeroThumbnail, setSavingHeroThumbnail] = useState(false)
    const [availablePracticePages, setAvailablePracticePages] = useState([])
    const [availableContentBlocks, setAvailableContentBlocks] = useState([])
    const [selectedMenuPageIds, setSelectedMenuPageIds] = useState([])
    const [selectedMenuBlockIds, setSelectedMenuBlockIds] = useState([])
    const [practiceMenuModalOpen, setPracticeMenuModalOpen] = useState(false)
    const [siteTitle, setSiteTitle] = useState('')
    const [showSiteTitleOnPublicSite, setShowSiteTitleOnPublicSite] = useState(true)
    const [newPostModalOpen, setNewPostModalOpen] = useState(false)
    const [contactCtaTopModalOpen, setContactCtaTopModalOpen] = useState(false)
    const [newPostSaving, setNewPostSaving] = useState(false)
    const [newPostError, setNewPostError] = useState('')
    const [newPostSlugEdited, setNewPostSlugEdited] = useState(false)
    const [newPostMode, setNewPostMode] = useState('create')
    const [editingSinglePostId, setEditingSinglePostId] = useState('')
    const [heroWorkspaceOpen, setHeroWorkspaceOpen] = useState(false)
    const [heroWorkspaceDirty, setHeroWorkspaceDirty] = useState(false)
    const [pendingSinglePostBlockId, setPendingSinglePostBlockId] = useState('')
    const [newPostDraft, setNewPostDraft] = useState({
        eyebrow: '',
        title: '',
        heading: '',
        slug: '',
        summary: '',
        status: 'draft'
    })
    const designerMiniPreviewHostRef = useRef(null)
    const heroScreenshotCaptureRef = useRef(null)
    const homeTemplateLoadRequestRef = useRef(0)
    const router = useRouter()
    const activeHomeScope = useMemo(() => resolveHomepageScope(activeDomainMode), [activeDomainMode])
    const activeHomeLabel = useMemo(
        () => getDomainLabel(activeHomeScope),
        [activeHomeScope]
    )
    const isPrivateHomepageScope = getPrivateHomepageScopes().includes(activeHomeScope)
    const isContentTab = activeTab === 'content'
    const isDesignerTab = activeTab === 'designer'
    const heroBannerSettingsEndpoint = useMemo(
        () => getHeroBannerSettingsEndpoint(activeHomeScope),
        [activeHomeScope]
    )
    const heroThumbnailSettingsEndpoint = useMemo(
        () => getHeroThumbnailSettingsEndpoint(activeHomeScope),
        [activeHomeScope]
    )
    const heroSection = useMemo(
        () => homeTemplateSections.find((section) => section.key === 'hero') || null,
        [homeTemplateSections]
    )
    const latestPostsSection = useMemo(
        () => homeTemplateSections.find((section) => section.key === 'latest_posts') || null,
        [homeTemplateSections]
    )
    const selectedHeroPost = useMemo(() => {
        const heroPostId = String(heroSection?.postId || '').trim()
        if (!heroPostId) return null
        return availablePracticePosts.find((item) => item.id === heroPostId) || null
    }, [availablePracticePosts, heroSection?.postId])
    const availableLatestPostOptions = useMemo(() => availablePracticePosts, [availablePracticePosts])
    const isSavingHomePage = savingTemplateSettings || savingHomePageBlocks || savingPracticeMenu
    const heroThumbnailPreviewSrc = useMemo(
        () => normalizePublicAssetUrl(heroThumbnailUrl || heroThumbnailPath),
        [heroThumbnailPath, heroThumbnailUrl]
    )
    const selectedLatestPostOptions = useMemo(() => {
        const selectedIds = Array.isArray(latestPostsSection?.postIds) ? latestPostsSection.postIds : []
        if (selectedIds.length === 0) return []

        const byId = new Map(availablePracticePosts.map((item) => [item.id, item]))
        return selectedIds
            .map((id) => byId.get(id))
            .filter(Boolean)
    }, [availablePracticePosts, latestPostsSection])
    const selectedMenuPages = useMemo(() => {
        if (!Array.isArray(selectedMenuPageIds) || selectedMenuPageIds.length === 0) return []

        const byId = new Map(availablePracticePages.map((item) => [item.id, item]))
        return selectedMenuPageIds
            .map((id) => byId.get(id))
            .filter(Boolean)
    }, [availablePracticePages, selectedMenuPageIds])
    const selectedMenuBlocks = useMemo(() => {
        if (!Array.isArray(selectedMenuBlockIds) || selectedMenuBlockIds.length === 0) return []

        const byId = new Map(availableContentBlocks.map((item) => [item.id, item]))
        return selectedMenuBlockIds
            .map((id) => byId.get(id))
            .filter(Boolean)
    }, [availableContentBlocks, selectedMenuBlockIds])
    const visibleHomeTemplateSectionDefinitions = useMemo(
        () => HOME_TEMPLATE_SECTION_DEFINITIONS.filter((definition) => (
            sectionSupportsScope(definition, activeHomeScope)
        )),
        [activeHomeScope]
    )
    const resolvedHomeTemplateColors = useMemo(
        () => getDomainTemplateColors({ colors: homeTemplateColors }, activeHomeScope),
        [activeHomeScope, homeTemplateColors]
    )
    const defaultDesignerPaletteKey = useMemo(
        () => getDesignerDefaultPaletteKey(activeHomeScope),
        [activeHomeScope]
    )
    const homePagePreviewStyles = useMemo(() => getDomainPageStyles(activeHomeScope), [activeHomeScope])
    const activeDesignerPaletteKey = useMemo(() => {
        const matchesPalette = (palette) => {
            const paletteColors = palette?.colors || {}
            return (
                String(resolvedHomeTemplateColors.color1 || '').toLowerCase() === String(paletteColors.color1 || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.color2 || '').toLowerCase() === String(paletteColors.color2 || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.color3 || '').toLowerCase() === String(paletteColors.color3 || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.backgroundColor || '').toLowerCase() === String(paletteColors.backgroundColor || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.successColor || '').toLowerCase() === String(paletteColors.successColor || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.warningColor || '').toLowerCase() === String(paletteColors.warningColor || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.errorColor || '').toLowerCase() === String(paletteColors.errorColor || '').toLowerCase() &&
                String(resolvedHomeTemplateColors.infoColor || '').toLowerCase() === String(paletteColors.infoColor || '').toLowerCase()
            )
        }

        const matched = DESIGNER_PRESET_PALETTES.find((palette) => matchesPalette(palette))
        return matched?.key || 'custom'
    }, [resolvedHomeTemplateColors])
    const previewHomePageBlocks = useMemo(
        () => attachResolvedSinglePostBlocks(homePageBlocks, availablePracticePosts),
        [availablePracticePosts, homePageBlocks]
    )
    const renderHomePagePreviewBlock = (block) => {
        if (block?.type === 'industry_news') {
            const blockHeading = String(block.heading || '').trim() || 'Industry News'
            const blockTopic = String(block.topic || '').trim() || 'Small Business Operations'
            return (
                <section key={block.id} className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{blockHeading}</h3>
                    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <h4 className="text-base font-semibold text-gray-900">Generated industry news will appear here</h4>
                        <p className="mt-2 text-sm text-gray-600">
                            This block pulls one OpenAI-search-backed Practice article for: {blockTopic}.
                        </p>
                    </article>
                </section>
            )
        }

        if (block?.type !== 'latest_posts') return undefined

        const previewItems = resolveLatestPostItems({
            items: availablePracticePosts,
            heroPostId: '',
            limit: block.limit,
            orderMode: block.orderMode,
            orderedIds: block.postIds,
            orderedSlugs: block.postSlugs
        })
        const blockHeading = String(block.heading || '').trim() || 'Latest Posts'
        const blockLayout = normalizeLatestPostsLayout(block.layout)
        const previewLayoutClass = blockLayout === 'list'
            ? 'space-y-3'
            : blockLayout === 'compact'
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
                : 'grid grid-cols-1 gap-3 sm:grid-cols-2'

        return (
            <section key={block.id} className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{blockHeading}</h3>
                {previewItems.length === 0 ? (
                    <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                        No Practice posts are available for this feed yet.
                    </p>
                ) : (
                    <div className={previewLayoutClass}>
                        {previewItems.map((item, index) => (
                            <article
                                key={item?.id || `preview-post-${index}`}
                                className={`rounded-xl border border-gray-200 bg-white shadow-sm ${blockLayout === 'list' ? 'p-4' : blockLayout === 'compact' ? 'p-3' : 'p-3'}`}
                            >
                                <h4 className="text-base font-semibold text-gray-900">{item.title || 'Untitled post'}</h4>
                                <p className="mt-2 text-xs text-gray-500">
                                    {item.type || 'post'}
                                    {item.slug ? ` • /${item.slug}` : ''}
                                </p>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        )
    }

    useEffect(() => {
        document.title = siteTitle || activeHomeLabel
    }, [siteTitle, activeHomeLabel])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const timeoutId = window.setTimeout(() => {
            try {
                const { mode, source } = getEffectiveAdminDomainModeFromStorage()
                setActiveDomainMode(source === 'default' ? DEFAULT_HOME_DOMAIN : mode)
            } catch {
                setActiveDomainMode(DEFAULT_HOME_DOMAIN)
            }
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [])

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

            setIsAuthenticated(true)
            setLoading(false)
        }

        bootstrapAdmin()

        return () => {
            cancelled = true
        }
    }, [router])

    const loadHomePageTemplate = useCallback(async () => {
        const requestId = homeTemplateLoadRequestRef.current + 1
        homeTemplateLoadRequestRef.current = requestId

        setHomeTemplateError('')
        setLoadingHomeTemplate(true)

        try {
            const [homeResponse, pagesResponse, practicePostsResponse, practiceArticlesResponse, bannerResponse, heroThumbnailResponse] = await Promise.all([
                fetch(`/api/content?type=page&subtype=home&domain=${encodeURIComponent(activeHomeScope)}&limit=25`, { cache: 'no-store' }),
                fetch(`/api/content?type=page&domain=${encodeURIComponent(activeHomeScope)}&limit=200`, { cache: 'no-store' }),
                fetch(`/api/content?type=post&domain=${encodeURIComponent(activeHomeScope)}&limit=200`, { cache: 'no-store' }),
                fetch(`/api/content?type=article&domain=${encodeURIComponent(activeHomeScope)}&limit=200`, { cache: 'no-store' }),
                fetch(heroBannerSettingsEndpoint, { cache: 'no-store' }),
                fetch(heroThumbnailSettingsEndpoint, { cache: 'no-store' })
            ])

            if (requestId !== homeTemplateLoadRequestRef.current) return

            const data = await homeResponse.json().catch(() => ({}))
            const pagesData = await pagesResponse.json().catch(() => ({}))
            const practicePostsData = await practicePostsResponse.json().catch(() => ({}))
            const practiceArticlesData = await practiceArticlesResponse.json().catch(() => ({}))
            const bannerData = await bannerResponse.json().catch(() => ({}))
            const heroThumbnailData = heroThumbnailResponse
                ? await heroThumbnailResponse.json().catch(() => ({}))
                : {}

            if (!homeResponse.ok || !data?.success || !Array.isArray(data?.content)) {
                throw new Error(data?.error || 'Unable to load the Practice home-page system node.')
            }

            const menuCandidates =
                pagesResponse.ok && pagesData?.success && Array.isArray(pagesData?.content)
                    ? pagesData.content
                    : []

            // Build a post-title lookup so single_post/three_panel blocks can fall back
            // to the linked post's title when no eyebrow text is set.
            const rawPostItems = [
                ...(practicePostsResponse.ok && practicePostsData?.success && Array.isArray(practicePostsData?.content) ? practicePostsData.content : []),
                ...(practiceArticlesResponse.ok && practiceArticlesData?.success && Array.isArray(practiceArticlesData?.content) ? practiceArticlesData.content : [])
            ]
            const postTitleById = new Map(
                rawPostItems
                    .map((item) => {
                        const id = String(item?.id || '').trim()
                        if (!id) return null
                        const meta = parseMaybeJsonObject(item?.metadata)
                        const title = String(meta?.presentation?.default?.title || item?.title || item?.name || '').trim()
                        return [id, title]
                    })
                    .filter(Boolean)
            )

            const visiblePages = menuCandidates
                .filter((item) => {
                    const metadata = parseMaybeJsonObject(item?.metadata)
                    const attributes = parseMaybeJsonObject(item?.attributes)
                    const domain = String(metadata?.domain || attributes?.domain || '').trim().toLowerCase()
                    const subtype = String(item?.subtype || '').trim().toLowerCase()
                    if (domain !== activeHomeScope) return false
                    if (subtype === 'home') return false
                    return true
                })
                .map((item) => {
                    const metadata = parseMaybeJsonObject(item?.metadata)
                    const attributes = parseMaybeJsonObject(item?.attributes)

                    // Normalize page blocks so missing ids get stable fallback values.
                    const rawBlocks = Array.isArray(metadata?.blocks)
                        ? metadata.blocks
                        : Array.isArray(attributes?.blocks)
                            ? attributes.blocks
                            : Array.isArray(metadata?.template?.blocks)
                                ? metadata.template.blocks
                                : (Array.isArray(attributes?.template?.blocks) ? attributes.template.blocks : [])
                    const blocks = normalizePageBlocks(rawBlocks)
                    const eligibleBlocks = blocks
                        .map((block) => {
                            const blockType = String(block?.type || '').trim()
                            const blockTypeLabel = MENU_BLOCK_TYPE_LABELS[blockType]
                            const blockId = String(block?.id || '').trim()
                            if (!blockTypeLabel || !blockId) return null

                            const blockAnchor = resolveBlockAnchorId({ slug: block?.slug, blockId })
                            if (!blockAnchor) return null

                            return {
                                id: `${String(item?.id || '').trim()}:${blockId}`,
                                blockType: blockTypeLabel,
                                blockId,
                                blockAnchor,
                                title: String(block?.title || block?.eyebrow || postTitleById.get(String(block?.postId || '').trim()) || block?.heading || block?.text || blockTypeLabel || '').trim() || blockTypeLabel
                            }
                        })
                        .filter(Boolean)

                    return {
                        id: String(item?.id || '').trim(),
                        slug: String(metadata?.slug || item?.slug || '').trim(),
                        title: String(metadata?.presentation?.default?.title || item?.title || item?.name || '').trim(),
                        status: String(item?.status || '').trim().toLowerCase(),
                        blockTypes: Array.from(new Set(eligibleBlocks.map((block) => block.blockType))).sort(),
                        eligibleBlocks
                    }
                })
                .filter((item) => item.id && item.slug)

            // Inject the built-in /contact static route for the public domain when no CMS contact page exists
            const contactBuiltIn =
                activeHomeScope === DEFAULT_CONTENT_DOMAIN && !visiblePages.some((p) => p.slug.toLowerCase() === 'contact')
                    ? [{ id: 'builtin:contact', slug: 'contact', title: 'Contact', status: 'published', blockTypes: [], eligibleBlocks: [] }]
                    : []

            visiblePages.push(...contactBuiltIn)
            visiblePages.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))

            // Extract eligible content blocks from pages
            const contentBlocks = visiblePages.flatMap((page) => (
                (Array.isArray(page.eligibleBlocks) ? page.eligibleBlocks : []).map((block) => ({
                    ...block,
                    pageId: page.id,
                    pageSlug: page.slug,
                    pageTitle: page.title
                }))
            ))

            const practiceStoryCandidates = [
                ...(practicePostsResponse.ok && practicePostsData?.success && Array.isArray(practicePostsData?.content) ? practicePostsData.content : []),
                ...(practiceArticlesResponse.ok && practiceArticlesData?.success && Array.isArray(practiceArticlesData?.content) ? practiceArticlesData.content : [])
            ]
            const seenPracticePostIds = new Set()
            const practicePostOptions = practiceStoryCandidates
                .filter((item) => {
                    const metadata = parseMaybeJsonObject(item?.metadata)
                    const attributes = parseMaybeJsonObject(item?.attributes)
                    const domain = String(metadata?.domain || attributes?.domain || '').trim().toLowerCase()
                    const id = String(item?.id || '').trim()
                    if (domain !== activeHomeScope || !id || seenPracticePostIds.has(id)) return false
                    seenPracticePostIds.add(id)
                    return true
                })
                .map((item) => {
                    return toPageBlockPostOption(item)
                })
                .filter((item) => item.id && item.title)
                .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))

            setAvailablePracticePages(visiblePages)
            setAvailablePracticePosts(practicePostOptions)
            setHeroBannerUrl(String(bannerData?.imageUrl || '').trim())
            setHeroBannerGradientEnabled(bannerData?.gradientEnabled !== false)
            if (heroThumbnailResponse?.ok && heroThumbnailData?.success) {
                setHeroThumbnailPath(String(heroThumbnailData?.thumbnailPath || '').trim())
                setHeroThumbnailUrl(String(heroThumbnailData?.thumbnailUrl || '').trim())
                setHeroThumbnailUpdatedAt(String(heroThumbnailData?.updatedAt || '').trim())
            } else {
                setHeroThumbnailPath('')
                setHeroThumbnailUrl('')
                setHeroThumbnailUpdatedAt('')
            }

            const candidates = data.content.filter((item) => {
                const metadata = parseMaybeJsonObject(item?.metadata)
                const attributes = parseMaybeJsonObject(item?.attributes)
                const domain = String(metadata?.domain || attributes?.domain || '').trim().toLowerCase()
                const route = String(metadata?.route || attributes?.route || '').trim()
                return domain === activeHomeScope && route === '/'
            })

            const preferred = candidates.find((item) => String(item?.status || '').toLowerCase() === 'published') || candidates[0] || null

            if (!preferred) {
                setHomePageSystemNodeId(null)
                setHomeTemplateBase({})
                setHomeTemplateColors(getDefaultTemplateColorsForScope(activeHomeScope))
                setHomeTemplateSections(buildEditableTemplateSections({}, activeHomeScope))
                setHomePageBlocks([])
                setAvailablePracticePosts(practicePostOptions)
                setAvailableContentBlocks(contentBlocks)
                setHomeTemplateError(
                    isPrivateHomepageScope
                        ? `No ${activeHomeLabel} home-page system node found yet. Create a home page record in Content with domain "${activeHomeScope}" and route "/", then return here.`
                        : 'No home-page system node found yet. Create a page with subtype "home" in Content, then return here.'
                )
                setSiteTitle('')
                setShowSiteTitleOnPublicSite(true)
                return
            }

            const metadata = parseMaybeJsonObject(preferred.metadata)
            const attributes = parseMaybeJsonObject(preferred.attributes)
            const template = parseMaybeJsonObject(metadata?.template || attributes?.template)

            // Extract eligible blocks from the home page so they appear in the menu modal
            // as direct homepage anchor hotlinks (e.g. /#block-id)
            const homeNormalizedBlocks = normalizePageBlocks(metadata?.blocks)
            const migratedHomeTemplate = migrateLegacyContactBlockIntoSection(
                buildEditableTemplateSections(template, activeHomeScope),
                homeNormalizedBlocks
            )
            const migratedHomeBlocks = migratedHomeTemplate.blocks
            const homePageTitle = String(metadata?.presentation?.default?.title || preferred.title || '').trim() || 'Home'
            const homePageId = String(preferred.id || '').trim()
            const homeEligibleBlocks = migratedHomeBlocks
                .map((block) => {
                    const blockType = String(block?.type || '').trim()
                    const blockTypeLabel = MENU_BLOCK_TYPE_LABELS[blockType]
                    const blockId = String(block?.id || '').trim()
                    if (!blockTypeLabel || !blockId) return null
                    const blockAnchor = resolveBlockAnchorId({ slug: block?.slug, blockId })
                    if (!blockAnchor) return null
                    return {
                        id: `${homePageId}:${blockId}`,
                        blockType: blockTypeLabel,
                        blockId,
                        blockAnchor,
                        title: String(block?.title || block?.eyebrow || postTitleById.get(String(block?.postId || '').trim()) || block?.heading || block?.text || blockTypeLabel || '').trim() || blockTypeLabel,
                        pageId: homePageId,
                        pageSlug: '',
                        pageTitle: homePageTitle
                    }
                })
                .filter(Boolean)
            setAvailableContentBlocks([...homeEligibleBlocks, ...contentBlocks])

            const selectedIdsFromTemplate = Array.isArray(template?.menu?.pageIds)
                ? template.menu.pageIds.map((id) => String(id || '').trim()).filter(Boolean)
                : []
            setSiteTitle(getSiteTitleFromTemplate(template))
            setShowSiteTitleOnPublicSite(shouldShowSiteTitleOnPublicSite(template))
            const selectedSlugsFromTemplate = Array.isArray(template?.menu?.pageSlugs)
                ? template.menu.pageSlugs.map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean)
                : []
            const fallbackIdsFromSlugs = visiblePages
                .filter((item) => selectedSlugsFromTemplate.includes(item.slug.toLowerCase()))
                .map((item) => item.id)
            const selectedIds = selectedIdsFromTemplate.length > 0 ? selectedIdsFromTemplate : fallbackIdsFromSlugs

            const selectedBlockIdsFromTemplate = Array.isArray(template?.menu?.blockIds)
                ? template.menu.blockIds.map((id) => String(id || '').trim()).filter(Boolean)
                : []

            setHomePageSystemNodeId(preferred.id)
            setHomeTemplateBase(template)
            setHomeTemplateColors(getDomainTemplateColors(template, activeHomeScope))
            setBgGradientTreatment(
                Object.prototype.hasOwnProperty.call(BG_GRADIENT_PRESETS, template?.bgGradientTreatment)
                    ? template.bgGradientTreatment
                    : DEFAULT_BG_GRADIENT_TREATMENT
            )
            setScrollReveal(template?.scrollReveal === true)
            setHomeTemplateSections(migratedHomeTemplate.sections)
            setHomePageBlocks(migratedHomeBlocks)
            setSelectedMenuPageIds(selectedIds)
            setSelectedMenuBlockIds(selectedBlockIdsFromTemplate)
            setHeroWorkspaceDirty(false)

            if (migratedHomeTemplate.migrated) {
                setHomeTemplateNotice('Migrated a legacy Contact block into the Contact section. Save Template and Save Homepage Blocks to persist this migration.')
            }
        } catch (error) {
            if (requestId !== homeTemplateLoadRequestRef.current) return
            setHomePageSystemNodeId(null)
            setHomeTemplateBase({})
            setHomeTemplateColors(getDefaultTemplateColorsForScope(activeHomeScope))
            setHomeTemplateSections(buildEditableTemplateSections({}, activeHomeScope))
            setHomePageBlocks([])
            setAvailablePracticePosts([])
            setHeroBannerUrl('')
            setHeroBannerGradientEnabled(true)
            setHeroThumbnailPath('')
            setHeroThumbnailUrl('')
            setHeroThumbnailUpdatedAt('')
            setAvailablePracticePages([])
            setAvailableContentBlocks([])
            setSelectedMenuPageIds([])
            setSelectedMenuBlockIds([])
            setShowSiteTitleOnPublicSite(true)
            setHeroWorkspaceDirty(false)
            setHomeTemplateError(error.message || 'Failed to load home-page template settings.')
        } finally {
            if (requestId !== homeTemplateLoadRequestRef.current) return
            setLoadingHomeTemplate(false)
        }
    }, [activeHomeScope, activeHomeLabel, heroBannerSettingsEndpoint, heroThumbnailSettingsEndpoint, isPrivateHomepageScope])

    const saveHeroTopFoldScreenshot = async () => {
        const captureNode = heroScreenshotCaptureRef.current
        if (!captureNode) return false

        try {
            setSavingHeroThumbnail(true)
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

            const imageDataUrl = await toPng(captureNode, {
                cacheBust: true,
                pixelRatio: 1,
                backgroundColor: '#ffffff',
                width: HERO_SCREENSHOT_VIEWPORT_WIDTH,
                height: HERO_SCREENSHOT_VIEWPORT_HEIGHT,
                canvasWidth: HERO_SCREENSHOT_VIEWPORT_WIDTH,
                canvasHeight: HERO_SCREENSHOT_VIEWPORT_HEIGHT,
                imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='
            })

            const adminToken = await getOrCreateAdminTokenForLocalhost()
            if (!adminToken) {
                throw new Error('Admin session expired. Please sign in again.')
            }

            const response = await fetch(heroThumbnailSettingsEndpoint, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                    imageDataUrl,
                    viewportWidth: HERO_SCREENSHOT_VIEWPORT_WIDTH
                })
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save Hero screenshot.')
            }

            setHeroThumbnailPath(String(data?.thumbnailPath || '').trim())
            setHeroThumbnailUrl(String(data?.thumbnailUrl || '').trim())
            setHeroThumbnailUpdatedAt(String(data?.updatedAt || '').trim())
            return true
        } catch (error) {
            setHomeTemplateError(error.message || 'Failed to save Hero screenshot.')
            return false
        } finally {
            setSavingHeroThumbnail(false)
        }
    }

    const handleToggleTemplateSection = (sectionKey, enabled) => {
        setHomeTemplateSections((prev) => prev.map((section) => (
            section.key === sectionKey ? { ...section, enabled } : section
        )))
    }

    const handleTemplateSectionLimitChange = (sectionKey, value) => {
        const definition = HOME_TEMPLATE_SECTION_DEFINITIONS.find((sectionDefinition) => sectionDefinition.key === sectionKey)
        if (!definition || !definition.supportsLimit) return

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== sectionKey) return section
            return {
                ...section,
                limit: normalizeSectionLimit(value, definition.defaultLimit, definition.minLimit, definition.maxLimit)
            }
        }))
    }

    const handleTemplateSectionTextChange = (sectionKey, field, value) => {
        if (
            field !== 'label' &&
            field !== 'heading' &&
            field !== 'subheading' &&
            field !== 'title' &&
            field !== 'description' &&
            field !== 'homePostLabel' &&
            field !== 'homeProductionLabel' &&
            field !== 'ctaText' &&
            field !== 'ctaHref' &&
            field !== 'secondaryCtaText' &&
            field !== 'secondaryCtaHref' &&
            field !== 'linkedinUsername' &&
            field !== 'logoImage'
        ) return

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== sectionKey) return section
            return {
                ...section,
                [field]: value
            }
        }))
    }

    const handleHomeTemplateColorChange = (colorKey, value) => {
        if (
            colorKey !== 'color1' &&
            colorKey !== 'color2' &&
            colorKey !== 'color3' &&
            colorKey !== 'backgroundColor' &&
            colorKey !== 'successColor' &&
            colorKey !== 'warningColor' &&
            colorKey !== 'errorColor' &&
            colorKey !== 'infoColor'
        ) return

        setHomeTemplateColors((prev) => getDomainTemplateColors({
            colors: {
                ...prev,
                [colorKey]: value
            }
        }, activeHomeScope))
    }

    const handleApplyDesignerPalette = (paletteKey) => {
        const normalizedKey = String(paletteKey || '').trim().toLowerCase()
        if (!normalizedKey || normalizedKey === 'custom') return

        const selectedPalette = DESIGNER_PRESET_PALETTES.find((palette) => palette.key === normalizedKey)
        if (!selectedPalette) return

        setHomeTemplateColors(getDomainTemplateColors({
            colors: selectedPalette.colors
        }, activeHomeScope))
    }

    const handleHeroPostChange = (sectionKey, selectedId) => {
        if (sectionKey !== 'hero') return

        const nextId = String(selectedId || '').trim()
        const selectedPost = availablePracticePosts.find((item) => item.id === nextId) || null

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key === sectionKey) {
                return {
                    ...section,
                    postId: selectedPost?.id || '',
                    postSlug: selectedPost?.slug || '',
                    postType: selectedPost?.type || ''
                }
            }

            return section
        }))
    }

    const handleLatestPostsOrderModeChange = (value) => {
        const nextMode = String(value || DEFAULT_LATEST_POSTS_ORDER_MODE).trim().toLowerCase() || DEFAULT_LATEST_POSTS_ORDER_MODE

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== 'latest_posts') return section
            return {
                ...section,
                orderMode: nextMode
            }
        }))
    }

    const handleAddLatestPost = (postId) => {
        const nextId = String(postId || '').trim()
        if (!nextId) return

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== 'latest_posts') return section
            if (section.postIds.includes(nextId)) return section

            const selectedPost = availablePracticePosts.find((item) => item.id === nextId)
            return {
                ...section,
                postIds: [...section.postIds, nextId],
                postSlugs: selectedPost?.slug
                    ? [...section.postSlugs.filter((slug) => slug !== selectedPost.slug), selectedPost.slug]
                    : section.postSlugs
            }
        }))
    }

    const handleRemoveLatestPost = (postId) => {
        const nextId = String(postId || '').trim()
        if (!nextId) return

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== 'latest_posts') return section
            const selectedPost = availablePracticePosts.find((item) => item.id === nextId)
            return {
                ...section,
                postIds: section.postIds.filter((id) => id !== nextId),
                postSlugs: selectedPost?.slug
                    ? section.postSlugs.filter((slug) => slug !== selectedPost.slug)
                    : section.postSlugs
            }
        }))
    }

    const handleMoveLatestPost = (postId, direction) => {
        const nextId = String(postId || '').trim()
        const step = Number(direction)
        if (!nextId || !Number.isInteger(step) || step === 0) return

        setHomeTemplateSections((prev) => prev.map((section) => {
            if (section.key !== 'latest_posts') return section

            const currentIndex = section.postIds.findIndex((id) => id === nextId)
            if (currentIndex < 0) return section

            const targetIndex = currentIndex + step
            if (targetIndex < 0 || targetIndex >= section.postIds.length) return section

            const nextPostIds = [...section.postIds]
            const [movedId] = nextPostIds.splice(currentIndex, 1)
            nextPostIds.splice(targetIndex, 0, movedId)

            const postIdsSet = new Set(nextPostIds)
            const nextPostSlugs = nextPostIds
                .map((id) => availablePracticePosts.find((item) => item.id === id)?.slug || '')
                .filter(Boolean)

            return {
                ...section,
                postIds: nextPostIds,
                postSlugs: nextPostSlugs.filter((slug, index) => nextPostSlugs.indexOf(slug) === index && postIdsSet.size > 0)
            }
        }))
    }

    const buildMergedHomeTemplateSections = () => {
        const existingSections = Array.isArray(homeTemplateBase?.sections) ? homeTemplateBase.sections : []
        const existingByKey = existingSections.reduce((acc, section) => {
            const key = String(section?.key || '').trim().toLowerCase()
            if (!key) return acc
            acc[key] = section
            return acc
        }, {})

        return HOME_TEMPLATE_SECTION_DEFINITIONS
            .filter((definition) => sectionSupportsScope(definition, activeHomeScope))
            .map((definition) => {
                const editable = homeTemplateSections.find((section) => section.key === definition.key) || {
                    enabled: definition.defaultEnabled,
                    limit: definition.defaultLimit
                }
                const baseSection = existingByKey[definition.key] || {}
                const nextSection = {
                    ...baseSection,
                    key: definition.key,
                    enabled: Boolean(editable.enabled)
                }

                if (definition.supportsLimit) {
                    nextSection.limit = normalizeSectionLimit(
                        editable.limit,
                        definition.defaultLimit,
                        definition.minLimit,
                        definition.maxLimit
                    )
                }

                if (definition.supportsHeading) {
                    nextSection.heading = String(editable.heading || '').trim()
                }

                if (definition.supportsSubheading) {
                    nextSection.subheading = String(editable.subheading || '').trim()
                }

                if (definition.supportsLabel) {
                    nextSection.label = String(editable.label || '').trim()
                }

                if (definition.key === 'hero') {
                    nextSection.homePostLabel = String(editable.homePostLabel || '').trim()
                    nextSection.homeProductionLabel = String(editable.homeProductionLabel || '').trim()
                    nextSection.logoImage = normalizePublicAssetUrl(editable.logoImage)
                    nextSection.postId = String(editable.postId || '').trim()
                    nextSection.postSlug = String(editable.postSlug || '').trim()
                    nextSection.postType = String(editable.postType || '').trim()
                }

                if (definition.key === 'contact_cta_top' || definition.key === 'contact_cta_bottom') {
                    nextSection.ctaText = String(editable.ctaText || '').trim()
                    nextSection.ctaHref = String(editable.ctaHref || '').trim()
                    nextSection.secondaryCtaText = String(editable.secondaryCtaText || '').trim()
                    nextSection.secondaryCtaHref = String(editable.secondaryCtaHref || '').trim()
                    nextSection.linkedinUsername = String(editable.linkedinUsername || '').trim()

                    if (definition.key === 'contact_cta_bottom') {
                        nextSection.title = String(editable.title || '').trim()
                        nextSection.heading = String(editable.heading || '').trim()
                        nextSection.description = String(editable.description || '').trim()
                    }
                }

                if (definition.key === 'latest_posts') {
                    const selectedIds = Array.isArray(editable.postIds)
                        ? editable.postIds.map((id) => String(id || '').trim()).filter(Boolean)
                        : []
                    nextSection.orderMode = String(editable.orderMode || DEFAULT_LATEST_POSTS_ORDER_MODE).trim().toLowerCase() || DEFAULT_LATEST_POSTS_ORDER_MODE
                    nextSection.postIds = selectedIds
                    nextSection.postSlugs = selectedIds
                        .map((id) => availablePracticePosts.find((item) => item.id === id)?.slug || '')
                        .filter(Boolean)
                }

                return nextSection
            })
    }

    const buildPracticeMenuConfig = () => ({
        ...(homeTemplateBase?.menu || {}),
        pageIds: selectedMenuPageIds.filter((id) => !String(id).startsWith('builtin:')),
        pageSlugs: selectedMenuPages
            .map((item) => item.slug)
            .filter(Boolean),
        blockIds: selectedMenuBlockIds,
        blockHotlinks: selectedMenuBlocks
            .map((item) => `/${item.pageSlug}#${item.blockAnchor || item.blockId}`)
            .filter(Boolean),
        blockLabels: Object.fromEntries(
            selectedMenuBlocks.map((item) => [`/${item.pageSlug}#${item.blockAnchor || item.blockId}`, item.title])
        )
    })

    const openHeroWorkspace = () => {
        setHeroWorkspaceDirty(false)
        setHeroWorkspaceOpen(true)
    }

    const saveHomePageTemplate = async () => {
        if (!homePageSystemNodeId) {
            setHomeTemplateError('Cannot save because the Practice home-page system node was not found.')
            return false
        }

        setHomeTemplateError('')
        setHomeTemplateNotice('')
        setSavingTemplateSettings(true)

        try {
            const adminToken = await getOrCreateAdminTokenForLocalhost()
            if (!adminToken) {
                throw new Error('Admin session expired. Please sign in again.')
            }

            const mergedSections = buildMergedHomeTemplateSections()

            const nextTemplate = {
                ...(homeTemplateBase || {}),
                colors: homeTemplateColors,
                bgGradientTreatment,
                scrollReveal,
                siteTitle: siteTitle,
                showSiteTitleOnPublicSite: showSiteTitleOnPublicSite,
                sections: mergedSections,
                menu: buildPracticeMenuConfig()
            }

            const response = await fetch(`/api/content/${homePageSystemNodeId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    metadata: {
                        template: nextTemplate
                    }
                })
            });

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save home-page template settings.')
            }

            const bannerResponse = await fetch(heroBannerSettingsEndpoint, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                    imageUrl: String(heroBannerUrl || '').trim(),
                    gradientEnabled: heroBannerGradientEnabled
                })
            })

            const bannerData = await bannerResponse.json().catch(() => ({}))
            if (!bannerResponse.ok || !bannerData?.success) {
                throw new Error(bannerData?.error || 'Failed to save the Practice hero banner image.')
            }

            setHomeTemplateBase(nextTemplate)
            setHeroBannerUrl(String(bannerData?.imageUrl || '').trim())
            setHeroBannerGradientEnabled(bannerData?.gradientEnabled !== false)
            if (heroWorkspaceOpen || heroWorkspaceDirty) {
                const screenshotSaved = await saveHeroTopFoldScreenshot()
                if (!screenshotSaved) {
                    setHomeTemplateNotice(`Template settings saved. The ${activeHomeLabel} public home page will reflect these sections, but the Hero screenshot could not be refreshed.`)
                    return true
                }
            }
            setHomeTemplateNotice(`Template settings saved. The ${activeHomeLabel} public home page will reflect these sections.`)
            return true
        } catch (error) {
            setHomeTemplateError(error.message || 'Failed to save home-page template settings.')
            return false
        } finally {
            setSavingTemplateSettings(false)
        }
    }

    const handleUpdateHeroWorkspace = async () => {
        const saved = await saveHomePageTemplate()
        if (saved) {
            setHeroWorkspaceDirty(false)
            setHeroWorkspaceOpen(false)
        }
    }

    const saveHeroWorkspaceIfDirty = async () => {
        if (!heroWorkspaceOpen || !heroWorkspaceDirty || savingTemplateSettings) return
        const saved = await saveHomePageTemplate()
        if (saved) setHeroWorkspaceDirty(false)
    }

    const saveHomePageBlocks = async () => {
        if (!homePageSystemNodeId) {
            setHomeTemplateError('Cannot save because the Practice home-page system node was not found.')
            return
        }

        setHomeTemplateError('')
        setHomeTemplateNotice('')
        setSavingHomePageBlocks(true)

        try {
            const response = await fetch(`/api/content/${homePageSystemNodeId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    metadata: {
                        blocks: normalizePageBlocks(homePageBlocks)
                    }
                })
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save home-page blocks.')
            }

            setHomeTemplateNotice(`Homepage blocks saved. The ${activeHomeLabel} public home page will reflect these blocks.`)
        } catch (error) {
            setHomeTemplateError(error.message || 'Failed to save home-page blocks.')
        } finally {
            setSavingHomePageBlocks(false)
        }
    }

    const savePracticeMenu = async () => {
        if (!homePageSystemNodeId) {
            setHomeTemplateError('Cannot save because the Practice home-page system node was not found.')
            return
        }

        setHomeTemplateError('')
        setHomeTemplateNotice('')
        setSavingPracticeMenu(true)

        try {
            const nextTemplate = {
                ...(homeTemplateBase || {}),
                menu: buildPracticeMenuConfig()
            }

            const response = await fetch(`/api/content/${homePageSystemNodeId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    metadata: {
                        template: nextTemplate
                    }
                })
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save menu settings.')
            }

            setHomeTemplateBase(nextTemplate)
            setHomeTemplateNotice(`Menu settings saved. The ${activeHomeLabel} public menu will reflect your selected pages.`)
            setPracticeMenuModalOpen(false)
        } catch (error) {
            setHomeTemplateError(error.message || 'Failed to save menu settings.')
        } finally {
            setSavingPracticeMenu(false)
        }
    }

    useEffect(() => {
        if (!isAuthenticated) return
        const timeoutId = window.setTimeout(() => {
            loadHomePageTemplate()
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [isAuthenticated, loadHomePageTemplate])

    useEffect(() => {
        const previewHost = designerMiniPreviewHostRef.current
        if (!previewHost || typeof ResizeObserver === 'undefined') return undefined

        const updateScale = () => {
            const availableWidth = previewHost.clientWidth
            if (!availableWidth) {
                setDesignerMiniPreviewScale(DESIGNER_MINI_PREVIEW_SCALE)
                return
            }

            const nextScale = Math.min(
                DESIGNER_MINI_PREVIEW_SCALE,
                availableWidth / DESIGNER_MINI_PREVIEW_WIDTH
            )

            setDesignerMiniPreviewScale(Math.max(0.01, nextScale))
        }

        updateScale()

        const observer = new ResizeObserver(() => {
            updateScale()
        })
        observer.observe(previewHost)

        return () => {
            observer.disconnect()
        }
    }, [isDesignerTab])

    const toggleMenuPageSelection = (pageId, checked) => {
        setSelectedMenuPageIds((prev) => {
            if (checked) {
                if (prev.includes(pageId)) return prev
                return [...prev, pageId]
            }

            return prev.filter((id) => id !== pageId)
        })
    }

    const moveMenuPage = (pageId, direction) => {
        const nextId = String(pageId || '').trim()
        const step = Number(direction)
        if (!nextId || !Number.isInteger(step) || step === 0) return

        setSelectedMenuPageIds((prev) => {
            const currentIndex = prev.findIndex((id) => id === nextId)
            if (currentIndex < 0) return prev

            const targetIndex = currentIndex + step
            if (targetIndex < 0 || targetIndex >= prev.length) return prev

            const nextIds = [...prev]
            const [movedId] = nextIds.splice(currentIndex, 1)
            nextIds.splice(targetIndex, 0, movedId)
            return nextIds
        })
    }

    const toggleMenuBlockSelection = (blockId, checked) => {
        setSelectedMenuBlockIds((prev) => {
            if (checked) {
                if (prev.includes(blockId)) return prev
                return [...prev, blockId]
            }

            return prev.filter((id) => id !== blockId)
        })
    }

    const moveMenuBlock = (blockId, direction) => {
        const nextId = String(blockId || '').trim()
        const step = Number(direction)
        if (!nextId || !Number.isInteger(step) || step === 0) return

        setSelectedMenuBlockIds((prev) => {
            const currentIndex = prev.findIndex((id) => id === nextId)
            if (currentIndex < 0) return prev

            const targetIndex = currentIndex + step
            if (targetIndex < 0 || targetIndex >= prev.length) return prev

            const nextIds = [...prev]
            const [movedId] = nextIds.splice(currentIndex, 1)
            nextIds.splice(targetIndex, 0, movedId)
            return nextIds
        })
    }

    const openNewPostForPageBlock = (blockId) => {
        const normalizedBlockId = String(blockId || '').trim()
        if (!normalizedBlockId) return

        // Handle card item encoding: "${realBlockId}::card::${index}"
        const cardItemMatch = normalizedBlockId.match(/^(.+)::card::(\d+)$/)
        const realBlockId = cardItemMatch ? cardItemMatch[1] : normalizedBlockId

        const selectedBlock = normalizePageBlocks(homePageBlocks).find((block) => (
            String(block?.id || '').trim() === realBlockId
        ))

        setPendingSinglePostBlockId(normalizedBlockId)
        setNewPostMode('create')
        setEditingSinglePostId('')
        setNewPostDraft({
            eyebrow: String(selectedBlock?.eyebrow || '').trim(),
            title: '',
            heading: '',
            slug: '',
            summary: '',
            status: 'draft'
        })
        setNewPostSlugEdited(false)
        setNewPostError('')
        setNewPostModalOpen(true)
    }

    const openEditPostForPageBlock = ({ blockId, postId, postSlug } = {}) => {
        const normalizedBlockId = String(blockId || '').trim()
        if (!normalizedBlockId) return

        const normalizedPostId = String(postId || '').trim()
        const normalizedPostSlug = String(postSlug || '').trim().toLowerCase()

        const selectedBlock = normalizePageBlocks(homePageBlocks).find((block) => (
            String(block?.id || '').trim() === normalizedBlockId && String(block?.type || '').trim() === 'single_post'
        ))

        const selectedPost = availablePracticePosts.find((item) => {
            const itemId = String(item?.id || '').trim()
            if (normalizedPostId && itemId === normalizedPostId) return true

            const itemSlug = String(item?.slug || '').trim().toLowerCase()
            return Boolean(normalizedPostSlug) && itemSlug === normalizedPostSlug
        })

        if (!selectedPost?.id) {
            setHomeTemplateError('Selected post could not be loaded for editing.')
            return
        }

        setPendingSinglePostBlockId(normalizedBlockId)
        setNewPostMode('edit')
        setEditingSinglePostId(String(selectedPost.id))
        setNewPostDraft({
            eyebrow: String(selectedBlock?.eyebrow || '').trim(),
            title: String(selectedPost.title || '').trim(),
            heading: String(selectedPost.heading || '').trim(),
            slug: String(selectedPost.slug || '').trim(),
            summary: String(selectedPost.summary || '').trim(),
            status: String(selectedPost.status || 'draft').trim().toLowerCase() || 'draft'
        })
        setNewPostSlugEdited(false)
        setNewPostError('')
        setNewPostModalOpen(true)
    }

    const closeNewPostModal = () => {
        if (newPostSaving) return
        setNewPostModalOpen(false)
        setNewPostError('')
        setNewPostMode('create')
        setEditingSinglePostId('')
        setPendingSinglePostBlockId('')
    }

    const saveNewPostForSingleBlock = async () => {
        const blockId = String(pendingSinglePostBlockId || '').trim()
        if (!blockId) {
            setNewPostError('Could not determine which block to update.')
            return
        }

        const normalizedEyebrow = String(newPostDraft.eyebrow || '').trim()
        const normalizedTitle = String(newPostDraft.title || '').trim()
        const normalizedSlug = String(newPostDraft.slug || '').trim() || slugifyTitle(normalizedTitle)
        if (!normalizedTitle) {
            setNewPostError('Title is required.')
            return
        }
        if (!normalizedSlug) {
            setNewPostError('Slug is required.')
            return
        }

        setNewPostSaving(true)
        setNewPostError('')
        setHomeTemplateNotice('')
        setHomeTemplateError('')

        try {
            const isEditMode = newPostMode === 'edit' && Boolean(editingSinglePostId)
            const response = await fetch(isEditMode ? `/api/content/${editingSinglePostId}` : '/api/content', {
                method: isEditMode ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(isEditMode
                    ? {
                        title: normalizedTitle,
                        heading: String(newPostDraft.heading || '').trim(),
                        slug: normalizedSlug,
                        status: String(newPostDraft.status || 'draft').trim().toLowerCase() || 'draft',
                        preview: String(newPostDraft.summary || '').trim(),
                        attributes: {
                            domain: activeHomeScope
                        }
                    }
                    : {
                        type: 'post',
                        title: normalizedTitle,
                        heading: String(newPostDraft.heading || '').trim(),
                        slug: normalizedSlug,
                        status: String(newPostDraft.status || 'draft').trim().toLowerCase() || 'draft',
                        summary: String(newPostDraft.summary || '').trim(),
                        attributes: {
                            domain: activeHomeScope
                        },
                        metadata: {
                            source: 'admin-dashboard',
                            created_via: 'homepage-page-block-single-post'
                        }
                    }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`)
            }

            const createdOption = toPageBlockPostOption(data?.content || null)
            if (!createdOption?.id) {
                throw new Error('Post was created, but no id was returned.')
            }

            setAvailablePracticePosts((prev) => {
                const withoutCreated = prev.filter((item) => item.id !== createdOption.id)
                return [...withoutCreated, createdOption]
                    .filter((item) => item.id && item.title)
                    .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))
            })

            // Handle card item encoding: "${realBlockId}::card::${index}"
            const cardItemMatch = blockId.match(/^(.+)::card::(\d+)$/)
            if (cardItemMatch) {
                const realBlockId = cardItemMatch[1]
                const cardIndex = parseInt(cardItemMatch[2], 10)
                setHomePageBlocks((prev) => normalizePageBlocks(prev).map((block) => {
                    if (String(block?.id || '') !== realBlockId) return block
                    const currentItems = Array.isArray(block.items) ? block.items : []
                    if (cardIndex < 0 || cardIndex >= currentItems.length) return block
                    const nextItems = currentItems.map((item, i) => {
                        if (i !== cardIndex) return item
                        return {
                            ...item,
                            title: createdOption.title || '',
                            body: createdOption.summary || '',
                            href: createdOption.href || '',
                            postId: createdOption.id,
                            postSlug: createdOption.slug || ''
                        }
                    })
                    return { ...block, items: nextItems }
                }))
            } else {
                setHomePageBlocks((prev) => normalizePageBlocks(prev).map((block) => {
                    if (String(block?.id || '') !== blockId) return block
                    if (String(block?.type || '') !== 'single_post') return block

                    return {
                        ...block,
                        eyebrow: normalizedEyebrow,
                        postId: createdOption.id,
                        postSlug: createdOption.slug || ''
                    }
                }))
            }

            setNewPostModalOpen(false)
            setNewPostMode('create')
            setEditingSinglePostId('')
            setPendingSinglePostBlockId('')
            setHomeTemplateNotice(newPostMode === 'edit'
                ? 'Post updated and linked Single Post block refreshed.'
                : 'Post created and assigned to the Single Post block.')
        } catch (error) {
            setNewPostError(error.message || (newPostMode === 'edit' ? 'Failed to update the post.' : 'Failed to create the post.'))
        } finally {
            setNewPostSaving(false)
        }
    }

    const renderHeroLivePreview = ({ constrainedHeight = false, screenshotMode = false } = {}) => {
        const heroEyebrow = String(heroSection?.label || '').trim() || 'Featured post'
        const heroHeading = String(heroSection?.heading || '').trim() || 'Feature your strongest story right at the top of the homepage.'
        const heroSubheading = String(heroSection?.subheading || '').trim()
        const heroLogoImage = normalizePublicAssetUrl(heroSection?.logoImage)
        const bannerImageUrl = String(heroBannerUrl || '').trim()
        const canRenderBannerImage = bannerImageUrl && (!screenshotMode || isLocalOrDataAsset(bannerImageUrl))
        const canRenderLogoImage = Boolean(heroLogoImage)
        const heroSummary = String(selectedHeroPost?.summary || '').trim() || 'No summary available.'
        const heroPrimaryColor = resolvedHomeTemplateColors.color1
        const heroSecondaryColor = resolvedHomeTemplateColors.color2
        const heroAccentColor = resolvedHomeTemplateColors.color3
        const contactCtaSection =
            homeTemplateSections.find((section) => section.key === 'contact_cta_top') ||
            homeTemplateSections.find((section) => section.key === 'contact_cta_bottom') ||
            {}
        const primaryCtaText = String(contactCtaSection.ctaText || '').trim() || 'Schedule an intro call'
        const secondaryCtaText = String(contactCtaSection.secondaryCtaText || '').trim() || 'Or see how I work'

        return (
            <div
                className={`overflow-hidden rounded-xl border bg-gray-100 h-full flex flex-col ${constrainedHeight ? 'max-h-[34rem]' : ''}`}
                style={{ borderColor: withAlpha(heroSecondaryColor, 0.22) }}
            >
                <div
                    className="relative flex-1 flex flex-col"
                    style={{ background: `linear-gradient(140deg, ${withAlpha(heroPrimaryColor, 0.96)}, ${withAlpha(heroAccentColor, 0.96)})` }}
                >
                    {canRenderBannerImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={bannerImageUrl}
                            crossOrigin="anonymous"
                            alt={heroHeading}
                            className="block h-[10rem] w-full object-cover object-center sm:h-[13rem] lg:h-[17rem]"
                        />
                    ) : (
                        <div
                            className="h-[10rem] w-full sm:h-[13rem] lg:h-[17rem]"
                            style={{
                                background: `radial-gradient(circle at 12% 20%, ${withAlpha(heroPrimaryColor, 0.34)}, transparent 36%), radial-gradient(circle at 78% 0%, ${withAlpha(heroSecondaryColor, 0.28)}, transparent 34%), linear-gradient(140deg, ${heroPrimaryColor}, ${heroAccentColor})`
                            }}
                        />
                    )}
                    {heroBannerGradientEnabled && (
                        <>
                            <div
                                className="pointer-events-none absolute inset-0"
                                style={{ background: `linear-gradient(180deg, ${withAlpha(heroSecondaryColor, 0.14)}, ${withAlpha(heroSecondaryColor, 0.22)} 32%, ${withAlpha(heroSecondaryColor, 0.58)} 74%, ${withAlpha(heroAccentColor, 0.82)} 88%)` }}
                            />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.2)_32%,rgba(255,255,255,0.82)_72%,#ffffff)]" />
                        </>
                    )}
                </div>

                <div className="relative z-10 mx-auto w-full px-3 -mt-12 sm:-mt-9 sm:px-6 lg:-mt-16 lg:px-8 flex-1 flex flex-col">
                    <div className={`${selectedHeroPost
                        ? 'mx-auto w-full max-w-[calc(100%-0.5rem)] sm:max-w-none grid gap-4 sm:gap-6 rounded-[28px] border border-gray-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.94)_34%,rgba(255,255,255,0.9))] px-6 py-7 shadow-[0_28px_60px_-48px_rgba(15,23,42,0.22)] sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(16rem,0.7fr)] lg:items-start lg:gap-8 lg:px-10 lg:py-10'
                        : 'mx-auto w-full max-w-[calc(100%-0.5rem)] sm:max-w-5xl overflow-hidden rounded-[32px] border border-sky-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.92))] shadow-[0_28px_60px_-48px_rgba(3,105,161,0.2)] backdrop-blur-md'} `}
                        style={selectedHeroPost
                            ? {
                                borderColor: withAlpha(heroSecondaryColor, 0.18),
                                background: `linear-gradient(180deg, rgba(255,255,255,0.96), ${withAlpha(heroSecondaryColor, 0.06)} 34%, rgba(255,255,255,0.9))`,
                                boxShadow: `0 28px 60px -48px ${withAlpha(heroAccentColor, 0.32)}`
                            }
                            : {
                                borderColor: withAlpha(heroSecondaryColor, 0.28),
                                background: `linear-gradient(180deg, rgba(255,255,255,0.96), ${withAlpha(heroPrimaryColor, 0.1)})`,
                                boxShadow: `0 28px 60px -48px ${withAlpha(heroSecondaryColor, 0.22)}`
                            }}
                    >
                        <div className={`px-6 py-6 sm:px-8 sm:py-8 lg:px-10 ${selectedHeroPost ? 'px-0 py-1 sm:px-0 sm:py-2 lg:px-0 lg:py-3' : 'py-7 text-center sm:px-10 sm:py-8 lg:px-12'}`}>
                            {canRenderLogoImage && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={heroLogoImage}
                                    crossOrigin="anonymous"
                                    alt=""
                                    className={`mb-5 h-20 w-20 rounded-full object-cover object-top ring-4 ring-white shadow-[0_0_0_7px_rgba(14,165,233,0.25),0_12px_40px_-8px_rgba(15,23,42,0.32)] sm:h-24 sm:w-24 ${selectedHeroPost ? '' : 'mx-auto'}`}
                                    style={{ boxShadow: `0 0 0 7px ${withAlpha(heroSecondaryColor, 0.24)}, 0 12px 40px -8px ${withAlpha(heroAccentColor, 0.32)}` }}
                                />
                            )}
                            {!canRenderLogoImage && (
                                <div
                                    className={`mb-5 h-20 w-20 rounded-full bg-white shadow-[0_0_0_7px_rgba(14,165,233,0.25),0_12px_40px_-8px_rgba(15,23,42,0.32)] sm:h-24 sm:w-24 ${selectedHeroPost ? '' : 'mx-auto'}`}
                                    style={{ boxShadow: `0 0 0 7px ${withAlpha(heroSecondaryColor, 0.24)}, 0 12px 40px -8px ${withAlpha(heroAccentColor, 0.32)}` }}
                                />
                            )}

                            {heroHeading && (
                                <h3 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{heroHeading}</h3>
                            )}

                            <p className={`text-sm leading-7 text-slate-600 sm:text-base ${selectedHeroPost ? 'max-w-2xl lg:mt-4' : 'mx-auto max-w-2xl'}`}>
                                {heroSubheading || 'Explore New York stories, productions, and place-based reporting directly from the day\'s main feature.'}
                            </p>
                        </div>

                        {selectedHeroPost && (
                            <article className="min-h-0 px-2 py-2 sm:px-0 sm:py-3 lg:max-w-sm lg:justify-self-end lg:self-end">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: heroSecondaryColor }}>{heroEyebrow}</p>
                                <h4 className="mt-3 text-xl font-semibold leading-tight text-stone-950 sm:text-2xl">{selectedHeroPost.title || 'Untitled post'}</h4>
                                <p
                                    className="mt-4 text-sm leading-7 text-stone-700 sm:text-[15px]"
                                    style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: 4,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                    }}
                                >
                                    {heroSummary}
                                </p>
                            </article>
                        )}
                    </div>

                    <div className="flex items-center justify-center gap-4 px-4 pb-6 pt-6 sm:gap-6 sm:pb-8">
                        <span
                            className="inline-flex min-w-[14rem] items-center justify-center rounded-full px-6 py-3 text-sm font-semibold shadow-sm sm:min-w-[16rem]"
                            style={{ backgroundColor: '#facc15', color: '#111827' }}
                        >
                            {primaryCtaText}
                        </span>
                        <span className="text-sm font-semibold underline decoration-2 underline-offset-4 text-slate-900">
                            {secondaryCtaText}
                        </span>
                    </div>
                </div>
            </div>
        )
    }

    const renderTemplateSaveFeedback = () => (
        <>
            {homeTemplateError && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-800">{homeTemplateError}</p>
                </div>
            )}

            {homeTemplateNotice && (
                <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-3">
                    <p className="text-sm text-green-800">{homeTemplateNotice}</p>
                </div>
            )}
        </>
    )

    const renderTemplateSaveActions = (buttonLabel = 'Save Template') => (
        <div className="mt-4 flex items-center gap-3">
            <button
                type="button"
                onClick={saveHomePageTemplate}
                disabled={loadingHomeTemplate || isSavingHomePage || !homePageSystemNodeId}
                className="px-4 py-2 bg-gray-700 text-white font-medium rounded hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {savingTemplateSettings ? 'Saving…' : buttonLabel}
            </button>
            {!homePageSystemNodeId && !loadingHomeTemplate && (
                <p className="text-xs text-amber-700">
                    {isPrivateHomepageScope
                        ? `Create a ${activeHomeLabel} home-page system node in Content first (domain "${activeHomeScope}", route "/").`
                        : 'Create a home-page system node in Content first (a page with subtype "home").'}
                </p>
            )}
        </div>
    )

    const renderTemplateSectionsCard = () => (
        <div className="bg-white rounded-lg shadow p-6">
            <div className="mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Template Sections</h3>
                </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-4 items-start">
                {(() => {
                    const heroDef = visibleHomeTemplateSectionDefinitions.find((d) => d.key === 'hero')
                    const heroSectionState = homeTemplateSections.find((item) => item.key === 'hero') || { enabled: heroDef?.defaultEnabled }
                    return heroDef ? (
                        <div className="border border-gray-200 rounded-lg p-4">
                            {visibleHomeTemplateSectionDefinitions.some((d) => d.key === 'contact_cta_top' || d.key === 'contact_cta_bottom') && (
                                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Site Title</p>
                                    <div className="mt-3">
                                        <label className="text-xs font-medium text-gray-600">Site Title (shows on public site and admin)</label>
                                        <input
                                            type="text"
                                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                                            placeholder="e.g. My Business Name"
                                            value={siteTitle}
                                            onChange={e => setSiteTitle(e.target.value)}
                                        />
                                    </div>
                                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            checked={showSiteTitleOnPublicSite}
                                            onChange={e => setShowSiteTitleOnPublicSite(e.target.checked)}
                                        />
                                        <span>Show on public site</span>
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">The site title always appears in Admin when set. Use the checkbox to control whether it also appears on the public homepage.</p>
                                </div>
                            )}
                            {visibleHomeTemplateSectionDefinitions.some((d) => d.key === 'contact_cta_top' || d.key === 'contact_cta_bottom') && (
                                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Contact CTA (Top)</p>
                                        <p className="mt-1 text-xs text-blue-900/80">Manage the call-to-action row displayed below the Hero section and above Page Blocks.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setContactCtaTopModalOpen(true)}
                                        className="mt-3 w-full rounded border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-50 transition-colors"
                                    >
                                        Configure Contact CTA
                                    </button>
                                </div>
                            )}
                            <div>
                                <p className="text-sm font-medium text-gray-900">{heroDef.label}</p>
                                <p className="text-xs text-gray-600 mt-1">{heroDef.description}</p>
                            </div>
                        </div>
                    ) : null
                })()}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <button
                        type="button"
                        onClick={openHeroWorkspace}
                        disabled={loadingHomeTemplate || !homePageSystemNodeId}
                        className="group relative w-full overflow-hidden bg-gray-100 text-left transition hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Edit hero section"
                    >
                        <div className="relative w-full overflow-hidden" style={{ height: '360px' }}>
                            {heroThumbnailPreviewSrc ? (
                                <div className="h-full w-full bg-[linear-gradient(135deg,#f5f3ff_0%,#f3f4f6_48%,#ede9fe_100%)] p-2">
                                    <Image
                                        src={heroThumbnailPreviewSrc}
                                        alt="Saved hero top-fold preview"
                                        width={560}
                                        height={340}
                                        unoptimized
                                        className="h-full w-full rounded object-contain"
                                    />
                                </div>
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 via-white to-gray-100 px-6 text-center">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-700">No Hero screenshot yet</p>
                                        <p className="mt-1 text-xs text-gray-500">Click Update Hero to save a medium-screen top-fold preview.</p>
                                    </div>
                                </div>
                            )}
                            <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
                            <span className="pointer-events-none absolute left-3 top-3 rounded bg-white/90 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-900 shadow-sm ring-1 ring-black/10">
                                Hero
                            </span>
                            {savingHeroThumbnail && (
                                <span className="pointer-events-none absolute left-3 bottom-3 rounded bg-blue-600/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
                                    Updating screenshot...
                                </span>
                            )}
                            {!savingHeroThumbnail && heroThumbnailUpdatedAt && (
                                <span className="pointer-events-none absolute left-3 bottom-3 rounded bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm ring-1 ring-black/10">
                                    Saved preview
                                </span>
                            )}
                            <span className="pointer-events-none absolute right-3 top-3 rounded bg-gray-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm ring-1 ring-black/10 transition group-hover:bg-gray-950">
                                Edit
                            </span>
                        </div>
                    </button>
                    <div className="border-t border-gray-200 bg-gray-50 p-3">
                        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-gray-600">
                                Control whether this section appears on the public homepage.
                            </p>
                            <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={Boolean(heroSection?.enabled ?? true)}
                                    onChange={(event) => handleToggleTemplateSection('hero', event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                Enabled
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {loadingHomeTemplate ? (
                <p className="text-sm text-gray-600">Loading template settings…</p>
            ) : (
                <div className="space-y-3">
                    {visibleHomeTemplateSectionDefinitions.map((definition) => {
                        const section = homeTemplateSections.find((item) => item.key === definition.key) || {
                            enabled: definition.defaultEnabled,
                            limit: definition.defaultLimit
                        }
                        const isHeroSection = definition.key === 'hero'
                        const isContactCtaSection = definition.key === 'contact_cta_top' || definition.key === 'contact_cta_bottom'
                        const isLatestPostsSection = definition.key === 'latest_posts'

                        if (isHeroSection || isContactCtaSection) return null

                        return (
                            <div key={definition.key} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{definition.label}</p>
                                        <p className="text-xs text-gray-600 mt-1">{definition.description}</p>
                                    </div>
                                </div>

                                <div className="mt-3 space-y-3">
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <p className="text-xs text-gray-600">
                                                Control whether this section appears on the public homepage.
                                            </p>
                                            <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(section.enabled)}
                                                    onChange={(event) => handleToggleTemplateSection(definition.key, event.target.checked)}
                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                Enabled
                                            </label>
                                        </div>

                                        {definition.supportsLimit && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <label className="text-xs font-medium text-gray-600" htmlFor={`limit-${definition.key}`}>
                                                    Item limit
                                                </label>
                                                <input
                                                    id={`limit-${definition.key}`}
                                                    type="number"
                                                    min={definition.minLimit}
                                                    max={definition.maxLimit}
                                                    value={section.limit ?? definition.defaultLimit}
                                                    onChange={(event) => handleTemplateSectionLimitChange(definition.key, event.target.value)}
                                                    className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                                                />
                                            </div>
                                        )}

                                        {isLatestPostsSection && (
                                            <div className="mt-3">
                                                <label className="text-xs font-medium text-gray-600" htmlFor={`order-mode-${definition.key}`}>
                                                    Order mode
                                                </label>
                                                <select
                                                    id={`order-mode-${definition.key}`}
                                                    value={section.orderMode || DEFAULT_LATEST_POSTS_ORDER_MODE}
                                                    onChange={(event) => handleLatestPostsOrderModeChange(event.target.value)}
                                                    className="mt-1 w-full max-w-xs rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                                                >
                                                    <option value="newest">Newest first</option>
                                                    <option value="manual">Manual</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {isLatestPostsSection && section.orderMode === 'manual' && (
                                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Manual Post Order</p>
                                            <p className="mt-2 text-xs text-gray-600">
                                                Add Practice posts or articles, then remove any items you do not want included.
                                            </p>

                                            {availableLatestPostOptions.length === 0 ? (
                                                <p className="mt-3 text-sm text-amber-700">No domain-relevant posts are available yet. Create Practice posts or articles first.</p>
                                            ) : (
                                                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                                    <div>
                                                        <p className="text-xs font-medium text-gray-600">Available posts</p>
                                                        <div className="mt-2 max-h-72 overflow-y-auto rounded border border-gray-200">
                                                            {availableLatestPostOptions.map((item) => {
                                                                const isSelected = section.postIds.includes(item.id)

                                                                return (
                                                                    <div key={item.id} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                                                                            <p className="truncate text-xs text-gray-500">
                                                                                {item.type || 'post'}
                                                                                {item.slug ? ` • /${item.slug}` : ''}
                                                                                {item.status ? ` • ${item.status}` : ''}
                                                                            </p>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            disabled={isSelected}
                                                                            onClick={() => handleAddLatestPost(item.id)}
                                                                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                                        >
                                                                            {isSelected ? 'Added' : 'Add'}
                                                                        </button>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs font-medium text-gray-600">Selected order</p>
                                                            {selectedLatestPostOptions.length < (section.limit ?? definition.defaultLimit) && (
                                                                <p className="text-[11px] text-amber-700">
                                                                    Add at least {section.limit ?? definition.defaultLimit} items to fill this section.
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="mt-2 space-y-2">
                                                            {selectedLatestPostOptions.length === 0 ? (
                                                                <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                                                                    No posts selected yet.
                                                                </p>
                                                            ) : (
                                                                selectedLatestPostOptions.map((item, index) => (
                                                                    <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-sm font-medium text-gray-900">
                                                                                {index + 1}. {item.title}
                                                                            </p>
                                                                            <p className="truncate text-xs text-gray-500">
                                                                                {item.type || 'post'}
                                                                                {item.slug ? ` • /${item.slug}` : ''}
                                                                                {item.status ? ` • ${item.status}` : ''}
                                                                            </p>
                                                                        </div>
                                                                        <div className="flex items-center gap-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRemoveLatestPost(item.id)}
                                                                                className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!isHeroSection && definition.supportsHeading && (
                                        <div>
                                            <label className="text-xs font-medium text-gray-600" htmlFor={`heading-${definition.key}`}>
                                                Heading
                                            </label>
                                            <input
                                                id={`heading-${definition.key}`}
                                                type="text"
                                                value={section.heading || ''}
                                                onChange={(event) => handleTemplateSectionTextChange(definition.key, 'heading', event.target.value)}
                                                placeholder="Enter hero heading"
                                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                            />
                                        </div>
                                    )}

                                    {!isHeroSection && definition.supportsSubheading && (
                                        <div>
                                            <label className="text-xs font-medium text-gray-600" htmlFor={`subheading-${definition.key}`}>
                                                Subheading
                                            </label>
                                            <textarea
                                                id={`subheading-${definition.key}`}
                                                value={section.subheading || ''}
                                                onChange={(event) => handleTemplateSectionTextChange(definition.key, 'subheading', event.target.value)}
                                                placeholder="Enter hero subheading"
                                                rows={2}
                                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {renderTemplateSaveFeedback()}
            {renderTemplateSaveActions()}
        </div>
    )

    const renderContactSectionCard = ({ sectionKey, title, description }) => {
        const ctaDef = visibleHomeTemplateSectionDefinitions.find((definition) => definition.key === sectionKey)
        if (!ctaDef) return null

        const ctaSection = homeTemplateSections.find((item) => item.key === sectionKey) || { enabled: ctaDef.defaultEnabled }
        const linkedInProfileValue = String(ctaSection.linkedinUsername || '').trim()
        const inputIdPrefix = String(sectionKey || '').replace(/[^a-z0-9_-]/gi, '-')

        // Skip rendering Contact CTA (Top) inline - it's now in a modal
        if (sectionKey === 'contact_cta_top') return null

        return (
            <div className="bg-white rounded-lg shadow p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                        <p className="text-sm text-gray-600 mt-1">{description}</p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                            type="checkbox"
                            checked={Boolean(ctaSection.enabled)}
                            onChange={(event) => handleToggleTemplateSection(sectionKey, event.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Enabled
                    </label>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {sectionKey === 'contact_cta_bottom' && (
                        <>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-title-inline`}>
                                    Title
                                </label>
                                <input
                                    id={`${inputIdPrefix}-contact-title-inline`}
                                    type="text"
                                    value={ctaSection.title || ''}
                                    onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'title', event.target.value)}
                                    placeholder="Contact"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-heading-inline`}>
                                    Heading
                                </label>
                                <input
                                    id={`${inputIdPrefix}-contact-heading-inline`}
                                    type="text"
                                    value={ctaSection.heading || ''}
                                    onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'heading', event.target.value)}
                                    placeholder="Let's talk"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-description-inline`}>
                                    Description
                                </label>
                                <textarea
                                    id={`${inputIdPrefix}-contact-description-inline`}
                                    value={ctaSection.description || ''}
                                    onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'description', event.target.value)}
                                    placeholder="Tell visitors what happens when they click the CTA."
                                    rows={2}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                        </>
                    )}
                    <div>
                        <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-cta-text-inline`}>
                            Call to action text
                        </label>
                        <input
                            id={`${inputIdPrefix}-cta-text-inline`}
                            type="text"
                            value={ctaSection.ctaText || ''}
                            onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'ctaText', event.target.value)}
                            placeholder="Contact us"
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-cta-link-inline`}>
                            Link
                        </label>
                        <input
                            id={`${inputIdPrefix}-cta-link-inline`}
                            type="text"
                            value={ctaSection.ctaHref || ''}
                            onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'ctaHref', event.target.value)}
                            placeholder="/contact or https://example.com/contact"
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-secondary-cta-text-inline`}>
                            Secondary CTA text (optional)
                        </label>
                        <input
                            id={`${inputIdPrefix}-contact-secondary-cta-text-inline`}
                            type="text"
                            value={ctaSection.secondaryCtaText || ''}
                            onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'secondaryCtaText', event.target.value)}
                            placeholder="Or see how I work"
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-secondary-cta-link-inline`}>
                            Secondary CTA link (optional)
                        </label>
                        <input
                            id={`${inputIdPrefix}-contact-secondary-cta-link-inline`}
                            type="text"
                            value={ctaSection.secondaryCtaHref || ''}
                            onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'secondaryCtaHref', event.target.value)}
                            placeholder="/how-i-work"
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-xs font-medium text-gray-600" htmlFor={`${inputIdPrefix}-contact-linkedin-profile-inline`}>
                            LinkedIn profile (optional)
                        </label>
                        <input
                            id={`${inputIdPrefix}-contact-linkedin-profile-inline`}
                            type="text"
                            value={ctaSection.linkedinUsername || ''}
                            onChange={(event) => handleTemplateSectionTextChange(sectionKey, 'linkedinUsername', event.target.value)}
                            placeholder="your-company-or-profile or https://www.linkedin.com/in/your-profile"
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-500">This shows a LinkedIn action in the public contact row when populated.</p>
                    </div>
                </div>

                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">LinkedIn button preview</p>
                    <div className="mt-2 inline-flex rounded border border-gray-200 bg-white px-3 py-2">
                        <span className="rounded-full border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700">
                            LinkedIn
                        </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                        {linkedInProfileValue ? ' • LinkedIn profile is configured.' : ' • Add a LinkedIn profile to enable this action on the public site.'}
                    </p>
                </div>
            </div>
        )
    }

    const renderDesignerMiniPreview = () => {
        const previewColors = resolvedHomeTemplateColors
        const previewMenuItems = selectedMenuPages.slice(0, 3).map((item, index) => ({
            key: String(item.id || item.slug || item.title || `menu-${index}`),
            label: String(item.title || item.slug || `Menu ${index + 1}`)
        }))
        const menuItems = previewMenuItems.length > 0
            ? previewMenuItems
            : [
                { key: 'about', label: 'About' },
                { key: 'services', label: 'Services' },
                { key: 'contact', label: 'Contact' }
            ]
        const previewSiteTitle = siteTitle || activeHomeLabel
        const previewHeroTitle = String(heroSection?.heading || '').trim() || 'A fast read on your homepage styling'
        const previewHeroBody = String(heroSection?.subheading || '').trim() || 'Change the palette on the left and this mini window updates immediately.'
        const previewCtaText = String(
            homeTemplateSections.find((item) => item.key === 'contact_cta_top')?.ctaText ||
            homeTemplateSections.find((item) => item.key === 'contact_cta_bottom')?.ctaText ||
            ''
        ).trim() || 'Call to Action'
        const previewScaleLabel = `${Math.round(designerMiniPreviewScale * 100)}%`

        return (
            <div className="rounded-lg border border-gray-200 bg-white shadow p-4 xl:sticky xl:top-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900">Mini Preview</h3>
                        <p className="mt-1 text-xs text-gray-600">Scaled to ~20% — shows hero, content grid, features &amp; footer.</p>
                    </div>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{previewScaleLabel}</span>
                </div>

                <div
                    ref={designerMiniPreviewHostRef}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
                    style={{ height: `${DESIGNER_MINI_PREVIEW_HEIGHT * designerMiniPreviewScale}px` }}
                >
                    <div
                        className="origin-top-left"
                        style={{
                            width: `${DESIGNER_MINI_PREVIEW_WIDTH}px`,
                            height: `${DESIGNER_MINI_PREVIEW_HEIGHT}px`,
                            transform: `scale(${designerMiniPreviewScale})`
                        }}
                    >
                        <div
                            className="w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.28)]"
                            style={{
                                minHeight: `${DESIGNER_MINI_PREVIEW_HEIGHT}px`,
                                backgroundImage: (BG_GRADIENT_PRESETS[bgGradientTreatment] ?? BG_GRADIENT_PRESETS[DEFAULT_BG_GRADIENT_TREATMENT]).build(previewColors)
                            }}
                        >
                            <div className="flex flex-col px-10 py-8">
                                <div className="flex items-start justify-between gap-8">
                                    <div>
                                        <p className="text-[16px] font-semibold text-slate-900">{previewSiteTitle}</p>
                                        <p className="mt-2 text-[12px] uppercase tracking-[0.2em] text-slate-500">Homepage</p>
                                    </div>
                                    <div className="flex flex-wrap justify-end gap-3">
                                        {menuItems.map((item, index) => (
                                            <span
                                                key={`${item.key}-${index}`}
                                                className="rounded-full border px-4 py-2 text-[12px] font-medium"
                                                style={{
                                                    borderColor: withAlpha(previewColors.color2, 0.16),
                                                    color: previewColors.color3,
                                                    backgroundColor: withAlpha('#ffffff', 0.78)
                                                }}
                                            >
                                                {item.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-8 overflow-hidden rounded-[26px] border border-white/50 bg-white shadow-[0_28px_60px_-48px_rgba(15,23,42,0.22)]">
                                    <div
                                        className="h-56"
                                        style={{
                                            background: `radial-gradient(circle at 12% 20%, ${withAlpha(previewColors.color1, 0.34)}, transparent 36%), radial-gradient(circle at 78% 0%, ${withAlpha(previewColors.color2, 0.28)}, transparent 34%), linear-gradient(140deg, ${previewColors.color2}, ${previewColors.color3})`
                                        }}
                                    />

                                    <div className="grid grid-cols-[1.3fr_0.7fr] gap-10 px-12 py-10" style={{ background: `linear-gradient(180deg, rgba(255,255,255,0.96), ${withAlpha(previewColors.color2, 0.06)} 34%, rgba(255,255,255,0.9))` }}>
                                        <div>
                                            <div className="mb-5 h-20 w-20 rounded-full bg-white" style={{ boxShadow: `0 0 0 7px ${withAlpha(previewColors.color2, 0.24)}, 0 12px 40px -8px ${withAlpha(previewColors.color3, 0.32)}` }} />
                                            <h4 className="text-[34px] font-semibold tracking-tight text-slate-950">{previewHeroTitle}</h4>
                                            <p className="mt-4 max-w-[40rem] text-[16px] leading-7 text-slate-600">{previewHeroBody}</p>
                                        </div>

                                        <div className="self-end rounded-[20px] bg-white/70 px-6 py-6">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: previewColors.color2 }}>Featured</p>
                                            <p className="mt-3 text-[24px] font-semibold leading-tight text-stone-950">Preview card</p>
                                            <p className="mt-3 text-[15px] leading-7 text-stone-700">This small card shows the secondary and contrast colors against a live page treatment.</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 flex justify-center">
                                    <span
                                        className="inline-flex min-w-[16rem] items-center justify-center rounded-full px-8 py-3 text-[14px] font-semibold shadow-sm"
                                        style={{
                                            backgroundColor: previewColors.color1,
                                            color: previewColors.color3
                                        }}
                                    >
                                        {previewCtaText}
                                    </span>
                                </div>

                                {/* Content grid section */}
                                <div className="mt-16">
                                    <div className="mb-6 flex items-center justify-between">
                                        <h4 className="text-[26px] font-semibold tracking-tight text-slate-900">Latest</h4>
                                        <span className="text-[13px] font-medium" style={{ color: previewColors.color2 }}>View all →</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-6">
                                        {[1, 2, 3].map((n) => (
                                            <div key={n} className="overflow-hidden rounded-[18px] border border-slate-100 bg-white shadow-sm">
                                                <div
                                                    className="h-32"
                                                    style={{
                                                        background: n === 1
                                                            ? `linear-gradient(135deg, ${previewColors.color1}, ${previewColors.color2})`
                                                            : n === 2
                                                                ? `linear-gradient(135deg, ${previewColors.color2}, ${previewColors.color3})`
                                                                : `linear-gradient(135deg, ${withAlpha(previewColors.color1, 0.6)}, ${previewColors.color3})`
                                                    }}
                                                />
                                                <div className="px-5 py-5">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: previewColors.color2 }}>Category</p>
                                                    <p className="mt-2 text-[17px] font-semibold leading-snug text-slate-900">Sample post title {n}</p>
                                                    <p className="mt-2 text-[13px] leading-6 text-slate-500">A short excerpt showing how body text looks against the background.</p>
                                                    <div className="mt-4 h-1 w-12 rounded-full" style={{ backgroundColor: previewColors.color1 }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Features / highlights section */}
                                <div
                                    className="mt-14 overflow-hidden rounded-[24px] px-12 py-12"
                                    style={{ background: `linear-gradient(135deg, ${withAlpha(previewColors.color1, 0.1)}, ${withAlpha(previewColors.color2, 0.14)})` }}
                                >
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: previewColors.color2 }}>Why choose us</p>
                                    <h4 className="mt-3 text-[28px] font-semibold tracking-tight text-slate-900">Built to stand out</h4>
                                    <div className="mt-8 grid grid-cols-3 gap-8">
                                        {['Speed', 'Design', 'Results'].map((label, i) => (
                                            <div key={label} className="rounded-[16px] bg-white/70 px-6 py-6 shadow-sm">
                                                <div
                                                    className="mb-4 h-10 w-10 rounded-xl"
                                                    style={{ backgroundColor: i === 0 ? previewColors.color1 : i === 1 ? previewColors.color2 : previewColors.color3 }}
                                                />
                                                <p className="text-[17px] font-semibold text-slate-900">{label}</p>
                                                <p className="mt-2 text-[13px] leading-6 text-slate-500">Short description of this feature and why it matters to visitors.</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* CTA banner */}
                                <div
                                    className="mt-14 overflow-hidden rounded-[24px] px-12 py-10 text-center"
                                    style={{ background: `linear-gradient(135deg, ${previewColors.color2}, ${previewColors.color3})` }}
                                >
                                    <p className="text-[28px] font-semibold text-white">Ready to get started?</p>
                                    <p className="mt-3 text-[15px] text-white/80">Join others already using {previewSiteTitle}.</p>
                                    <div className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-10 py-3 text-[14px] font-semibold" style={{ color: previewColors.color2 }}>{previewCtaText}</div>
                                </div>

                                {/* Footer strip */}
                                <div className="mt-14 border-t pt-8" style={{ borderColor: withAlpha(previewColors.color2, 0.14) }}>
                                    <div className="flex items-center justify-between">
                                        <p className="text-[15px] font-semibold text-slate-800">{previewSiteTitle}</p>
                                        <div className="flex gap-6">
                                            {menuItems.map((item, index) => (
                                                <span key={`${item.key}-${index}`} className="text-[13px] text-slate-500">{item.label}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <p className="mt-4 text-[12px] text-slate-400">© {new Date().getFullYear()} {previewSiteTitle}. All rights reserved.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-gray-600">Loading...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    // Show siteTitle as subtitle if present
    return (
        <>
            <AdminHeader title="Homepage" />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Homepage Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="flex items-center justify-center h-10 w-10 rounded-md bg-blue-100">
                            <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">{activeHomeLabel}</h1>
                        {siteTitle && (
                            <div className="text-base text-gray-500 font-medium ml-2">{siteTitle}</div>
                        )}
                    </div>
                    <p className="text-gray-600 max-w-3xl">
                        Manage homepage content for your {activeHomeLabel}-powered website.
                    </p>
                </div>

                <div className="mb-6 border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2" role="tablist" aria-label="Homepage tabs">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={isContentTab}
                            onClick={() => setActiveTab('content')}
                            className={`px-3 py-1.5 text-sm font-medium rounded ${isContentTab ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                        >
                            Content
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={isDesignerTab}
                            onClick={() => setActiveTab('designer')}
                            className={`px-3 py-1.5 text-sm font-medium rounded ${isDesignerTab ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                        >
                            Designer
                        </button>
                    </div>
                </div>

                <div className="space-y-6">
                    {isDesignerTab && (
                        <div className="grid gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(260px,1fr)] xl:items-start">
                            <div className="bg-white rounded-lg shadow p-6">
                                <div className="mb-4">
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900">Colors</h3>
                                        <p className="mt-1 text-sm text-gray-600">
                                            Set the palette for the current {activeHomeLabel} template, including a dedicated page background color.
                                        </p>
                                    </div>
                                </div>

                                <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                        <div className="min-w-0 flex-1">
                                            <label className="text-xs font-medium uppercase tracking-wide text-gray-500" htmlFor="designer-palette-select">
                                                Palette Presets
                                            </label>
                                            <select
                                                id="designer-palette-select"
                                                value={activeDesignerPaletteKey}
                                                onChange={(event) => handleApplyDesignerPalette(event.target.value)}
                                                className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                                            >
                                                {DESIGNER_PRESET_PALETTES.map((palette) => (
                                                    <option key={palette.key} value={palette.key}>
                                                        {palette.label}
                                                    </option>
                                                ))}
                                                <option value="custom">Custom (current values)</option>
                                            </select>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleApplyDesignerPalette(activeDesignerPaletteKey === 'custom' ? defaultDesignerPaletteKey : activeDesignerPaletteKey)}
                                            disabled={activeDesignerPaletteKey === 'custom' && !defaultDesignerPaletteKey}
                                            className="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Apply Palette
                                        </button>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-600">
                                        Choose a preset to instantly populate all colors, then fine-tune any individual swatch below.
                                    </p>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                        {DESIGNER_PRESET_PALETTES.map((palette) => {
                                            const isActive = activeDesignerPaletteKey === palette.key
                                            return (
                                                <button
                                                    key={palette.key}
                                                    type="button"
                                                    onClick={() => handleApplyDesignerPalette(palette.key)}
                                                    className={`rounded-lg border p-2 text-left transition-colors ${isActive ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                                    title={palette.description}
                                                >
                                                    <p className={`text-xs font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{palette.label}</p>
                                                    <p className="mt-1 line-clamp-2 text-[11px] text-gray-500">{palette.description}</p>
                                                    <div className="mt-2 grid grid-cols-4 gap-1">
                                                        {['color1', 'color2', 'color3', 'backgroundColor'].map((colorKey) => (
                                                            <span
                                                                key={colorKey}
                                                                className="h-5 rounded border border-black/5"
                                                                style={{ backgroundColor: palette.colors[colorKey] }}
                                                            />
                                                        ))}
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {[
                                        { key: 'color1', label: 'Color 1', description: 'Primary accent for calls to action and warm highlights.' },
                                        { key: 'color2', label: 'Color 2', description: 'Secondary accent for hero treatments and surface framing.' },
                                        { key: 'color3', label: 'Color 3', description: 'Deep contrast color used to anchor the palette.' },
                                        { key: 'backgroundColor', label: 'Background', description: 'Base page shell tone behind hero and content surfaces.' }
                                    ].map((colorField) => {
                                        const colorValue = resolvedHomeTemplateColors[colorField.key]

                                        return (
                                            <label key={colorField.key} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                                <span className="block text-sm font-medium text-gray-900">{colorField.label}</span>
                                                <span className="mt-1 block text-xs text-gray-600">{colorField.description}</span>

                                                <div className="mt-4 flex items-center gap-3">
                                                    <input
                                                        type="color"
                                                        value={colorValue}
                                                        onChange={(event) => handleHomeTemplateColorChange(colorField.key, event.target.value)}
                                                        className="h-11 w-14 cursor-pointer rounded border border-gray-300 bg-white"
                                                        aria-label={colorField.label}
                                                    />
                                                    <div className="min-w-0 flex-1 overflow-hidden">
                                                        <div
                                                            className="h-11 rounded-lg border border-black/10"
                                                            style={{ backgroundColor: colorValue }}
                                                        />
                                                        <p className="mt-2 truncate text-xs font-medium uppercase tracking-wide text-gray-500">
                                                            {colorValue}
                                                        </p>
                                                    </div>
                                                </div>
                                            </label>
                                        )
                                    })}
                                </div>

                                <div className="mt-6 border-t pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowSemanticColors(!showSemanticColors)}
                                        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                                    >
                                        <svg
                                            className={`h-4 w-4 transition-transform ${showSemanticColors ? 'rotate-90' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        Semantic Colors (status indicators)
                                    </button>

                                    {showSemanticColors && (
                                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                            {[
                                                { key: 'successColor', label: 'Success', description: 'Success states and positive feedback.' },
                                                { key: 'warningColor', label: 'Warning', description: 'Warnings and caution states.' },
                                                { key: 'errorColor', label: 'Error', description: 'Errors and destructive actions.' },
                                                { key: 'infoColor', label: 'Info', description: 'Informational content.' }
                                            ].map((colorField) => {
                                                const colorValue = resolvedHomeTemplateColors[colorField.key]

                                                return (
                                                    <label key={colorField.key} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                                                        <span className="block text-xs font-medium text-gray-900">{colorField.label}</span>
                                                        <span className="mt-0.5 block text-[11px] text-gray-600">{colorField.description}</span>

                                                        <div className="mt-3 flex items-center gap-2">
                                                            <input
                                                                type="color"
                                                                value={colorValue}
                                                                onChange={(event) => handleHomeTemplateColorChange(colorField.key, event.target.value)}
                                                                className="h-9 w-12 cursor-pointer rounded border border-gray-300 bg-white"
                                                                aria-label={colorField.label}
                                                            />
                                                            <div className="min-w-0 flex-1 overflow-hidden">
                                                                <div
                                                                    className="h-9 rounded border border-black/10"
                                                                    style={{ backgroundColor: colorValue }}
                                                                />
                                                                <p className="mt-1 truncate text-[11px] font-medium text-gray-400">
                                                                    {colorValue}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </label>
                                                )
                                            })}
                                            <div className="mt-4 border-t border-gray-200 pt-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setContactCtaTopModalOpen(true)}
                                                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                                                >
                                                    Configure Contact CTA
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Palette Preview</p>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                                        <div
                                            className="h-20 rounded-2xl border border-black/5"
                                            style={{
                                                background: `linear-gradient(135deg, ${resolvedHomeTemplateColors.color1} 0%, ${resolvedHomeTemplateColors.color2} 45%, ${resolvedHomeTemplateColors.color3} 72%, ${resolvedHomeTemplateColors.backgroundColor} 100%)`
                                            }}
                                        />
                                        <div className="grid grid-cols-4 gap-2">
                                            {['color1', 'color2', 'color3', 'backgroundColor'].map((colorKey) => (
                                                <div
                                                    key={colorKey}
                                                    className="rounded-xl border border-black/5"
                                                    style={{ backgroundColor: resolvedHomeTemplateColors[colorKey] }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">Background Gradient</p>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                                        {Object.entries(BG_GRADIENT_PRESETS).map(([key, preset]) => {
                                            const isSelected = bgGradientTreatment === key
                                            const previewBg = preset.build(resolvedHomeTemplateColors)
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => setBgGradientTreatment(key)}
                                                    className={`group flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all ${isSelected ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-gray-300'}`}
                                                    title={preset.description}
                                                >
                                                    <div
                                                        className="h-14 w-full"
                                                        style={{ background: previewBg }}
                                                    />
                                                    <div className={`px-2 py-1.5 text-[11px] font-semibold ${isSelected ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'}`}>
                                                        {preset.label}
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">Scroll Animations</p>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={scrollReveal}
                                            onClick={() => setScrollReveal((v) => !v)}
                                            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${scrollReveal ? 'bg-blue-500' : 'bg-gray-300'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${scrollReveal ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                        <span className="text-sm text-gray-700">
                                            Scroll reveal — fade sections in as visitors scroll down
                                        </span>
                                    </label>
                                </div>

                                {renderTemplateSaveFeedback()}
                                {renderTemplateSaveActions('Save Colors')}
                            </div>

                            {renderDesignerMiniPreview()}
                        </div>
                    )}

                    {isContentTab && (
                        <>
                            {renderTemplateSectionsCard()}

                            {renderContactSectionCard({
                                sectionKey: 'contact_cta_top',
                                title: 'Contact CTA (Top)',
                                description: `Configure homepage contact actions shown below Hero and above Page Blocks on ${activeHomeLabel}.`
                            })}

                            <div className="bg-white rounded-lg shadow p-6">
                                <PageBlocksEditor
                                    blocks={homePageBlocks}
                                    onChange={setHomePageBlocks}
                                    title="Page Blocks"
                                    description="Add structured content blocks for the Practice home-page system page. Use the Latest Posts Feed block to place Practice posts anywhere on the page and choose a layout for that feed."
                                    emptyMessage="No homepage blocks yet."
                                    excludedBlockTypes={['contact']}
                                    additionalBlockTypeOptions={[
                                        { value: 'latest_posts', label: 'Latest Posts Feed' },
                                        { value: 'industry_news', label: 'Industry News' }
                                    ]}
                                    availablePostItems={availableLatestPostOptions}
                                    excludePostIds={[]}
                                    onCreatePostForBlock={openNewPostForPageBlock}
                                    onEditPostForBlock={openEditPostForPageBlock}
                                    previewPanel={(
                                        <div>
                                            <div className="mb-3">
                                                <h3 className="text-sm font-medium text-gray-700">Homepage Block Preview</h3>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Preview of how these blocks render with the Practice page styling.
                                                </p>
                                            </div>

                                            <div>
                                                <div className={homePagePreviewStyles.detail.content}>
                                                    <PageContentArticle
                                                        pageTitle={showSiteTitleOnPublicSite && siteTitle ? siteTitle : 'Practice Home Page'}
                                                        summaryParagraphs={[]}
                                                        bodyParagraphs={[]}
                                                        blocks={previewHomePageBlocks}
                                                        pageStyles={homePagePreviewStyles}
                                                        renderBlock={renderHomePagePreviewBlock}
                                                        paletteColors={resolvedHomeTemplateColors}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                />

                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={saveHomePageBlocks}
                                        disabled={loadingHomeTemplate || isSavingHomePage || !homePageSystemNodeId}
                                        className="px-4 py-2 bg-gray-700 text-white font-medium rounded hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {savingHomePageBlocks ? 'Saving…' : 'Save Homepage Blocks'}
                                    </button>
                                    {!homePageSystemNodeId && !loadingHomeTemplate && (
                                        <p className="text-xs text-amber-700">Create a home-page system node in Content first (a page with subtype &quot;home&quot;).</p>
                                    )}
                                </div>
                            </div>

                            {renderContactSectionCard({
                                sectionKey: 'contact_cta_bottom',
                                title: 'Contact CTA (Bottom)',
                                description: `Configure homepage contact actions shown below Page Blocks and above the ${activeHomeLabel} menu footer area.`
                            })}

                            <div className="bg-white rounded-lg shadow p-6">
                                <div className="mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900">{activeHomeLabel} Menu</h3>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Choose which {activeHomeLabel} pages appear in the public menu and set their order.
                                    </p>
                                </div>

                                {loadingHomeTemplate ? (
                                    <p className="text-sm text-gray-600">Loading pages…</p>
                                ) : availablePracticePages.length === 0 ? (
                                    <p className="text-sm text-amber-700">No {activeHomeLabel} pages found yet. Create pages first, then return here to add them to the menu.</p>
                                ) : (
                                    <div className="rounded border border-gray-200 bg-gray-50 p-4">
                                        <p className="text-sm text-gray-700">
                                            {selectedMenuPages.length > 0
                                                ? `${selectedMenuPages.length} page${selectedMenuPages.length === 1 ? '' : 's'} currently selected for the public menu.`
                                                : 'No menu pages selected yet.'}
                                        </p>
                                        {selectedMenuPages.length > 0 && (
                                            <p className="mt-2 text-xs text-gray-600">
                                                {selectedMenuPages.slice(0, 4).map((item) => item.title || item.slug).join(' • ')}
                                                {selectedMenuPages.length > 4 ? ` • +${selectedMenuPages.length - 4} more` : ''}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setPracticeMenuModalOpen(true)}
                                        disabled={loadingHomeTemplate || availablePracticePages.length === 0}
                                        className="px-4 py-2 bg-gray-700 text-white font-medium rounded hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Configure Menu
                                    </button>
                                    {selectedMenuPages.length > 0 && (
                                        <span className="text-xs text-gray-500">Selection is saved from the setup modal.</span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </main>

            {newPostModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
                        <div className="border-b border-gray-200 px-6 py-4">
                            <h2 className="text-lg font-semibold text-gray-900">{newPostMode === 'edit' ? 'Edit Selected Post' : 'Create New Post'}</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                {newPostMode === 'edit'
                                    ? 'Update the selected post and keep it linked to this Single Post block.'
                                    : 'Save a new Practice post and assign it to this Single Post block.'}
                            </p>
                        </div>

                        <div className="space-y-4 px-6 py-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-eyebrow">Eyebrow</label>
                                <input
                                    id="new-single-post-eyebrow"
                                    type="text"
                                    value={newPostDraft.eyebrow}
                                    onChange={(event) => setNewPostDraft((prev) => ({ ...prev, eyebrow: event.target.value }))}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    placeholder="Optional eyebrow"
                                    disabled={newPostSaving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-title">Title</label>
                                <input
                                    id="new-single-post-title"
                                    type="text"
                                    value={newPostDraft.title}
                                    onChange={(event) => {
                                        const nextTitle = event.target.value
                                        setNewPostDraft((prev) => ({
                                            ...prev,
                                            title: nextTitle,
                                            slug: newPostSlugEdited ? prev.slug : slugifyTitle(nextTitle)
                                        }))
                                    }}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    placeholder="Enter post title"
                                    disabled={newPostSaving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-heading">Heading</label>
                                <input
                                    id="new-single-post-heading"
                                    type="text"
                                    value={newPostDraft.heading}
                                    onChange={(event) => setNewPostDraft((prev) => ({ ...prev, heading: event.target.value }))}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    placeholder="Optional heading"
                                    disabled={newPostSaving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-slug">Slug</label>
                                <input
                                    id="new-single-post-slug"
                                    type="text"
                                    value={newPostDraft.slug}
                                    onChange={(event) => {
                                        setNewPostSlugEdited(true)
                                        setNewPostDraft((prev) => ({ ...prev, slug: event.target.value }))
                                    }}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    placeholder="my-new-post"
                                    disabled={newPostSaving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-summary">Summary</label>
                                <textarea
                                    id="new-single-post-summary"
                                    value={newPostDraft.summary}
                                    onChange={(event) => setNewPostDraft((prev) => ({ ...prev, summary: event.target.value }))}
                                    rows={4}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    placeholder="Optional summary"
                                    disabled={newPostSaving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700" htmlFor="new-single-post-status">Status</label>
                                <select
                                    id="new-single-post-status"
                                    value={newPostDraft.status}
                                    onChange={(event) => setNewPostDraft((prev) => ({ ...prev, status: event.target.value }))}
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                    disabled={newPostSaving}
                                >
                                    <option value="draft">Draft</option>
                                    <option value="published">Published</option>
                                </select>
                            </div>

                            {newPostError && (
                                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                    {newPostError}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                            <button
                                type="button"
                                onClick={closeNewPostModal}
                                disabled={newPostSaving}
                                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveNewPostForSingleBlock}
                                disabled={newPostSaving}
                                className="rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {newPostSaving ? 'Saving…' : (newPostMode === 'edit' ? 'Update Post' : 'Save Post')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {contactCtaTopModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Contact CTA (Top)</h2>
                                <p className="mt-1 text-sm text-gray-600">Configure a primary button plus an optional secondary text link. Each CTA only renders on the public site when both its text and link are populated.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setContactCtaTopModalOpen(false)}
                                aria-label="Close Contact CTA settings"
                                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor="contact-cta-top-text">
                                    Call to action text
                                </label>
                                <input
                                    id="contact-cta-top-text"
                                    type="text"
                                    value={homeTemplateSections.find((s) => s.key === 'contact_cta_top')?.ctaText || ''}
                                    onChange={(event) => handleTemplateSectionTextChange('contact_cta_top', 'ctaText', event.target.value)}
                                    placeholder="Contact us"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor="contact-cta-top-link">
                                    Link
                                </label>
                                <input
                                    id="contact-cta-top-link"
                                    type="text"
                                    value={homeTemplateSections.find((s) => s.key === 'contact_cta_top')?.ctaHref || ''}
                                    onChange={(event) => handleTemplateSectionTextChange('contact_cta_top', 'ctaHref', event.target.value)}
                                    placeholder="/contact or https://example.com/contact"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor="contact-cta-top-secondary-text">
                                    Secondary CTA text (optional)
                                </label>
                                <input
                                    id="contact-cta-top-secondary-text"
                                    type="text"
                                    value={homeTemplateSections.find((s) => s.key === 'contact_cta_top')?.secondaryCtaText || ''}
                                    onChange={(event) => handleTemplateSectionTextChange('contact_cta_top', 'secondaryCtaText', event.target.value)}
                                    placeholder="Or see how I work"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor="contact-cta-top-secondary-link">
                                    Secondary CTA link (optional)
                                </label>
                                <input
                                    id="contact-cta-top-secondary-link"
                                    type="text"
                                    value={homeTemplateSections.find((s) => s.key === 'contact_cta_top')?.secondaryCtaHref || ''}
                                    onChange={(event) => handleTemplateSectionTextChange('contact_cta_top', 'secondaryCtaHref', event.target.value)}
                                    placeholder="/how-i-work"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor="contact-cta-top-linkedin">
                                    LinkedIn profile (optional)
                                </label>
                                <input
                                    id="contact-cta-top-linkedin"
                                    type="text"
                                    value={homeTemplateSections.find((s) => s.key === 'contact_cta_top')?.linkedinUsername || ''}
                                    onChange={(event) => handleTemplateSectionTextChange('contact_cta_top', 'linkedinUsername', event.target.value)}
                                    placeholder="your-company-or-profile or https://www.linkedin.com/in/your-profile"
                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                />
                                <p className="mt-1 text-xs text-gray-500">This shows a LinkedIn action in the public contact row when populated.</p>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 px-6 py-4 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setContactCtaTopModalOpen(false)}
                                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {heroWorkspaceOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-[96vw] lg:max-w-[80vw] rounded-lg bg-white shadow-xl max-h-[95vh] overflow-hidden">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Hero Editor Workspace</h2>
                                <p className="mt-1 text-sm text-gray-600">Adjust Hero copy, banner, and featured post. Changes auto-save when you click out of a field.</p>
                                {homeTemplateError && (
                                    <p className="mt-2 text-sm text-red-700">{homeTemplateError}</p>
                                )}
                                {homeTemplateNotice && (
                                    <p className="mt-2 text-sm text-green-700">{homeTemplateNotice}</p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setHeroWorkspaceOpen(false)}
                                disabled={savingTemplateSettings}
                                aria-label="Close hero workspace"
                                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                X
                            </button>
                        </div>

                        <div className="grid gap-0 lg:grid-cols-[1.45fr_1fr] h-full">
                            <div className="border-b border-gray-200 bg-gray-50 p-4 lg:border-b-0 lg:border-r lg:self-stretch flex flex-col h-full">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Live Hero Preview</p>
                                <div className="mt-3 overflow-hidden rounded-lg bg-gray-100 p-3 flex-1 flex flex-col min-h-0">
                                    <div className="w-[117.65%] origin-top-left scale-[0.85] h-full flex flex-col -ml-[5.883%] -mb-[5.882%]">
                                        {renderHeroLivePreview()}
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 max-h-[80vh] overflow-y-auto">
                                <div className="space-y-4">
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Hero Copy</p>
                                        <div className="mt-3 space-y-3">
                                            <div>
                                                <label className="text-xs font-medium text-gray-600">Eyebrow</label>
                                                <input
                                                    type="text"
                                                    value={heroSection?.label || ''}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        handleTemplateSectionTextChange('hero', 'label', event.target.value)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    placeholder="Featured post"
                                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600">Heading</label>
                                                <input
                                                    type="text"
                                                    value={heroSection?.heading || ''}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        handleTemplateSectionTextChange('hero', 'heading', event.target.value)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    placeholder="Enter hero heading"
                                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600">Subheading</label>
                                                <input
                                                    type="text"
                                                    value={heroSection?.subheading || ''}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        handleTemplateSectionTextChange('hero', 'subheading', event.target.value)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    placeholder="Enter hero subheading"
                                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Hero Banner</p>
                                        <div className="mt-3 space-y-3">
                                            <div>
                                                <label className="text-xs font-medium text-gray-600">Banner image URL</label>
                                                <input
                                                    type="text"
                                                    value={heroBannerUrl}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        setHeroBannerUrl(event.target.value)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    placeholder="/hero-image.jpg or https://example.com/image.jpg"
                                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600">Logo image URL</label>
                                                <input
                                                    type="text"
                                                    value={heroSection?.logoImage || ''}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        handleTemplateSectionTextChange('hero', 'logoImage', event.target.value)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    placeholder="/logo.png (files in public/ use /filename.png)"
                                                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                                />
                                            </div>
                                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={heroBannerGradientEnabled}
                                                    onChange={(event) => {
                                                        setHeroWorkspaceDirty(true)
                                                        setHeroBannerGradientEnabled(event.target.checked)
                                                    }}
                                                    onBlur={saveHeroWorkspaceIfDirty}
                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                                                />
                                                Enable banner gradient overlay
                                            </label>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Hero Post</p>
                                        <div className="mt-3">
                                            <label className="text-xs font-medium text-gray-600">Featured post</label>
                                            <select
                                                value={heroSection?.postId || ''}
                                                onChange={(event) => {
                                                    setHeroWorkspaceDirty(true)
                                                    handleHeroPostChange('hero', event.target.value)
                                                }}
                                                onBlur={saveHeroWorkspaceIfDirty}
                                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                                            >
                                                <option value="">No hero post selected</option>
                                                {availablePracticePosts.map((item) => (
                                                    <option key={item.id} value={item.id}>
                                                        {item.title} {item.type ? `(${item.type})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setHeroWorkspaceOpen(false)}
                                disabled={savingTemplateSettings}
                                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleUpdateHeroWorkspace}
                                disabled={savingTemplateSettings || !homePageSystemNodeId}
                                className="rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {savingTemplateSettings || savingHeroThumbnail ? 'Updating…' : 'Update Hero'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="pointer-events-none fixed -left-[200vw] -top-[200vh] opacity-0" aria-hidden="true">
                <div
                    ref={heroScreenshotCaptureRef}
                    className="overflow-hidden bg-white"
                    style={{ width: `${HERO_SCREENSHOT_VIEWPORT_WIDTH}px`, height: `${HERO_SCREENSHOT_VIEWPORT_HEIGHT}px` }}
                >
                    {renderHeroLivePreview({ constrainedHeight: false, screenshotMode: true })}
                </div>
            </div>

            {practiceMenuModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
                        <div className="border-b border-gray-200 px-6 py-4">
                            <h2 className="text-lg font-semibold text-gray-900">Practice Menu Setup</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                Select the Practice pages that should appear in the public menu.
                            </p>
                            <div className="mt-3 rounded bg-blue-50 border border-blue-200 p-3">
                                <p className="text-xs text-blue-700">
                                    <strong>Hotlinking tip:</strong> Pages with Single Post, Three Panel Feature, or FAQ blocks can be linked directly to those blocks using URL anchors (e.g., <code className="bg-white px-1 rounded text-blue-600">/page#block-id</code>). Block types are shown below for your reference.
                                </p>
                            </div>
                        </div>

                        <div className="px-6 py-4">
                            {availablePracticePages.length === 0 ? (
                                <p className="text-sm text-amber-700">No Practice pages found yet. Create pages first, then return here to add them to the menu.</p>
                            ) : (
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                        <p className="text-xs font-medium text-gray-600">Available pages</p>
                                        <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                                            {availablePracticePages.map((pageItem) => (
                                                <label key={pageItem.id} className="flex items-start gap-3 rounded border border-gray-200 p-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedMenuPageIds.includes(pageItem.id)}
                                                        onChange={(event) => toggleMenuPageSelection(pageItem.id, event.target.checked)}
                                                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-sm font-medium text-gray-900">{pageItem.title || pageItem.slug}</span>
                                                        <span className="block text-xs text-gray-600">/{pageItem.slug} • {pageItem.status || 'draft'}</span>
                                                        {pageItem.blockTypes && pageItem.blockTypes.length > 0 && (
                                                            <span className="mt-1 flex flex-wrap gap-1">
                                                                {pageItem.blockTypes.map((blockType) => (
                                                                    <span key={blockType} className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                                                        {blockType}
                                                                    </span>
                                                                ))}
                                                            </span>
                                                        )}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs font-medium text-gray-600">Selected order</p>
                                            {selectedMenuPages.length === 0 && (
                                                <p className="text-[11px] text-gray-500">Select pages to add them to the public menu.</p>
                                            )}
                                        </div>

                                        <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                                            {selectedMenuPages.length === 0 ? (
                                                <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                                                    No menu pages selected yet.
                                                </p>
                                            ) : (
                                                selectedMenuPages.map((pageItem, index) => (
                                                    <div key={pageItem.id} className="flex items-start justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-medium text-gray-900">
                                                                {index + 1}. {pageItem.title || pageItem.slug}
                                                            </p>
                                                            <p className="truncate text-xs text-gray-500">
                                                                /{pageItem.slug}
                                                                {pageItem.status ? ` • ${pageItem.status}` : ''}
                                                            </p>
                                                            {pageItem.blockTypes && pageItem.blockTypes.length > 0 && (
                                                                <p className="mt-1 text-[10px] text-gray-600">
                                                                    Blocks: {pageItem.blockTypes.join(', ')}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => moveMenuPage(pageItem.id, -1)}
                                                                disabled={index === 0}
                                                                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                                Up
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => moveMenuPage(pageItem.id, 1)}
                                                                disabled={index === selectedMenuPages.length - 1}
                                                                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                                Down
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleMenuPageSelection(pageItem.id, false)}
                                                                className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {availableContentBlocks.length > 0 && (
                                <div className="mt-6 border-t border-gray-200 pt-6">
                                    <p className="mb-4 text-sm font-semibold text-gray-900">Available Content Blocks</p>
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <div>
                                            <p className="text-xs font-medium text-gray-600">Available blocks</p>
                                            <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                                                {availableContentBlocks.map((block) => (
                                                    <label key={block.id} className="flex items-start gap-3 rounded border border-gray-200 p-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedMenuBlockIds.includes(block.id)}
                                                            onChange={(event) => toggleMenuBlockSelection(block.id, event.target.checked)}
                                                            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span className="flex-1 min-w-0">
                                                            <span className="block text-sm font-medium text-gray-900">{block.title}</span>
                                                            <span className="block text-xs text-gray-600">From: {block.pageTitle} ({block.blockType})</span>
                                                            <span className="block text-[10px] text-gray-500 font-mono">/{block.pageSlug}#{block.blockAnchor || block.blockId}</span>
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-xs font-medium text-gray-600">Selected order</p>
                                                {selectedMenuBlocks.length === 0 && (
                                                    <p className="text-[11px] text-gray-500">Select blocks to add them to the public menu.</p>
                                                )}
                                            </div>

                                            <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                                                {selectedMenuBlocks.length === 0 ? (
                                                    <p className="rounded border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                                                        No menu blocks selected yet.
                                                    </p>
                                                ) : (
                                                    selectedMenuBlocks.map((block, index) => (
                                                        <div key={block.id} className="flex items-start justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-medium text-gray-900">
                                                                    {index + 1}. {block.title}
                                                                </p>
                                                                <p className="truncate text-xs text-gray-500">
                                                                    {block.blockType} on {block.pageTitle}
                                                                </p>
                                                                <p className="truncate text-[10px] text-gray-600 font-mono">
                                                                    /{block.pageSlug}#{block.blockAnchor || block.blockId}
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveMenuBlock(block.id, -1)}
                                                                    disabled={index === 0}
                                                                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                                                >
                                                                    Up
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveMenuBlock(block.id, 1)}
                                                                    disabled={index === selectedMenuBlocks.length - 1}
                                                                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                                                >
                                                                    Down
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleMenuBlockSelection(block.id, false)}
                                                                    className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setPracticeMenuModalOpen(false)}
                                disabled={savingPracticeMenu}
                                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={savePracticeMenu}
                                disabled={loadingHomeTemplate || isSavingHomePage || !homePageSystemNodeId}
                                className="rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {savingPracticeMenu ? 'Saving…' : 'Save Menu'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
