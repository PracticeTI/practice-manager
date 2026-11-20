import { cookies, headers } from 'next/headers'
import { getDomainLabel, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { ADMIN_DOMAIN_COOKIE, normalizeAdminDomainKey } from '@/lib/adminDomainCookie'
import { getDomainSettings } from '@/lib/appSettings'
import {
    BG_GRADIENT_PRESETS,
    DEFAULT_BG_GRADIENT_TREATMENT,
    buildDomainTemplateColorStyles,
    getContrastingTextColor,
    getDomainTemplateColors,
} from '@/lib/domainPageStyles'

/**
 * Active domain for the portal: a domain-scoped admin always sees their own
 * domain, signalled by the cookie written when the session is persisted.
 * Falls back to hostname/header resolution for superadmins and bypass sessions.
 */
function resolveActiveAdminMode({ cookieStore, headerStore }) {
    const scopedDomain = normalizeAdminDomainKey(cookieStore?.get?.(ADMIN_DOMAIN_COOKIE)?.value)
    if (scopedDomain) return scopedDomain

    return resolveDomainModeFromHeaders(headerStore)
}

function paletteFromDomainSettings(settings) {
    const palette = settings?.homepage_palette
    if (palette && typeof palette === 'object') return palette

    const management = settings?.management
    const nested = management && typeof management === 'object' ? management.homepagePalette : null
    return nested && typeof nested === 'object' ? nested : null
}

export async function generateMetadata() {
    const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
    const mode = resolveActiveAdminMode({ cookieStore, headerStore })
    const label = getDomainLabel(mode)

    return {
        title: `${label} Admin Portal`,
        description: 'Content Management Admin Portal',
        robots: {
            index: false,
            follow: false,
            nocache: true,
            googleBot: {
                index: false,
                follow: false,
                noimageindex: true,
            },
        },
    }
}

export default async function AdminLayout({ children }) {
    const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
    const mode = resolveActiveAdminMode({ cookieStore, headerStore })

    const domainSettings = mode
        ? await getDomainSettings(mode, ['management', 'homepage_palette', 'admin_background_color'])
        : {}
    const paletteSettings = paletteFromDomainSettings(domainSettings)
    const templateColors = getDomainTemplateColors({ colors: paletteSettings?.colors }, mode)
    const domainColorStyles = {
        ...buildDomainTemplateColorStyles(templateColors),
        '--domain-color-1-contrast': getContrastingTextColor(templateColors.color1),
    }

    // Check for admin-specific background color
    const adminBackgroundColor = domainSettings?.admin_background_color?.color || null

    // If admin color is set, use a simple background
    if (adminBackgroundColor) {
        return (
            <div className="min-h-screen" style={{ ...domainColorStyles, backgroundColor: adminBackgroundColor }}>
                {children}
            </div>
        )
    }

    // Otherwise, use the homepage gradient
    const treatmentKey = String(paletteSettings?.bgGradientTreatment || '').trim()
    const treatment = BG_GRADIENT_PRESETS[treatmentKey] ?? BG_GRADIENT_PRESETS[DEFAULT_BG_GRADIENT_TREATMENT]

    return (
        <div className="relative min-h-screen overflow-x-clip" style={domainColorStyles}>
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 z-0"
                style={{
                    backgroundColor: templateColors.backgroundColor,
                    backgroundImage: treatment.build(templateColors),
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100vw 100vh',
                }}
            />
            <div className="relative z-10">
                {children}
            </div>
        </div>
    )
}
