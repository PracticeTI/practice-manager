import { getPrivateDomainFieldMap } from './domainExtension.js'

const SHARED_DOMAIN_PAGE_STYLE_TEMPLATE = {
    layout: {
        page: 'min-h-screen bg-gradient-to-b from-gray-50 to-white',
        container: 'max-w-7xl mx-auto px-4 py-4',
        contentSurface: 'mb-4 md:bg-white md:p-4 lg:p-5 md:border md:border-gray-200 md:rounded-2xl md:shadow-sm'
    },
    detail: {
        container: 'max-w-3xl mx-auto px-4 py-10',
        metaRow: 'mb-6 flex items-center justify-between gap-4',
        backLink: 'text-sm text-gray-700 hover:text-gray-900 underline underline-offset-4',
        readerFrame: 'slide-in-panel',
        readerHeader: 'sticky top-0 z-10 mb-6 border-b border-gray-200 bg-white px-4 py-4 flex items-center justify-between',
        backButton: 'p-2 -ml-2 text-gray-400 hover:text-gray-600 transition-colors',
        categoryBadge: 'inline-flex rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600',
        content: 'max-w-3xl mx-auto px-4 py-6 space-y-4',
        article: 'space-y-4',
        title: 'text-2xl font-bold text-gray-900',
        summary: 'space-y-4 text-gray-700',
        body: 'pt-4 border-t border-gray-200 space-y-4 text-gray-700',
        paragraph: 'text-base leading-relaxed'
    },
    menu: {
        nav: 'mb-5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm lg:flex lg:justify-end',
        chip: 'inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900'
    },
    cards: {
        selected: 'border-gray-400 bg-gray-50',
        interactive: 'cursor-pointer',
        searchResult: 'rounded-xl border border-gray-300 p-3 bg-white min-h-[220px] flex flex-col transition-colors',
        searchEmpty: 'rounded-xl border border-gray-300 p-3 bg-white text-sm text-gray-700',
        production: 'rounded-xl border border-gray-300 p-3 bg-white min-h-[220px] flex flex-col transition-colors',
        news: 'rounded-2xl border border-sky-200/70 p-4 bg-gradient-to-b from-white to-sky-50/40 min-h-[220px] flex flex-col transition-all duration-200 shadow-[0_18px_44px_-34px_rgba(2,132,199,0.35)] hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_24px_52px_-34px_rgba(2,132,199,0.42)]',
        latestPost: 'rounded-xl border border-gray-300 p-4 bg-white min-h-[200px] flex flex-col transition-colors'
    },
    blocks: {
        eyebrowText: 'text-xs font-semibold uppercase tracking-[0.22em] text-sky-600',
        ctaButton: 'inline-flex items-center rounded-full bg-sky-400 px-5 py-3 text-sm font-medium text-sky-950 transition hover:bg-sky-500',
        cardsArticle: 'flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm',
        cardsEyebrow: 'mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-sky-600',
        threePanelIntroEyebrow: 'text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-sky-600',
        threePanelArticle: 'flex h-full min-h-[28rem] flex-col overflow-hidden rounded-[30px] border border-slate-200/90 bg-white shadow-[0_12px_22px_-18px_rgba(15,23,42,0.2),0_20px_36px_-26px_rgba(37,99,235,0.18)] md:shadow-[0_22px_40px_-22px_rgba(15,23,42,0.3),0_36px_72px_-34px_rgba(37,99,235,0.34)]',
        threePanelHeader: 'grid grid-rows-[1.25rem_1fr] border-b border-sky-200/70 bg-[linear-gradient(180deg,#60a5fa_0%,#3b82f6_55%,#2563eb_100%)] px-6 py-6 text-white sm:grid-rows-[1.35rem_1fr] sm:px-7 sm:py-7',
        threePanelHeaderEyebrow: 'flex items-start text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-sky-50',
        threePanelDotActive: 'bg-sky-600',
        threePanelDotInactive: 'bg-sky-200 hover:bg-sky-300',
        threePanelPagerButton: 'inline-flex h-11 w-11 items-center justify-center rounded-full border border-sky-500 bg-sky-600 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgba(2,132,199,0.85)] transition-all enabled:hover:bg-sky-700 enabled:hover:shadow-[0_14px_26px_-14px_rgba(3,105,161,0.9)] enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:border-sky-200 disabled:bg-sky-100 disabled:text-sky-300 disabled:shadow-none',
        threePanelPagerCount: 'text-sm font-semibold tracking-[0.08em] text-slate-900'
    }
}

