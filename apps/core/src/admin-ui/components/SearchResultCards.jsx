'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

export default function SearchResultCards({
    result,
    onProductionsParsed,
    databaseProduction,
    onEdit,
    onPublish,
    onDelete,
    editingProduction,
    editForm,
    onInputChange,
    onSaveEdit,
    onCancelEdit,
    saving,
    editError
}) {
    const [selectedProduction, setSelectedProduction] = useState(null)
    const [friendlyNames, setFriendlyNames] = useState({})
    const [companyManifest, setCompanyManifest] = useState([])

    const getInitialRandomImage = () => {
        const images = [
            'camera-solutions-for-tv-film-production-prg-9.webp',
            'central-park-wikipedia-1.jpg',
            'cesar-done-14.jpg',
            'cop-stock-photos-images-and-backgrounds-for-free-download-5.jpg',
            'east-harlem-wikipedia-6.jpg',
            'east-village-manhattan-wikipedia-7.jpg',
            'l-minh-10.jpg',
            'l-minh-12.jpg',
            'new-york-city-simple-english-wikipedia-the-free-encyclopedia-2.jpg',
            'new-york-city-wikipedia-4.jpg',
            'opinion-review-three-standout-movies-from-2022-tribeca-festival-8.jpg',
            'phil-13.jpg',
            'pixabay-11.jpg',
            'royalton-new-york-new-york-ny-2025-updated-prices-deals-3.jpg'
        ]
        const randomIndex = Math.floor(Math.random() * images.length)
        return `/api/images/local?category=key_art&file=${images[randomIndex]}`
    }

    const [randomImage] = useState(getInitialRandomImage)

    const modalProduction = databaseProduction && selectedProduction?.id === databaseProduction.id
        ? { ...selectedProduction, ...databaseProduction }
        : selectedProduction

    // Helper to clean markdown links from text
    const cleanMarkdown = (text) => {
        if (!text) return '';
        return text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove [text](url) markdown links
            .replace(/\s*\([a-zA-Z0-9\-]+\.[a-zA-Z]{2,}\)/g, '') // Remove parenthetical domain names
            .replace(/\*\*/g, '') // Remove bold markers
            .trim();
    }

    const normalizeSources = (sources) => {
        if (!Array.isArray(sources)) return []
        return sources.map((source) => {
            if (!source) return null
            if (typeof source === 'string') {
                return { title: source, url: source }
            }
            if (typeof source === 'object') {
                const url = source.url || source.link || source.href || ''
                if (!url) return null
                return { title: source.title || url, url }
            }
            return null
        }).filter(Boolean)
    }

    // Get friendly names for URLs using OpenAI
    const getFriendlyNames = async (urls) => {
        if (!urls || urls.length === 0) return {}

        try {
            const response = await fetch('/api/openai/friendly-names', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            })

            if (response.ok) {
                const data = await response.json()
                return data.names || {}
            }
        } catch (error) {
            console.error('Error getting friendly names:', error)
        }

        // Fallback: extract from domain
        return urls.reduce((acc, url) => {
            try {
                const domain = new URL(url).hostname.replace(/^www\./, '')
                const mainPart = domain.split('.')[0]
                acc[url] = mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
            } catch {
                acc[url] = url
            }
            return acc
        }, {})
    }

    const looksLikeSourceHeadline = (line) => {
        const lowered = String(line || '').toLowerCase()
        if (!lowered.includes(' - ')) return false
        const parts = lowered.split(' - ')
        const suffix = parts[parts.length - 1]
        return /\b(feed|news|times|post|daily|wire|gazette|review|observer|report|tribune|patch|blog)\b/.test(suffix)
    }

    // Parse the result to extract production data
    const parseProductions = (text) => {
        const productions = []

        let contentText = text
        let extractedTitle = null

        console.log('Input text:', text)

        // Try to parse as JSON first
        try {
            const parsed = JSON.parse(text)
            console.log('Parsed JSON:', parsed)

            // Extract text from OpenAI response structure
            if (Array.isArray(parsed)) {
                // Check if it's already the production array we want
                if (parsed.length > 0 && parsed[0].title && parsed[0].production_company) {
                    console.log('Direct production array:', parsed)
                    return parsed.slice(0, 1).map(p => ({
                        title: p.title || 'Untitled',
                        details: typeof p.details === 'string' ? [cleanMarkdown(p.details)] : (Array.isArray(p.details) ? p.details.map(cleanMarkdown) : [cleanMarkdown(p.description || '')]),
                        sources: Array.isArray(p.sources) ? p.sources.slice(0, 3) : (p.source ? [p.source] : []),
                        company: p.production_company || p.company || null
                    }))
                }

                // Otherwise, extract text from OpenAI response structure
                const messages = parsed.filter(item => item.type === 'message' && item.status === 'completed')
                console.log('Messages found:', messages.length)
                const textParts = []

                messages.forEach(msg => {
                    if (msg.content && Array.isArray(msg.content)) {
                        msg.content.forEach(contentItem => {
                            if (contentItem.type === 'output_text' && contentItem.text) {
                                textParts.push(contentItem.text)
                                // Try to extract title from annotations
                                if (!extractedTitle && contentItem.annotations && Array.isArray(contentItem.annotations)) {
                                    const titleAnnotation = contentItem.annotations.find(ann => ann.title)
                                    if (titleAnnotation) {
                                        extractedTitle = titleAnnotation.title
                                    }
                                }
                            }
                        })
                    }
                })

                contentText = textParts.join('\n\n')
                console.log('Extracted text:', contentText)
                console.log('Extracted title from annotations:', extractedTitle)

                // Try parsing the extracted text as JSON
                // First, strip markdown code blocks if present
                let cleanedText = contentText.trim()
                if (cleanedText.startsWith('```json')) {
                    cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '').trim()
                } else if (cleanedText.startsWith('```')) {
                    cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```\s*$/, '').trim()
                }
                console.log('Cleaned text:', cleanedText)

                try {
                    const innerParsed = JSON.parse(cleanedText)
                    console.log('Inner parsed JSON:', innerParsed)

                    // Handle single object (new structured format)
                    if (innerParsed.title && innerParsed.production_company) {
                        console.log('Parsed single production object:', innerParsed)
                        const p = innerParsed

                        // Format sources array - handle both {title, url} and plain string objects
                        const formattedSources = Array.isArray(p.sources)
                            ? p.sources.slice(0, 3).map(src =>
                                typeof src === 'object' && src.url ? src :
                                    typeof src === 'string' ? { title: src, url: src } : src
                            )
                            : (p.source ? [p.source] : [])

                        // Format dates - handle both {start, end} and string formats
                        let dateString = ''
                        if (p.dates) {
                            if (typeof p.dates === 'object' && (p.dates.start || p.dates.end)) {
                                dateString = `${p.dates.start || 'Unknown'} to ${p.dates.end || 'Unknown'}`
                            } else {
                                dateString = String(p.dates)
                            }
                        }

                        // Format actors array
                        const actorsText = Array.isArray(p.actors) && p.actors.length > 0
                            ? `Actors: ${p.actors.join(', ')}`
                            : ''

                        return [{
                            title: p.title || 'Untitled',
                            details: [
                                cleanMarkdown(p.summary || p.details || p.description || 'No details available'),
                                dateString,
                                actorsText
                            ].filter(Boolean),
                            sources: formattedSources,
                            company: p.production_company || p.company || null
                        }]
                    }

                    // Handle array of objects (legacy format)
                    if (Array.isArray(innerParsed) && innerParsed.length > 0 && innerParsed[0].title) {
                        console.log('Parsed JSON array from text:', innerParsed)
                        return innerParsed.slice(0, 1).map(p => ({
                            title: p.title || 'Untitled',
                            details: typeof p.details === 'string' ? [cleanMarkdown(p.details), p.dates || p.date].filter(Boolean) : (Array.isArray(p.details) ? p.details.map(cleanMarkdown) : [cleanMarkdown(p.description || ''), p.dates || p.date].filter(Boolean)),
                            sources: Array.isArray(p.sources) ? p.sources.slice(0, 3) : (p.source ? [p.source] : []),
                            company: p.production_company || p.company || null
                        }))
                    }
                } catch (e) {
                    console.log('Inner text is not JSON:', e)
                    // Not JSON inside, continue with text parsing
                }
            }
        } catch (e) {
            // Not JSON, use as-is
            console.log('Not JSON format:', e)
        }

        console.log('Extracted content text for text parsing:', contentText)

        if (!contentText || contentText.length < 10) {
            return []
        }

        // Parse as a single production (no numbering required)
        const lines = contentText.split('\n').filter(line => line.trim())

        if (lines.length === 0) {
            return []
        }

        const production = {
            title: '',
            details: [],
            sources: [],
            company: null
        }

        let titleFound = false
        let startDetailIndex = 0

        // Extract company name from text (look for common production companies)
        const companies = ['netflix', 'hulu', 'disney', 'amazon', 'apple', 'hbo', 'paramount', 'warner', 'universal', 'sony', 'nbc', 'cbs', 'abc', 'fox', 'nbcuniversal']
        const companyMatch = contentText.toLowerCase().match(new RegExp(`\\b(${companies.join('|')})\\b`))
        if (companyMatch) {
            let companyName = companyMatch[1]
            // Normalize company names
            if (companyName === 'nbcuniversal' || companyName === 'universal') companyName = 'nbc'
            production.company = companyName.charAt(0).toUpperCase() + companyName.slice(1)
            console.log('Extracted company:', production.company)
        } else {
            console.log('No company found in text')
        }

        // Use extracted title from annotations if available, but only if it looks like a production name (not a website title)
        if (extractedTitle && !extractedTitle.includes('.com') && !extractedTitle.includes('locations') && extractedTitle.length < 100) {
            production.title = extractedTitle
            titleFound = true
        }

        // Extract title - look for quoted titles in the text first (" "Title" ")
        if (!titleFound) {
            const quotedMatch = contentText.match(/[""]([^""]{5,80})[""]/)
            if (quotedMatch) {
                production.title = quotedMatch[1].trim()
                titleFound = true
            }
        }

        // Extract title - look for bold markdown first (**Title**)
        if (!titleFound) {
            // Try to find title in first few lines
            for (let i = 0; i < Math.min(5, lines.length); i++) {
                const line = lines[i].trim()

                // Skip if line looks like a citation/link fragment
                if (line.match(/^\(\[|^http/) || line.length < 3) {
                    continue
                }

                // Check for bold markdown pattern
                const boldMatch = line.match(/\*\*([^*]+)\*\*/)
                if (boldMatch) {
                    production.title = boldMatch[1].trim().replace(/^\d+\.\s*/, '')
                    startDetailIndex = i + 1
                    titleFound = true
                    break
                }

                // Look for title followed by colon (Title: description)
                const colonMatch = line.match(/^([^:]+):\s*(.+)/)
                if (colonMatch && i < 2) {
                    const potentialTitle = colonMatch[1].trim()
                    if (potentialTitle.length > 5 && !potentialTitle.toLowerCase().startsWith('in ') && !potentialTitle.toLowerCase().startsWith('during ')) {
                        production.title = potentialTitle
                        startDetailIndex = i + 1
                        titleFound = true
                        break
                    }
                }

                // Look for a prominent first line
                if (!titleFound && i === 0 && line.length > 8 && !line.toLowerCase().startsWith('in ') && !line.toLowerCase().startsWith('during ') && !looksLikeSourceHeadline(line)) {
                    production.title = line.replace(/^\d+\.\s*/, '').split(/\s*[-–—]\s*/)[0].trim()
                    startDetailIndex = 1
                    titleFound = true
                }
            }

            // If no title found, use first non-empty line as title
            if (!titleFound || !production.title) {
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim()
                    if (line.length > 5 && !line.match(/^https?:\/\//) && !line.match(/^\[/) && !line.toLowerCase().startsWith('in ') && !line.toLowerCase().startsWith('during ')) {
                        production.title = line.replace(/^\d+\.\s*/, '').split(/[:\-]/)[0].trim()
                        startDetailIndex = i + 1
                        titleFound = true
                        break
                    }
                }
            }
        }

        // If still no title found, use a generic one
        if (!production.title) {
            production.title = 'Production'
            startDetailIndex = 0
        }

        // Rest are details - extract all remaining lines
        for (let i = startDetailIndex; i < lines.length; i++) {
            const line = lines[i].trim()

            // Skip very short lines and markdown headers
            if (line.length < 10 || line.startsWith('#')) {
                continue
            }

            // Extract URLs first
            if (line.includes('http')) {
                const urlMatches = line.match(/https?:\/\/[^\s\)\"]+/g)
                if (urlMatches) {
                    production.sources.push(...urlMatches)
                }
            }

            // Skip lines that are just URLs or citations
            if (line.match(/^\(\[.*\]\(http/) || line.match(/^https?:\/\//)) {
                continue
            }

            // Clean up markdown links and add to details
            const cleanLine = line
                .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                .replace(/\s*\([a-zA-Z0-9\-]+\.[a-zA-Z]{2,}\)/g, '') // Remove parenthetical domain names
                .replace(/^\(+|\)+$/g, '')
                .replace(/^[-•]\s+/, '')
                .replace(/^\d+\.\s+/, '')
                .replace(/\*\*/g, '')
                .trim()

            const lowerClean = cleanLine.toLowerCase()
            if (
                cleanLine.length > 10 &&
                !cleanLine.startsWith('http') &&
                !lowerClean.startsWith('production details') &&
                !lowerClean.startsWith('sources') &&
                cleanLine !== production.title
            ) {
                production.details.push(cleanLine)
            }
        }

        if (production.title && production.title.length > 3) {
            if (production.sources && production.sources.length > 0) {
                production.sources = [...new Set(production.sources)]
            }
            productions.push(production)
        }

        console.log('Parsed productions:', productions)
        return productions.slice(0, 1)
    }

    const normalizeCompany = (value) =>
        String(value || '').trim().toLowerCase()

    const stripExtension = (value) =>
        String(value || '').replace(/\.[a-z0-9]+$/i, '')

    const tokenize = (value) => {
        const normalized = normalizeCompany(value)
        return normalized.split(/\s+/).filter(token => token.length >= 2)
    }

    const resolveCompanyLogo = (companyName) => {
        if (!companyName || companyManifest.length === 0) return null

        const normalized = normalizeCompany(companyName)
        const searchTokens = tokenize(normalized)

        let bestMatch = null
        let bestScore = 0

        companyManifest.forEach((entry) => {
            const entryName = normalizeCompany(entry?.name)
            const entryFilename = normalizeCompany(stripExtension(entry?.filename))

            let score = 0

            // Exact match: highest priority
            if (entryName === normalized || entryFilename === normalized) {
                score = 100
            }
            // Substring match
            else if (entryName.includes(normalized) || entryFilename.includes(normalized)) {
                score = 80
            }
            else if (normalized.includes(entryName) || normalized.includes(entryFilename)) {
                score = 75
            }
            // Token overlap: check if first token matches
            else {
                const entryTokens = tokenize(entryName)
                if (searchTokens.length > 0 && entryTokens.length > 0 && searchTokens[0] === entryTokens[0]) {
                    score = 70
                }
            }

            if (score > bestScore) {
                bestScore = score
                bestMatch = entry
            }
        })

        if (!bestMatch?.filename) return null
        return `/api/images/local?category=companies&file=${bestMatch.filename}`
    }

    const resolveCompanyFilename = (companyName) => {
        if (!companyName || companyManifest.length === 0) return null

        const normalized = normalizeCompany(companyName)
        const match = companyManifest.find((entry) => {
            const entryName = normalizeCompany(entry?.name)
            const entryFilename = normalizeCompany(stripExtension(entry?.filename))
            return entryName === normalized || entryFilename === normalized
        })

        return match?.filename || null
    }

    const productions = parseProductions(typeof result === 'string' ? result : '')

    const companyLogos = productions.reduce((logos, production) => {
        if (!production?.company) return logos
        const logoUrl = resolveCompanyLogo(production.company)
        if (logoUrl) {
            logos[production.company] = logoUrl
        }
        return logos
    }, {})

    // Notify parent and fetch friendly source names when productions change
    useEffect(() => {
        // Notify parent component of parsed productions
        if (onProductionsParsed && productions.length > 0) {
            onProductionsParsed(productions)
        }

        // Collect all unique URLs
        const allUrls = productions
            .flatMap(p => normalizeSources(p.sources))
            .map(source => source.url)
            .filter(Boolean)
        const uniqueUrls = [...new Set(allUrls)]

        if (uniqueUrls.length > 0) {
            getFriendlyNames(uniqueUrls).then(names => setFriendlyNames(names))
        }
    }, [productions, onProductionsParsed])

    if (productions.length === 0) {
        return null
    }

    return (
        <>
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Production Found</h3>
                <div className="grid grid-cols-1 gap-4">
                    {productions.map((production, index) => (
                        <div
                            key={index}
                            onClick={() => {
                                // If this is from a database search, enrich production with full database data
                                const enrichedProduction = databaseProduction
                                    ? { ...production, ...databaseProduction }
                                    : production
                                setSelectedProduction(enrichedProduction)
                            }}
                            className="border border-gray-200 rounded-lg bg-white hover:shadow-md transition-shadow cursor-pointer flex flex-col"
                        >
                            {randomImage && (
                                <Image
                                    src={randomImage}
                                    alt="Location preview"
                                    unoptimized
                                    width={640}
                                    height={160}
                                    className="w-full h-20 object-cover rounded-t-lg bg-gray-200"
                                    onError={(e) => {
                                        console.error('Image failed to load:', randomImage)
                                        e.currentTarget.style.display = 'none'
                                    }}
                                    onLoad={() => {
                                        console.log('Image loaded successfully:', randomImage)
                                    }}
                                />
                            )}

                            <div className="p-3 flex-1 flex flex-col">
                                <div className="mb-2">
                                    <h4 className="text-sm font-semibold text-gray-900 line-clamp-2">
                                        {production.title}
                                    </h4>
                                </div>

                                <div className="flex-1">
                                    <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                                        {production.details.join(' ')}
                                    </p>
                                </div>

                                {/* Company Logo - Centered at bottom */}
                                {production.company && companyLogos[production.company] && (
                                    <div className="mt-3 flex flex-col items-center">
                                        <Image
                                            src={companyLogos[production.company]}
                                            alt={production.company}
                                            unoptimized
                                            width={96}
                                            height={24}
                                            className="h-6 object-contain"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none'
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Placeholder circle if no logo - Centered at bottom */}
                                {production.company && !companyLogos[production.company] && (
                                    <div className="mt-3 flex justify-center items-center">
                                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center border border-gray-400">
                                            <span className="text-xs font-bold text-gray-700">
                                                {production.company.charAt(0)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {modalProduction && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
                    onClick={() => {
                        setSelectedProduction(null)
                        if (onCancelEdit) onCancelEdit()
                    }}
                >
                    <div
                        className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xl font-semibold pr-4">{modalProduction.title}</h3>
                            <button
                                onClick={() => {
                                    setSelectedProduction(null)
                                    if (onCancelEdit) onCancelEdit()
                                }}
                                className="text-gray-400 hover:text-gray-600 text-3xl leading-none font-light"
                            >
                                ×
                            </button>
                        </div>

                        {editError && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                                {editError}
                            </div>
                        )}

                        {editingProduction && editingProduction.id === modalProduction.id ? (
                            // Edit Form
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Title</label>
                                        <input
                                            type="text"
                                            value={editForm.title}
                                            onChange={(e) => onInputChange('title', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Company</label>
                                        <input
                                            type="text"
                                            value={editForm.company}
                                            onChange={(e) => onInputChange('company', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Borough</label>
                                        <input
                                            type="text"
                                            value={editForm.borough}
                                            onChange={(e) => onInputChange('borough', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                            placeholder="e.g., Brooklyn, Manhattan"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Neighborhood</label>
                                        <input
                                            type="text"
                                            value={editForm.neighborhood}
                                            onChange={(e) => onInputChange('neighborhood', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                            placeholder="e.g., Williamsburg, SoHo"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Area</label>
                                        <input
                                            type="text"
                                            value={editForm.area}
                                            onChange={(e) => onInputChange('area', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                            placeholder="e.g., Bedford Ave & N 7th St"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Released On</label>
                                        <input
                                            type="date"
                                            value={editForm.released_on}
                                            onChange={(e) => onInputChange('released_on', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Actor 1</label>
                                        <input
                                            type="text"
                                            value={editForm.actor1}
                                            onChange={(e) => onInputChange('actor1', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Actor 2</label>
                                        <input
                                            type="text"
                                            value={editForm.actor2}
                                            onChange={(e) => onInputChange('actor2', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Actor 3</label>
                                        <input
                                            type="text"
                                            value={editForm.actor3}
                                            onChange={(e) => onInputChange('actor3', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Summary</label>
                                    <textarea
                                        value={editForm.summary}
                                        onChange={(e) => onInputChange('summary', e.target.value)}
                                        rows={4}
                                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                    />
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <button
                                        onClick={onSaveEdit}
                                        disabled={saving}
                                        className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={onCancelEdit}
                                        disabled={saving}
                                        className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // View Mode
                            <div>
                                <div className="space-y-4">
                                    {modalProduction.id && databaseProduction && modalProduction.id === databaseProduction.id ? (
                                        <>
                                            {modalProduction.summary && (
                                                <p className="text-gray-700 text-sm">{modalProduction.summary}</p>
                                            )}
                                            <div className="grid grid-cols-2 gap-2 text-sm">
                                                {modalProduction.company && <p><span className="font-medium">Company:</span> {modalProduction.company}</p>}
                                                {modalProduction.borough && <p><span className="font-medium">Borough:</span> {modalProduction.borough}</p>}
                                                {modalProduction.neighborhood && <p><span className="font-medium">Neighborhood:</span> {modalProduction.neighborhood}</p>}
                                                {modalProduction.area && <p><span className="font-medium">Area:</span> {modalProduction.area}</p>}
                                                {modalProduction.released_on && <p><span className="font-medium">Released:</span> {modalProduction.released_on}</p>}
                                                {modalProduction.actor1 && <p><span className="font-medium">Actor 1:</span> {modalProduction.actor1}</p>}
                                                {modalProduction.actor2 && <p><span className="font-medium">Actor 2:</span> {modalProduction.actor2}</p>}
                                                {modalProduction.actor3 && <p><span className="font-medium">Actor 3:</span> {modalProduction.actor3}</p>}
                                            </div>
                                        </>
                                    ) : (
                                        modalProduction.details.map((detail, i) => (
                                            <p key={i} className="text-gray-700 text-sm">{detail}</p>
                                        ))
                                    )}

                                    {modalProduction.sources && modalProduction.sources.length > 0 && (
                                        <div className="pt-4 border-t border-gray-200">
                                            <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                                {modalProduction.sources.length === 1 ? 'Source:' : 'Sources:'}
                                            </h4>
                                            <div className="space-y-2">
                                                {[...new Map(normalizeSources(modalProduction.sources).map(source => [source.url, source])).values()].map((source, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={source.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-sm text-blue-600 hover:text-blue-800 underline block"
                                                    >
                                                        {friendlyNames[source.url] || source.title || source.url}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Action buttons - only show if production has an ID (saved to database) */}
                                {modalProduction.id && onEdit && onPublish && onDelete && (
                                    <div className="flex gap-2 mt-6 pt-4 border-t border-gray-200">
                                        <button
                                            onClick={() => onEdit(modalProduction)}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => onPublish(modalProduction)}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Publish
                                        </button>
                                        <button
                                            onClick={() => onDelete(modalProduction)}
                                            className="px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
