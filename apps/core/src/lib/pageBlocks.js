import {
    DEFAULT_LATEST_POSTS_LAYOUT,
    normalizeLatestPostsLayout
} from '@/lib/latestPosts'
import { normalizeBlockAnchorId } from '@/lib/blockAnchors'

const PAGE_BLOCK_TYPES = new Set(['eyebrow', 'heading', 'paragraph', 'image', 'quote', 'cta', 'contact', 'divider', 'latest_posts', 'industry_news', 'single_post', 'three_panel', 'cards', 'faq', 'hero', 'testimonials', 'stats', 'logo_marquee', 'feature_comparison', 'steps', 'pricing', 'bio_profile', 'icon_cards', 'proof_points'])

function createBlockId() {
    return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createStableFallbackBlockId(type, index = 0) {
    const normalizedType = String(type || 'block').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'block'
    const normalizedIndex = Number.isInteger(index) ? index + 1 : 1
    return `${normalizedType}-${normalizedIndex}`
}

function normalizeText(value) {
    return typeof value === 'string' ? value : ''
}

function normalizeHeadingLevel(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 2
    return Math.min(4, Math.max(2, Math.round(numeric)))
}

function normalizeLatestPostsLimit(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 4
    return Math.min(24, Math.max(1, Math.floor(numeric)))
}

function normalizeLatestPostsOrderMode(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized === 'manual' ? 'manual' : 'newest'
}

function normalizeStringArray(value, transform = (item) => item) {
    if (!Array.isArray(value)) return []

    const seen = new Set()
    return value
        .map((item) => transform(String(item || '').trim()))
        .filter((item) => {
            if (!item || seen.has(item)) return false
            seen.add(item)
            return true
        })
}

function normalizeFaqItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const candidate = item && typeof item === 'object' ? item : {}
        return {
            question: normalizeText(candidate.question),
            answer: normalizeText(candidate.answer)
        }
    }).filter((item) => item.question || item.answer)
}

function normalizeCardsColumns(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 2
    return Math.min(4, Math.max(1, Math.round(numeric)))
}

function normalizeCardsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const candidate = item && typeof item === 'object' ? item : {}
        return {
            eyebrow: normalizeText(candidate.eyebrow),
            title: normalizeText(candidate.title),
            body: normalizeText(candidate.body),
            href: normalizeText(candidate.href),
            linkText: normalizeText(candidate.linkText),
            postId: normalizeText(candidate.postId),
            postSlug: normalizeText(candidate.postSlug).toLowerCase()
        }
    }).filter((item) => item.title || item.body || item.postId || item.postSlug)
}

function normalizeThreePanelAutoAdvanceInterval(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 5200
    return Math.min(20000, Math.max(1800, Math.floor(numeric)))
}

function normalizeThreePanelHeaderBackgroundColor(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'color2') return 'color2'
    return 'color1'
}

function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true
        if (['false', '0', 'no', 'off', ''].includes(normalized)) return false
    }
    return fallback
}

function normalizeBlockStyles(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const clean = {}
        for (const [k, v] of Object.entries(value)) {
            if (typeof v === 'string') clean[k] = v
        }
        return clean
    }
    return {}
}

function normalizeTestimonialsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            quote: normalizeText(c.quote),
            author: normalizeText(c.author),
            role: normalizeText(c.role),
            company: normalizeText(c.company),
            avatarUrl: normalizeText(c.avatarUrl)
        }
    }).filter((item) => item.quote)
}

function normalizeStatsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            value: normalizeText(c.value),
            label: normalizeText(c.label),
            prefix: normalizeText(c.prefix),
            suffix: normalizeText(c.suffix)
        }
    }).filter((item) => item.value || item.label)
}

function normalizeLogoMarqueeItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            name: normalizeText(c.name),
            imageUrl: normalizeText(c.imageUrl),
            filePath: normalizeText(c.filePath),
            href: normalizeText(c.href)
        }
    }).filter((item) => item.name || item.imageUrl || item.filePath)
}

function normalizeProofPointsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            heading: normalizeText(c.heading),
            body: normalizeText(c.body)
        }
    }).filter((item) => item.heading || item.body)
}

function normalizeFeatureComparisonItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            label: normalizeText(c.label),
            included: c.included !== false
        }
    }).filter((item) => item.label)
}

function normalizeStepsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            title: normalizeText(c.title),
            body: normalizeText(c.body)
        }
    }).filter((item) => item.title || item.body)
}

function normalizePricingFeatures(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => normalizeText(item)).filter(Boolean)
}

function normalizeBlockSlug(value) {
    return normalizeBlockAnchorId(value)
}

function normalizePricingItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            name: normalizeText(c.name),
            price: normalizeText(c.price),
            period: normalizeText(c.period),
            description: normalizeText(c.description),
            features: normalizePricingFeatures(c.features),
            ctaText: normalizeText(c.ctaText),
            ctaHref: normalizeText(c.ctaHref),
            highlighted: c.highlighted === true
        }
    }).filter((item) => item.name || item.price)
}

function normalizeIconCardsColumns(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 3
    return Math.min(4, Math.max(2, Math.round(numeric)))
}

function normalizeIconCardsItems(value) {
    const candidates = Array.isArray(value) ? value : []
    return candidates.map((item) => {
        const c = item && typeof item === 'object' ? item : {}
        return {
            icon: normalizeText(c.icon),
            title: normalizeText(c.title),
            body: normalizeText(c.body)
        }
    }).filter((item) => item.title || item.body)
}

function normalizeThreePanelItems(value) {
    const candidates = Array.isArray(value) ? value : []
    const normalized = candidates.slice(0, 3).map((item) => {
        const candidate = item && typeof item === 'object' ? item : {}
        return {
            eyebrow: normalizeText(candidate.eyebrow),
            heading: normalizeText(candidate.heading),
            body: normalizeText(candidate.body),
            body2: normalizeText(candidate.body2),
            body3: normalizeText(candidate.body3),
            body4: normalizeText(candidate.body4)
        }
    })

    while (normalized.length < 3) {
        normalized.push({
            eyebrow: '',
            heading: '',
            body: '',
            body2: '',
            body3: '',
            body4: ''
        })
    }

    return normalized
}