const DOMAIN_PAGE_STYLE_OVERRIDES = {
    ...getPrivateDomainFieldMap('pageStyleOverrides'),
    default: {}
}

export const DEFAULT_DOMAIN_TEMPLATE_COLORS = {
    default: {
        // Practice Manager's lockup runs deep navy into cyan, so the unconfigured
        // default domain takes its palette from the logo rather than a generic blue.
        // Domains with their own stored colours (including the private overlay's)
        // still win.
        color1: '#04bdfd',
        color2: '#00216b',
        color3: '#dff4ff',
        backgroundColor: '#f4fafe',
        successColor: '#10b981',
        warningColor: '#f59e0b',
        errorColor: '#ef4444',
        infoColor: '#04bdfd'
    },
    ...getPrivateDomainFieldMap('templateColors')
}

function normalizeHexColor(value, fallback) {
    const normalizedFallback = typeof fallback === 'string' ? fallback : '#2563eb'
    const trimmed = String(value || '').trim()
    if (!trimmed) return normalizedFallback

    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
        return withHash.toLowerCase()
    }

    if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
        const [, red, green, blue] = withHash
        return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
    }

    return normalizedFallback
}

function hexToRgb(color) {
    const normalized = normalizeHexColor(color, '#2563eb').slice(1)
    return {
        red: Number.parseInt(normalized.slice(0, 2), 16),
        green: Number.parseInt(normalized.slice(2, 4), 16),
        blue: Number.parseInt(normalized.slice(4, 6), 16)
    }
}

