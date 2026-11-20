import { NextResponse } from 'next/server'
import { resolveDomainAiConfig } from '@/lib/domainAiConfig'
import { DOMAIN_AI_FEATURE_INTAKE_ASSISTANT } from '@/lib/domainAiFeatures'
import { requestAiChatCompletion } from '@/lib/openaiClient'
import { IDENTITY_POLICY_DELEGATED } from '@/lib/ai/chat'
import {
  EGRESS_CHANNEL_INTAKE,
  EGRESS_DECISION_DISCLOSED,
  PrivacyEgressError,
  guardOutgoingChat,
  hasIdentityValues,
  recordEgressEvent,
} from '@/lib/privacy'
import { buildIntakeIdentity } from '@/lib/intakeIdentity'

function buildSystemPrompt(schema, answers, options = {}) {
  const { hasExistingAssistantIntro = false } = options
  const fieldLines = schema.fields.map(f => {
    const req = f.required ? '(required)' : '(optional)'
    const opts = f.options ? ` — options: ${f.options.join(', ')}` : ''
    // Only whether a field is answered. Echoing the value here would re-send the patient's name,
    // date of birth and address on every turn of the conversation.
    const answered = answers[f.id] !== undefined && String(answers[f.id]).trim() !== '' ? ' ✓ answered' : ''
    return `  • [${f.id}] ${f.label} [${f.type}] ${req}${opts}${answered}`
  }).join('\n')

  return `You are a friendly virtual assistant for ${schema.orgName} Occupational Therapy practice.
You are assisting patients on behalf of Kate who is a sole trader and services (primarily) the South Eastern suburbs of Melbourne, Australia so assume the patient is likely from that area.
Your task is to collect information one question at a time in a calm, supportive, conversational way. The patient is completing the intake form themselves so refer to them directly ("you", "your").

VOICE AND TONE:
- Speak to the patient directly with warm, simple language.
- Vary your phrasing naturally so responses do not sound repetitive.
- Rotate acknowledgement phrases (for example: "Thanks", "Got it", "That helps", "I appreciate that").
- Keep each message concise (usually 1-3 short sentences).
- Mention early in the conversation, and again at completion, that you will pass responses to Kate and she will get back to them shortly.

FORM FIELDS IN ORDER:
${fieldLines}

INSTRUCTIONS:
1. Look at which fields are already answered (marked ✓) and determine the next unanswered field to ask about.
2. Ask exactly ONE question per response. Be warm and concise.
3. For Dropdown fields, do not write phrases like "You can choose:" in the reply. Ask the question naturally and put clickable choices into the options array.
4. For Date or Date of birth fields, accept any natural format (e.g. "15 March 1990", "03/15/1990") and normalize to YYYY-MM-DD in your extraction.
5. For Phone fields, accept Australian mobile/landline formats. Strip spaces/hyphens in extracted value.
6. For Address fields, collect: address, suburb and post code. If the user provides a street address that includes a recognisable suburb (e.g. "26 Somers Ave Malvern"), infer the missing components from your knowledge of the area (e.g. suburb: Malvern, state: VIC, postcode: 3144, country: Australia) and ask a single confirmation question like "Is that Malvern, VIC 3144, Australia?" rather than asking for each part separately. Only ask follow-up questions if the suburb is ambiguous or unrecognised.
7. If the user's answer is invalid or ambiguous, explain why and ask again - do NOT move to the next field.
8. If funding_source is "TAC", prompt for accident_date even though it is optional.
9. Once all required fields are collected (and TAC accident_date if applicable), present a concise summary of all answers and ask the user to confirm or correct anything.
10. Once the user confirms, thank them, tell them you will send this to Kate and she will get back to them shortly, then set isComplete to true.
11. If this is your first assistant response in the conversation, introduce yourself as a virtual assistant helping Kate and include the reassurance that Kate will follow up shortly.
12. Do not ask the same field twice in a row unless the user's previous response is invalid or ambiguous; if repeating, briefly explain why it needs clarification.
13. If the user provides a plausible answer for the current field, extract it instead of re-asking the same question.

${hasExistingAssistantIntro
      ? 'INTRODUCTION GUARD: The assistant has already introduced itself earlier in this chat. Do not introduce yourself again.'
      : ''}

RESPONSE FORMAT — always respond with valid JSON only, no extra text:
{
  "reply": "<your conversational message to show the user>",
  "options": ["<optional clickable choice 1>", "<optional clickable choice 2>"],
  "fieldId": "<the Splose field id you just extracted a value for, or null>",
  "fieldValue": <the extracted validated value, or null>,
  "isComplete": false
}`
}

