# Agentic and AI-Supported Features

An inventory of the AI- and agent-driven capabilities in this platform, grouped by what
the feature actually does. Paths are relative to `apps/core` unless prefixed with
`packages/`, which holds the shared modules — worker jobs live in `packages/jobs`.

All model calls go through the provider-agnostic layer in
[src/lib/ai/chat.js](../src/lib/ai/chat.js), which dispatches to OpenAI, Claude, Gemini or
DeepSeek depending on configuration. See the AI Providers section of the
[README](../../../README.md#ai-providers) for the key/model resolution order.

## 1. Conversational assistants

| Feature | What it does | Where |
|---|---|---|
| **Admin AI Assistant** | Per-domain chat assistant (OpenAI, Claude, Gemini, DeepSeek or Vertex) available from a floating launcher on every admin page and at `/admin/assistant`. Copy and starter prompts adapt to the domain's enabled features, and the system prompt carries clinical guardrails ("never invent patient facts"). Advisory and drafting only — it has no tools and no write access. | [route.js](../src/app/api/admin/assistant/route.js), [AssistantChat.jsx](../src/app/admin/assistant/AssistantChat.jsx), [assistantConfig.js](../src/lib/assistantConfig.js) |
| **Search-box handoff** | The practice search box detects question-shaped queries ("list this week's appointments", anything ending in `?`) and routes them to the assistant instead of performing a name lookup. | [assistantClient.js](../src/lib/assistantClient.js) |
| **Conversational intake** | Public `/intake` chat that asks one form question at a time over the practice's Splose form schema, validates and normalises answers (dates, Australian phone formats, addresses), handles TAC accident-date conditionals, and reads back a summary for confirmation. | [SploseIntakeChat.jsx](../src/app/intake/SploseIntakeChat.jsx), [chat/route.js](../src/app/api/intake/chat/route.js) |
| **Booking assistant** | Natural-language slot search on the public booking page. The model only extracts intent; every offered time comes from the same availability engine the calendar uses, so it cannot invent an appointment. | [BookingAssistant.jsx](../src/app/book/BookingAssistant.jsx), [agent/route.js](../src/app/api/scheduling/agent/route.js) |

## 2. Clinical documentation workers

These are the per-patient agent toggles in Admin → Patients → Overview. Each toggle
enqueues jobs that a background worker service drains; results are written back onto the
patient record rather than being published directly.

| Feature | What it does | Where |
|---|---|---|
| **Transcript Summariser (Scribe)** | AI audio transcription of live browser recordings or uploaded audio (chunked, OpenAI or Gemini), then automatic summarisation roughly five minutes after a transcript settles. Summary style is configurable; output is bullet-point, third-person and evidence-focused. | [chunk/route.js](../src/app/api/transcription/chunk/route.js), `packages/jobs/src/jobs/scribeWorker.js` |
| **HSR Summariser** | Re-summarises a transcript specifically for a TAC OTF10 Home Services Review, prioritising personal care, domestic tasks, mobility, equipment, supervision and safety. | [patientPageConfig.js](../src/app/admin/patients/patientPageConfig.js) |
| **HSR Writer / Reporting** | Generates report drafts from notes plus transcript summaries: TAC OTF10 (field-by-field against the pro-forma), NDIS FCA, and template-driven report types. Applies DOCX templates and template policies, and honours the configured provider and model tier. | `packages/jobs/src/jobs/reportWorker.js`, [reports/route.js](../src/app/api/database/reports/route.js) |
| **FCA Builder (NDIS)** | Step-by-step Functional Capacity Assessment builder that drafts each section with AI, with heuristic fallback when no key or provider is available. Participant identifying values are stripped from free text before it reaches the model, and de-identified language stems are used as style guidance only. | [NDISFCAReportBuilder.jsx](../src/admin-ui/components/NDISFCAReportBuilder.jsx), `packages/jobs/src/jobs/fcaReportGeneration.js`, [fcaLanguageManifest.js](../src/lib/fcaLanguageManifest.js) |
| **FCA Analyst** | Reads patient notes, transcripts and clinician-selected evidence documents, then returns domain-tagged findings and support recommendations (addressed versus recommended) that feed the FCA builder. | `packages/jobs/src/jobs/analysisWorker.js`, [analysisEvidenceDocuments.js](../src/lib/analysisEvidenceDocuments.js) |
| **Quote Writer** | Drafts a priced NDIS quote (header plus line items) from the clinical record. Every line is validated against the NDIS support catalogue and its price limits; `propose` never writes, and `draft` only ever overwrites its own draft, so hand-tuned quotes are safe. | [quoteWriter.js](../src/lib/quoteWriter.js), [assist/route.js](../src/app/api/database/quotes/assist/route.js) |
| **Human review layer** | Worker output is tagged `worker-draft` or `worker-assisted`, so nothing worker-written is treated as final until a person has reviewed it. A practice-wide review queue and Tasks view aggregate what is waiting on a human. Tasks keeps its own ledger of what it has raised, so a task stays on the list until somebody marks it done rather than disappearing when the record is actioned. | [workerReviewQueue.js](../src/lib/workerReviewQueue.js), [taskEntries.js](../src/lib/taskEntries.js); domain-specific operator notes live in the private overlay. |

**Agentic but not LLM-driven:** the **Equipment Sourcer** extracts the equipment table
from the latest OTF10 report and saves suggestions deterministically, and **Billing**
generates draft invoices from recent consultations. Both are queued workers, but neither
calls a model.

## 3. Directory and content enrichment

| Feature | What it does | Where |
|---|---|---|
| **Supplier/provider discovery** | An admin types a query; Brave Search finds candidates, then a guardrail (keyword vocabulary plus AI classification) rejects directories, dead sites and unrelated businesses before records are created. | [equipment/web-search/route.js](../src/app/api/equipment/web-search/route.js), [equipmentWebSearch.js](../src/lib/equipmentWebSearch.js), [providersWebSearch.js](../src/lib/providersWebSearch.js) |
| **Profile enrichment scripts** | Visit each provider or supplier homepage, have the model extract a structured profile and classify what the business is, then apply confident changes (and hide dead, parked or unrelated rows) with a before/after JSONL audit log. | [enrich-allied-health-providers.mjs](../scripts/enrich-allied-health-providers.mjs), [enrich-equipment-suppliers.mjs](../scripts/enrich-equipment-suppliers.mjs) |
| **Published-copy tone normalisation** | Rewrites model-written directory descriptions from "the site says…" into authoritative third-person copy, so research provenance does not leak into published text. | [descriptionTone.js](../src/lib/descriptionTone.js) |
| **Content editor helpers** | AI turns image URLs into friendly display names, and resolves company names to likely homepage URLs for the logo marquee. | [friendly-names/route.js](../src/app/api/openai/friendly-names/route.js), [logo-marquee-smart/route.js](../src/app/api/openai/logo-marquee-smart/route.js) |
| **Grounded web search API** | Provider-executed web search (OpenAI, Claude, Gemini) returning an answer plus source citations; DeepSeek returns an explicit "unsupported" instead of answering from memory. | [webSearch.js](../src/lib/ai/webSearch.js), [search/route.js](../src/app/api/openai/search/route.js) |

## 4. AI platform foundation

| Feature | What it does | Where |
|---|---|---|
| **Provider abstraction** | All chat and completion calls go through one entrypoint that dispatches to OpenAI, Claude, Gemini or DeepSeek (plus Vertex for the assistant). A model id belonging to another vendor is rejected before the request is sent. | [chat.js](../src/lib/ai/chat.js), [providers.js](../src/lib/ai/providers.js) |
| **Per-service providers** | Chat, web search and transcription each get their own provider (for example chat on DeepSeek, search with Claude, transcription with OpenAI). Only capable providers are offered; a stored-but-incapable setting is upgraded rather than breaking the feature. | [services.js](../src/lib/ai/services.js), [serviceSettings.js](../src/lib/ai/serviceSettings.js) |
| **Model catalog and validation** | Live `/v1/models` listing, curated flagship/balanced/value tiers per provider, and compatibility checks; OpenRouter exposes its full model catalog. | [openaiModel.js](../src/lib/openaiModel.js), [reportAiProviders.js](../src/lib/reportAiProviders.js) |
| **Connectivity and setup UI** | "Check" and "Test" probes per vendor, used by the setup modals and Domain Settings → AI & Defaults. | [providers/status/route.js](../src/app/api/ai/providers/status/route.js), [OpenAiSetupModal.jsx](../src/admin-ui/components/OpenAiSetupModal.jsx) |
| **AI usage and value dashboard** | 30-day cost roll-up per domain using per-model token pricing and currency conversion, plus a "replaced tools" savings comparison. | [ai-usage/route.js](../src/app/api/settings/domains/ai-usage/route.js), [aiUsageModel.js](../src/lib/aiUsageModel.js) |

## 5. Cross-cutting design conventions

Every model-facing feature in this list follows the same rules:

- **Draft-first.** Output lands as a draft or suggestion that a practitioner reviews,
  edits and sends; no worker publishes clinical content on its own.
- **Evidence-bound.** Prompts restrict the model to the supplied notes, transcripts and
  selected documents, and explicitly forbid inventing facts.
- **De-identified at the egress boundary.** Every model call is scrubbed against the patient's
  identity block and refused if an identifier survives — see
  [§6 Patient data and the model boundary](#6-patient-data-and-the-model-boundary). The two
  channels that cannot be scrubbed before sending (session audio, and the single form answer the
  intake chat is extracting) record a disclosed exception instead of a clean send.
- **Provider-agnostic.** No feature hardcodes a vendor endpoint; provider, model and
  service routing are configuration.
- **Attributable.** Worker output carries provenance (`worker-draft` /
  `worker-assisted`) and model/usage metadata, and the AI usage dashboard aggregates cost
  from the same records.

## 6. Patient data and the model boundary

The rule this platform enforces: **no identifying patient data reaches a model.** "Identifying"
means anything on the record that points at a person — the name (including a bare first name), date
of birth, address, phone, email, the Medicare / DVA / NDIS / TAC / WorkCover numbers, the practice's
own record id, and any third party named in the notes (nominee, emergency contact, referrer, support
coordinator, plan manager, a relative mentioned once).

`src/lib/privacy/` is the boundary for the app; the worker service in `packages/jobs` reaches
the same guard through `packages/jobs/src/privacy/`:

| Module | Job |
|---|---|
| `identity.js` | One shape for every identifier a record holds, built from the patient row and intake answers |
| `subject.js` | "the participant" for an NDIS record, "the patient" for TAC / WorkCover / DVA / aged care / private |
| `deidentify.js` | Glossary replacement (longest first) plus email, phone, address, postcode and titled-name patterns |
| `verify.js` | Re-scans what the redactor produced and reports what survived |
| `egress.js` | The guard every model call goes through, and the audit record |
| `rehydrate.js` | Real values back into headers, template tokens and generated drafts |

### Two enforced rules

- **Every model call goes through the guard.** Chat, streaming, transcription, web search and the
  four direct vendor calls in the worker service all pass through `guardOutgoingChat` /
  `guardOutgoingText` (or, in the FCA section writers, `deidentifyLlmText`).
  `test/privacyEgress.test.js` fails if a module reaches a vendor without it, which is the regression
  that actually happens: someone adds a `fetch` to `/chat/completions` and review misses it. It runs
  as a required step in the `Lint` job of `.github/workflows/ci.yml`.
- **The guard fails closed.** Redaction is best-effort by nature — a glossary cannot know about a
  neighbour mentioned once, and no pattern list is complete. So the boundary does not claim to
  redact everything; it refuses to send what survived. A blocked call fails with
  `PrivacyEgressError` (HTTP 422) and a quote or report job fails loudly rather than drafting from
  unredacted text.

### Referring to the person

Prose uses a role, never a name. A **claim number is not a pseudonym** — an NDIS or TAC number is
itself a direct identifier — so the substitute is the role word, not "participant 430012345".

### Restoring the person

The model never sees a name, so it cannot write one. The real details are restored locally, from
the same identity block:

- **Report and quote headers** are written from the database, never by a model.
- **Report template tokens** (`{{participant_name}}`, `{{ndis_number}}`) are hydrated by
  `hydrateIdentityVariables`.
- **Generated drafts** — the OTF10 fields and the quote summary and line justifications — are passed
  through `restoreIdentityDeep`, so the finished document reads "Ling Hu requires support with
  showering", not "the participant requires…". This restore never travels back to a model.
- **Prose restoration** (`restoreIdentityInText`) is opt-in: swapping "the participant" back is only
  correct for a document about one person, and third-party roles are never inverted because which
  coordinator attended is not recoverable from the text.

### Disclosed exceptions

Two channels carry identifying content that cannot be rewritten before it is sent. Both emit a
`disclosed-non-redactable` audit line instead of a clean one, so the log shows the gap rather than
implying full coverage:

1. **Session audio → speech-to-text.** A name spoken aloud is not a string that can be rewritten, so
   the recording reaches the transcription provider as recorded. Every request is recorded with its
   model. This is covered by the provider's data-processing terms, not by de-identification.
2. **The intake chat's current answer.** The intake chat extracts one field value per turn from what
   the patient typed. The conversation history and the collected answers are scrubbed (the system
   prompt reports only *whether* a field is answered, never its value), but the message being
   extracted is sent as typed, because extraction happens on the model. Moving that extraction
   locally is the remaining work for this flow.

### Checking it

```bash
npm test                        # every workspace; the privacy suites sit in apps/core/test
```

- `test/privacy.test.js` covers role nouns, the full identifier sweep, the fail-closed block, chat
  payload guarding, and the round trip from role phrase back to real name.
- `test/privacyEgress.test.js` walks `src/` and fails if a module reaches a model without the guard,
  or interpolates a patient name into message content.
- `getEgressAuditCounters()` in the worker exposes per-channel counts for a status endpoint; the
  per-call records are JSON lines stamped `ai.egress` in the platform logs. Records carry counts,
  finding kinds and character counts only — never the value that was removed, because an audit line
  that quoted the leak would itself be a disclosure.
