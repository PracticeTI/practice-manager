import { NextResponse } from 'next/server'
import { requestOpenAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiChatConfig } from '@/lib/ai/serverConfig'

/**
 * POST /api/content/smart-page/edit
 * Use AI to edit page content based on a natural language prompt
 */
export async function POST(request) {
    try {
        const body = await request.json()
        const { prompt, currentData, witPayload } = body

        if (!prompt || !prompt.trim()) {
            return NextResponse.json(
                { error: 'Prompt is required' },
                { status: 400 }
            )
        }

        const aiConfig = await resolveAiChatConfig()
        if (!aiConfig.hasApiKey) {
            return NextResponse.json(
                { error: `${aiConfig.providerLabel} API key is not configured` },
                { status: 503 }
            )
        }

        // Build context from current data and WIT payload
        const context = {
            title: currentData?.title || '',
            summary: currentData?.preview || '',
            body: currentData?.body || '',
            witSource: witPayload ? {
                title: witPayload.title || '',
                summary: witPayload.summary || '',
                body: witPayload.body || '',
            } : null,
        }

        const systemPrompt = `You are an expert content editor for a local business/service directory.
You help admins refine and improve page content through natural language instructions.

Current page data:
- Title: ${context.title || '(empty)'}
- Summary: ${context.summary ? context.summary.substring(0, 200) : '(empty)'}
- Body: ${context.body ? context.body.substring(0, 200) : '(empty)'}

${context.witSource ? `
WIT source available:
- Title: ${context.witSource.title}
- Summary: ${context.witSource.summary ? context.witSource.summary.substring(0, 200) : '(empty)'}
- Body: ${context.witSource.body ? context.witSource.body.substring(0, 200) : '(empty)'}
` : ''}

Your task: Apply the user's edit instruction to improve the content.
- Return ONLY a valid JSON object with this exact structure (no markdown, no backticks):
{
  "title": "updated title if changed, or null",
  "summary": "updated summary if changed, or null",
  "body": "updated body if changed, or null",
  "changes": { "title": true, "summary": true, "body": true },
  "reasoning": "brief explanation of changes made"
}

Guidelines:
- Only modify fields that are specifically addressed in the user's instruction
- Return null for unchanged fields
- Keep changes natural and professional for a business directory
- If the instruction conflicts with current content, use WIT source as reference if available
- Never fabricate specific details like phone numbers or addresses unless instructed`

        const userPrompt = `Edit instruction: ${prompt}

Apply this instruction to improve the content. Return only the JSON object with changes.`

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 22000)

        try {
            const completion = await requestOpenAiChatCompletion({
                ...aiConfig,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                maxOutputTokens: 1500,
                signal: controller.signal,
            })

            clearTimeout(timeout)

            if (!completion?.ok) {
                throw new Error(completion?.error || 'No response from the AI provider')
            }

            const completionText = String(completion.text || '')
            let parsedResponse
            try {
                // Extract JSON from response (it might be wrapped)
                const jsonMatch = completionText.match(/\{[\s\S]*\}/)
                parsedResponse = JSON.parse(jsonMatch ? jsonMatch[0] : completionText)
            } catch (parseErr) {
                console.error('Failed to parse AI response:', completionText)
                throw new Error('Invalid response format from AI')
            }

            // Build updated data
            const updatedData = {}
            const changes = {}

            if (parsedResponse.title) {
                updatedData.title = parsedResponse.title
                changes.title = true
            }
            if (parsedResponse.summary) {
                updatedData.summary = parsedResponse.summary
                changes.summary = true
            }
            if (parsedResponse.body) {
                updatedData.body = parsedResponse.body
                changes.body = true
            }

            return NextResponse.json({
                success: true,
                updatedData,
                changes: Object.keys(changes).length > 0 ? changes : null,
                summary: parsedResponse.reasoning || 'Content updated',
            })
        } catch (err) {
            clearTimeout(timeout)
            if (err.name === 'AbortError') {
                throw new Error('AI processing timeout')
            }
            throw err
        }
    } catch (error) {
        console.error('Smart page edit error:', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to process edit' },
            { status: 500 }
        )
    }
}