function normalizePageBlock(block, index = 0) {
    const candidate = block && typeof block === 'object' ? block : {}
    const type = PAGE_BLOCK_TYPES.has(candidate.type) ? candidate.type : 'paragraph'
    const base = {
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : createStableFallbackBlockId(type, index),
        type
    }

    switch (type) {
        case 'eyebrow':
            return {
                ...base,
                text: normalizeText(candidate.text)
            }
        case 'heading':
            return {
                ...base,
                text: normalizeText(candidate.text),
                level: normalizeHeadingLevel(candidate.level)
            }
        case 'paragraph':
            return {
                ...base,
                text: normalizeText(candidate.text)
            }
        case 'image':
            return {
                ...base,
                src: normalizeText(candidate.src),
                alt: normalizeText(candidate.alt),
                caption: normalizeText(candidate.caption)
            }
        case 'quote':
            return {
                ...base,
                quote: normalizeText(candidate.quote),
                attribution: normalizeText(candidate.attribution)
            }
        case 'cta':
            return {
                ...base,
                text: normalizeText(candidate.text),
                href: normalizeText(candidate.href)
            }
        case 'contact':
            return {
                ...base,
                title: normalizeText(candidate.title || candidate.label),
                heading: normalizeText(candidate.heading),
                description: normalizeText(candidate.description || candidate.subheading),
                ctaText: normalizeText(candidate.ctaText || candidate.text),
                ctaHref: normalizeText(candidate.ctaHref || candidate.href),
                secondaryCtaText: normalizeText(candidate.secondaryCtaText || candidate.secondaryText || candidate.altCtaText),
                secondaryCtaHref: normalizeText(candidate.secondaryCtaHref || candidate.secondaryHref || candidate.altCtaHref)
            }
        case 'latest_posts':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                limit: normalizeLatestPostsLimit(candidate.limit),
                orderMode: normalizeLatestPostsOrderMode(candidate.orderMode),
                layout: normalizeLatestPostsLayout(candidate.layout),
                postIds: normalizeStringArray(candidate.postIds),
                postSlugs: normalizeStringArray(candidate.postSlugs, (item) => item.toLowerCase())
            }
        case 'industry_news':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                topic: normalizeText(candidate.topic)
            }
        case 'single_post':
            return {
                ...base,
                eyebrow: normalizeText(candidate.eyebrow),
                title: normalizeText(candidate.title || candidate.eyebrow),
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                postId: normalizeText(candidate.postId),
                postSlug: normalizeText(candidate.postSlug).toLowerCase()
            }
        case 'three_panel':
            return {
                ...base,
                eyebrow: normalizeText(candidate.eyebrow),
                title: normalizeText(candidate.title || candidate.eyebrow),
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                postId: normalizeText(candidate.postId),
                postSlug: normalizeText(candidate.postSlug).toLowerCase(),
                autoAdvancePanels: normalizeBooleanFlag(candidate.autoAdvancePanels, false),
                autoAdvanceIntervalMs: normalizeThreePanelAutoAdvanceInterval(candidate.autoAdvanceIntervalMs),
                headingBackgroundColor: normalizeThreePanelHeaderBackgroundColor(candidate.headingBackgroundColor),
                items: normalizeThreePanelItems(candidate.items)
            }
        case 'cards':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                columns: normalizeCardsColumns(candidate.columns),
                showBackground: candidate.showBackground !== false,
                items: normalizeCardsItems(candidate.items)
            }
        case 'faq':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                items: normalizeFaqItems(candidate.items)
            }
        case 'divider':
            return base
        case 'hero':
            return {
                ...base,
                headline: normalizeText(candidate.headline),
                slug: normalizeBlockSlug(candidate.slug || candidate.headline),
                subheadline: normalizeText(candidate.subheadline),
                ctaText: normalizeText(candidate.ctaText),
                ctaHref: normalizeText(candidate.ctaHref),
                backgroundType: ['color', 'gradient', 'image'].includes(candidate.backgroundType) ? candidate.backgroundType : 'color',
                backgroundValue: normalizeText(candidate.backgroundValue),
                imageUrl: normalizeText(candidate.imageUrl),
                textAlign: ['left', 'center', 'right'].includes(candidate.textAlign) ? candidate.textAlign : 'center',
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'testimonials':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                variant: ['marquee', 'carousel', 'grid'].includes(candidate.variant) ? candidate.variant : 'marquee',
                items: normalizeTestimonialsItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'stats':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                variant: ['centered', 'row'].includes(candidate.variant) ? candidate.variant : 'row',
                items: normalizeStatsItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'logo_marquee':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                items: normalizeLogoMarqueeItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'feature_comparison':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                eyebrow: normalizeText(candidate.eyebrow),
                items: normalizeFeatureComparisonItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'steps':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                eyebrow: normalizeText(candidate.eyebrow),
                items: normalizeStepsItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'pricing':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                items: normalizePricingItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'bio_profile':
            return {
                ...base,
                imageUrl: normalizeText(candidate.imageUrl),
                imageAlt: normalizeText(candidate.imageAlt),
                eyebrow: normalizeText(candidate.eyebrow),
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                body: normalizeText(candidate.body),
                ctaText: normalizeText(candidate.ctaText),
                ctaHref: normalizeText(candidate.ctaHref),
                imagePosition: candidate.imagePosition === 'right' ? 'right' : 'left',
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'icon_cards':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                eyebrow: normalizeText(candidate.eyebrow),
                columns: normalizeIconCardsColumns(candidate.columns),
                items: normalizeIconCardsItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        case 'proof_points':
            return {
                ...base,
                heading: normalizeText(candidate.heading),
                slug: normalizeBlockSlug(candidate.slug || candidate.heading),
                reverse: candidate.reverse === true,
                items: normalizeProofPointsItems(candidate.items),
                styles: normalizeBlockStyles(candidate.styles)
            }
        default:
            return {
                ...base,
                text: normalizeText(candidate.text)
            }
    }
}

export function normalizePageBlocks(value) {
    if (!Array.isArray(value)) return []
    return value
        .map((block, index) => normalizePageBlock(block, index))
        .filter(Boolean)
}

