import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_DOMAIN_DEFINITIONS, formatDomainLabelFromKey } from '@/lib/domainSettings'
import { getPracticeTypeLabel, normalizePracticeType } from '@/lib/practiceTypes'
import { getDomainSetting } from '@/lib/appSettings'
import {
    DOMAIN_ARTWORK_FILES,
    TEMPLATE_LIBRARY_ID_PREFIX,
    TEMPLATE_LIBRARY_SOURCE,
    getDomainArtworkRelativePath,
    getDomainImageRelativePath,
    getDomainTemplateRelativePath,
    getPracticeTypeArtworkRelativePath,
    getPracticeTypeImageRelativePath,
    getPracticeTypeTemplateRelativePath,
    normalizeDomainKey,
} from '@/lib/templateLibrary'

/**
 * Server-only Template Library helpers (filesystem + domain settings access).
 *
 * Keep this module out of client bundles: it imports `node:fs` and reads the
 * private `content/` directory.
 */

const CONTENT_DIRECTORY = path.resolve(process.cwd(), 'content')
const PUBLIC_DIRECTORY = path.resolve(process.cwd(), 'public')

const TEMPLATE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

// Domain artwork shares the image folders but is never offered as an insertable
// template image (you don't want the worker mark dropped into a report body).
const TEMPLATE_ARTWORK_FILE_NAMES = new Set(Object.values(DOMAIN_ARTWORK_FILES))

/** Resolves a `content/`-relative path to an absolute path, guarding against escapes. */
export function resolveContentPath(relativePath) {
    const normalizedPath = String(relativePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, '')
    const withoutPrefix = normalizedPath.startsWith('content/')
        ? normalizedPath.slice('content/'.length)
        : normalizedPath
    if (!withoutPrefix) return null

    const resolvedPath = path.resolve(CONTENT_DIRECTORY, withoutPrefix)
    if (resolvedPath !== CONTENT_DIRECTORY && !resolvedPath.startsWith(`${CONTENT_DIRECTORY}${path.sep}`)) {
        return null
    }

    return resolvedPath
}

