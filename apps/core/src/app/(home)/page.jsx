'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Image from 'next/image'
import AdminBanner from '@/admin-ui/components/AdminBanner'
import PageContentArticle from '@/components/PageContentArticle'
import DomainAdminFloatingLink from '@/components/DomainAdminFloatingLink'
import { DEFAULT_CONTENT_DOMAIN, DEFAULT_DOMAIN_KEY, DEFAULT_DOMAIN_MODE, getEffectiveDomainMode, getModePathPrefix, getDomainLabel, prefixPathWithDomainMode } from '@/lib/domainMode'
import { DEFAULT_DISPLAY_POLICY, normalizeDisplayPolicy, shouldShowPracticeContent } from '@/lib/displayPolicy'
import { attachResolvedSinglePostBlocks } from '@/lib/pageBlockPosts'
import { normalizePageBlocks } from '@/lib/pageBlocks'
import {
  ENABLE_LEGACY_LATEST_POSTS_SECTION,
  normalizeLatestPostsLayout,
  resolveLatestPostItems
} from '@/lib/latestPosts'
import {
  getPublicSiteTitleFromTemplate,
  getSiteTitleFromTemplate,
  shouldShowSiteTitleOnPublicSite
} from '@/lib/siteTitle'
import {
  BG_GRADIENT_PRESETS,
  DEFAULT_BG_GRADIENT_TREATMENT,
  getContrastingTextColor,
  getDomainPageStyles,
  getDomainTemplateColors,
  withAlpha
} from '@/lib/domainPageStyles'
import ScrollReveal from '@/components/ScrollReveal'
import { PRIVATE_LANDING_COMPONENTS } from '@/components/privateLandings'
import { getHomepageHeroSettingsEndpoint, hasPrivateDomainTrait } from '@/lib/domainExtension'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const PRIVATE_LANDINGS = Object.fromEntries(
  Object.entries(PRIVATE_LANDING_COMPONENTS).map(([mode, loader]) => [mode, dynamic(loader)])
)

const DOMAIN_LANDINGS = PRIVATE_LANDINGS

const ADMIN_PRESENCE_COOKIE = 'admin_presence_v1'
const HOMEPAGE_RETURN_TRANSITION_KEY = 'practice-home-return-transition'
const DOMAIN_MODE_LOADING_INDICATOR_DELAY_MS = 150
const DOMAIN_DESIGNER_PRESET_PALETTES = [
  {
    key: 'studio-classic',
    label: 'Studio Classic',
    colors: {
      color1: '#d97706',
      color2: '#1f2937',
      color3: '#f8fafc',
      backgroundColor: '#f8fafc',
      successColor: '#10b981',
      warningColor: '#f59e0b',
      errorColor: '#ef4444',
      infoColor: '#0284c7'
    }
  },
  {
    key: 'premiere-night',
    label: 'Premiere Night',
    colors: {
      color1: '#f97316',
      color2: '#0f172a',
      color3: '#f8fafc',
      backgroundColor: '#eef2ff',
      successColor: '#22c55e',
      warningColor: '#f59e0b',
      errorColor: '#ef4444',
      infoColor: '#38bdf8'
    }
  },
  {
    key: 'trade-press',
    label: 'Trade Press',
    colors: {
      color1: '#b91c1c',
      color2: '#111827',
      color3: '#f9fafb',
      backgroundColor: '#fff7ed',
      successColor: '#16a34a',
      warningColor: '#f59e0b',
      errorColor: '#dc2626',
      infoColor: '#0ea5e9'
    }
  },
  {
    key: 'borough-neon',
    label: 'Borough Neon',
    colors: {
      color1: '#14b8a6',
      color2: '#1e293b',
      color3: '#e2e8f0',
      backgroundColor: '#ecfeff',
      successColor: '#10b981',
      warningColor: '#f59e0b',
      errorColor: '#ef4444',
      infoColor: '#0284c7'
    }
  },
  {
    key: 'sunset-glow',
    label: 'Sunset Glow',
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
    key: 'ocean-depth',
    label: 'Ocean Depth',
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
    key: 'forest-journal',
    label: 'Forest Journal',
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
    key: 'professional-steel',
    label: 'Professional Steel',
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
    key: 'emerald-luxury',
    label: 'Emerald Luxury',
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
    key: 'arctic-frost',
    label: 'Arctic Frost',
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
  },
  {
    key: 'charcoal-modern',
    label: 'Charcoal Modern',
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
  }
]
const DOMAIN_PALETTE_PANEL_HEIGHT = 88
const DEFAULT_LATEST_POSTS_ORDER_MODE = 'newest'

function normalizePublicAssetUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
  return raw.startsWith('/') ? raw : `/${raw}`
}

function compareHomepageRecords(left, right) {
  const leftStatus = String(left?.status || '').trim().toLowerCase()
  const rightStatus = String(right?.status || '').trim().toLowerCase()
  const leftPublished = leftStatus === 'published'
  const rightPublished = rightStatus === 'published'

  if (leftPublished !== rightPublished) return leftPublished ? -1 : 1

  const leftTime = new Date(left?.published_at || left?.updated_at || left?.created_at || 0).getTime()
  const rightTime = new Date(right?.published_at || right?.updated_at || right?.created_at || 0).getTime()

  return rightTime - leftTime
}

