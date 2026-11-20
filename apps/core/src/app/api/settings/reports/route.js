import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { readReportSettingsForDomain, writeReportSettingsForDomain } from '@/lib/reportSettingsStore'
import { mergeLibraryTemplates } from '@/lib/templateLibraryServer'
import { readAiProviderModelCatalog } from '@/lib/aiProviderModelCatalog'
import {
	DEFAULT_REPORT_AI_PROVIDER,
	DEFAULT_REPORT_AI_TIER,
	DEFAULT_REPORT_AI_PROVIDER_MODELS,
	getReportAiProviderApiKeyAvailability,
	getReportAiProviderDisplayName,
	normalizeReportAiProvider,
	normalizeReportAiTier,
	normalizeReportAiProviderModels,
	resolveReportAiSelection,
} from '@/lib/reportAiProviders'
import {
	DEFAULT_STRICT_TEMPLATE_POLICY,
	DEFAULT_TEMPLATE_MODE,
	getStrictTemplatePolicies,
	normalizeReportTypeTemplateSettings,
	validateReportTypeTemplateBindings,
} from '@/lib/reportTemplatePolicies'

const DEFAULT_REPORT_TYPE = {
	id: 'general-progress',
	name: 'General Progress',
	description: 'Default report template for general progress reporting.',
	templateId: null,
	templateMode: DEFAULT_TEMPLATE_MODE,
	strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
	requiredPlaceholders: [],
	requiredAnchors: [],
	isActive: true,
}

const OTF6_REPORT_TYPE = {
	id: 'otf6-initial-occupational-therapy-assessment',
	name: 'OTF6 Initial Occupational Therapy Assessment',
	description: 'Agent-ready report type for OTF6 initial occupational therapy assessment templates.',
	templateId: null,
	templateMode: DEFAULT_TEMPLATE_MODE,
	strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
	requiredPlaceholders: [],
	requiredAnchors: [],
	isActive: true,
}

const NDIS_FCA_REPORT_TYPE = {
	id: 'ndis-functional-capacity-assessment',
	name: 'NDIS - Functional Capacity Assessment',
	description: 'Guided interactive report builder for NDIS Functional Capacity Assessments with intelligent step-by-step guidance.',
	templateId: null,
	templateMode: DEFAULT_TEMPLATE_MODE,
	strictTemplatePolicy: DEFAULT_STRICT_TEMPLATE_POLICY,
	requiredPlaceholders: [],
	requiredAnchors: [],
	isActive: true,
}

const DEFAULT_REPORT_TYPES = [DEFAULT_REPORT_TYPE, OTF6_REPORT_TYPE, NDIS_FCA_REPORT_TYPE]

const DEFAULT_CONFIG = {
	defaultReportTypeId: DEFAULT_REPORT_TYPE.id,
	includeSourceNotesByDefault: true,
	autoSaveDrafts: true,
	requireTemplateForGeneration: false,
	providerDetails: '',
	reportHeaderText: '',
	reportHeaderLogoUrl: '',
	daysHoursAvailable: '',
	aiProvider: DEFAULT_REPORT_AI_PROVIDER,
	aiModelTier: DEFAULT_REPORT_AI_TIER,
	providerModels: DEFAULT_REPORT_AI_PROVIDER_MODELS,
	aiGateway: 'openai',
	openAiModel: DEFAULT_REPORT_AI_PROVIDER_MODELS.openai.balanced,
	aimlApiBaseUrl: 'https://api.aimlapi.com/v1',
	aimlApiKey: '',
	aimlProvider: 'auto',
	aimlVendor: 'Open AI',
	aimlModel: DEFAULT_REPORT_AI_PROVIDER_MODELS.openai.balanced,
}

const KEEP_EXISTING_API_KEY_SENTINEL = '__UNCHANGED__'

const FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT = [
	'You are an expert occupational therapist writing FCA report sections for NDIS plan review.',
	'Use only the supplied participant evidence; approved language stems are loose style guidance, never facts.',
	'Do not invent diagnoses, scores, dates, medications, incidents, support hours, or assessment findings.',
	'Write in professional Australian clinical English: specific, measured, readable, and grounded in real-world function.',
	'Aim for about {{MIN_WORDS}} words, but evidence takes priority over length; never pad or repeat content to reach a target.',
	'The report shell supplies the cover page and starts every numbered section on a new A4 page. Do not add a cover page, a second title, page-break markup, or a horizontal rule yourself.',
].join(' ')

const FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT = [
	'Section: {{SECTION_TITLE}}',
	'',
	'Participant: {{PATIENT_NAME}}',
	'',
	'Practice: {{PRACTICE_NAME}}',
	'',
	'Evidence:',
	'- {{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}',
	'',
	'Approved language stems (style guidance only):',
	'- {{APPROVED_SNIPPETS_OR_NONE}}',
	'',
	'Output requirements: link each relevant functional impact to practical support implications; attribute sources only as specifically as the evidence permits.',
	'Evidence may include [Evidence source: ...] labels. Use these to distinguish input categories, but do not copy the labels into the report or treat them as proof of who observed or said something.',
	'Write in the assessing OT’s clinical voice. Use first person for the OT’s assessment or observations only when the evidence explicitly identifies them; otherwise attribute reports to the named source when available and never invent a speaker.',
	'Do not claim direct observation, a formal assessment, family or support-worker report, or a clinical-record finding unless the evidence identifies that source.',
	'Separate current supports from requested supports. State exact hours and schedules only when the evidence supplies them. Include standardised measures only when instrument and result are explicitly documented; preserve scores and comparisons exactly.',
	'Boxed callouts: open a blockquote with [!summary], [!evidence], [!finding], [!recommendation] or [!opinion]; the system guidance says when each applies. Put the lead-in label in bold at the start of the box, and keep tables and lists outside it.',
	'Keep the section title as the main heading and use the provided topic headings as level-three headings when supported by evidence. Format the opening executive-summary recommendation as a short standalone callout; use concise lists or tables when they improve scanning. State each finding once, and avoid stock phrases, repetition, filler, template notices, and raw context dumps.',
	'Layout: the template supplies the cover page and the report assembler starts every numbered section on a new A4 page. Do not add a cover page, duplicate title, page-break markup, or "---" separators to the section body.',
].join('\n')

function normalizeDomainKey(value) {
	return String(value || '').trim().toLowerCase()
}

function getAdminTokenFromRequest(request, payload = null) {
	const authHeader = request.headers.get('authorization') || ''
	const fromHeader = authHeader.startsWith('Bearer ')
		? authHeader.slice('Bearer '.length).trim()
		: ''
	if (fromHeader) return fromHeader
	if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
	return ''
}

function resolveScopedDomain(adminUser, requestedDomain) {
	const requested = normalizeDomainKey(requestedDomain)

	if (isSuperAdmin(adminUser)) {
		return requested
	}

	const scopedDomain = normalizeDomainKey(adminUser?.domain)
	if (!scopedDomain) return ''

	if (requested && requested !== scopedDomain) {
		return null
	}

	return scopedDomain
}

function normalizeFcaPromptConfig(input) {
	const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
	const systemPromptTemplate = String(source.systemPromptTemplate || '').trim() || FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT
	const userPromptTemplate = String(source.userPromptTemplate || '').trim() || FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT
	const minWords = Number.parseInt(String(source.minWords || source.minimumWords || '').trim(), 10)
	// Per-section targets are edited on the report settings Word Count tab. Keeping them in the
	// normalised shape stops a save from silently discarding a domain's overrides.
	const sectionMinWords = source.sectionMinWords && typeof source.sectionMinWords === 'object' && !Array.isArray(source.sectionMinWords)
		? Object.fromEntries(Object.entries(source.sectionMinWords).map(([key, value]) => {
			const parsed = Number.parseInt(String(value || '').trim(), 10)
			return [String(key || '').trim(), Number.isFinite(parsed) && parsed > 0 ? parsed : null]
		}).filter(([, value]) => value !== null))
		: {}

	return {
		systemPromptTemplate,
		userPromptTemplate,
		minWords: Number.isFinite(minWords) && minWords > 0 ? minWords : null,
		sectionMinWords,
	}
}

function normalizeReportTypeConfig(input, reportTypeId = '') {
	const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
	const normalized = {}

	if (String(reportTypeId || '').trim() === NDIS_FCA_REPORT_TYPE.id) {
		normalized.fcaPromptConfig = normalizeFcaPromptConfig(source.fcaPromptConfig)
	}

	return normalized
}