function getRelativeLuminance(color) {
    const { red, green, blue } = hexToRgb(color)
    const channels = [red, green, blue].map((channel) => {
        const normalized = channel / 255
        if (normalized <= 0.03928) {
            return normalized / 12.92
        }
        return ((normalized + 0.055) / 1.055) ** 2.4
    })

    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

export function getDomainTemplateColors(template, mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    const fallback = DEFAULT_DOMAIN_TEMPLATE_COLORS[normalizedMode] || DEFAULT_DOMAIN_TEMPLATE_COLORS.default
    const configured = typeof template?.colors === 'object' && template?.colors
        ? template.colors
        : {}

    return {
        color1: normalizeHexColor(configured.color1, fallback.color1),
        color2: normalizeHexColor(configured.color2, fallback.color2),
        color3: normalizeHexColor(configured.color3, fallback.color3),
        backgroundColor: normalizeHexColor(
            configured.backgroundColor,
            fallback.backgroundColor || '#f8fafc'
        ),
        successColor: normalizeHexColor(configured.successColor, fallback.successColor || '#10b981'),
        warningColor: normalizeHexColor(configured.warningColor, fallback.warningColor || '#f59e0b'),
        errorColor: normalizeHexColor(configured.errorColor, fallback.errorColor || '#ef4444'),
        infoColor: normalizeHexColor(configured.infoColor, fallback.infoColor || '#2563eb')
    }
}

export function buildDomainTemplateColorStyles(colors) {
    const resolved = getDomainTemplateColors({ colors }, 'default')
    const color1Rgb = hexToRgb(resolved.color1)
    const color2Rgb = hexToRgb(resolved.color2)
    const color3Rgb = hexToRgb(resolved.color3)
    const backgroundColorRgb = hexToRgb(resolved.backgroundColor)
    const successColorRgb = hexToRgb(resolved.successColor)
    const warningColorRgb = hexToRgb(resolved.warningColor)
    const errorColorRgb = hexToRgb(resolved.errorColor)
    const infoColorRgb = hexToRgb(resolved.infoColor)

    return {
        '--domain-color-1': resolved.color1,
        '--domain-color-1-rgb': `${color1Rgb.red} ${color1Rgb.green} ${color1Rgb.blue}`,
        '--domain-color-2': resolved.color2,
        '--domain-color-2-rgb': `${color2Rgb.red} ${color2Rgb.green} ${color2Rgb.blue}`,
        '--domain-color-3': resolved.color3,
        '--domain-color-3-rgb': `${color3Rgb.red} ${color3Rgb.green} ${color3Rgb.blue}`,
        '--domain-background-color': resolved.backgroundColor,
        '--domain-background-color-rgb': `${backgroundColorRgb.red} ${backgroundColorRgb.green} ${backgroundColorRgb.blue}`,
        '--domain-success-color': resolved.successColor,
        '--domain-success-color-rgb': `${successColorRgb.red} ${successColorRgb.green} ${successColorRgb.blue}`,
        '--domain-warning-color': resolved.warningColor,
        '--domain-warning-color-rgb': `${warningColorRgb.red} ${warningColorRgb.green} ${warningColorRgb.blue}`,
        '--domain-error-color': resolved.errorColor,
        '--domain-error-color-rgb': `${errorColorRgb.red} ${errorColorRgb.green} ${errorColorRgb.blue}`,
        '--domain-info-color': resolved.infoColor,
        '--domain-info-color-rgb': `${infoColorRgb.red} ${infoColorRgb.green} ${infoColorRgb.blue}`
    }
}

export function withAlpha(color, alpha) {
    const { red, green, blue } = hexToRgb(color)
    const normalizedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
    return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`
}

export function getContrastingTextColor(backgroundColor, dark = '#0f172a', light = '#ffffff') {
    // Pick whichever option actually contrasts with the background. The old fixed
    // luminance threshold handed bright brand colours (cyan, emerald, amber) white
    // text at ~2:1, so light accents got unreadable chips.
    const contrastRatio = (left, right) => {
        const [lighter, darker] = left > right ? [left, right] : [right, left]
        return (lighter + 0.05) / (darker + 0.05)
    }

    const backgroundLuminance = getRelativeLuminance(backgroundColor)
    const darkContrast = contrastRatio(backgroundLuminance, getRelativeLuminance(dark))
    const lightContrast = contrastRatio(backgroundLuminance, getRelativeLuminance(light))

    return darkContrast >= lightContrast ? dark : light
}

export function buildThreePanelDynamicStyles(colors, headerColorKey = 'color1') {
    const resolved = getDomainTemplateColors({ colors }, 'default')
    const selectedHeaderColorKey = String(headerColorKey || '').trim().toLowerCase() === 'color2' ? 'color2' : 'color1'
    const headerBg = resolved[selectedHeaderColorKey] || resolved.color1
    const bodyBg = resolved.backgroundColor
    const headerTextColor = getContrastingTextColor(headerBg, '#0f172a', '#ffffff')
    const headerAccentColor = getContrastingTextColor(headerBg, '#1f2937', '#f0f4f8')

    return {
        headerStyle: {
            backgroundColor: headerBg,
            backgroundImage: 'none',
            color: headerTextColor,
            borderColor: withAlpha(headerTextColor, 0.2)
        },
        headerEyebrowColor: headerAccentColor,
        bodyStyle: {
            backgroundColor: bodyBg
        },
        dotActiveColor: resolved.color1,
        dotInactiveColor: withAlpha(resolved.color2, 0.3),
        pagerButtonBg: headerBg,
        pagerButtonText: getContrastingTextColor(headerBg, '#0f172a', '#ffffff'),
        pagerCountColor: getContrastingTextColor(bodyBg, '#0f172a', '#ffffff')
    }
}

function mergeDomainPageStyleTemplate(overrides = {}) {
    return {
        layout: {
            ...SHARED_DOMAIN_PAGE_STYLE_TEMPLATE.layout,
            ...(overrides.layout || {})
        },
        detail: {
            ...SHARED_DOMAIN_PAGE_STYLE_TEMPLATE.detail,
            ...(overrides.detail || {})
        },
        menu: {
            ...SHARED_DOMAIN_PAGE_STYLE_TEMPLATE.menu,
            ...(overrides.menu || {})
        },
        cards: {
            ...SHARED_DOMAIN_PAGE_STYLE_TEMPLATE.cards,
            ...(overrides.cards || {})
        },
        blocks: {
            ...SHARED_DOMAIN_PAGE_STYLE_TEMPLATE.blocks,
            ...(overrides.blocks || {})
        }
    }
}

function buildDomainPageStyleTemplates(overrides) {
    return Object.fromEntries(
        Object.entries(overrides).map(([mode, value]) => [mode, mergeDomainPageStyleTemplate(value)])
    )
}

export const DOMAIN_PAGE_STYLE_TEMPLATES = buildDomainPageStyleTemplates(DOMAIN_PAGE_STYLE_OVERRIDES)

export function getDomainPageStyles(mode) {
    const normalized = String(mode || '').trim().toLowerCase()
    if (normalized && DOMAIN_PAGE_STYLE_TEMPLATES[normalized]) {
        return DOMAIN_PAGE_STYLE_TEMPLATES[normalized]
    }
    return DOMAIN_PAGE_STYLE_TEMPLATES.default
}

export const DEFAULT_BG_GRADIENT_TREATMENT = 'soft-radial'

export const BG_GRADIENT_PRESETS = {
    'soft-radial': {
        label: 'Soft Radial',
        description: 'Subtle radial blooms that fade into the background.',
        build: (c) => `radial-gradient(circle at 8% 0%, ${withAlpha(c.color1, 0.18)}, transparent 34%), radial-gradient(circle at 92% 4%, ${withAlpha(c.color2, 0.14)}, transparent 30%), linear-gradient(180deg, ${withAlpha(c.color2, 0.12)} 0%, ${withAlpha(c.color1, 0.08)} 38%, ${withAlpha(c.backgroundColor, 0.92)} 66%, ${c.backgroundColor} 100%)`
    },
    'bold-diagonal': {
        label: 'Bold Diagonal',
        description: 'Strong diagonal sweep from accent to background.',
        build: (c) => `linear-gradient(135deg, ${withAlpha(c.color1, 0.22)} 0%, ${withAlpha(c.color2, 0.18)} 40%, ${c.backgroundColor} 80%)`
    },
    'aurora': {
        label: 'Aurora',
        description: 'Layered colorful radials for a vibrant, immersive feel.',
        build: (c) => `radial-gradient(ellipse at 10% 0%, ${withAlpha(c.color1, 0.28)}, transparent 44%), radial-gradient(ellipse at 88% 8%, ${withAlpha(c.color2, 0.26)}, transparent 40%), radial-gradient(ellipse at 50% 60%, ${withAlpha(c.color3, 0.12)}, transparent 50%), linear-gradient(180deg, ${c.backgroundColor} 0%, ${c.backgroundColor} 100%)`
    },
    'minimal': {
        label: 'Minimal',
        description: 'Very faint top tint, nearly flat.',
        build: (c) => `linear-gradient(180deg, ${withAlpha(c.color2, 0.07)} 0%, ${c.backgroundColor} 28%)`
    },
    'none': {
        label: 'None',
        description: 'Solid background color, no gradient.',
        build: (c) => `linear-gradient(${c.backgroundColor}, ${c.backgroundColor})`
    }
}
