import { NextResponse } from 'next/server'
import { generateWebSearch } from '@/lib/ai/webSearch'
import { AI_SERVICE_WEB_SEARCH } from '@/lib/ai/services'
import { readAiServiceSelection } from '@/lib/ai/serviceSettings'

const SEARCH_SYSTEM_PROMPT = 'You are a research assistant. Use the web search tool to find current, factual information. Follow the user\'s instructions carefully regarding format, number of results, and content requirements. Include specific sources and citations as requested.'

/**
 * Run a web-grounded query.
 * POST /api/openai/search
 *
 * Body: { query, provider?, model? }
 * The provider defaults to the configured "Web search" service provider
 * (OpenAI, Claude or Gemini), not necessarily the chat provider.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const query = typeof body?.query === 'string' ? body.query.trim() : ''

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    const selection = await readAiServiceSelection(AI_SERVICE_WEB_SEARCH).catch(() => null)
    const provider = typeof body?.provider === 'string' && body.provider.trim()
      ? body.provider.trim()
      : selection?.provider
    // An explicit override invalidates the stored model, which belongs to the stored provider.
    const model = typeof body?.model === 'string' && body.model.trim()
      ? body.model.trim()
      : (body?.provider ? undefined : selection?.model)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)

    try {
      const result = await generateWebSearch({
        query,
        system: SEARCH_SYSTEM_PROMPT,
        provider,
        model,
        signal: controller.signal,
      })

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, provider: result.provider },
          { status: result.status }
        )
      }

      return NextResponse.json({
        content: result.text,
        searchQueries: result.searchQueries,
        sources: result.sources,
        provider: result.provider,
        model: result.model,
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        return NextResponse.json({ error: 'Web search timed out' }, { status: 504 })
      }
      return NextResponse.json(
        { error: err?.message || 'Failed to run web search' },
        { status: 500 }
      )
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    console.error('Error running web search:', error)
    return NextResponse.json(
      { error: 'Failed to run web search' },
      { status: 500 }
    )
  }
}