function normalizeReportTypes(input) {
	const source = Array.isArray(input) ? input : []
	const normalized = source
		.map((item, index) => {
			const fallbackId = index === 0 ? DEFAULT_REPORT_TYPE.id : `report-type-${index + 1}`
			const id = String(item?.id || '').trim() || fallbackId
			const templateSettings = normalizeReportTypeTemplateSettings(item)
			const config = normalizeReportTypeConfig(item?.config || item?.options, id)
			return {
				id,
				name: String(item?.name || '').trim() || 'Untitled Report Type',
				description: String(item?.description || '').trim(),
				templateId: String(item?.templateId || '').trim() || null,
				templateMode: templateSettings.templateMode,
				strictTemplatePolicy: templateSettings.strictTemplatePolicy,
				requiredPlaceholders: templateSettings.requiredPlaceholders,
				requiredAnchors: templateSettings.requiredAnchors,
				config,
				isActive: item?.isActive !== false,
			}
		})
		.filter((item) => item.id)

	if (normalized.length === 0) {
		return DEFAULT_REPORT_TYPES.map((item) => ({ ...item }))
	}

	if (!normalized.some((item) => item.id === OTF6_REPORT_TYPE.id)) {
		return [...normalized, { ...OTF6_REPORT_TYPE }]
	}

	if (!normalized.some((item) => item.id === NDIS_FCA_REPORT_TYPE.id)) {
		return [...normalized, { ...NDIS_FCA_REPORT_TYPE }]
	}

	return normalized
}

function normalizeTemplates(input) {
	const source = Array.isArray(input) ? input : []
	return source
		.map((item, index) => ({
			id: String(item?.id || '').trim() || `template-${index + 1}`,
			name: String(item?.name || '').trim() || String(item?.fileName || '').trim() || 'Template',
			fileName: String(item?.fileName || '').trim() || 'template.txt',
			mimeType: String(item?.mimeType || '').trim() || 'application/octet-stream',
			size: Number.parseInt(String(item?.size || '0'), 10) || 0,
			contentBase64: String(item?.contentBase64 || '').trim(),
			uploadedAt: String(item?.uploadedAt || '').trim() || new Date().toISOString(),
			source: String(item?.source || '').trim(),
			sourceDocId: String(item?.sourceDocId || '').trim(),
			sourceUrl: String(item?.sourceUrl || '').trim(),
		}))
		.filter((item) => item.id)
}

function normalizeConfig(input, reportTypes, existingAimlApiKey = '', providerModelsCatalog = null) {
	const source = input && typeof input === 'object' ? input : {}
	const knownTypeIds = new Set(reportTypes.map((item) => item.id))
	const requestedDefault = String(source.defaultReportTypeId || '').trim()
	const legacyGateway = String(source.aiGateway || '').trim().toLowerCase()
	const legacyVendor = String(source.aimlVendor || '').trim().toLowerCase()
	const inferredLegacyProvider = legacyGateway === 'aimlapi'
		? (legacyVendor.includes('claude') || legacyVendor.includes('anthropic')
			? 'claude'
			: legacyVendor.includes('gemini') || legacyVendor.includes('google')
				? 'gemini'
				: legacyVendor.includes('deepseek')
					? 'deepseek'
					: 'openai')
		: 'openai'
	const provider = normalizeReportAiProvider(source.aiProvider || inferredLegacyProvider)
	const tier = normalizeReportAiTier(source.aiModelTier)
	const providerModels = normalizeReportAiProviderModels(providerModelsCatalog || source.providerModels)
	const selected = resolveReportAiSelection({
		aiProvider: provider,
		aiModelTier: tier,
		providerModels,
	})

	const requestedAimlApiKey = String(source.aimlApiKey || '').trim()
	const aimlApiKey = requestedAimlApiKey === KEEP_EXISTING_API_KEY_SENTINEL
		? String(existingAimlApiKey || '').trim()
		: requestedAimlApiKey

	return {
		defaultReportTypeId: knownTypeIds.has(requestedDefault) ? requestedDefault : reportTypes[0].id,
		includeSourceNotesByDefault: source.includeSourceNotesByDefault !== false,
		autoSaveDrafts: source.autoSaveDrafts !== false,
		requireTemplateForGeneration: source.requireTemplateForGeneration === true,
		providerDetails: String(source.providerDetails || '').trim(),
		reportHeaderText: String(source.reportHeaderText || '').trim(),
		reportHeaderLogoUrl: String(source.reportHeaderLogoUrl || '').trim(),
		daysHoursAvailable: String(source.daysHoursAvailable || '').trim(),
		aiProvider: provider,
		aiModelTier: tier,
		providerModels,
		aiGateway: provider === 'openai' ? 'openai' : 'aimlapi',
		openAiModel: String(providerModels.openai?.balanced || DEFAULT_CONFIG.openAiModel).trim() || DEFAULT_CONFIG.openAiModel,
		aimlApiBaseUrl: String(source.aimlApiBaseUrl || DEFAULT_CONFIG.aimlApiBaseUrl).trim() || DEFAULT_CONFIG.aimlApiBaseUrl,
		aimlApiKey,
		aimlProvider: String(source.aimlProvider || DEFAULT_CONFIG.aimlProvider).trim().toLowerCase() || DEFAULT_CONFIG.aimlProvider,
		aimlVendor: getReportAiProviderDisplayName(selected.provider),
		aimlModel: selected.model,
	}
}