/**
 * POST /api/intake/chat
 * Body: { messages: [{role, content}], answers: {}, schema: {...} }
 * Returns: { reply, fieldId, fieldValue, isComplete }
 */
export async function POST(request) {
  const aiConfig = await resolveDomainAiConfig({
    headerStore: request.headers,
    feature: DOMAIN_AI_FEATURE_INTAKE_ASSISTANT,
  })
  if (!aiConfig.hasApiKey) {
    return NextResponse.json({ error: `AI API key not configured for this domain (${aiConfig.providerLabel})` }, { status: 500 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messages, answers, schema } = body

  if (!Array.isArray(messages) || !answers || !schema?.fields) {
    return NextResponse.json({ error: 'Missing required fields: messages, answers, schema' }, { status: 400 })
  }

  // Cap history to avoid runaway token use
  const MAX_HISTORY = 40
  const trimmedMessages = messages.slice(-MAX_HISTORY)

  const hasExistingAssistantIntro = trimmedMessages.some(
    (m) => m?.role === 'assistant' && /virtual assistant|Kate/i.test(String(m?.content || ''))
  )

  const identity = buildIntakeIdentity(schema, answers)

  // Everything said so far is scrubbed; only the answer being extracted this turn is sent as
  // typed, because extracting it locally is the one piece this flow does not do yet.
  const history = trimmedMessages.slice(0, -1)
  const currentMessage = trimmedMessages[trimmedMessages.length - 1]

  const systemPrompt = buildSystemPrompt(schema, answers, { hasExistingAssistantIntro })
  let guarded
  try {
    guarded = guardOutgoingChat(
      { messages: history, system: systemPrompt },
      { identity, channel: EGRESS_CHANNEL_INTAKE }
    )
  } catch (error) {
    if (!(error instanceof PrivacyEgressError)) throw error
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (currentMessage) {
    recordEgressEvent({
      channel: EGRESS_CHANNEL_INTAKE,
      decision: EGRESS_DECISION_DISCLOSED,
      identityKnown: hasIdentityValues(identity),
      findings: [{ kind: 'form-answer', count: 1 }],
      reason: 'The answer being extracted this turn is sent as typed; the rest of the conversation is de-identified.',
    })
  }

  let completion
  try {
    completion = await requestAiChatCompletion({
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrl: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      identity,
      channel: EGRESS_CHANNEL_INTAKE,
      // This route has already guarded the payload; the one unredacted message is the answer being
      // extracted, recorded as a disclosed egress above.
      identityPolicy: IDENTITY_POLICY_DELEGATED,
      messages: [
        { role: 'system', content: guarded.system },
        ...guarded.messages,
        ...(currentMessage ? [currentMessage] : []),
      ],
      temperature: 0.4,
      maxOutputTokens: 600,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to reach AI provider', detail: err.message }, { status: 502 })
  }

  if (!completion.ok) {
    return NextResponse.json(
      { error: 'AI provider error', detail: completion.error || completion.status },
      { status: 502 }
    )
  }

  const raw = completion.text || '{}'

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // If the model somehow returned non-JSON, surface the text as a reply
    return NextResponse.json({ reply: raw, fieldId: null, fieldValue: null, isComplete: false })
  }

  return NextResponse.json({
    reply: parsed.reply ?? '',
    options: Array.isArray(parsed.options)
      ? parsed.options
        .map((opt) => String(opt).trim())
        .filter(Boolean)
        .slice(0, 8)
      : [],
    fieldId: parsed.fieldId ?? null,
    fieldValue: parsed.fieldValue ?? null,
    isComplete: parsed.isComplete === true,
  })
}