export function createPageBlock(type = 'paragraph') {
    if (type === 'latest_posts') {
        const block = normalizePageBlock({
            type,
            heading: 'Latest Posts',
            limit: 4,
            orderMode: 'newest',
            layout: DEFAULT_LATEST_POSTS_LAYOUT,
            postIds: [],
            postSlugs: []
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'industry_news') {
        const block = normalizePageBlock({
            type,
            heading: 'Industry News',
            topic: 'Small Business Operations'
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'contact') {
        const block = normalizePageBlock({
            type,
            title: 'Contact',
            heading: "Let's talk",
            description: 'Let me know what is working, what is not, and we will explore how we might work together.',
            ctaText: 'Schedule an intro call',
            ctaHref: '/contact',
            secondaryCtaText: 'Or see how I work',
            secondaryCtaHref: '/how-i-work'
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'cards') {
        const block = normalizePageBlock({
            type,
            heading: '',
            slug: '',
            columns: 2,
            showBackground: true,
            items: [
                { eyebrow: '', title: 'Card Title', body: 'Card body text goes here.', href: '', linkText: '' },
                { eyebrow: '', title: 'Card Title', body: 'Card body text goes here.', href: '', linkText: '' }
            ]
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'single_post') {
        const block = normalizePageBlock({
            type,
            eyebrow: '',
            title: '',
            heading: '',
            slug: '',
            postId: '',
            postSlug: ''
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'three_panel') {
        const block = normalizePageBlock({
            type,
            eyebrow: '',
            title: '',
            heading: '',
            slug: '',
            postId: '',
            postSlug: '',
            autoAdvancePanels: false,
            autoAdvanceIntervalMs: 5200,
            headingBackgroundColor: 'color1',
            items: [
                {
                    eyebrow: 'Win More Business',
                    heading: 'Build a repeatable sales engine that drives predictable revenue.',
                    body: 'Map, fix, and standardize the sales process so your team knows what to do at every stage.',
                    body2: 'Analyze feedback from won and lost deals and turn it into actionable insights to refine your sales approach.',
                    body3: '',
                    body4: ''
                },
                {
                    eyebrow: 'Build Systems That Scale',
                    heading: 'Streamline operations and automate workflows so your team delivers more with less effort.',
                    body: 'Design and implement automations to handle repetitive tasks, reduce errors, and free teams to focus on higher-value work.',
                    body2: '',
                    body3: '',
                    body4: ''
                },
                {
                    eyebrow: 'Hire And Retain The Right People',
                    heading: 'Attract, onboard, and motivate the right talent to grow your business faster.',
                    body: 'Fix broken hiring processes to consistently attract better candidates and fill roles quickly.',
                    body2: '',
                    body3: '',
                    body4: ''
                }
            ]
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'faq') {
        const block = normalizePageBlock({
            type,
            heading: 'Frequently Asked Questions',
            slug: '',
            items: [
                {
                    question: "What's the difference between a fractional operator and a business coach?",
                    answer: "A business coach helps you think through decisions. I help you make and implement them. I work inside your business to set up systems, run projects, manage people and vendors, not just advising from the outside. You get a senior operator, not a sounding board."
                },
                {
                    question: 'What makes you different from a typical consultant?',
                    answer: "Most consultants hand you a report and leave you to do the hard work of implementing. I stay until the work is done and your team is actually using the new way of doing things. I'm also not tied to any methodology or preferred toolset, I recommend what works best for your business."
                },
                {
                    question: 'How much time will you need from me?',
                    answer: 'The goal is to reduce demands on your time, not add to them. After an initial briefing, most clients spend 2\u20133 hours per week with me, mostly a standing check-in and quick decisions. The rest I handle.'
                },
                {
                    question: 'What size business do you work with?',
                    answer: 'While I have proven success at businesses from 100 to 100,000 staff, I find the fractional model works best with founder-led businesses of up to 200 people, with turnover in the $2M\u2013$20M range. This is often when businesses have outgrown informal ways of working, but aren\u2019t ready for a full-time operations executive. If you\u2019re not sure whether that\u2019s you, the Ops Audit is a good place to find out.'
                },
                {
                    question: 'Do you work across industries?',
                    answer: 'Yes. While my background is primarily in SaaS and media/publishing, the operational challenges that slow businesses down, such as unclear ownership, poor systems, reactive hiring, or inconsistent processes, show up across industries. My breadth of experience will help bring ideas and learnings to your business that you may not see otherwise.'
                },
                {
                    question: 'How quickly can you start?',
                    answer: 'Usually within 1\u20132 weeks of our initial call. If something is genuinely urgent, let me know when you reach out.'
                },
                {
                    question: 'How long do engagements typically run?',
                    answer: 'Sprints are usually 2\u20138 weeks. Embedded clients typically work with me for 3\u201312 months; long enough to build something that lasts. I\u2019m not trying to create dependency; the goal is to get your business to the point where it runs without me.'
                },
                {
                    question: "What if I don't really know what I need help with?",
                    answer: "That's exactly what the Ops Audit is for. Most business owners have a general sense that something isn't working, but don't have the time or distance to pinpoint it. We'll figure it out together."
                },
                {
                    question: 'Do you only work with Melbourne businesses?',
                    answer: 'I can work onsite within ~10km of the Melbourne CBD, and remotely with anyone. Most of my work involves a mix of both.'
                },
                {
                    question: "I've had bad experiences with consultants before.",
                    answer: "I understand. The most common complaints I hear are: they didn't understand the reality of a smaller business, they recommended things that were too complex or expensive, and they disappeared once the document was delivered. I work differently, hands-on, practical, and I stay until things are actually working."
                },
                {
                    question: 'How do you ensure alignment with culture and objectives?',
                    answer: "I run a comprehensive onboarding process that takes a deep dive into your company's mission, values, and goals. Wherever possible I spend time onsite to get to know you and your team. Lastly, we'll establish regular check-ins and feedback loops to ensure we stay in lock step."
                },
                {
                    question: 'What if we decide we need a full time operator in the future?',
                    answer: "If and when you decide to make that transition, I'm more than happy to help scope the role, and support the sourcing, interviewing, and onboarding process to ensure a seamless transition."
                }
            ]
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'hero') {
        const block = normalizePageBlock({
            type,
            headline: 'Your Compelling Headline',
            slug: '',
            subheadline: 'A short description that expands on your headline and tells visitors what to expect.',
            ctaText: 'Get Started',
            ctaHref: '',
            backgroundType: 'gradient',
            backgroundValue: 'linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%)',
            imageUrl: '',
            textAlign: 'center',
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'testimonials') {
        const block = normalizePageBlock({
            type,
            heading: 'What Our Clients Say',
            slug: '',
            variant: 'marquee',
            items: [
                { quote: 'This service transformed our business. We saw results within weeks.', author: 'Jane Smith', role: 'CEO', company: 'Acme Corp', avatarUrl: '' },
                { quote: 'Exceptional quality and professionalism. Highly recommend to anyone.', author: 'Mark Johnson', role: 'Founder', company: 'Startup Co', avatarUrl: '' },
                { quote: 'The best investment we made this year. Our team is more productive than ever.', author: 'Sarah Lee', role: 'COO', company: 'Growth Inc', avatarUrl: '' },
                { quote: 'Clear communication, on-time delivery, and outstanding results.', author: 'Tom Brown', role: 'Director', company: 'Scale Up Ltd', avatarUrl: '' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'stats') {
        const block = normalizePageBlock({
            type,
            heading: '',
            slug: '',
            variant: 'row',
            items: [
                { value: '200+', label: 'Clients Served', prefix: '', suffix: '' },
                { value: '20', label: 'Hours Saved Per Week', prefix: '', suffix: 'hrs' },
                { value: '98', label: 'Satisfaction Rate', prefix: '', suffix: '%' },
                { value: '5', label: 'Years Experience', prefix: '', suffix: '+' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'logo_marquee') {
        const block = normalizePageBlock({
            type,
            heading: 'As Seen In',
            slug: '',
            items: [
                { name: 'Forbes', imageUrl: '', href: '' },
                { name: 'Inc.', imageUrl: '', href: '' },
                { name: 'Fast Company', imageUrl: '', href: '' },
                { name: 'HBR', imageUrl: '', href: '' },
                { name: 'TechCrunch', imageUrl: '', href: '' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'feature_comparison') {
        const block = normalizePageBlock({
            type,
            heading: 'What We Do (And Don\u2019t Do)',
            slug: '',
            eyebrow: 'Our Approach',
            items: [
                { label: 'Focus on generating real impact quickly', included: true },
                { label: 'Tackle one priority at a time', included: true },
                { label: 'Tell the truth with kindness', included: true },
                { label: 'Leave you to defend your spend', included: false },
                { label: 'Try to fix everything at once', included: false }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'steps') {
        const block = normalizePageBlock({
            type,
            heading: 'How It Works',
            slug: '',
            eyebrow: 'Simple Process',
            items: [
                { title: 'Book a Discovery Call', body: 'Tell us about your business and what you\u2019re trying to achieve.' },
                { title: 'We Build a Plan', body: 'We\u2019ll outline a clear roadmap tailored to your specific goals.' },
                { title: 'Start Seeing Results', body: 'We execute together and track progress every step of the way.' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'pricing') {
        const block = normalizePageBlock({
            type,
            heading: 'Simple, Transparent Pricing',
            slug: '',
            items: [
                {
                    name: 'Starter',
                    price: '$1,500',
                    period: 'per month',
                    description: 'Perfect for businesses just getting started.',
                    features: ['2 tasks at a time', 'Email support', 'Monthly review'],
                    ctaText: 'Get Started',
                    ctaHref: '',
                    highlighted: false
                },
                {
                    name: 'Growth',
                    price: '$3,500',
                    period: 'per month',
                    description: 'Our most popular plan for growing teams.',
                    features: ['Unlimited tasks', 'Priority support', 'Weekly check-ins', 'Slack access'],
                    ctaText: 'Get Started',
                    ctaHref: '',
                    highlighted: true
                }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'bio_profile') {
        const block = normalizePageBlock({
            type,
            imageUrl: '',
            imageAlt: '',
            eyebrow: 'Meet Your Partner',
            heading: 'Hi, I\u2019m [Your Name]',
            slug: '',
            body: 'Tell your story here. Share your background, your passion, and why you do what you do. Be authentic and connect with your reader.',
            ctaText: 'Learn More',
            ctaHref: '',
            imagePosition: 'left',
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'icon_cards') {
        const block = normalizePageBlock({
            type,
            heading: 'What We Offer',
            slug: '',
            eyebrow: 'Our Services',
            columns: 3,
            items: [
                { icon: '\u2728', title: 'Strategy', body: 'Clear direction and a roadmap to hit your goals.' },
                { icon: '\u2699\ufe0f', title: 'Operations', body: 'Systems and processes that scale with your business.' },
                { icon: '\ud83d\ude80', title: 'Execution', body: 'Hands-on implementation to get things done fast.' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    if (type === 'proof_points') {
        const block = normalizePageBlock({
            type,
            heading: 'Why Work With Me',
            slug: '',
            items: [
                { heading: 'Operational chops without the overhead.', body: 'Experience building and scaling high-growth organisations, ready to apply to your business.' },
                { heading: 'Hands-on and decisive.', body: 'No analysis paralysis or lengthy strategy decks. Just clear thinking and rapid delivery.' },
                { heading: 'I focus on people as much as process.', body: 'Systems only work if people use them. I help guide your team through the change curve.' },
                { heading: 'Not tied to any tools or software.', body: 'Software agnostic. I’ll recommend what makes sense for your business and your team.' },
                { heading: 'No dramas, even when things are messy.', body: 'A calm, positive approach that makes even complex problems feel solvable.' }
            ],
            styles: {}
        })
        return { ...block, id: createBlockId() }
    }

    const block = normalizePageBlock({ type })
    return { ...block, id: createBlockId() }
}

export function getPageBlockTypeOptions() {
    return [
        { value: 'eyebrow', label: 'Eyebrow' },
        { value: 'heading', label: 'Heading' },
        { value: 'paragraph', label: 'Paragraph' },
        { value: 'image', label: 'Image' },
        { value: 'quote', label: 'Quote' },
        { value: 'cta', label: 'Call To Action' },
        { value: 'contact', label: 'Contact' },
        { value: 'industry_news', label: 'Industry News' },
        { value: 'single_post', label: 'Single Post' },
        { value: 'three_panel', label: 'Three Panel Feature' },
        { value: 'cards', label: 'Cards Grid' },
        { value: 'faq', label: 'FAQ Accordion' },
        { value: 'divider', label: 'Divider' },
        { value: 'hero', label: 'Hero' },
        { value: 'testimonials', label: 'Testimonials' },
        { value: 'stats', label: 'Stats' },
        { value: 'logo_marquee', label: 'Logo Marquee' },
        { value: 'feature_comparison', label: 'Feature Comparison' },
        { value: 'steps', label: 'Steps' },
        { value: 'pricing', label: 'Pricing Cards' },
        { value: 'bio_profile', label: 'Bio / Profile' },
        { value: 'icon_cards', label: 'Icon Cards' },
        { value: 'proof_points', label: 'Proof Points' }
    ]
}