function maskApiKey(value) {
	const raw = String(value || '').trim()
	if (!raw) return ''
	if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-2)}`
	return `${raw.slice(0, 4)}***${raw.slice(-4)}`
}

function buildResponseSettings(payload, providerModelsCatalog = null) {
	const reportTypes = normalizeReportTypes(payload?.reportTypes)
	const templates = normalizeTemplates(payload?.templates)
	const config = normalizeConfig(payload?.config, reportTypes, payload?.config?.aimlApiKey, providerModelsCatalog)
	const providerKeyStatus = getReportAiProviderApiKeyAvailability()
	const selected = resolveReportAiSelection(config)

	return {
		reportTypes,
		templates,
		strictTemplatePolicies: getStrictTemplatePolicies(),
		config: {
			...config,
			aiProvider: selected.provider,
			aiModelTier: selected.tier,
			providerModels: selected.providerModels,
			selectedProviderModel: selected.model,
			hasProviderApiKeys: providerKeyStatus,
			hasProviderApiKey: providerKeyStatus[selected.provider] === true,
			hasAimlApiKey: String(config.aimlApiKey || '').trim().length > 0,
			aimlApiKeyMasked: maskApiKey(config.aimlApiKey),
			aimlApiKey: '',
		},
	}
}

export async function GET(request) {
	try {
		const adminToken = getAdminTokenFromRequest(request)
		const adminUser = await verifyAdminToken(adminToken)
		if (!adminUser) {
			return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
		}

		const { searchParams } = new URL(request.url)
		const domain = resolveScopedDomain(adminUser, searchParams.get('domain'))
		if (domain === null) {
			return NextResponse.json({ error: 'Forbidden: cannot load requested domain' }, { status: 403 })
		}
		if (!domain) {
			return NextResponse.json({ error: 'domain is required' }, { status: 400 })
		}

		const [stored, catalog] = await Promise.all([
			readReportSettingsForDomain(domain),
			readAiProviderModelCatalog(),
		])
		const settings = buildResponseSettings({
			reportTypes: stored?.settings?.reportTypes,
			templates: stored?.templates,
			config: stored?.settings?.config,
		}, catalog?.models)

		return NextResponse.json({ success: true, settings })
	} catch (error) {
		return NextResponse.json({ error: error?.message || 'Failed to load report settings' }, { status: 500 })
	}
}

export async function PATCH(request) {
	try {
		const payload = await request.json().catch(() => ({}))
		const adminToken = getAdminTokenFromRequest(request, payload)
		const adminUser = await verifyAdminToken(adminToken)
		if (!adminUser) {
			return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
		}

		const domain = resolveScopedDomain(adminUser, payload?.domain)
		if (domain === null) {
			return NextResponse.json({ error: 'Forbidden: cannot save requested domain' }, { status: 403 })
		}
		if (!domain) {
			return NextResponse.json({ error: 'domain is required' }, { status: 400 })
		}

		const incoming = payload?.settings && typeof payload.settings === 'object' ? payload.settings : null
		if (!incoming) {
			return NextResponse.json({ error: 'settings object is required' }, { status: 400 })
		}

		const [existing, catalog] = await Promise.all([
			readReportSettingsForDomain(domain),
			readAiProviderModelCatalog(),
		])
		const existingConfig = existing?.settings?.config && typeof existing.settings.config === 'object'
			? existing.settings.config
			: {}

		const reportTypes = normalizeReportTypes(incoming.reportTypes)
		const templates = normalizeTemplates(incoming.templates)
		// Report types may bind to Template Library templates. Those are derived on read
		// (and stripped before persisting), so include them when validating bindings.
		const templatesForValidation = await mergeLibraryTemplates(domain, templates)
		const bindingValidation = validateReportTypeTemplateBindings({ reportTypes, templates: templatesForValidation })
		if (!bindingValidation.valid) {
			return NextResponse.json(
				{ error: `Template validation failed: ${bindingValidation.failures.join(' ')}` },
				{ status: 400 }
			)
		}
		const config = normalizeConfig(incoming.config, reportTypes, existingConfig.aimlApiKey, catalog?.models)

		const persisted = await writeReportSettingsForDomain(domain, {
			reportTypes,
			templates,
			config,
		})

		const settings = buildResponseSettings({
			reportTypes: persisted?.settings?.reportTypes,
			templates: await mergeLibraryTemplates(domain, persisted?.templates),
			config: persisted?.settings?.config,
		}, catalog?.models)

		return NextResponse.json({ success: true, settings })
	} catch (error) {
		return NextResponse.json({ error: error?.message || 'Failed to save report settings' }, { status: 500 })
	}
}