/** Resolves a `public/`-relative path to an absolute path, guarding against escapes. */
export function resolvePublicPath(relativePath) {
    const normalizedPath = String(relativePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, '')
    const withoutPrefix = normalizedPath.startsWith('public/')
        ? normalizedPath.slice('public/'.length)
        : normalizedPath
    if (!withoutPrefix) return null

    const resolvedPath = path.resolve(PUBLIC_DIRECTORY, withoutPrefix)
    if (resolvedPath !== PUBLIC_DIRECTORY && !resolvedPath.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`)) {
        return null
    }

    return resolvedPath
}

async function isDirectory(target) {
    try {
        return (await stat(target)).isDirectory()
    } catch {
        return false
    }
}

/**
 * Resolves the Template Library directory for a domain.
 *
 * An explicit `templateLibraryPath` setting is an override. When it is blank the
 * derived default applies: a domain folder under `domains/` wins when it exists,
 * otherwise the folder for the domain's practice type is used.
 */
export async function resolveTemplateLibrary(domainKey, templateLibraryPath, practiceType) {
    const explicitPath = String(templateLibraryPath || '').trim()
    if (explicitPath) {
        return { directory: resolveContentPath(explicitPath), path: explicitPath, source: 'override' }
    }

    const domainRelativePath = getDomainTemplateRelativePath(domainKey)
    const domainDirectory = resolveContentPath(domainRelativePath)
    if (domainDirectory && await isDirectory(domainDirectory)) {
        return { directory: domainDirectory, path: domainRelativePath, source: 'domain' }
    }

    const practiceRelativePath = getPracticeTypeTemplateRelativePath(practiceType)
    const practiceDirectory = resolveContentPath(practiceRelativePath)
    if (practiceDirectory && await isDirectory(practiceDirectory)) {
        return { directory: practiceDirectory, path: practiceRelativePath, source: 'practiceType' }
    }

    return { directory: null, path: '', source: 'none' }
}

/** Reads the domain's settings and resolves its Template Library directory. */
export async function getTemplateLibraryDirectory(rawDomain) {
    const domain = normalizeDomainKey(rawDomain)
    if (!domain) return { directory: null, path: '', source: 'none', configuredPath: '' }

    const settings = (await getDomainSetting(domain, 'management')) || {}
    const configuredPath = String(settings.templateLibraryPath || '').trim()
    const practiceType = normalizePracticeType(settings.practiceType, domain)
    const resolved = await resolveTemplateLibrary(domain, configuredPath, practiceType)

    return { ...resolved, configuredPath }
}

/** Recursively collects `.md` files from a directory as template objects. */
export async function collectMarkdownFiles(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name)
        const relativePath = path.join(relativeDirectory, entry.name)
        if (entry.isDirectory()) {
            files.push(...await collectMarkdownFiles(absolutePath, relativePath))
            continue
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue

        const content = await readFile(absolutePath, 'utf8')
        files.push({
            id: `${TEMPLATE_LIBRARY_ID_PREFIX}${Buffer.from(relativePath).toString('base64url')}`,
            name: entry.name.replace(/\.md$/i, '') || entry.name,
            fileName: entry.name,
            relativePath: relativePath.replaceAll(path.sep, '/'),
            mimeType: 'text/markdown',
            size: Buffer.byteLength(content, 'utf8'),
            contentBase64: Buffer.from(content, 'utf8').toString('base64'),
            uploadedAt: new Date().toISOString(),
            source: TEMPLATE_LIBRARY_SOURCE,
        })
    }

    return files
}

/**
 * Library templates for a domain, sorted, never throwing — a missing or
 * unreadable library simply yields an empty list.
 */
export async function listTemplateLibraryTemplates(rawDomain) {
    try {
        const { directory } = await getTemplateLibraryDirectory(rawDomain)
        if (!directory) return []
        return (await collectMarkdownFiles(directory))
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    } catch {
        return []
    }
}

/**
 * Appends unmatched library templates to a stored template list, deduped by id.
 * Library entries always come last so they never shadow a domain's own templates.
 */
export async function mergeLibraryTemplates(rawDomain, storedTemplates = []) {
    const stored = Array.isArray(storedTemplates) ? storedTemplates : []
    const libraryTemplates = await listTemplateLibraryTemplates(rawDomain)
    if (libraryTemplates.length === 0) return stored

    const seen = new Set(stored.map((template) => String(template?.id || '').trim()))
    // A library file that was uploaded into the domain's stored templates is the same
    // template, not a second one to offer in the picker.
    const seenFileNames = new Set(
        stored
            .map((template) => String(template?.fileName || '').trim().toLowerCase())
            .filter(Boolean)
    )
    const merged = [...stored]

    for (const template of libraryTemplates) {
        const id = String(template?.id || '').trim()
        if (!id || seen.has(id)) continue
        const fileName = String(template?.fileName || '').trim().toLowerCase()
        if (fileName && seenFileNames.has(fileName)) continue
        seen.add(id)
        merged.push(template)
    }

    return merged
}

function humanizeFileName(fileName) {
    const base = path.basename(fileName, path.extname(fileName))
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function getDomainDisplayName(domainKey, settings) {
    const configured = String(settings?.displayName || '').trim()
    if (configured) return configured
    const definition = DEFAULT_DOMAIN_DEFINITIONS.find((item) => item.key === domainKey)
    return definition?.name || formatDomainLabelFromKey(domainKey)
}

/** Lists image files in a `public/`-relative directory (never throws). */
async function collectImageItems(relativeDirectory, group, groupLabel) {
    const directory = resolvePublicPath(relativeDirectory)
    if (!directory) return { items: [], exists: false }

    let entries = []
    try {
        entries = await readdir(directory, { withFileTypes: true })
    } catch {
        return { items: [], exists: false }
    }

    const items = entries
        .filter((entry) => entry.isFile()
            && TEMPLATE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
            && !TEMPLATE_ARTWORK_FILE_NAMES.has(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => ({
            id: `${group}:${fileName}`,
            fileName,
            label: humanizeFileName(fileName),
            src: `/${relativeDirectory}/${encodeURIComponent(fileName)}`,
            group,
            groupLabel,
        }))

    return { items, exists: true }
}

/**
 * Template image library for a domain: the union of the assets shared by its
 * practice type (e.g. `allied-health/OT`) and its own domain assets
 * (e.g. `allied-health/domains/acme`).
 */
export async function listTemplateImageLibrary(rawDomain) {
    const domain = normalizeDomainKey(rawDomain)
    const settings = domain ? ((await getDomainSetting(domain, 'management')) || {}) : {}
    const practiceType = normalizePracticeType(settings.practiceType, domain)

    const groups = []
    const items = []

    const practiceRelativePath = getPracticeTypeImageRelativePath(practiceType)
    if (practiceRelativePath) {
        const label = getPracticeTypeLabel(practiceType, domain) || 'Practice type'
        const collected = await collectImageItems(practiceRelativePath, 'practiceType', label)
        groups.push({
            key: 'practiceType',
            label,
            relativePath: practiceRelativePath,
            exists: collected.exists,
            itemCount: collected.items.length,
        })
        items.push(...collected.items)
    }

    const domainRelativePath = getDomainImageRelativePath(domain)
    if (domainRelativePath) {
        const label = getDomainDisplayName(domain, settings)
        const collected = await collectImageItems(domainRelativePath, 'domain', label)
        groups.push({
            key: 'domain',
            label,
            relativePath: domainRelativePath,
            exists: collected.exists,
            itemCount: collected.items.length,
        })
        items.push(...collected.items)
    }

    return { practiceType, groups, items }
}

/**
 * Resolves the public artwork file for a domain's worker / assistant mark.
 *
 * A domain override (`public/allied-health/domains/<domain>/<file>`) wins over the
 * shared practice-type folder (`public/allied-health/<OT|physio|speech>/<file>`).
 * Returns null when neither exists.
 */
export async function resolveDomainArtwork(rawDomain, artwork) {
    const fileName = DOMAIN_ARTWORK_FILES[String(artwork || '').trim().toLowerCase()]
    const domain = normalizeDomainKey(rawDomain)
    if (!fileName || !domain) return null

    const settings = (await getDomainSetting(domain, 'management')) || {}
    const practiceType = normalizePracticeType(settings.practiceType, domain)

    const candidates = [
        { source: 'domain', relativePath: getDomainArtworkRelativePath(domain) },
        { source: 'practiceType', relativePath: getPracticeTypeArtworkRelativePath(practiceType) },
    ].filter((candidate) => candidate.relativePath)

    for (const candidate of candidates) {
        const relativeFile = `${candidate.relativePath}/${fileName}`
        const absolutePath = resolvePublicPath(relativeFile)
        if (!absolutePath) continue

        try {
            if ((await stat(absolutePath)).isFile()) {
                return { url: `/${relativeFile}`, source: candidate.source, practiceType, fileName }
            }
        } catch {
            // Not present in this folder – fall through to the next candidate.
        }
    }

    return null
}
