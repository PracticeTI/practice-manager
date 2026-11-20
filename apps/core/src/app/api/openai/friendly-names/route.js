import { NextResponse } from 'next/server'
import { requestAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiChatConfig } from '@/lib/ai/serverConfig'

/**
 * Get friendly names for URLs using the configured AI provider
 * POST /api/openai/friendly-names
 */
export async function POST(request) {
  try {
    const aiConfig = await resolveAiChatConfig()

    if (!aiConfig.hasApiKey) {
      return NextResponse.json(
        { error: `${aiConfig.providerLabel} API key not configured` },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const urls = Array.isArray(body?.urls) ? body.urls : []

    if (urls.length === 0) {
      return NextResponse.json({ names: {} })
    }

    const prompt = `Convert these URLs into friendly, readable website names. Return ONLY a JSON object mapping each URL to its friendly name.

Examples:
- "https://en.wikipedia.org/wiki/..." → "Wikipedia"
- "https://www.georgiaentertainment.com/..." → "Georgia Entertainment"
- "https://www.hobokengirl.com/..." → "Hoboken Girl"
- "https://www.imdb.com/..." → "IMDb"

URLs to convert:
${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Return format:
{
  "url1": "Friendly Name 1",
  "url2": "Friendly Name 2"
}`

    const completion = await requestAiChatCompletion({
      ...aiConfig,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      maxOutputTokens: 500
    })

    if (!completion.ok) {
      console.error('AI provider error:', completion.error || completion.status)
      return NextResponse.json(
        { error: 'Failed to get friendly names' },
        { status: completion.status }
      )
    }

    const content = String(completion.text || '{}')

    // Parse the JSON response
    try {
      // Remove markdown code blocks if present
      let cleanContent = content.trim()
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```\s*$/, '')
      }

      const names = JSON.parse(cleanContent)
      return NextResponse.json({ names })
    } catch (e) {
      console.error('Failed to parse AI response:', content)
      // Return fallback names
      const fallbackNames = {}
      urls.forEach(url => {
        try {
          const domain = new URL(url).hostname.replace(/^www\./, '')
          const mainPart = domain.split('.')[0]
          fallbackNames[url] = mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
        } catch {
          fallbackNames[url] = url
        }
      })
      return NextResponse.json({ names: fallbackNames })
    }
  } catch (error) {
    console.error('Error getting friendly names:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