function parseMetadataObject(value) {
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

function getHomeItemTitle(item) {
  const metadata = parseMetadataObject(item?.metadata)
  return metadata?.presentation?.default?.title || metadata?.presentation?.default?.name || item?.title || item?.name || 'Untitled Production'
}

function getHomeItemSummary(item) {
  const metadata = parseMetadataObject(item?.metadata)
  return metadata?.presentation?.default?.summary || item?.summary || item?.description || item?.body || ''
}

function getPracticeMenuPageTitle(item) {
  const metadata = parseMetadataObject(item?.metadata)
  const presentation = parseMetadataObject(metadata?.presentation)
  const defaultPresentation = parseMetadataObject(presentation?.default)
  return String(defaultPresentation?.title || item?.title || item?.name || metadata?.slug || item?.slug || '').trim()
}

function getHomeItemSlug(item) {
  const metadata = parseMetadataObject(item?.metadata)
  return String(metadata?.slug || item?.slug || '').trim()
}

function isSafeContactHref(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/')) return true
  return /^(https?:|mailto:|tel:)/i.test(trimmed)
}

function buildLinkedInProfileHref(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) {
    return /linkedin\.com/i.test(trimmed) ? trimmed : ''
  }

  const normalized = trimmed
    .replace(/^@+/, '')
    .replace(/^linkedin\.com\/(in|company)\//i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  if (!normalized) return ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(normalized)) return ''

  return `https://www.linkedin.com/in/${normalized}`
}

export default function HomePage() {
  const [domainMode, setDomainMode] = useState(DEFAULT_DOMAIN_MODE)
  const [modePathPrefix, setModePathPrefix] = useState('')
  const [isReturningFromSlugPage, setIsReturningFromSlugPage] = useState(false)
  const [domainLabel, setDomainLabel] = useState(() => getDomainLabel(DEFAULT_DOMAIN_MODE))
  const [isDomainModeBootstrapping, setIsDomainModeBootstrapping] = useState(true)
  const [showDomainModeLoadingIndicator, setShowDomainModeLoadingIndicator] = useState(false)
  const [siteTitle, setSiteTitle] = useState('')
  const [displayPolicy, setDisplayPolicy] = useState(DEFAULT_DISPLAY_POLICY)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [selectedDesktopDraft, setSelectedDesktopDraft] = useState('')
  const [showVersionBadge, setShowVersionBadge] = useState(false)
  const [adminFloatingLinkEnabled, setAdminFloatingLinkEnabled] = useState(false)
  const [showDomainPaletteTrayFromQuery, setShowDomainPaletteTrayFromQuery] = useState(false)
  const [isDomainPaletteTrayCollapsed, setIsDomainPaletteTrayCollapsed] = useState(false)
  const [isDomainPaletteSettingsSaving, setIsDomainPaletteSettingsSaving] = useState(false)
  const [domainPaletteStatusMessage, setDomainPaletteStatusMessage] = useState('')
  const [isDomainPaletteDirty, setIsDomainPaletteDirty] = useState(false)
  const [domainPaletteSettings, setDomainPaletteSettings] = useState({
    enabled: false,
    editMode: false,
    paletteKey: '',
    bgGradientTreatment: DEFAULT_BG_GRADIENT_TREATMENT,
    colors: null
  })
  const [starterPostRecords, setStarterPostRecords] = useState([])
  const [selectedHomeContent, setSelectedHomeContent] = useState(null)
  const [heroPostItem, setHeroPostItem] = useState(null)
  const [isHeroPostResolving, setIsHeroPostResolving] = useState(false)
  const [isHomeTemplateConfigLoading, setIsHomeTemplateConfigLoading] = useState(true)
  const [heroBannerUrl, setHeroBannerUrl] = useState('')
  const [heroBannerGradientEnabled, setHeroBannerGradientEnabled] = useState(true)
  const [practiceIndustryNewsItems, setPracticeIndustryNewsItems] = useState([])
  const [loadingPracticeIndustryNews, setLoadingPracticeIndustryNews] = useState(false)
  const [homeTemplateConfig, setHomeTemplateConfig] = useState(null)
  const [homePageBlocks, setHomePageBlocks] = useState([])
  const [practiceMenuPages, setPracticeMenuPages] = useState([])
  const [heroLogoImageOpen, setHeroLogoImageOpen] = useState(false)

  const templateSectionsByKey = useMemo(() => {
    const sections = Array.isArray(homeTemplateConfig?.sections) ? homeTemplateConfig.sections : []
    return sections.reduce((acc, section) => {
      const key = String(section?.key || '').trim().toLowerCase()
      if (!key) return acc
      acc[key] = section
      return acc
    }, {})
  }, [homeTemplateConfig])

  const getSectionConfig = (sectionKey) => {
    const key = String(sectionKey || '').trim().toLowerCase()
    if (!key) return null
    return templateSectionsByKey[key] || null
  }

  const isSharedRootDomainMode = domainMode === DEFAULT_DOMAIN_KEY || hasPrivateDomainTrait(domainMode, 'genericHomepageLayout')

  const isSectionEnabled = (sectionKey, fallback = true) => {
    if (!isSharedRootDomainMode) return fallback
    const section = getSectionConfig(sectionKey)
    if (!section) return fallback
    if (typeof section.enabled === 'boolean') return section.enabled
    return fallback
  }

  const getSectionLimit = (sectionKey, fallback) => {
    const section = getSectionConfig(sectionKey)
    const rawLimit = Number(section?.limit)
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) return fallback
    return Math.min(Math.floor(rawLimit), 24)
  }

  const getSectionOrderMode = (sectionKey, fallback = DEFAULT_LATEST_POSTS_ORDER_MODE) => {
    const section = getSectionConfig(sectionKey)
    const orderMode = String(section?.orderMode || '').trim().toLowerCase()
    return orderMode || fallback
  }

  const getSectionPostIds = (sectionKey) => {
    const section = getSectionConfig(sectionKey)
    if (!Array.isArray(section?.postIds)) return []
    return section.postIds.map((id) => String(id || '').trim()).filter(Boolean)
  }

  const getSectionPostSlugs = (sectionKey) => {
    const section = getSectionConfig(sectionKey)
    if (!Array.isArray(section?.postSlugs)) return []
    return section.postSlugs.map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean)
  }

  const showPracticeFrontendContent =
    isSharedRootDomainMode ||
    shouldShowPracticeContent({
      surface: 'frontend',
      policy: displayPolicy
    })
  const heroSectionConfig = getSectionConfig('hero')
  const latestPostsSectionConfig = getSectionConfig('latest_posts')
  const legacyContactCtaSectionConfig = getSectionConfig('contact_cta')
  const contactCtaTopSectionConfig = getSectionConfig('contact_cta_top') || legacyContactCtaSectionConfig
  const contactCtaBottomSectionConfig = getSectionConfig('contact_cta_bottom') || legacyContactCtaSectionConfig
  const heroLabel = String(heroSectionConfig?.label || '').trim() || 'Featured post'
  const homePostLabel = String(heroSectionConfig?.homePostLabel || '').trim() || 'Post'
  const homeProductionLabel = String(heroSectionConfig?.homeProductionLabel || '').trim() || 'Discover Production'
  const topContactCtaText = String(contactCtaTopSectionConfig?.ctaText || contactCtaTopSectionConfig?.text || '').trim()
  const topContactCtaHref = String(contactCtaTopSectionConfig?.ctaHref || contactCtaTopSectionConfig?.href || '').trim()
  const topContactSecondaryCtaText = String(contactCtaTopSectionConfig?.secondaryCtaText || contactCtaTopSectionConfig?.secondaryText || contactCtaTopSectionConfig?.altCtaText || '').trim()
  const topContactSecondaryCtaHref = String(contactCtaTopSectionConfig?.secondaryCtaHref || contactCtaTopSectionConfig?.secondaryHref || contactCtaTopSectionConfig?.altCtaHref || '').trim()
  const topLinkedInUsername = String(contactCtaTopSectionConfig?.linkedinUsername || contactCtaTopSectionConfig?.linkedinUser || '').trim()
  const topLinkedInCtaHref = buildLinkedInProfileHref(topLinkedInUsername)
  const bottomContactCtaText = String(contactCtaBottomSectionConfig?.ctaText || contactCtaBottomSectionConfig?.text || '').trim()
  const bottomContactCtaHref = String(contactCtaBottomSectionConfig?.ctaHref || contactCtaBottomSectionConfig?.href || '').trim()
  const bottomContactTitle = String(contactCtaBottomSectionConfig?.title || contactCtaBottomSectionConfig?.label || '').trim()
  const bottomContactHeading = String(contactCtaBottomSectionConfig?.heading || '').trim()
  const bottomContactDescription = String(contactCtaBottomSectionConfig?.description || contactCtaBottomSectionConfig?.subheading || '').trim()
  const bottomContactSecondaryCtaText = String(contactCtaBottomSectionConfig?.secondaryCtaText || contactCtaBottomSectionConfig?.secondaryText || contactCtaBottomSectionConfig?.altCtaText || '').trim()
  const bottomContactSecondaryCtaHref = String(contactCtaBottomSectionConfig?.secondaryCtaHref || contactCtaBottomSectionConfig?.secondaryHref || contactCtaBottomSectionConfig?.altCtaHref || '').trim()
  const bottomLinkedInUsername = String(contactCtaBottomSectionConfig?.linkedinUsername || contactCtaBottomSectionConfig?.linkedinUser || '').trim()
  const bottomLinkedInCtaHref = buildLinkedInProfileHref(bottomLinkedInUsername)
  const heroHeading = String(heroSectionConfig?.heading || '').trim()
  const heroSubheading = String(heroSectionConfig?.subheading || '').trim()
  const heroLogoImage = normalizePublicAssetUrl(heroSectionConfig?.logoImage)
  const heroPostId = String(heroSectionConfig?.postId || heroSectionConfig?.selectedPostId || '').trim()
  const heroPostSlug = String(heroSectionConfig?.postSlug || heroSectionConfig?.selectedPostSlug || '').trim().toLowerCase()
  const heroPostType = String(heroSectionConfig?.postType || heroSectionConfig?.selectedPostType || '').trim().toLowerCase()
  const latestPostsHeading = String(latestPostsSectionConfig?.heading || '').trim() || 'Latest Posts'
  const showHeroHeadingBlock = Boolean(heroHeading || heroSubheading)
  const showHeroBanner = Boolean(heroBannerUrl)
  const showHeroSection = isSectionEnabled('hero', true)
  const showHeroFeaturePanel = showHeroSection && (showHeroHeadingBlock || showHeroBanner || Boolean(heroPostItem))
  const hasConfiguredHeroPost = Boolean(heroPostId || heroPostSlug)
  const showLatestPostsSection = ENABLE_LEGACY_LATEST_POSTS_SECTION && isSharedRootDomainMode && isSectionEnabled('latest_posts', true) && showPracticeFrontendContent
  const showTopPrimaryContactCta = Boolean(topContactCtaText) && isSafeContactHref(topContactCtaHref)
  const showTopSecondaryContactCta = Boolean(topContactSecondaryCtaText) && isSafeContactHref(topContactSecondaryCtaHref)
  const showTopLinkedInContactCta = Boolean(topLinkedInCtaHref)
  const showBottomPrimaryContactCta = Boolean(bottomContactCtaText) && isSafeContactHref(bottomContactCtaHref)
  const showBottomSecondaryContactCta = Boolean(bottomContactSecondaryCtaText) && isSafeContactHref(bottomContactSecondaryCtaHref)
  const showBottomLinkedInContactCta = Boolean(bottomLinkedInCtaHref)
  const showBottomContactIntro = Boolean(bottomContactTitle || bottomContactHeading || bottomContactDescription)
  const latestPostsLimit = getSectionLimit('latest_posts', 4)
  const latestPostsOrderMode = getSectionOrderMode('latest_posts')
  const latestPostsOrderedIds = getSectionPostIds('latest_posts')
  const latestPostsOrderedSlugs = getSectionPostSlugs('latest_posts')
  const practiceMenuConfig = useMemo(() => parseMetadataObject(homeTemplateConfig?.menu), [homeTemplateConfig])
  const visibleHomePageBlocks = useMemo(() => normalizePageBlocks(homePageBlocks), [homePageBlocks])
  const visibleHomePageBlocksWithoutContact = useMemo(
    () => visibleHomePageBlocks.filter((block) => block?.type !== 'contact'),
    [visibleHomePageBlocks]
  )
  const resolvedHomePageBlocks = useMemo(
    () => attachResolvedSinglePostBlocks(visibleHomePageBlocksWithoutContact, starterPostRecords),
    [starterPostRecords, visibleHomePageBlocksWithoutContact]
  )
  const configuredPracticeSiteTitle = useMemo(() => getSiteTitleFromTemplate(homeTemplateConfig), [homeTemplateConfig])
  const showConfiguredPracticeSiteTitleOnPublicSite = useMemo(
    () => shouldShowSiteTitleOnPublicSite(homeTemplateConfig),
    [homeTemplateConfig]
  )
  const hasLatestPostsBlock = useMemo(
    () => visibleHomePageBlocksWithoutContact.some((block) => block.type === 'latest_posts'),
    [visibleHomePageBlocksWithoutContact]
  )
  const hasIndustryNewsBlock = useMemo(
    () => visibleHomePageBlocksWithoutContact.some((block) => block.type === 'industry_news'),
    [visibleHomePageBlocksWithoutContact]
  )
  const industryNewsTopic = useMemo(() => {
    const industryNewsBlock = visibleHomePageBlocksWithoutContact.find((block) => block.type === 'industry_news')
    return String(industryNewsBlock?.topic || '').trim() || 'Small Business Operations'
  }, [visibleHomePageBlocksWithoutContact])
  const shouldLoadLatestPostFeeds = showLatestPostsSection || hasLatestPostsBlock
  const shouldLoadPracticeIndustryNews = isSharedRootDomainMode && showPracticeFrontendContent && hasIndustryNewsBlock
  const publicHomeHeading = useMemo(() => {
    if (!isSharedRootDomainMode) return domainLabel
    if (siteTitle) return siteTitle
    if (configuredPracticeSiteTitle && !showConfiguredPracticeSiteTitleOnPublicSite) return ''
    return domainLabel
  }, [configuredPracticeSiteTitle, isSharedRootDomainMode, domainLabel, showConfiguredPracticeSiteTitleOnPublicSite, siteTitle])
  const showHomePageBlocksSection = isSharedRootDomainMode && showPracticeFrontendContent && visibleHomePageBlocksWithoutContact.length > 0
  const showTopContactCtaSection =
    isSharedRootDomainMode &&
    showPracticeFrontendContent &&
    isSectionEnabled('contact_cta_top', isSectionEnabled('contact_cta', true)) &&
    (showTopPrimaryContactCta || showTopSecondaryContactCta || showTopLinkedInContactCta)
  const showBottomContactCtaSection =
    isSharedRootDomainMode &&
    showPracticeFrontendContent &&
    isSectionEnabled('contact_cta_bottom', isSectionEnabled('contact_cta', true)) &&
    (showBottomPrimaryContactCta || showBottomSecondaryContactCta || showBottomLinkedInContactCta || showBottomContactIntro)
  const contactCtaButtonClass = 'inline-flex min-w-[16rem] items-center justify-center rounded-full bg-amber-400 px-8 py-3 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-500'
  const contactCtaSecondaryClass = 'inline-flex items-center justify-center text-sm font-semibold underline decoration-2 underline-offset-4 transition hover:opacity-80'
  const topContactCtaResolvedHref = prefixPathWithDomainMode(topContactCtaHref, modePathPrefix)
  const topContactSecondaryCtaResolvedHref = prefixPathWithDomainMode(topContactSecondaryCtaHref, modePathPrefix)
  const bottomContactCtaResolvedHref = prefixPathWithDomainMode(bottomContactCtaHref, modePathPrefix)
  const bottomContactSecondaryCtaResolvedHref = prefixPathWithDomainMode(bottomContactSecondaryCtaHref, modePathPrefix)
  const visiblePracticeMenuItems = useMemo(() => {
    if (!isSharedRootDomainMode) return []
    if (!Array.isArray(practiceMenuPages) || practiceMenuPages.length === 0) return []

    const selectedIds = Array.isArray(practiceMenuConfig?.pageIds)
      ? practiceMenuConfig.pageIds.map((id) => String(id || '').trim()).filter(Boolean)
      : []
    const selectedSlugs = Array.isArray(practiceMenuConfig?.pageSlugs)
      ? practiceMenuConfig.pageSlugs.map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean)
      : []
    const selectedBlockHotlinks = Array.isArray(practiceMenuConfig?.blockHotlinks)
      ? practiceMenuConfig.blockHotlinks.map((link) => String(link || '').trim()).filter(Boolean)
      : []

    if (selectedIds.length === 0 && selectedSlugs.length === 0 && selectedBlockHotlinks.length === 0) return []

    const selectedById = new Set(selectedIds)
    const selectedBySlug = new Set(selectedSlugs)

    const ordered = []

    selectedIds.forEach((id) => {
      const match = practiceMenuPages.find((item) => item.id === id)
      if (!match) return
      ordered.push(match)
    })

    practiceMenuPages.forEach((item) => {
      if (selectedById.has(item.id)) return
      if (!selectedBySlug.has(item.slug.toLowerCase())) return
      ordered.push(item)
    })

    // Add block hotlinks to menu
    selectedBlockHotlinks.forEach((hotlink) => {
      const normalizedLink = String(hotlink || '').trim()
      // Matches /pageSlug#blockId  OR  /#blockId (homepage blocks)
      const match = normalizedLink.match(/^\/([^#]*)#(.+)$/)
      if (!match) return

      const pageSlug = match[1]  // may be '' for homepage blocks
      const blockId = match[2]
      const storedLabel = practiceMenuConfig?.blockLabels?.[hotlink]
        || practiceMenuConfig?.blockLabels?.[normalizedLink]
        || ''

      if (pageSlug === '') {
        // Homepage anchor — link directly to /#blockId
        ordered.push({
          id: `home:${blockId}`,
          slug: hotlink,
          title: storedLabel || blockId,
          isBlockHotlink: true,
          blockId,
          pageId: '',
          pageSlug: ''
        })
        return
      }

      const page = practiceMenuPages.find((item) => item.slug.toLowerCase() === pageSlug.toLowerCase())

      if (page) {
        ordered.push({
          id: `${page.id}:${blockId}`,
          slug: hotlink,
          title: storedLabel || page.title || blockId,
          isBlockHotlink: true,
          blockId,
          pageId: page.id,
          pageSlug: page.slug
        })
      }
    })

    const deduped = []
    const seenMenuLinks = new Set()

    ordered.forEach((item) => {
      const isBlockHotlink = Boolean(item?.isBlockHotlink)
      const href = isBlockHotlink
        ? String(item?.slug || '').trim()
        : `/${String(item?.slug || '').trim()}`

      if (!href || href === '/') return

      const dedupeKey = href.toLowerCase()
      if (seenMenuLinks.has(dedupeKey)) return

      seenMenuLinks.add(dedupeKey)
      deduped.push({
        ...item,
        slug: String(item?.slug || '').trim(),
        title: String(item?.title || item?.slug || '').trim()
      })
    })

    return deduped
  }, [isSharedRootDomainMode, practiceMenuPages, practiceMenuConfig])
  const pageStyles = useMemo(() => getDomainPageStyles(domainMode), [domainMode])
  const templateColors = useMemo(() => getDomainTemplateColors(homeTemplateConfig, domainMode), [homeTemplateConfig, domainMode])
  const isDomainPaletteSupported = Boolean(String(domainMode || '').trim())
  const showDomainPaletteTray = isDomainPaletteSupported && (showDomainPaletteTrayFromQuery || (domainPaletteSettings.enabled && domainPaletteSettings.editMode))
  const isDomainPalettePreview = showDomainPaletteTray
  const scrollRevealEnabled = homeTemplateConfig?.scrollReveal === true
  const menuNavStyle = useMemo(() => {
    if (!isSharedRootDomainMode) return undefined
    return {
      borderColor: withAlpha(templateColors.color2, 0.16),
      boxShadow: `0 18px 40px -34px ${withAlpha(templateColors.color2, 0.32)}`
    }
  }, [isSharedRootDomainMode, templateColors.color2])
  const menuChipStyle = useMemo(() => {
    if (!isSharedRootDomainMode) return undefined
    return {
      color: templateColors.color3
    }
  }, [isSharedRootDomainMode, templateColors.color3])
  const pageShellStyle = useMemo(() => {
    if (!isSharedRootDomainMode && !isDomainPalettePreview) return undefined
    const treatment = String(homeTemplateConfig?.bgGradientTreatment || '').trim() || DEFAULT_BG_GRADIENT_TREATMENT
    const preset = BG_GRADIENT_PRESETS[treatment] ?? BG_GRADIENT_PRESETS[DEFAULT_BG_GRADIENT_TREATMENT]
    return {
      backgroundImage: preset.build(templateColors)
    }
  }, [isSharedRootDomainMode, isDomainPalettePreview, homeTemplateConfig, templateColors])
  const domainPaletteSurfaceStyle = useMemo(() => {
    if (!isDomainPalettePreview) return undefined
    return {
      borderColor: withAlpha(templateColors.color2, 0.18),
      background: `linear-gradient(180deg, rgba(255,255,255,0.98), ${withAlpha(templateColors.color2, 0.06)} 42%, rgba(255,255,255,0.94))`,
      boxShadow: `0 28px 58px -44px ${withAlpha(templateColors.color2, 0.34)}`
    }
  }, [isDomainPalettePreview, templateColors.color2])
  const domainPaletteCardBaseStyle = useMemo(() => {
    if (!isDomainPalettePreview) return undefined
    return {
      borderColor: withAlpha(templateColors.color2, 0.22),
      boxShadow: `0 22px 48px -38px ${withAlpha(templateColors.color2, 0.36)}`
    }
  }, [isDomainPalettePreview, templateColors.color2])
  const domainPaletteCardSelectedStyle = useMemo(() => {
    if (!isDomainPalettePreview) return undefined
    return {
      boxShadow: `0 0 0 2px ${withAlpha(templateColors.color1, 0.34)}, 0 22px 48px -38px ${withAlpha(templateColors.color2, 0.36)}`
    }
  }, [isDomainPalettePreview, templateColors.color1, templateColors.color2])
  const contactCtaButtonStyle = useMemo(() => ({
    backgroundColor: templateColors.color1,
    color: getContrastingTextColor(templateColors.color1)
  }), [templateColors.color1])
  const contactCtaSecondaryStyle = useMemo(() => ({
    color: templateColors.color3,
    textDecorationColor: withAlpha(templateColors.color3, 0.52)
  }), [templateColors.color3])
  const bottomContactTitleStyle = useMemo(() => ({
    color: templateColors.color2
  }), [templateColors.color2])
  const heroBannerShellStyle = useMemo(() => ({
    backgroundColor: templateColors.color2,
    boxShadow: `0 30px 90px -52px ${withAlpha(templateColors.color2, 0.45)}`
  }), [templateColors.color2])
  const heroBannerGradientStyle = useMemo(() => ({
    background: `linear-gradient(180deg, ${withAlpha(templateColors.color2, 0.14)}, ${withAlpha(templateColors.color2, 0.22)} 32%, ${withAlpha(templateColors.color2, 0.58)} 74%, ${withAlpha(templateColors.color3, 0.82)} 88%)`
  }), [templateColors.color2, templateColors.color3])
  const heroFeatureCardStyle = useMemo(() => ({
    borderColor: withAlpha(templateColors.color2, 0.18),
    background: hasPrivateDomainTrait(domainMode, 'flatHeroCardBackground') ? '#ffffff' : `linear-gradient(180deg, rgba(255,255,255,0.96), ${withAlpha(templateColors.color2, 0.06)} 34%, rgba(255,255,255,0.9))`,
    boxShadow: `0 28px 60px -48px ${withAlpha(templateColors.color3, 0.28)}`
  }), [domainMode, templateColors.color2, templateColors.color3])
  const heroHeadingCardStyle = useMemo(() => ({
    borderColor: withAlpha(templateColors.color2, 0.28),
    background: hasPrivateDomainTrait(domainMode, 'flatHeroCardBackground') ? '#ffffff' : `linear-gradient(180deg, rgba(255,255,255,0.96), ${withAlpha(templateColors.color1, 0.1)})`,
    boxShadow: `0 28px 60px -48px ${withAlpha(templateColors.color2, 0.22)}`
  }), [domainMode, templateColors.color1, templateColors.color2])
  const heroLogoStyle = useMemo(() => ({
    boxShadow: `0 0 0 7px ${withAlpha(templateColors.color2, 0.24)}, 0 12px 40px -8px ${withAlpha(templateColors.color3, 0.32)}`
  }), [templateColors.color2, templateColors.color3])
  const heroEyebrowStyle = useMemo(() => ({
    color: templateColors.color2
  }), [templateColors.color2])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const hostname = window.location.hostname
        const pathname = window.location.pathname
        const savedDomain = readStoredDefaultDomain()
        const { mode } = getEffectiveDomainMode(hostname, savedDomain, pathname)
        setDomainMode(mode)
        setDomainLabel(getDomainLabel(mode))
        setModePathPrefix(getModePathPrefix(pathname, mode))
        setIsReturningFromSlugPage(window.sessionStorage.getItem(HOMEPAGE_RETURN_TRANSITION_KEY) === '1')
      } catch {
        setDomainMode(DEFAULT_DOMAIN_MODE)
        setDomainLabel(getDomainLabel(DEFAULT_DOMAIN_MODE))
        setModePathPrefix('')
        setIsReturningFromSlugPage(false)
      } finally {
        setIsDomainModeBootstrapping(false)
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (!isDomainModeBootstrapping) {
      const timeoutId = window.setTimeout(() => {
        setShowDomainModeLoadingIndicator(false)
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }

    const timer = window.setTimeout(() => {
      setShowDomainModeLoadingIndicator(true)
    }, DOMAIN_MODE_LOADING_INDICATOR_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [isDomainModeBootstrapping])

  useEffect(() => {
    if (typeof window === 'undefined' || !isReturningFromSlugPage) return

    window.sessionStorage.removeItem(HOMEPAGE_RETURN_TRANSITION_KEY)

    const timer = window.setTimeout(() => {
      setIsReturningFromSlugPage(false)
    }, 340)

    return () => window.clearTimeout(timer)
  }, [isReturningFromSlugPage])

  // Load site title for the practice site
  useEffect(() => {
    if (!isSharedRootDomainMode) {
      const timeoutId = window.setTimeout(() => {
        setSiteTitle('')
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
    // Try to get from loaded homeTemplateConfig
    if (homeTemplateConfig && typeof homeTemplateConfig === 'object') {
      const timeoutId = window.setTimeout(() => {
        setSiteTitle(getPublicSiteTitleFromTemplate(homeTemplateConfig))
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [homeTemplateConfig, isSharedRootDomainMode])

  useEffect(() => {
    if (!heroLogoImageOpen) return
    const handleKeyDown = (e) => { if (e.key === 'Escape') setHeroLogoImageOpen(false) }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [heroLogoImageOpen])

  useEffect(() => {
    let cancelled = false

    const loadDisplayPolicy = async () => {
      try {
        const response = await fetch('/api/settings/display-policy', { cache: 'no-store' })
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        if (cancelled) return

        setDisplayPolicy(normalizeDisplayPolicy(data?.policy))
      } catch {
        // Keep defaults if policy cannot be loaded.
      }
    }

    loadDisplayPolicy()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isDomainModeBootstrapping) return

    let cancelled = false

    const loadAdminFloatingLinkFlag = async () => {
      try {
        const response = await fetch(`/api/settings/domain-admin-link?domain=${encodeURIComponent(domainMode)}`, { cache: 'no-store' })
        if (!response.ok) return

        const data = await response.json().catch(() => ({}))
        if (cancelled) return

        setAdminFloatingLinkEnabled(data?.adminFloatingLinkEnabled === true)
      } catch {
        // Keep the link hidden when the per-domain flag cannot be loaded.
        if (!cancelled) setAdminFloatingLinkEnabled(false)
      }
    }

    loadAdminFloatingLinkFlag()

    return () => {
      cancelled = true
    }
  }, [isDomainModeBootstrapping, domainMode])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncAuthState = () => {
      const token = String(window.localStorage.getItem('adminToken') || '').trim()
      const cookiePresent = document.cookie
        .split(';')
        .map((part) => part.trim())
        .some((part) => part === `${ADMIN_PRESENCE_COOKIE}=1`)
      const isAuthenticated = Boolean(token) || cookiePresent

      setIsAdminAuthenticated(isAuthenticated)
    }

    syncAuthState()
    window.addEventListener('storage', syncAuthState)

    return () => {
      window.removeEventListener('storage', syncAuthState)
    }
  }, [])

  useEffect(() => {
    if (isDomainModeBootstrapping) return
    let cancelled = false

    const loadHeroBanner = async () => {
      if (!isSharedRootDomainMode) {
        setHeroBannerUrl('')
        setHeroBannerGradientEnabled(true)
        return
      }

      try {
        const bannerSettingsEndpoint = getHomepageHeroSettingsEndpoint('banner', domainMode)
        const response = await fetch(bannerSettingsEndpoint, { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (cancelled) return

        if (!response.ok || !data?.success) {
          setHeroBannerUrl('')
          setHeroBannerGradientEnabled(true)
          return
        }

        setHeroBannerUrl(String(data?.imageUrl || '').trim())
        setHeroBannerGradientEnabled(data?.gradientEnabled !== false)
      } catch {
        if (!cancelled) {
          setHeroBannerUrl('')
          setHeroBannerGradientEnabled(true)
        }
      }
    }

    loadHeroBanner()

    return () => {
      cancelled = true
    }
  }, [isDomainModeBootstrapping, isSharedRootDomainMode, domainMode])

  useEffect(() => {
    if (isDomainModeBootstrapping) return
    let cancelled = false

    const loadHomeTemplateConfig = async () => {
      if (!isSharedRootDomainMode) {
        setHomeTemplateConfig(null)
        setHomePageBlocks([])
        setIsHomeTemplateConfigLoading(false)
        return
      }

      setIsHomeTemplateConfigLoading(true)

      try {
        const response = await fetch('/api/content?type=page&subtype=home&limit=25', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (!response.ok || !data?.success || !Array.isArray(data?.content)) {
          if (!cancelled) {
            setHomeTemplateConfig(null)
            setHomePageBlocks([])
            setIsHomeTemplateConfigLoading(false)
          }
          return
        }

        const candidates = data.content.filter((item) => {
          const attrs = parseMetadataObject(item?.attributes)
          const metadata = parseMetadataObject(item?.metadata)
          const domain = String(attrs?.domain || metadata?.domain || '').trim().toLowerCase()
          const route = String(attrs?.route || metadata?.route || '').trim()
          return domain === domainMode && route === '/'
        })

        const preferred = candidates.find((item) => String(item?.status || '').toLowerCase() === 'published') || candidates[0] || null
        // Templates may be stored in either `attributes` or `metadata`; check both so
        // either convention works without requiring a migration.
        const template = parseMetadataObject(preferred?.attributes?.template || preferred?.metadata?.template)
        const attributes = parseMetadataObject(preferred?.attributes)
        const metadata = parseMetadataObject(preferred?.metadata)
        if (!cancelled) {
          setHomeTemplateConfig(template)
          setHomePageBlocks(normalizePageBlocks(metadata?.blocks || attributes?.blocks))
          setIsHomeTemplateConfigLoading(false)
        }
      } catch {
        if (!cancelled) {
          setHomeTemplateConfig(null)
          setHomePageBlocks([])
          setIsHomeTemplateConfigLoading(false)
        }
      }
    }

    loadHomeTemplateConfig()

    return () => {
      cancelled = true
    }
  }, [isDomainModeBootstrapping, isSharedRootDomainMode, domainMode])

  useEffect(() => {
    if (isDomainModeBootstrapping) return
    let cancelled = false

    const loadPracticeMenuPages = async () => {
      if (!isSharedRootDomainMode) {
        setPracticeMenuPages([])
        return
      }

      try {
        const response = await fetch(`/api/content?type=page&domain=${encodeURIComponent(domainMode)}&limit=200`, { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (!response.ok || !data?.success || !Array.isArray(data?.content)) {
          if (!cancelled) setPracticeMenuPages([])
          return
        }

        const pages = data.content
          .filter((item) => {
            const metadata = parseMetadataObject(item?.metadata)
            const attributes = parseMetadataObject(item?.attributes)
            const subtype = String(item?.subtype || '').trim().toLowerCase()
            const status = String(item?.status || '').trim().toLowerCase()
            const route = String(metadata?.route || attributes?.route || '').trim()
            if (subtype === 'home') return false
            if (route === '/') return false
            if (status !== 'published') return false
            return true
          })
          .map((item) => {
            const metadata = parseMetadataObject(item?.metadata)
            return {
              id: String(item?.id || '').trim(),
              slug: String(metadata?.slug || item?.slug || '').trim(),
              title: getPracticeMenuPageTitle(item)
            }
          })
          .filter((item) => item.id && item.slug)
          .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))

        // Inject built-in /contact static route so it can always be resolved as a menu item
        if (!pages.some((p) => p.slug === 'contact')) {
          pages.push({ id: 'contact', slug: 'contact', title: 'Contact' })
        }

        if (!cancelled) {
          setPracticeMenuPages(pages)
        }
      } catch {
        if (!cancelled) setPracticeMenuPages([])
      }
    }

    loadPracticeMenuPages()

    return () => {
      cancelled = true
    }
  }, [isDomainModeBootstrapping, isSharedRootDomainMode, domainMode])

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setSelectedDesktopDraft('')
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  useEffect(() => {
    if (!selectedDesktopDraft) return

    const selectedDraftIsMissing = selectedDesktopDraft === 'home' && !selectedHomeContent

    if (selectedDraftIsMissing) {
      const timeoutId = window.setTimeout(() => {
        setSelectedDesktopDraft('')
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [selectedDesktopDraft, selectedHomeContent])

  useEffect(() => {
    let cancelled = false

    const loadStarterRecordSuggestions = async () => {
      const shouldLoadHeroStories = hasConfiguredHeroPost

      if (!shouldLoadLatestPostFeeds && !shouldLoadHeroStories) {
        setStarterPostRecords([])
        return
      }

      const contentDomain = isSharedRootDomainMode ? domainMode : ''
      const postQuery = contentDomain
        ? `/api/content?type=post&domain=${contentDomain}&limit=12`
        : '/api/content?type=post&limit=12'
      const articleQuery = contentDomain
        ? `/api/content?type=article&domain=${contentDomain}&limit=12`
        : '/api/content?type=article&limit=12'

      try {
        const [postResponse, articleResponse] = await Promise.all([
          (shouldLoadLatestPostFeeds || shouldLoadHeroStories)
            ? fetch(postQuery, { cache: 'no-store' })
            : Promise.resolve({ ok: true, json: async () => ({ success: true, content: [] }) }),
          (shouldLoadLatestPostFeeds || shouldLoadHeroStories)
            ? fetch(articleQuery, { cache: 'no-store' })
            : Promise.resolve({ ok: true, json: async () => ({ success: true, content: [] }) })
        ])

        const [postData, articleData] = await Promise.all([
          postResponse.json().catch(() => ({})),
          articleResponse.json().catch(() => ({}))
        ])

        if (cancelled) return

        const postItems =
          postResponse.ok && postData?.success && Array.isArray(postData?.content)
            ? postData.content
            : []

        const articleItems =
          articleResponse.ok && articleData?.success && Array.isArray(articleData?.content)
            ? articleData.content
            : []

        const domainMatchesMode = (item, mode) => {
          if (!mode) return true
          const attrs = parseMetadataObject(item?.attributes)
          const metadata = parseMetadataObject(item?.metadata)
          const domain = String(attrs?.domain || metadata?.domain || '').trim().toLowerCase()
          if (!domain) return false
          if (mode === DEFAULT_CONTENT_DOMAIN && domain === 'core') return showPracticeFrontendContent
          return domain === mode
        }

        const seenPostIds = new Set()
        const candidateItems = [...postItems, ...articleItems]
        const posts = candidateItems.filter((item) => {
          if (isSharedRootDomainMode && !showPracticeFrontendContent) return false
          if (isSharedRootDomainMode && !domainMatchesMode(item, domainMode)) return false
          const id = String(item?.id || '')
          if (!id || seenPostIds.has(id)) return false
          seenPostIds.add(id)
          return true
        }).sort(compareHomepageRecords)

        setStarterPostRecords(posts)
      } catch {
        if (cancelled) return
        setStarterPostRecords([])
      }
    }

    loadStarterRecordSuggestions()

    return () => {
      cancelled = true
    }
  }, [hasConfiguredHeroPost, isSharedRootDomainMode, domainMode, shouldLoadLatestPostFeeds, showPracticeFrontendContent])

  useEffect(() => {
    let cancelled = false

    const resolveHeroPost = async () => {
      if (!hasConfiguredHeroPost || !isSharedRootDomainMode) {
        setHeroPostItem(null)
        setIsHeroPostResolving(false)
        return
      }

      setIsHeroPostResolving(true)

      const matchingPost = starterPostRecords.find((item) => {
        const itemId = String(item?.id || '').trim()
        const itemSlug = getHomeItemSlug(item).toLowerCase()
        const itemType = String(item?.type || '').trim().toLowerCase()

        if (heroPostId && itemId === heroPostId) return true
        if (!heroPostSlug || itemSlug !== heroPostSlug) return false
        if (heroPostType && itemType && itemType !== heroPostType) return false
        return true
      })

      if (matchingPost) {
        setHeroPostItem(matchingPost)
        setIsHeroPostResolving(false)
        return
      }

      if (!heroPostId) {
        setHeroPostItem(null)
        setIsHeroPostResolving(false)
        return
      }

      try {
        const response = await fetch(`/api/content/${heroPostId}`, { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (cancelled) return

        const content = data?.content
        const attrs = parseMetadataObject(content?.attributes)
        const metadata = parseMetadataObject(content?.metadata)
        const domain = String(attrs?.domain || metadata?.domain || '').trim().toLowerCase()
        const type = String(content?.type || '').trim().toLowerCase()

        if (!response.ok || !data?.success || !content) {
          setHeroPostItem(null)
          if (!cancelled) setIsHeroPostResolving(false)
          return
        }

        if (domain !== domainMode || (type !== 'post' && type !== 'article')) {
          setHeroPostItem(null)
          if (!cancelled) setIsHeroPostResolving(false)
          return
        }

        setHeroPostItem(content)
        if (!cancelled) setIsHeroPostResolving(false)
      } catch {
        if (!cancelled) {
          setHeroPostItem(null)
          setIsHeroPostResolving(false)
        }
      }
    }

    resolveHeroPost()

    return () => {
      cancelled = true
    }
  }, [isSharedRootDomainMode, domainMode, starterPostRecords, hasConfiguredHeroPost, heroPostId, heroPostSlug, heroPostType])

  useEffect(() => {
    let cancelled = false

    const loadPracticeIndustryNews = async () => {
      if (!shouldLoadPracticeIndustryNews) {
        setPracticeIndustryNewsItems([])
        return
      }

      setLoadingPracticeIndustryNews(true)
      try {
        const response = await fetch(
          `/api/practice/news?domain=${encodeURIComponent(domainMode)}&topic=${encodeURIComponent(industryNewsTopic)}`,
          { cache: 'no-store' }
        )
        const data = await response.json().catch(() => ({}))
        if (!cancelled) {
          if (response.ok && data?.success && Array.isArray(data.news)) {
            setPracticeIndustryNewsItems(data.news)
          } else {
            setPracticeIndustryNewsItems([])
          }
        }
      } catch {
        if (!cancelled) setPracticeIndustryNewsItems([])
      } finally {
        if (!cancelled) setLoadingPracticeIndustryNews(false)
      }
    }

    loadPracticeIndustryNews()

    return () => {
      cancelled = true
    }
  }, [industryNewsTopic, isSharedRootDomainMode, domainMode, shouldLoadPracticeIndustryNews])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const debugParam = params.get('debug')
    const paletteParam = String(params.get('palette') || '').trim().toLowerCase()
    const isDebug = debugParam !== null
    const timeoutId = window.setTimeout(() => {
      setShowVersionBadge(process.env.NODE_ENV === 'development' || isDebug)
      setShowDomainPaletteTrayFromQuery(paletteParam === 'true')
      if (debugParam === '1') {
        setShowAiDebug(true)
        return
      }
      if (debugParam === '0') {
        setShowAiDebug(false)
      }
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const applyDomainPaletteToTemplatePreview = useCallback((colors, nextBgGradientTreatment = '') => {
    if (!colors || typeof colors !== 'object') return

    setHomeTemplateConfig((previousConfig) => {
      const nextConfig = previousConfig && typeof previousConfig === 'object' ? previousConfig : {}
      const existingBgTreatment = String(nextConfig?.bgGradientTreatment || '').trim()
      return {
        ...nextConfig,
        colors: {
          ...colors
        },
        bgGradientTreatment: String(nextBgGradientTreatment || '').trim() || existingBgTreatment || DEFAULT_BG_GRADIENT_TREATMENT
      }
    })
  }, [])

  const handleSelectDomainPalette = useCallback((paletteKey) => {
    const palette = DOMAIN_DESIGNER_PRESET_PALETTES.find((candidate) => candidate.key === paletteKey)
    if (!palette || isDomainPaletteSettingsSaving) return

    setDomainPaletteSettings((previous) => ({
      ...previous,
      paletteKey: palette.key,
      colors: { ...palette.colors }
    }))
    setIsDomainPaletteDirty(true)
    setDomainPaletteStatusMessage('')
    applyDomainPaletteToTemplatePreview(palette.colors, domainPaletteSettings.bgGradientTreatment)
  }, [applyDomainPaletteToTemplatePreview, domainPaletteSettings.bgGradientTreatment, isDomainPaletteSettingsSaving])

  const saveDomainPaletteSettings = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!isDomainPaletteSupported) return

    const adminToken = String(window.localStorage.getItem('adminToken') || '').trim()
    if (!adminToken) {
      setDomainPaletteStatusMessage('Admin sign-in required to save palette settings.')
      return
    }

    setIsDomainPaletteSettingsSaving(true)
    setDomainPaletteStatusMessage('')

    try {
      const response = await fetch('/api/settings/domain-homepage-palette', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          domain: domainMode,
          settings: {
            enabled: domainPaletteSettings.enabled,
            editMode: domainPaletteSettings.editMode,
            paletteKey: domainPaletteSettings.paletteKey,
            bgGradientTreatment: domainPaletteSettings.bgGradientTreatment,
            colors: domainPaletteSettings.colors || templateColors
          }
        })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || 'Failed to save palette settings')
      }

      const saved = data?.settings && typeof data.settings === 'object' ? data.settings : domainPaletteSettings
      setDomainPaletteSettings((previous) => ({
        ...previous,
        ...saved
      }))
      if (saved?.colors && typeof saved.colors === 'object') {
        applyDomainPaletteToTemplatePreview(saved.colors, saved.bgGradientTreatment)
      }

      setIsDomainPaletteDirty(false)
      setDomainPaletteStatusMessage('Saved')
      setIsDomainPaletteTrayCollapsed(true)
    } catch (saveError) {
      setDomainPaletteStatusMessage(saveError?.message || 'Failed to save palette settings')
    } finally {
      setIsDomainPaletteSettingsSaving(false)
    }
  }, [
    applyDomainPaletteToTemplatePreview,
    domainPaletteSettings,
    isDomainPaletteSupported,
    domainMode,
    templateColors
  ])

  useEffect(() => {
    if (isDomainModeBootstrapping) return
    if (!isDomainPaletteSupported) return

    let cancelled = false

    const loadDomainPaletteSettings = async () => {
      try {
        const response = await fetch(`/api/settings/domain-homepage-palette?domain=${encodeURIComponent(domainMode)}`, {
          cache: 'no-store'
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data?.success !== true || cancelled) return

        const settings = data?.settings && typeof data.settings === 'object'
          ? data.settings
          : {
            enabled: false,
            editMode: false,
            paletteKey: '',
            bgGradientTreatment: DEFAULT_BG_GRADIENT_TREATMENT,
            colors: null
          }

        setDomainPaletteSettings((previous) => ({
          ...previous,
          ...settings
        }))
        setIsDomainPaletteDirty(false)
        setDomainPaletteStatusMessage('')

        if (settings?.colors && typeof settings.colors === 'object' && (settings.enabled || showDomainPaletteTrayFromQuery)) {
          applyDomainPaletteToTemplatePreview(settings.colors, settings.bgGradientTreatment)
        }
      } catch {
        // Keep defaults when settings cannot be loaded.
      }
    }

    loadDomainPaletteSettings()

    return () => {
      cancelled = true
    }
  }, [
    applyDomainPaletteToTemplatePreview,
    isDomainPaletteSupported,
    isDomainModeBootstrapping,
    domainMode,
    showDomainPaletteTrayFromQuery
  ])

  useEffect(() => {
    if (!showDomainPaletteTray) return
    if (typeof window === 'undefined') return
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    const timeoutId = window.setTimeout(() => {
      setIsDomainPaletteTrayCollapsed(isMobile)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [showDomainPaletteTray, domainMode])

  const splitSummaryParagraphs = (text) => {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
  }

  const latestPostItems = useMemo(() => resolveLatestPostItems({
    items: starterPostRecords,
    heroPostId: heroPostItem?.id,
    limit: latestPostsLimit,
    orderMode: latestPostsOrderMode,
    orderedIds: latestPostsOrderedIds,
    orderedSlugs: latestPostsOrderedSlugs
  }), [heroPostItem?.id, latestPostsLimit, latestPostsOrderMode, latestPostsOrderedIds, latestPostsOrderedSlugs, starterPostRecords])
  const renderPracticeHomePageBlock = useCallback((block) => {
    if (block?.type === 'industry_news') {
      const blockHeading = String(block.heading || '').trim() || 'Industry News'

      return (
        <section key={block.id} className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{blockHeading}</h3>

          {loadingPracticeIndustryNews ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 py-3" role="status" aria-live="polite">
              <svg className="animate-spin h-4 w-4 text-gray-600 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span>Generating industry news article...</span>
            </div>
          ) : practiceIndustryNewsItems.length === 0 ? (
            <p className="text-sm text-gray-600">No industry news is available right now.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {practiceIndustryNewsItems.map((item, index) => {
                const isSelected = selectedDesktopDraft === 'home' && selectedHomeContent === item
                const metadata = parseMetadataObject(item?.metadata)
                const sources = Array.isArray(metadata?.sources)
                  ? metadata.sources.filter((source) => typeof source?.url === 'string' && source.url.trim())
                  : []

                return (
                  <article
                    key={item?.id || `practice-industry-news-${index}`}
                    className={`${pageStyles.cards.news} ${isSelected ? pageStyles.cards.selected : ''} ${pageStyles.cards.interactive}`}
                    onClick={() => {
                      setSelectedHomeContent(item)
                      setSelectedDesktopDraft('home')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedHomeContent(item)
                        setSelectedDesktopDraft('home')
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="mb-3 h-1.5 w-14 rounded-full bg-gradient-to-r from-sky-400 to-cyan-300" aria-hidden="true" />
                    <h4 className="text-lg font-semibold leading-tight tracking-[-0.01em] text-slate-900">{getHomeItemTitle(item)}</h4>
                    <p
                      className="mt-3 text-[15px] leading-7 text-slate-700"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {getHomeItemSummary(item) || 'No summary available.'}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-sky-100/80 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700/85">
                      <span>{sources.length} source{sources.length === 1 ? '' : 's'}</span>
                      <span>Open Article</span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )
    }

    if (block?.type !== 'latest_posts') return undefined

    const blockHeading = String(block.heading || '').trim() || 'Latest Posts'
    const blockLayout = normalizeLatestPostsLayout(block.layout)
    const blockItems = resolveLatestPostItems({
      items: starterPostRecords,
      heroPostId: heroPostItem?.id,
      limit: block.limit,
      orderMode: block.orderMode,
      orderedIds: block.postIds,
      orderedSlugs: block.postSlugs
    })
    const blockLayoutClass = blockLayout === 'list'
      ? 'space-y-3'
      : blockLayout === 'compact'
        ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
        : 'grid grid-cols-1 sm:grid-cols-2 gap-3'
    const summaryLineClamp = blockLayout === 'compact' ? 3 : 5

    return (
      <section key={block.id} className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{blockHeading}</h3>

        {blockItems.length === 0 ? (
          <p className="text-sm text-gray-600">No practice posts are available yet.</p>
        ) : (
          <div className={blockLayoutClass}>
            {blockItems.map((item, index) => (
              <article
                key={item?.id || `block-post-item-${index}`}
                className={`${pageStyles.cards.latestPost} ${blockLayout === 'list' ? 'px-5 py-4' : ''} ${blockLayout === 'compact' ? 'px-4 py-3' : ''} ${item?.id && selectedHomeContent?.id === item.id ? pageStyles.cards.selected : ''} ${item?.id ? pageStyles.cards.interactive : ''}`}
                onClick={() => {
                  if (!item?.id) return
                  setSelectedHomeContent(item)
                  setSelectedDesktopDraft('home')
                }}
                onKeyDown={(event) => {
                  if (!item?.id) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedHomeContent(item)
                    setSelectedDesktopDraft('home')
                  }
                }}
                role={item?.id ? 'button' : undefined}
                tabIndex={item?.id ? 0 : undefined}
              >
                <h4 className="text-base font-semibold text-gray-900 min-w-0">{getHomeItemTitle(item)}</h4>
                <p
                  className="mt-3 text-sm text-gray-700 leading-relaxed"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: summaryLineClamp,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {getHomeItemSummary(item) || 'No summary available.'}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    )
  }, [
    heroPostItem?.id,
    loadingPracticeIndustryNews,
    pageStyles.cards.interactive,
    pageStyles.cards.latestPost,
    pageStyles.cards.news,
    pageStyles.cards.selected,
    selectedDesktopDraft,
    selectedHomeContent,
    starterPostRecords,
    practiceIndustryNewsItems
  ])
  const desktopReaderDraft =
    selectedDesktopDraft === 'home'
      ? {
        id: 'home',
        label: selectedHomeContent?.type === 'production' ? homeProductionLabel : homePostLabel,
        article: selectedHomeContent,
        title: getHomeItemTitle(selectedHomeContent),
        summaryText: getHomeItemSummary(selectedHomeContent),
        badgeClass: selectedHomeContent?.type === 'production'
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }
      : null
  const isDesktopReaderOpen = Boolean(selectedDesktopDraft === 'home' && selectedHomeContent)

  const renderModuleLoadingCards = () => (
    <div className="flex items-center gap-2 sm:gap-3" aria-live="polite" aria-label="Loading modules">
      <div className="h-8 w-24 animate-pulse rounded-lg border border-sky-200/80 bg-sky-100/80 sm:w-28" />
      <div className="h-8 w-20 animate-pulse rounded-lg border border-sky-200/80 bg-sky-100/80 sm:w-24" />
      <div className="h-8 w-28 animate-pulse rounded-lg border border-sky-200/80 bg-sky-100/80 sm:w-32" />
    </div>
  )

  const DomainLanding = DOMAIN_LANDINGS[domainMode]
  if (DomainLanding) {
    return (
      <>
        <DomainLanding isAdminAuthenticated={isAdminAuthenticated} />
        <DomainAdminFloatingLink show={adminFloatingLinkEnabled} offsetForVersionBadge={showVersionBadge} />
      </>
    )
  }

  return (
    <>
      {isAdminAuthenticated && <AdminBanner />}
      <DomainAdminFloatingLink show={adminFloatingLinkEnabled} offsetForVersionBadge={showVersionBadge} />
      {isSharedRootDomainMode && (
        <div className={`${pageStyles.layout.page} ${isReturningFromSlugPage ? 'slide-in-panel-left open' : ''}`} style={pageShellStyle}>
          <div className={pageStyles.layout.container}>
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                {isDomainModeBootstrapping && showDomainModeLoadingIndicator ? (
                  renderModuleLoadingCards()
                ) : !isDomainModeBootstrapping && !isHomeTemplateConfigLoading && publicHomeHeading && !showHeroFeaturePanel ? (
                  <h1 className="text-xl font-semibold text-gray-900">
                    {publicHomeHeading}
                  </h1>
                ) : null}
              </div>

              {isSharedRootDomainMode && visiblePracticeMenuItems.length > 0 && (
                <nav className={pageStyles.menu.nav} style={menuNavStyle}>
                  <ul className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
                    {visiblePracticeMenuItems.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={prefixPathWithDomainMode(item.isBlockHotlink ? item.slug : `/${item.slug}`, modePathPrefix)}
                          className={pageStyles.menu.chip}
                          style={menuChipStyle}
                        >
                          {item.title || item.slug}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>

            <div className={pageStyles.layout.contentSurface} style={domainPaletteSurfaceStyle}>
              <div className="w-full space-y-5 sm:space-y-10 lg:mx-auto lg:max-w-[68rem]">
                {showHeroFeaturePanel && (
                      <section
                        className="mx-auto w-full"
                        data-hero-capture="true"
                        style={{
                          opacity: isHeroPostResolving ? 0 : 1,
                          transition: isHeroPostResolving ? 'none' : 'opacity 0.4s ease'
                        }}
                      >
                        {showHeroBanner ? (
                          <div className="-mx-4 sm:-mx-6 lg:relative lg:left-1/2 lg:right-1/2 lg:mx-0 lg:w-screen lg:-translate-x-1/2">
                            <div className="relative mx-auto w-full max-w-none overflow-hidden rounded-none" style={heroBannerShellStyle}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={heroBannerUrl}
                                alt={heroHeading || `${domainLabel} hero banner`}
                                className={`block w-full object-center object-cover ${heroPostItem || showHeroHeadingBlock ? 'h-[10rem] sm:h-[13rem] lg:h-[17rem]' : 'h-28 sm:h-36'}`}
                              />
                              {heroBannerGradientEnabled && (
                                <>
                                  <div className="pointer-events-none absolute inset-0" style={heroBannerGradientStyle} />
                                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.2)_32%,rgba(255,255,255,0.82)_72%,#ffffff)]" />
                                </>
                              )}

                              {showHeroHeadingBlock && !heroPostItem && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0">
                                  <div className="mx-auto w-full max-w-6xl px-4 pb-7 sm:px-6 sm:pb-10 lg:max-w-[68rem] lg:px-8 lg:pb-14 xl:px-10">
                                    <div className="max-w-4xl">
                                      {heroHeading && <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{heroHeading}</h2>}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className={`relative z-10 mx-auto w-full max-w-6xl px-0 lg:max-w-[68rem] lg:px-8 xl:px-10 ${heroPostItem ? '-mt-14 px-3 sm:-mt-10 sm:px-6 lg:-mt-16 lg:px-8' : '-mt-12 px-3 sm:-mt-9 sm:px-6 lg:-mt-16 lg:px-8'}`}>
                              <div className={heroPostItem
                                ? 'mx-auto w-full max-w-[calc(100%-0.5rem)] sm:max-w-none grid gap-4 sm:gap-6 rounded-[28px] border border-gray-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.94)_34%,rgba(255,255,255,0.9))] px-6 py-7 shadow-[0_28px_60px_-48px_rgba(15,23,42,0.22)] sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)] lg:items-start lg:gap-12 lg:px-10 lg:py-10 xl:px-12'
                                : 'mx-auto w-full max-w-[calc(100%-0.5rem)] sm:max-w-5xl overflow-hidden rounded-[32px] border border-sky-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.92))] shadow-[0_28px_60px_-48px_rgba(3,105,161,0.2)] backdrop-blur-md'} style={heroPostItem ? heroFeatureCardStyle : heroHeadingCardStyle}>
                                {showHeroHeadingBlock && (
                                  <div className={`px-6 py-6 sm:px-8 sm:py-8 lg:px-10 ${heroPostItem ? 'px-0 py-1 sm:px-0 sm:py-2 lg:px-0 lg:py-3' : 'py-7 text-center sm:px-10 sm:py-8 lg:px-12'}`}>
                                    {heroLogoImage && (
                                      <button
                                        type="button"
                                        aria-label="Enlarge profile image"
                                        onClick={() => setHeroLogoImageOpen(true)}
                                        className={`mb-5 block cursor-zoom-in rounded-full p-0 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 ${heroPostItem ? '' : 'mx-auto'}`}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={heroLogoImage}
                                          alt=""
                                          className="h-20 w-20 rounded-full object-cover object-top ring-4 ring-white shadow-[0_0_0_7px_rgba(14,165,233,0.25),0_12px_40px_-8px_rgba(15,23,42,0.32)] sm:h-24 sm:w-24"
                                          style={heroLogoStyle}
                                        />
                                      </button>
                                    )}
                                    {heroHeading && heroPostItem && <h2 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{heroHeading}</h2>}
                                    {heroSubheading && (
                                      <p className={`text-sm leading-7 text-slate-600 sm:text-base ${heroPostItem ? 'max-w-2xl lg:mt-4' : 'mx-auto max-w-2xl'}`}>
                                        {heroSubheading}
                                      </p>
                                    )}
                                    {!heroSubheading && heroHeading && (
                                      <p className={`text-sm leading-7 text-slate-600 sm:text-base ${heroPostItem ? 'max-w-2xl lg:mt-4' : 'mx-auto max-w-2xl'}`}>
                                        Explore New York stories, productions, and place-based reporting directly from the day&apos;s main feature.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {heroPostItem && (
                                  <article
                                    className={`${pageStyles.cards.latestPost} ${heroPostItem?.id ? pageStyles.cards.interactive : ''} min-h-0 !rounded-none !border-0 !bg-transparent px-2 py-2 shadow-none transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent sm:px-0 sm:py-3 lg:max-w-sm lg:justify-self-end lg:self-end`}
                                    onClick={() => {
                                      if (!heroPostItem?.id) return
                                      setSelectedHomeContent(heroPostItem)
                                      setSelectedDesktopDraft('home')
                                    }}
                                    onKeyDown={(event) => {
                                      if (!heroPostItem?.id) return
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        setSelectedHomeContent(heroPostItem)
                                        setSelectedDesktopDraft('home')
                                      }
                                    }}
                                    role={heroPostItem?.id ? 'button' : undefined}
                                    tabIndex={heroPostItem?.id ? 0 : undefined}
                                  >
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={heroEyebrowStyle}>
                                      {heroLabel}
                                    </p>
                                    <h3 className="mt-3 text-xl font-semibold leading-tight text-stone-950 sm:text-2xl">
                                      {getHomeItemTitle(heroPostItem)}
                                    </h3>
                                    <p
                                      className="mt-4 text-sm leading-7 text-stone-700 sm:text-[15px]"
                                      style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: 4,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                      }}
                                    >
                                      {getHomeItemSummary(heroPostItem) || 'No summary available.'}
                                    </p>
                                  </article>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (showHeroHeadingBlock || heroPostItem) ? (
                          <div className="px-4 pb-4 sm:px-8 sm:pb-8">
                            <div className={`${showHeroHeadingBlock && heroPostItem ? 'mx-auto max-w-4xl' : 'mx-auto max-w-2xl'}`}>
                              {!(showHeroHeadingBlock && heroPostItem) && (
                                <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.24em]" style={heroEyebrowStyle}>
                                  <span className="inline-block h-px w-8 bg-current opacity-60" aria-hidden="true" />
                                  {heroLabel}
                                </div>
                              )}
                              <div
                                className={showHeroHeadingBlock && heroPostItem
                                  ? 'grid gap-4 sm:gap-6 rounded-[28px] border border-gray-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.94)_34%,rgba(255,255,255,0.9))] px-6 py-7 shadow-[0_28px_60px_-48px_rgba(15,23,42,0.22)] sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)] lg:items-start lg:gap-12 lg:px-10 lg:py-10 xl:px-12'
                                  : showHeroHeadingBlock
                                    ? 'overflow-hidden rounded-[32px] border border-sky-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.92))] shadow-[0_28px_60px_-48px_rgba(3,105,161,0.2)] backdrop-blur-md'
                                    : ''}
                                style={showHeroHeadingBlock && heroPostItem ? heroFeatureCardStyle : showHeroHeadingBlock ? heroHeadingCardStyle : undefined}
                              >
                                {showHeroHeadingBlock && (
                                  <div className={heroPostItem ? 'px-0 py-1 sm:px-0 sm:py-2 lg:px-0 lg:py-3' : 'px-6 py-7 text-center sm:px-10 sm:py-8 lg:px-12'}>
                                    {heroLogoImage && (
                                      <button
                                        type="button"
                                        aria-label="Enlarge profile image"
                                        onClick={() => setHeroLogoImageOpen(true)}
                                        className={`mb-5 block cursor-zoom-in rounded-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 ${heroPostItem ? '' : 'mx-auto'}`}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={heroLogoImage}
                                          alt=""
                                          className="h-20 w-20 rounded-full object-cover object-top ring-4 ring-white shadow-[0_0_0_7px_rgba(14,165,233,0.25),0_12px_40px_-8px_rgba(15,23,42,0.32)] sm:h-24 sm:w-24"
                                          style={heroLogoStyle}
                                        />
                                      </button>
                                    )}
                                    {heroHeading && <h2 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{heroHeading}</h2>}
                                    {heroSubheading && (
                                      <p className={`text-sm leading-7 text-slate-600 sm:text-base ${heroPostItem ? 'max-w-2xl lg:mt-4' : 'mx-auto max-w-2xl'}`}>
                                        {heroSubheading}
                                      </p>
                                    )}
                                    {!heroSubheading && heroHeading && (
                                      <p className={`text-sm leading-7 text-slate-600 sm:text-base ${heroPostItem ? 'max-w-2xl lg:mt-4' : 'mx-auto max-w-2xl'}`}>
                                        Explore New York stories, productions, and place-based reporting directly from the day&apos;s main feature.
                                      </p>
                                    )}
                                  </div>
                                )}
                                {heroPostItem && (
                                  <article
                                    className={showHeroHeadingBlock
                                      ? `${pageStyles.cards.latestPost} ${heroPostItem?.id ? pageStyles.cards.interactive : ''} min-h-0 !rounded-none !border-0 !bg-transparent px-2 py-2 shadow-none transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent sm:px-0 sm:py-3 lg:max-w-sm lg:justify-self-end lg:self-end`
                                      : `${pageStyles.cards.latestPost} ${heroPostItem?.id && selectedHomeContent?.id === heroPostItem.id ? pageStyles.cards.selected : ''} ${heroPostItem?.id ? pageStyles.cards.interactive : ''}`}
                                    onClick={() => {
                                      if (!heroPostItem?.id) return
                                      setSelectedHomeContent(heroPostItem)
                                      setSelectedDesktopDraft('home')
                                    }}
                                    onKeyDown={(event) => {
                                      if (!heroPostItem?.id) return
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        setSelectedHomeContent(heroPostItem)
                                        setSelectedDesktopDraft('home')
                                      }
                                    }}
                                    role={heroPostItem?.id ? 'button' : undefined}
                                    tabIndex={heroPostItem?.id ? 0 : undefined}
                                  >
                                    {!showHeroHeadingBlock && <h3 className="text-lg font-semibold text-stone-950 min-w-0">{getHomeItemTitle(heroPostItem)}</h3>}
                                    {showHeroHeadingBlock && (
                                      <>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={heroEyebrowStyle}>
                                          {heroLabel}
                                        </p>
                                        <h3 className="mt-3 text-xl font-semibold leading-tight text-stone-950 sm:text-2xl">
                                          {getHomeItemTitle(heroPostItem)}
                                        </h3>
                                      </>
                                    )}
                                    <p
                                      className={`${showHeroHeadingBlock ? 'mt-4 text-sm leading-7 sm:text-[15px]' : 'mt-3 text-sm leading-7'} text-stone-700`}
                                      style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: 4,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                      }}
                                    >
                                      {getHomeItemSummary(heroPostItem) || 'No summary available.'}
                                    </p>
                                  </article>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </section>
                )}

                {showTopContactCtaSection && (
                  <ScrollReveal enabled={scrollRevealEnabled}>
                    <section className="-mx-4 sm:-mx-6 lg:mx-0">
                      <div className="mx-auto w-full max-w-6xl px-3 pt-0 pb-0 sm:px-6 lg:max-w-[68rem] lg:px-8">
                        <div className="flex flex-col items-center justify-center gap-3 pt-0 pb-0 sm:pt-3 sm:pb-0 md:flex-row md:gap-6">
                          {showTopPrimaryContactCta && (
                            <a
                              href={topContactCtaResolvedHref}
                              className={contactCtaButtonClass}
                              style={contactCtaButtonStyle}
                            >
                              {topContactCtaText}
                            </a>
                          )}
                          {showTopSecondaryContactCta && (
                            <a
                              href={topContactSecondaryCtaResolvedHref}
                              className={contactCtaSecondaryClass}
                              style={contactCtaSecondaryStyle}
                            >
                              {topContactSecondaryCtaText}
                            </a>
                          )}
                          {showTopLinkedInContactCta && (
                            <a
                              href={topLinkedInCtaHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center"
                              aria-label="View my LinkedIn profile"
                            >
                              <span className="rounded-full border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50">
                                LinkedIn
                              </span>
                            </a>
                          )}
                        </div>
                      </div>
                    </section>
                  </ScrollReveal>
                )}

                {showHomePageBlocksSection && (
                  <section className="-mx-4 sm:-mx-6 lg:mx-0">
                    <div className="mx-auto w-full max-w-6xl lg:max-w-[68rem]">
                      <div className="mx-auto w-full max-w-6xl space-y-5 px-3 pt-0 pb-6 sm:py-6 sm:px-6 lg:max-w-[68rem] lg:px-8">
                        <PageContentArticle
                          pageTitle=""
                          summaryParagraphs={[]}
                          bodyParagraphs={[]}
                          blocks={resolvedHomePageBlocks}
                          pageStyles={{ ...pageStyles, detail: { ...pageStyles.detail, body: pageStyles.detail.body.replace(/\bpt-\d+\b/, 'pt-0') } }}
                          renderBlock={renderPracticeHomePageBlock}
                          paletteColors={templateColors}
                          scrollReveal={scrollRevealEnabled}
                          pathPrefix={modePathPrefix}
                        />
                      </div>
                    </div>
                  </section>
                )}

                {showBottomContactCtaSection && (
                  <ScrollReveal enabled={scrollRevealEnabled}>
                    <section className="-mx-4 sm:-mx-6 lg:mx-0">
                      <div className="mx-auto w-full max-w-6xl px-3 pt-0 pb-0 sm:px-6 lg:max-w-[68rem] lg:px-8">
                        {showBottomContactIntro && (
                          <div className="mx-auto mb-4 max-w-3xl text-center">
                            {bottomContactTitle && (
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500" style={bottomContactTitleStyle}>{bottomContactTitle}</p>
                            )}
                            {bottomContactHeading && (
                              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{bottomContactHeading}</h3>
                            )}
                            {bottomContactDescription && (
                              <p className="mt-2 text-sm leading-7 text-gray-600 sm:text-base">{bottomContactDescription}</p>
                            )}
                          </div>
                        )}
                        <div className="flex flex-col items-center justify-center gap-3 pt-0 pb-0 sm:pt-3 sm:pb-0 md:flex-row md:gap-6">
                          {showBottomPrimaryContactCta && (
                            <a
                              href={bottomContactCtaResolvedHref}
                              className={contactCtaButtonClass}
                              style={contactCtaButtonStyle}
                            >
                              {bottomContactCtaText}
                            </a>
                          )}
                          {showBottomSecondaryContactCta && (
                            <a
                              href={bottomContactSecondaryCtaResolvedHref}
                              className={contactCtaSecondaryClass}
                              style={contactCtaSecondaryStyle}
                            >
                              {bottomContactSecondaryCtaText}
                            </a>
                          )}
                          {showBottomLinkedInContactCta && (
                            <a
                              href={bottomLinkedInCtaHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center"
                              aria-label="View my LinkedIn profile"
                            >
                              <span className="rounded-full border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50">
                                LinkedIn
                              </span>
                            </a>
                          )}
                        </div>
                      </div>
                    </section>
                  </ScrollReveal>
                )}

                {showLatestPostsSection && !hasLatestPostsBlock && (
                  <ScrollReveal enabled={scrollRevealEnabled}>
                    <section className="-mx-4 sm:-mx-6 lg:mx-0">
                      <div className="mx-auto w-full max-w-6xl space-y-4 px-3 sm:px-6 lg:max-w-[68rem] lg:px-8">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{latestPostsHeading}</h3>
                        </div>

                        {latestPostItems.length === 0 ? (
                          <p className="text-sm text-gray-600">No practice posts are available yet.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {latestPostItems.map((item, index) => (
                              <article
                                key={item?.id || `post-item-${index}`}
                                className={`${pageStyles.cards.latestPost} ${item?.id && selectedHomeContent?.id === item.id ? pageStyles.cards.selected : ''} ${item?.id ? pageStyles.cards.interactive : ''}`}
                                style={isDomainPalettePreview ? {
                                  ...domainPaletteCardBaseStyle,
                                  ...(item?.id && selectedHomeContent?.id === item.id ? domainPaletteCardSelectedStyle : {})
                                } : undefined}
                                onClick={() => {
                                  if (!item?.id) return
                                  setSelectedHomeContent(item)
                                  setSelectedDesktopDraft('home')
                                }}
                                onKeyDown={(event) => {
                                  if (!item?.id) return
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setSelectedHomeContent(item)
                                    setSelectedDesktopDraft('home')
                                  }
                                }}
                                role={item?.id ? 'button' : undefined}
                                tabIndex={item?.id ? 0 : undefined}
                              >
                                <h4 className="text-base font-semibold text-gray-900 min-w-0">{getHomeItemTitle(item)}</h4>
                                <p
                                  className="mt-3 text-sm text-gray-700 leading-relaxed"
                                  style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 5,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                  }}
                                >
                                  {getHomeItemSummary(item) || 'No summary available.'}
                                </p>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </ScrollReveal>
                )}

                <aside className={`fixed inset-0 z-50 bg-white overflow-y-auto transition-all duration-300 ease-out will-change-transform ${isDesktopReaderOpen
                    ? 'translate-x-0 opacity-100 visible pointer-events-auto'
                    : 'translate-x-full opacity-0 invisible pointer-events-none'
                    }`}
                    style={{
                      WebkitTransform: isDesktopReaderOpen ? 'translateX(0)' : 'translateX(100%)',
                      WebkitTransition: 'all 300ms ease-out',
                    }}>
                    <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
                      <button
                        onClick={() => setSelectedDesktopDraft('')}
                        className="p-2 -ml-2 text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label="Back"
                        title="Back (or press Escape)"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      {desktopReaderDraft?.id !== 'home' && (
                        <p className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${desktopReaderDraft?.badgeClass || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {desktopReaderDraft?.label || 'Post'}
                        </p>
                      )}
                    </div>

                    {desktopReaderDraft?.article && (
                      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                        <div className="flex items-center gap-4">
                          {desktopReaderDraft.imageUrl && (
                            <Image
                              src={desktopReaderDraft.imageUrl}
                              alt={desktopReaderDraft.label}
                              unoptimized
                              width={256}
                              height={144}
                              className={`bg-white flex-shrink-0 ${desktopReaderDraft.id === 'home' ? 'w-auto h-auto max-w-24 max-h-10 lg:max-w-28 lg:max-h-12 object-contain' : 'w-28 h-28 lg:w-64 lg:h-36 object-cover'}`}
                            />
                          )}
                          <h1 className="text-2xl font-bold text-gray-900">{desktopReaderDraft.title}</h1>
                        </div>

                        <div className="space-y-4 text-gray-700">
                          {splitSummaryParagraphs(desktopReaderDraft.summaryText).map((paragraph, index) => (
                            <p key={`${desktopReaderDraft.id}-reader-${index}`} className="text-base leading-relaxed">
                              {paragraph}
                            </p>
                          ))}
                        </div>
                        {Array.isArray(desktopReaderDraft.article?.metadata?.sources) && desktopReaderDraft.article.metadata.sources.length > 0 && (
                          <div className="pt-4 border-t border-gray-200">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Sources</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {desktopReaderDraft.article.metadata.sources.map((source, sourceIndex) => (
                                <a
                                  key={`${source.url}-${sourceIndex}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-rose-700 underline underline-offset-2 hover:text-rose-900"
                                >
                                  {source.label || 'Source'}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </aside>
              </div>
            </div>
          </div>
        </div>
      )}
      {showDomainPaletteTray && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50"
          style={{
            transform: isDomainPaletteTrayCollapsed ? `translateY(${DOMAIN_PALETTE_PANEL_HEIGHT}px)` : 'translateY(0)',
            transition: 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        >
          <div className="flex justify-end pr-6">
            <button
              type="button"
              aria-label={isDomainPaletteTrayCollapsed ? 'Show palette tray' : 'Hide palette tray'}
              onClick={() => setIsDomainPaletteTrayCollapsed((previous) => !previous)}
              className="relative flex items-center gap-1.5 rounded-t-xl border-x border-t px-4 py-1.5 backdrop-blur-lg transition-opacity hover:opacity-100"
              style={{
                borderColor: withAlpha(templateColors.color2, 0.24),
                backgroundColor: withAlpha(templateColors.backgroundColor, 0.9),
                opacity: isDomainPaletteTrayCollapsed ? 1 : 0.72,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                style={{
                  color: withAlpha(templateColors.color2, 0.7),
                  transform: isDomainPaletteTrayCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                <path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: withAlpha(templateColors.color2, 0.7) }}>
                {domainLabel} Palette
              </span>
            </button>
          </div>

          <div
            className="border-t backdrop-blur-lg"
            style={{
              height: DOMAIN_PALETTE_PANEL_HEIGHT,
              borderTopColor: withAlpha(templateColors.color2, 0.24),
              backgroundColor: withAlpha(templateColors.backgroundColor, 0.92),
            }}
          >
            <div className="flex h-full items-center gap-3 px-4">
              <div className="flex flex-1 gap-2 overflow-x-auto py-2" style={{ scrollbarWidth: 'none' }}>
                {DOMAIN_DESIGNER_PRESET_PALETTES.map((palette) => {
                  const isActive = domainPaletteSettings.paletteKey
                    ? domainPaletteSettings.paletteKey === palette.key
                    : false
                  const inactiveButtonBg = palette.colors.backgroundColor
                  const activeButtonBg = palette.colors.color2
                  const buttonBg = isActive ? activeButtonBg : inactiveButtonBg
                  const buttonTextColor = getContrastingTextColor(buttonBg)

                  return (
                    <button
                      key={palette.key}
                      type="button"
                      title={palette.label}
                      onClick={() => handleSelectDomainPalette(palette.key)}
                      disabled={isDomainPaletteSettingsSaving}
                      className="shrink-0 rounded-xl border px-3 py-2 text-left transition-all"
                      style={{
                        borderColor: isActive ? withAlpha(palette.colors.color1, 0.62) : withAlpha(palette.colors.color2, 0.3),
                        backgroundColor: buttonBg,
                      }}
                    >
                      <span className="block whitespace-nowrap text-[11px] font-semibold" style={{ color: buttonTextColor }}>
                        {palette.label}
                      </span>
                      <div className="mt-1 flex gap-1">
                        {['color1', 'color2', 'color3', 'backgroundColor'].map((colorKey) => (
                          <span key={colorKey} className="h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: palette.colors[colorKey] }} />
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {domainPaletteStatusMessage && (
                  <span className="text-[11px]" style={{ color: withAlpha(templateColors.color3, 0.7) }}>
                    {domainPaletteStatusMessage}
                  </span>
                )}
                <button
                  type="button"
                  onClick={saveDomainPaletteSettings}
                  disabled={isDomainPaletteSettingsSaving || !isDomainPaletteDirty}
                  className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: withAlpha(templateColors.color2, 0.28),
                    backgroundColor: withAlpha(templateColors.color2, 0.12),
                    color: templateColors.color2
                  }}
                >
                  {isDomainPaletteSettingsSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showVersionBadge && (
        <div className="fixed bottom-3 right-3 z-50">
          <span className="text-xs text-gray-400 bg-white/80 border border-gray-200 rounded px-2 py-1 font-mono">
            v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString() : 'dev'}
          </span>
        </div>
      )}
      {heroLogoImage && heroLogoImageOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setHeroLogoImageOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Profile image enlarged view"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroLogoImage}
            alt=""
            className="max-h-[75vh] w-auto max-w-[88vw] sm:max-w-[28rem] lg:max-w-[32rem] rounded-2xl object-contain shadow-2xl ring-4 ring-white/20"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setHeroLogoImageOpen(false)}
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}
