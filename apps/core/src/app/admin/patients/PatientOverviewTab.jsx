'use client'

import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import InfoTooltip from '@/components/InfoTooltip'
import { NDIS_PRICING_REGIONS, normalizeNdisPricingRegion } from '@/lib/ndisSupportCatalogue'
import { AGENT_CARD_STYLES, DEFAULT_ANALYST_AGENT_CONFIG, DEFAULT_BILLING_AGENT_CONFIG, DEFAULT_HSR_CREATOR_WORKER_PROMPT, DEFAULT_HSR_SUMMARISER_WORKER_PROMPT, DEFAULT_REPORTING_AGENT_CONFIG, DEFAULT_SCRIBE_AGENT_CONFIG, getReportTypeLabel, REPORTING_COMPARATIVE_OPTIONS, USE_COLORED_AGENT_CARD_BACKGROUNDS } from './patientPageConfig'
import { AnalysisEvidenceDocumentsPanel } from './PatientPageParts'
import { normalizeStringArray } from './patientUtils'
import { getPrivateDomainAgentCardArtwork, hasPrivateDomainTrait } from '@/lib/domainExtension'
import { DEFAULT_DOMAIN_KEY } from '@/lib/domainMode'
export default function PatientOverviewTab({
    activeAgentSettings,
    activeAgentSettingsKey,
    activeDomain,
    agentCardOrder,
    agentGroupExplainer,
    agentGroupLabel,
    agentSavingKey,
    analysisConfig,
    analysisEvidenceError,
    analysisEvidenceFileId,
    analysisJobLoading,
    analysisJobStatus,
    billingConfig,
    billingJobLoading,
    billingJobStatus,
    comparativeDraftErrorByOption,
    comparativeDraftLoadingByOption,
    comparativeDraftsByOption,
    comparativePatientOptions,
    currentReportRow,
    draft,
    equipmentSourcing,
    equipmentSourcingLoading,
    fcaBuilderHeroCard,
    fcaBuilderHeroVisible,
    firstInactiveAgentKey,
    firstWorkerHeroKey,
    handleBuildFca,
    hasFormalReport,
    hasUnsavedChanges,
    hsrCreatorConfig,
    hsrSummariserConfig,
    hsrWriterDomainVisible,
    hsrWriterHeroCard,
    isAgentActive,
    loadComparativeDrafts,
    onChangeAgentConfig,
    onChangeOverviewDob,
    onChangeOverviewName,
    onChangeOverviewSuburb,
    onToggleAgent,
    onToggleAnalysisEvidenceFile,
    openAgentSettingsKey,
    openReportEditor,
    overviewDob,
    overviewName,
    overviewSuburb,
    patientFiles,
    patientFilesLoading,
    quoteWriterConfig,
    reportJobLoading,
    reportJobStatus,
    reportSaveImpact,
    reportingConfig,
    saving,
    scribeConfig,
    scribeJobLoading,
    scribeJobStatus,
    setActiveTab,
    setOpenAgentSettingsKey,
    setSelectedSummaryStyle,
    setSelectedSummaryTranscriptId,
    setUnavailableAgentActionKey,
    unavailableAgentActionKey,
    workerReviewItems,
    workerReviewSummary,
}) {
    return (
        <>
<div className="space-y-4">
                            <section className="rounded-md border border-gray-200 p-4">
                                <h3 className="text-sm font-semibold text-gray-900">Info</h3>
                                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start">
                                    <label className="block">
                                        <span className="flex items-baseline gap-2">
                                            <span className="text-xs font-medium text-gray-700">Name</span>
                                            <span className="text-[10px] text-gray-400">
                                                ID: {draft.id ? String(draft.id) : 'Assigned after save'}
                                            </span>
                                        </span>
                                        <input
                                            type="text"
                                            value={overviewName}
                                            onChange={(event) => onChangeOverviewName(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="Patient name"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="block text-xs font-medium text-gray-700">Suburb</span>
                                        <input
                                            type="text"
                                            value={overviewSuburb}
                                            onChange={(event) => onChangeOverviewSuburb(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="Suburb"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="block text-xs font-medium text-gray-700">Date of birth</span>
                                        <input
                                            type="date"
                                            value={overviewDob}
                                            onChange={(event) => onChangeOverviewDob(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>
                                </div>
                            </section>

                            {/* Anything the workers have made that nobody has taken on yet.
                                It sits above the worker cards because it is the answer to
                                "what needs me?" rather than "what can run?". */}
                            {workerReviewItems.length > 0 && (
                                <section className="rounded-md border border-sky-200 bg-sky-50/50 p-5" aria-label="Waiting on review">
                                    <div className="flex items-start gap-2">
                                        <AssistantAvatar
                                            domainKey={activeDomain}
                                            iconClassName="mt-0.5 h-4 w-4 flex-none text-sky-600"
                                            imageClassName="mt-0.5 h-4 w-4 flex-none"
                                        />
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-semibold text-sky-900">Waiting on review</h3>
                                            <p className="mt-0.5 text-xs text-sky-800">{workerReviewSummary.summaryText}</p>
                                        </div>
                                    </div>
                                    <ul className="mt-3 space-y-2">
                                        {workerReviewItems.map((item) => (
                                            <li
                                                key={item.key}
                                                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-100 bg-white px-3 py-2"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                                                    <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setActiveTab(item.tab)}
                                                    className="inline-flex flex-none items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                                                >
                                                    {item.actionLabel}
                                                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            <section className="rounded-md border border-gray-200 p-5">
                                <div className="flex items-center gap-2">
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                        <AssistantAvatar
                                            domainKey={activeDomain}
                                            iconClassName="h-6 w-6"
                                            imageClassName="h-6 w-6"
                                        />
                                        {agentGroupLabel}
                                    </h3>
                                    {/* The group name is jargon-free but still opaque on first
                                        sight, so it carries its own one-line explainer. It sits
                                        beside the heading rather than inside it so the heading's
                                        accessible name stays the label alone. */}
                                    <InfoTooltip
                                        text={agentGroupExplainer}
                                        label={`About ${agentGroupLabel}`}
                                    />
                                </div>
                                <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-5">
                                    {agentCardOrder.map((agent) => {
                                        if (agent.key === '__fcaBuilderHero__' || agent.key === '__hsrWriterHero__') {
                                            // Both hero cards are rendered together by the first hero
                                            // marker so they sit side by side on the same 3-column row.
                                            if (agent.key !== firstWorkerHeroKey) return null
                                            return (
                                                <Fragment key="worker-heroes">
                                                    <div className="col-span-full">
                                                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                                            {fcaBuilderHeroVisible && fcaBuilderHeroCard}
                                                            {hsrWriterDomainVisible && hsrWriterHeroCard}
                                                        </div>
                                                    </div>
                                                </Fragment>
                                            )
                                        }
                                        const available = agent.available !== false
                                        const enabled = available && isAgentActive(agent)
                                        const hsrPairSaving = (agent.key === 'hsrCreator' || agent.key === 'hsrSummariser')
                                            && (agentSavingKey === 'hsrCreator' || agentSavingKey === 'hsrSummariser')
                                        const savingCurrent = agentSavingKey === agent.key || hsrPairSaving
                                        const workerStatus = agent.key === 'reporting' || agent.key === 'hsrCreator'
                                            ? reportJobStatus
                                            : agent.key === 'equipmentSourcer'
                                                ? equipmentSourcing
                                                : agent.key === 'quoteWriter'
                                                    ? null
                                                    : agent.key === 'analyst'
                                                        ? analysisJobStatus
                                                        : agent.key === 'scribe' || agent.key === 'hsrSummariser'
                                                            ? scribeJobStatus
                                                            : billingJobStatus
                                        const workerLoading = agent.key === 'reporting' || agent.key === 'hsrCreator'
                                            ? reportJobLoading
                                            : agent.key === 'equipmentSourcer'
                                                ? equipmentSourcingLoading
                                                : agent.key === 'quoteWriter'
                                                    ? false
                                                    : agent.key === 'analyst'
                                                        ? analysisJobLoading
                                                        : agent.key === 'scribe' || agent.key === 'hsrSummariser'
                                                            ? scribeJobLoading
                                                            : billingJobLoading
                                        const settings = agent.key === 'reporting'
                                            ? reportingConfig
                                            : agent.key === 'hsrCreator'
                                                ? hsrCreatorConfig
                                                : agent.key === 'hsrSummariser'
                                                    ? hsrSummariserConfig
                                                    : agent.key === 'quoteWriter'
                                                        ? quoteWriterConfig
                                                        : agent.key === 'analyst'
                                                            ? analysisConfig
                                                            : agent.key === 'scribe'
                                                                ? scribeConfig
                                                                : billingConfig
                                        const statusOverride = (agent.key === 'reporting' || agent.key === 'hsrCreator') && hasUnsavedChanges && !saving
                                            ? String(reportSaveImpact?.statusOverride || '').trim()
                                            : ''
                                        const defaultStatusLabel = agent.key === 'reporting'
                                            ? 'Working'
                                            : agent.key === 'hsrCreator'
                                                ? 'Working'
                                                : agent.key === 'analyst'
                                                    ? 'Working'
                                                    : agent.key === 'scribe' || agent.key === 'hsrSummariser'
                                                        ? 'Working'
                                                        : 'Waiting'
                                        const resolvedStatusLabel = String(statusOverride || workerStatus?.statusLabel || defaultStatusLabel).trim()
                                        const workerStatusLabel = !available
                                            ? 'Not configured'
                                            : enabled
                                                ? (resolvedStatusLabel === 'Waiting' || resolvedStatusLabel === 'waiting'
                                                    ? (agent.key === 'reporting' ? 'Working' : 'Working')
                                                    : resolvedStatusLabel)
                                                : 'Inactive'
                                        const showOpenReportLink = (agent.key === 'reporting' || agent.key === 'hsrCreator') && hasFormalReport && workerStatusLabel === 'Ready'
                                        const showOpenAnalysisLink = agent.key === 'analyst' && workerStatusLabel === 'Ready'
                                        const showOpenEquipmentLink = agent.key === 'equipmentSourcer' && workerStatusLabel === 'Ready'
                                        const showOpenQuoteLink = agent.key === 'quoteWriter' && enabled
                                        const showOpenSummaryLink = (agent.key === 'scribe' || agent.key === 'hsrSummariser') && workerStatusLabel === 'Ready'
                                        const isGeneralHelperStyle = (agent.style || 'general') === 'general'
                                        const styleKey = (activeDomain === DEFAULT_DOMAIN_KEY || hasPrivateDomainTrait(activeDomain, 'platformAgentCardStyle')) && isGeneralHelperStyle
                                            ? 'platformGeneral'
                                            : hasPrivateDomainTrait(activeDomain, 'generalAgentHelperStyle') && isGeneralHelperStyle
                                                ? 'seGeneral'
                                                : (agent.style || 'general')
                                        const cardStyle = AGENT_CARD_STYLES[styleKey]
                                        const helperCardStyle = cardStyle?.helper === true
                                        const cardArtwork = cardStyle?.domainArtwork === true
                                            ? getPrivateDomainAgentCardArtwork(activeDomain)
                                            : ''
                                        const workerStatusClass = workerStatusLabel === 'Ready'
                                            ? (cardStyle?.status.accent || 'bg-green-100 text-green-700')
                                            : workerStatusLabel === 'Creating'
                                                ? (cardStyle?.status.active || 'bg-blue-100 text-blue-700')
                                                : workerStatusLabel === 'Updating'
                                                    ? (cardStyle?.status.active || 'bg-cyan-100 text-cyan-700')
                                                    : workerStatusLabel === 'Update Pending'
                                                        ? (cardStyle?.status.accent || 'bg-amber-100 text-amber-800')
                                                        : workerStatusLabel === 'Working'
                                                            ? (cardStyle?.status.active || 'bg-blue-100 text-blue-700')
                                                            : workerStatusLabel === 'Failed'
                                                                ? (cardStyle?.status.failed || 'bg-red-100 text-red-700')
                                                                : workerStatusLabel === 'Inactive'
                                                                    ? 'bg-gray-100 text-gray-700'
                                                                    : (cardStyle?.status.accent || 'bg-amber-100 text-amber-700')

                                        // The Open… links are shared by the inline row and the helper
                                        // card's bottom row, so they are built once here.
                                        const hasAgentCardLinks = showOpenReportLink || showOpenAnalysisLink || showOpenEquipmentLink || showOpenQuoteLink || showOpenSummaryLink
                                        const agentCardLinks = (
                                            <>
                                                {showOpenReportLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (agent.key === 'hsrCreator') {
                                                                openReportEditor(currentReportRow)
                                                                return
                                                            }
                                                            setActiveTab('report')
                                                        }}
                                                        className={`text-xs font-medium ${cardStyle?.actionLink || 'text-blue-700 underline-offset-2 hover:underline'}`}
                                                    >
                                                        {agent.key === 'hsrCreator' ? 'Open report' : 'Open reports'}
                                                    </button>
                                                )}
                                                {showOpenAnalysisLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('analysis')}
                                                        className={`text-xs font-semibold ${cardStyle?.actionLink || 'text-blue-700 underline-offset-2 hover:underline'}`}
                                                    >
                                                        Open analysis
                                                    </button>
                                                )}
                                                {showOpenEquipmentLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('equipment')}
                                                        className={`text-xs font-semibold ${cardStyle?.actionLink || 'text-blue-700 underline-offset-2 hover:underline'}`}
                                                    >
                                                        Open equipment
                                                    </button>
                                                )}
                                                {showOpenQuoteLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('quotes')}
                                                        className={`text-xs font-semibold ${cardStyle?.actionLink || 'text-blue-700 underline-offset-2 hover:underline'}`}
                                                    >
                                                        Open quotes
                                                    </button>
                                                )}
                                                {showOpenSummaryLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            // Only the HSR Summariser card names its own style; every other
                                                            // card opens the patient's primary summary view (the FCA summary
                                                            // when they have one, otherwise the generic style). Summaries
                                                            // renders inside the Transcripts pane, so open that pane.
                                                            setSelectedSummaryStyle(agent.key === 'hsrSummariser' ? 'otf10-home-services' : '')
                                                            setSelectedSummaryTranscriptId(null)
                                                            setActiveTab('transcripts')
                                                        }}
                                                        className={`text-xs font-medium ${cardStyle?.actionLink || 'text-blue-700 underline-offset-2 hover:underline'}`}
                                                    >
                                                        Open summary
                                                    </button>
                                                )}
                                            </>
                                        )
                                        return (
                                            <Fragment key={agent.key}>
                                                {agent.key === firstInactiveAgentKey && (
                                                    <h4 className="col-span-full border-t border-gray-200 pt-5 text-xs font-semibold uppercase text-gray-500">
                                                        Inactive
                                                    </h4>
                                                )}
                                                <div
                                                    className={`relative flex ${helperCardStyle ? 'aspect-[3/2] self-start' : 'h-full'} flex-col overflow-hidden rounded-lg border px-4 py-3 drop-shadow-[0_8px_10px_rgba(15,23,42,0.14)] transition ${cardStyle?.card || 'border-gray-200'} ${USE_COLORED_AGENT_CARD_BACKGROUNDS ? (cardStyle?.background || 'bg-white') : 'bg-white'}`}
                                                    style={cardArtwork ? { backgroundImage: `url(${cardArtwork})` } : undefined}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className={`text-sm font-semibold ${cardStyle?.title || 'text-gray-900'}`}>{agent.label}</span>
                                                        {agent.buildAction ? (
                                                            <span
                                                                role={!enabled ? 'button' : undefined}
                                                                tabIndex={!enabled ? 0 : undefined}
                                                                title={!enabled ? 'FCA Builder is available when the patient Funder is NDIS.' : undefined}
                                                                onClick={() => {
                                                                    if (!enabled) setUnavailableAgentActionKey(agent.key)
                                                                }}
                                                                onKeyDown={(event) => {
                                                                    if (!enabled && (event.key === 'Enter' || event.key === ' ')) {
                                                                        event.preventDefault()
                                                                        setUnavailableAgentActionKey(agent.key)
                                                                    }
                                                                }}
                                                                className={!enabled ? 'cursor-not-allowed' : undefined}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={handleBuildFca}
                                                                    disabled={!available || !enabled}
                                                                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${cardStyle?.settingsButton || 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
                                                                >
                                                                    Build
                                                                </button>
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                role="switch"
                                                                aria-checked={enabled}
                                                                onClick={() => onToggleAgent(agent.key, !enabled)}
                                                                disabled={!available || savingCurrent}
                                                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${enabled ? 'bg-emerald-600' : 'bg-gray-300'} ${savingCurrent ? 'cursor-not-allowed opacity-70' : ''}`}
                                                            >
                                                                <span
                                                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${enabled ? 'translate-x-5' : 'translate-x-1'}`}
                                                                />
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${cardStyle?.details || 'text-gray-600'}`}>
                                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${workerStatusClass}`}>
                                                            {workerLoading ? 'Updating...' : workerStatusLabel}
                                                        </span>
                                                        {!helperCardStyle && agentCardLinks}
                                                        {!helperCardStyle && (
                                                            <span>
                                                                {agent.summary || (agent.key === 'reporting'
                                                                    ? `${getReportTypeLabel(settings.outputStyle || DEFAULT_REPORTING_AGENT_CONFIG.outputStyle)} · ${(settings.detailLevel || DEFAULT_REPORTING_AGENT_CONFIG.detailLevel)} · ${Array.isArray(settings.focusAreas) ? settings.focusAreas.length : 0} focus area(s)`
                                                                    : agent.key === 'hsrCreator'
                                                                        ? `TAC Home Services Review · ${settings.includeTranscripts !== false ? 'transcripts included' : 'notes only'}`
                                                                        : agent.key === 'hsrSummariser'
                                                                            ? `otf10-home-services · ${settings.includeActionItems !== false ? 'action items on' : 'action items off'}`
                                                                            : agent.key === 'analyst'
                                                                                ? `${settings.focus || DEFAULT_ANALYST_AGENT_CONFIG.focus} · ${settings.includeTranscripts !== false ? 'transcripts included' : 'notes only'} · ${Number(settings.minRecommendedInterventions || DEFAULT_ANALYST_AGENT_CONFIG.minRecommendedInterventions)}-${Number(settings.maxRecommendedInterventions || DEFAULT_ANALYST_AGENT_CONFIG.maxRecommendedInterventions)} recommendations`
                                                                                : agent.key === 'scribe'
                                                                                    ? `${settings.summaryStyle || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle} · ${settings.includeActionItems !== false ? 'action items on' : 'action items off'} · 5 minute delay`
                                                                                    : agent.key === 'quoteWriter'
                                                                                        ? `NDIS ${NDIS_PRICING_REGIONS.find((region) => region.value === normalizeNdisPricingRegion(settings.pricingRegion))?.label || 'National'} price limits · ${settings.includeTranscripts !== false ? 'transcripts included' : 'notes only'}`
                                                                                        : `${settings.invoiceScope || DEFAULT_BILLING_AGENT_CONFIG.invoiceScope} · ${Number(settings.lookbackDays || DEFAULT_BILLING_AGENT_CONFIG.lookbackDays)} days · ${(settings.rounding || DEFAULT_BILLING_AGENT_CONFIG.rounding)}`)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {agent.description && !helperCardStyle && (
                                                        <p className={`mt-3 text-sm ${cardStyle?.description || 'text-gray-700'}`}>{agent.description}</p>
                                                    )}
                                                    {agent.buildAction && unavailableAgentActionKey === agent.key && !enabled && (
                                                        <p className="mt-2 text-xs font-medium text-red-700" role="status">
                                                            FCA Builder is available when the patient Funder is NDIS.
                                                        </p>
                                                    )}

                                                    {/* The status chip stays under the title; on a helper card the
                                                        report/summary links move to their own row pinned to the bottom
                                                        edge, centred on the card so they read as the card's action. */}
                                                    {helperCardStyle && hasAgentCardLinks && (
                                                        <div className={`mt-auto flex flex-wrap items-center justify-center gap-2 text-xs ${cardStyle?.details || 'text-gray-600'}`}>
                                                            {agentCardLinks}
                                                        </div>
                                                    )}

                                                    {/* Helper cards fix their height to the 3:2 artwork frame, so the
                                                        settings control is pinned to the corner instead of trailing the
                                                        text: an in-flow row is clipped by `overflow-hidden` as soon as
                                                        the title wraps and the card runs out of height. */}
                                                    <div className={helperCardStyle ? 'contents' : 'mt-auto flex items-end justify-between gap-3 pt-3'}>
                                                        {cardStyle?.badge && !cardStyle?.hideBadge && (
                                                            <span className={`inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase ${cardStyle.badgeClass}`}>
                                                                {cardStyle.badge}
                                                            </span>
                                                        )}
                                                        {available && agent.configurable !== false && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setOpenAgentSettingsKey(agent.key)}
                                                                aria-expanded={openAgentSettingsKey === agent.key}
                                                                aria-label="Settings"
                                                                title="Settings"
                                                                className={`inline-flex items-center rounded-md border text-xs font-medium ${helperCardStyle
                                                                    ? 'absolute bottom-1.5 right-1.5 border-gray-500 bg-white p-1 text-gray-900 hover:bg-gray-100'
                                                                    : `ml-auto gap-1.5 px-3 py-1.5 ${cardStyle?.settingsButton || 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}`}
                                                            >
                                                                {helperCardStyle ? (
                                                                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                                                                        <path
                                                                            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
                                                                            stroke="currentColor"
                                                                            strokeWidth="1.5"
                                                                            strokeLinecap="round"
                                                                            strokeLinejoin="round"
                                                                        />
                                                                        <path
                                                                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                                            stroke="currentColor"
                                                                            strokeWidth="1.5"
                                                                            strokeLinecap="round"
                                                                            strokeLinejoin="round"
                                                                        />
                                                                    </svg>
                                                                ) : (
                                                                    'Settings'
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </Fragment>
                                        )
                                    })}
                                </div>

                                {activeAgentSettingsKey && (
                                    <div
                                        className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                        role="dialog"
                                        aria-modal="true"
                                        aria-label={`${activeAgentSettingsKey === 'reporting' ? 'Reporting' : activeAgentSettingsKey === 'hsrCreator' ? 'HSR Writer' : activeAgentSettingsKey === 'hsrSummariser' ? 'HSR Summariser' : activeAgentSettingsKey === 'analyst' ? 'FCA Analyst' : activeAgentSettingsKey === 'scribe' ? 'Transcript Summariser' : activeAgentSettingsKey === 'quoteWriter' ? 'Quote Writer' : 'Billing'} settings`}
                                        onClick={() => setOpenAgentSettingsKey('')}
                                    >
                                        <div
                                            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                                <span className="text-sm font-semibold text-gray-900">{activeAgentSettingsKey === 'reporting' ? 'Reporting' : activeAgentSettingsKey === 'hsrCreator' ? 'HSR Writer' : activeAgentSettingsKey === 'hsrSummariser' ? 'HSR Summariser' : activeAgentSettingsKey === 'analyst' ? 'FCA Analyst' : activeAgentSettingsKey === 'scribe' ? 'Transcript Summariser' : activeAgentSettingsKey === 'quoteWriter' ? 'Quote Writer' : 'Billing'} settings</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setOpenAgentSettingsKey('')}
                                                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                                >
                                                    Close
                                                </button>
                                            </div>

                                            <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
                                                {activeAgentSettingsKey === 'reporting' && reportSaveImpact?.text && (
                                                    <p className={`rounded-md border px-2.5 py-2 text-xs ${reportSaveImpact.tone === 'info' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                                                        {reportSaveImpact.text}
                                                    </p>
                                                )}

                                                {activeAgentSettingsKey === 'reporting' && (
                                                    <>
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Report type</span>
                                                            <select
                                                                value={activeAgentSettings.outputStyle || DEFAULT_REPORTING_AGENT_CONFIG.outputStyle}
                                                                onChange={(event) => onChangeAgentConfig('reporting', 'outputStyle', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                <option value="functional-capacity-assessment">Functional Capacity Assessment (FCA)</option>
                                                                <option value="assistive-technology-assessment">Assistive Technology Assessment (AT)</option>
                                                                <option value="home-modification-assessment">Home Modification Assessment</option>
                                                            </select>
                                                        </label>

                                                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                            <fieldset>
                                                                <legend className="text-xs font-medium text-gray-700">Detail level</legend>
                                                                <div className="mt-1 flex flex-wrap gap-3">
                                                                    {[
                                                                        { value: 'brief', label: 'Brief' },
                                                                        { value: 'standard', label: 'Standard' },
                                                                        { value: 'comprehensive', label: 'Comprehensive' },
                                                                    ].map((option) => (
                                                                        <label key={option.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                                            <input
                                                                                type="radio"
                                                                                name="reporting-detail-level"
                                                                                value={option.value}
                                                                                checked={(activeAgentSettings.detailLevel || DEFAULT_REPORTING_AGENT_CONFIG.detailLevel) === option.value}
                                                                                onChange={(event) => onChangeAgentConfig('reporting', 'detailLevel', event.target.value)}
                                                                                className="h-4 w-4 border-gray-300 text-gray-900"
                                                                            />
                                                                            {option.label}
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            </fieldset>

                                                            <div className="space-y-2">
                                                                <span className="text-xs font-medium text-gray-700">Include focus areas</span>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    {[
                                                                        { value: 'functional-capacity', label: 'Functional capacity' },
                                                                        { value: 'home-safety', label: 'Home safety' },
                                                                        { value: 'goals-progress', label: 'Goals progress' },
                                                                        { value: 'recommendations', label: 'Recommendations' },
                                                                    ].map((option) => {
                                                                        const selected = Array.isArray(activeAgentSettings.focusAreas) && activeAgentSettings.focusAreas.includes(option.value)
                                                                        const nextFocusAreas = selected
                                                                            ? activeAgentSettings.focusAreas.filter((item) => item !== option.value)
                                                                            : [...normalizeStringArray(activeAgentSettings.focusAreas), option.value]
                                                                        return (
                                                                            <label key={option.value} className="inline-flex items-start gap-2 text-sm leading-5 text-gray-700">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={selected}
                                                                                    onChange={() => onChangeAgentConfig('reporting', 'focusAreas', nextFocusAreas)}
                                                                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-gray-900"
                                                                                />
                                                                                {option.label}
                                                                            </label>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                            <label className="inline-flex items-start gap-2 text-sm leading-5 text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={activeAgentSettings.includeRecommendations !== false}
                                                                    onChange={(event) => onChangeAgentConfig('reporting', 'includeRecommendations', event.target.checked)}
                                                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-gray-900"
                                                                />
                                                                Recommendation summary
                                                            </label>

                                                            <label className="inline-flex items-start gap-2 text-sm leading-5 text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={activeAgentSettings.includeTranscriptSnippets !== false}
                                                                    onChange={(event) => onChangeAgentConfig('reporting', 'includeTranscriptSnippets', event.target.checked)}
                                                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-gray-900"
                                                                />
                                                                Transcript snippets
                                                            </label>
                                                        </div>

                                                        <section className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
                                                            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Comparative patient references</h4>
                                                            <p className="mt-1 text-xs text-gray-600">
                                                                Choose a comparative patient and the exact draft version to reference for each area below.
                                                            </p>

                                                            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                                                                {REPORTING_COMPARATIVE_OPTIONS.map((option) => {
                                                                    const selectedPatientId = String(activeAgentSettings?.[option.patientConfigKey] || '').trim()
                                                                    const selectedDraftId = String(activeAgentSettings?.[option.draftConfigKey] || '').trim()
                                                                    const rows = Array.isArray(comparativeDraftsByOption[option.key]) ? comparativeDraftsByOption[option.key] : []
                                                                    const loadingRows = comparativeDraftLoadingByOption[option.key] === true
                                                                    const loadingError = String(comparativeDraftErrorByOption[option.key] || '').trim()
                                                                    const hasSelectedDraft = rows.some((row) => String(row.id || '') === selectedDraftId)
                                                                    const resolvedDraftValue = hasSelectedDraft ? selectedDraftId : ''

                                                                    return (
                                                                        <div key={option.key} className="rounded-md border border-gray-200 bg-white p-3">
                                                                            <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                                                                            <p className="mt-1 text-xs text-gray-600">{option.description}</p>

                                                                            <label className="mt-3 block">
                                                                                <span className="text-xs font-medium text-gray-700">Comparative patient</span>
                                                                                <select
                                                                                    value={selectedPatientId}
                                                                                    onChange={(event) => {
                                                                                        const nextPatientId = String(event.target.value || '').trim()
                                                                                        onChangeAgentConfig('reporting', option.patientConfigKey, nextPatientId)
                                                                                        onChangeAgentConfig('reporting', option.draftConfigKey, '')
                                                                                        loadComparativeDrafts(option, nextPatientId)
                                                                                    }}
                                                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                                >
                                                                                    <option value="">None</option>
                                                                                    {comparativePatientOptions.map((patientOption) => (
                                                                                        <option key={patientOption.id} value={patientOption.id}>{patientOption.name}</option>
                                                                                    ))}
                                                                                </select>
                                                                            </label>

                                                                            <label className="mt-3 block">
                                                                                <span className="text-xs font-medium text-gray-700">Comparative draft version</span>
                                                                                <select
                                                                                    value={resolvedDraftValue}
                                                                                    onChange={(event) => onChangeAgentConfig('reporting', option.draftConfigKey, String(event.target.value || '').trim())}
                                                                                    disabled={!selectedPatientId || loadingRows || rows.length === 0}
                                                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
                                                                                >
                                                                                    {!selectedPatientId && <option value="">Select patient first</option>}
                                                                                    {selectedPatientId && loadingRows && <option value="">Loading versions...</option>}
                                                                                    {selectedPatientId && !loadingRows && rows.length === 0 && <option value="">No drafts available</option>}
                                                                                    {selectedPatientId && !loadingRows && rows.map((row) => (
                                                                                        <option key={row.rowKey || row.versionKey || row.id} value={row.id}>
                                                                                            Draft #{row.id}{row.timestampLabel ? ` - ${row.timestampLabel}` : ''}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                            </label>

                                                                            {loadingError && (
                                                                                <p className="mt-2 text-xs text-red-700">{loadingError}</p>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </section>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra instructions</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('reporting', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional guidance for drafting tone, emphasis, or style"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'billing' && (
                                                    <>
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Invoice scope</span>
                                                            <select
                                                                value={activeAgentSettings.invoiceScope || DEFAULT_BILLING_AGENT_CONFIG.invoiceScope}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'invoiceScope', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                <option value="recent-consultations">Recent consultations</option>
                                                                <option value="unbilled-only">Only unbilled consultations</option>
                                                                <option value="all-open-items">All open items</option>
                                                            </select>
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Lookback window (days)</span>
                                                            <input
                                                                type="range"
                                                                min={7}
                                                                max={180}
                                                                step={1}
                                                                value={Number(activeAgentSettings.lookbackDays || DEFAULT_BILLING_AGENT_CONFIG.lookbackDays)}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'lookbackDays', Number.parseInt(event.target.value, 10))}
                                                                className="mt-2 w-full"
                                                            />
                                                            <p className="mt-1 text-xs text-gray-600">{Number(activeAgentSettings.lookbackDays || DEFAULT_BILLING_AGENT_CONFIG.lookbackDays)} days</p>
                                                        </label>

                                                        <fieldset>
                                                            <legend className="text-xs font-medium text-gray-700">Rounding</legend>
                                                            <div className="mt-1 flex flex-wrap gap-3">
                                                                {[
                                                                    { value: 'nearest-cent', label: 'Nearest cent' },
                                                                    { value: 'nearest-dollar', label: 'Nearest dollar' },
                                                                    { value: 'none', label: 'No rounding' },
                                                                ].map((option) => (
                                                                    <label key={option.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                                        <input
                                                                            type="radio"
                                                                            name="billing-rounding"
                                                                            value={option.value}
                                                                            checked={(activeAgentSettings.rounding || DEFAULT_BILLING_AGENT_CONFIG.rounding) === option.value}
                                                                            onChange={(event) => onChangeAgentConfig('billing', 'rounding', event.target.value)}
                                                                            className="h-4 w-4 border-gray-300 text-gray-900"
                                                                        />
                                                                        {option.label}
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </fieldset>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeTravel !== false}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'includeTravel', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include travel line items
                                                        </label>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeConsumables === true}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'includeConsumables', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include consumables
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Tax mode</span>
                                                            <select
                                                                value={activeAgentSettings.taxMode || DEFAULT_BILLING_AGENT_CONFIG.taxMode}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'taxMode', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                <option value="standard">Standard GST rules</option>
                                                                <option value="tax-exempt">Tax exempt</option>
                                                                <option value="mixed">Mixed tax treatment</option>
                                                            </select>
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra billing context</span>
                                                            <textarea
                                                                value={activeAgentSettings.extraContext || ''}
                                                                onChange={(event) => onChangeAgentConfig('billing', 'extraContext', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional context like contractual rates or preferred wording"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'analyst' && (
                                                    <>
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Analysis focus</span>
                                                            <select
                                                                value={activeAgentSettings.focus || DEFAULT_ANALYST_AGENT_CONFIG.focus}
                                                                onChange={(event) => onChangeAgentConfig('analyst', 'focus', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                <option value="fca-report-builder">FCA report builder suggestions</option>
                                                            </select>
                                                        </label>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeTranscripts !== false}
                                                                onChange={(event) => onChangeAgentConfig('analyst', 'includeTranscripts', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include transcripts in analysis
                                                        </label>

                                                        <AnalysisEvidenceDocumentsPanel
                                                            files={patientFiles}
                                                            loading={patientFilesLoading}
                                                            busyId={analysisEvidenceFileId}
                                                            error={analysisEvidenceError}
                                                            onToggle={onToggleAnalysisEvidenceFile}
                                                        />

                                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                            <label className="block">
                                                                <span className="text-xs font-medium text-gray-700">Minimum recommended interventions</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max="50"
                                                                    value={activeAgentSettings.minRecommendedInterventions ?? DEFAULT_ANALYST_AGENT_CONFIG.minRecommendedInterventions}
                                                                    onChange={(event) => {
                                                                        const nextMin = Number.parseInt(event.target.value, 10)
                                                                        const normalizedMin = Number.isFinite(nextMin)
                                                                            ? Math.max(0, Math.min(50, nextMin))
                                                                            : DEFAULT_ANALYST_AGENT_CONFIG.minRecommendedInterventions
                                                                        const currentMax = Number(activeAgentSettings.maxRecommendedInterventions || DEFAULT_ANALYST_AGENT_CONFIG.maxRecommendedInterventions)
                                                                        onChangeAgentConfig('analyst', 'minRecommendedInterventions', normalizedMin)
                                                                        if (normalizedMin > currentMax) {
                                                                            onChangeAgentConfig('analyst', 'maxRecommendedInterventions', normalizedMin)
                                                                        }
                                                                    }}
                                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                />
                                                            </label>

                                                            <label className="block">
                                                                <span className="text-xs font-medium text-gray-700">Maximum recommended interventions</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max="50"
                                                                    value={activeAgentSettings.maxRecommendedInterventions || DEFAULT_ANALYST_AGENT_CONFIG.maxRecommendedInterventions}
                                                                    onChange={(event) => {
                                                                        const nextMax = Number.parseInt(event.target.value, 10)
                                                                        const currentMin = Number(activeAgentSettings.minRecommendedInterventions ?? DEFAULT_ANALYST_AGENT_CONFIG.minRecommendedInterventions)
                                                                        const normalizedMax = Number.isFinite(nextMax)
                                                                            ? Math.max(currentMin, Math.min(50, nextMax))
                                                                            : DEFAULT_ANALYST_AGENT_CONFIG.maxRecommendedInterventions
                                                                        onChangeAgentConfig('analyst', 'maxRecommendedInterventions', normalizedMax)
                                                                    }}
                                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                />
                                                            </label>
                                                        </div>
                                                        <p className="text-xs text-gray-500">
                                                            Defaults to 0-50: the analyst is not forced to invent a minimum, and is not
                                                            capped below what the evidence actually supports.
                                                        </p>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Worker prompt</span>
                                                            <textarea
                                                                value={activeAgentSettings.workerPrompt || ''}
                                                                onChange={(event) => onChangeAgentConfig('analyst', 'workerPrompt', event.target.value)}
                                                                className="mt-1 min-h-[120px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                                                placeholder="Optional prompt for the FCA Analyst worker to follow when reviewing notes and transcripts"
                                                            />
                                                            <p className="mt-2 text-[11px] text-gray-500">Default guidance now focuses on a bounded recommendedInterventions array with intervention + justification entries only, plus FCA wording guardrails.</p>
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra FCA Analyst context</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('analyst', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional guidance for what the FCA Analyst should pay attention to"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'hsrCreator' && (
                                                    <>
                                                        <p className="text-xs text-gray-600">Generates a TAC Home Services Review draft from patient notes and transcript summaries.</p>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeTranscripts !== false}
                                                                onChange={(event) => onChangeAgentConfig('hsrCreator', 'includeTranscripts', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include transcript summaries as evidence
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Worker prompt</span>
                                                            <textarea
                                                                value={activeAgentSettings.workerPrompt || DEFAULT_HSR_CREATOR_WORKER_PROMPT}
                                                                onChange={(event) => onChangeAgentConfig('hsrCreator', 'workerPrompt', event.target.value)}
                                                                className="mt-1 min-h-[120px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                                                placeholder="Optional prompt for the HSR Writer worker to follow when drafting the Home Services Review"
                                                            />
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra HSR context</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('hsrCreator', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional guidance for what the HSR Writer should pay attention to"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'hsrSummariser' && (
                                                    <>
                                                        <p className="text-xs text-gray-600">Generates transcript summaries using the fixed <span className="font-mono">otf10-home-services</span> style.</p>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeActionItems !== false}
                                                                onChange={(event) => onChangeAgentConfig('hsrSummariser', 'includeActionItems', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include agreed follow-up actions
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Worker prompt</span>
                                                            <textarea
                                                                value={activeAgentSettings.workerPrompt || DEFAULT_HSR_SUMMARISER_WORKER_PROMPT}
                                                                onChange={(event) => onChangeAgentConfig('hsrSummariser', 'workerPrompt', event.target.value)}
                                                                className="mt-1 min-h-[160px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                                            />
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra HSR summary context</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('hsrSummariser', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional additional guidance for OTF10 transcript summaries"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'scribe' && (
                                                    <>
                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Summary style</span>
                                                            <select
                                                                value={activeAgentSettings.summaryStyle || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle}
                                                                onChange={(event) => onChangeAgentConfig('scribe', 'summaryStyle', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                <option value="topic-bullets-third-person">Third-person topic bullets</option>
                                                                <option value="clinical-brief">Clinical brief</option>
                                                                <option value="detailed">Detailed</option>
                                                            </select>
                                                        </label>

                                                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={activeAgentSettings.includeActionItems !== false}
                                                                onChange={(event) => onChangeAgentConfig('scribe', 'includeActionItems', event.target.checked)}
                                                                className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                            />
                                                            Include action items
                                                        </label>

                                                        <p className="text-xs text-gray-600">Activation delay: 5 minutes after transcript completion.</p>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra Transcript Summariser context</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('scribe', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional guidance for transcript summarization"
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {activeAgentSettingsKey === 'quoteWriter' && (
                                                    <>
                                                        <p className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-700">
                                                            The Quote Writer reads this patient’s notes, transcript summaries, latest report, equipment
                                                            recommendations and intake answers, then drafts a <strong>draft</strong> quote with priced lines.
                                                            Every line is matched against the NDIS support catalogue and priced at the published limit for
                                                            the region below. It only ever overwrites its own draft, and never a quote you have sent,
                                                            accepted or declined.
                                                        </p>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">NDIS pricing region</span>
                                                            <select
                                                                value={normalizeNdisPricingRegion(activeAgentSettings.pricingRegion)}
                                                                onChange={(event) => onChangeAgentConfig('quoteWriter', 'pricingRegion', event.target.value)}
                                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                            >
                                                                {NDIS_PRICING_REGIONS.map((region) => (
                                                                    <option key={region.value} value={region.value}>{region.label}</option>
                                                                ))}
                                                            </select>
                                                            <span className="mt-1 block text-[11px] text-gray-400">
                                                                {NDIS_PRICING_REGIONS.find((region) => region.value === normalizeNdisPricingRegion(activeAgentSettings.pricingRegion))?.description}
                                                            </span>
                                                        </label>

                                                        <div className="flex flex-wrap gap-4">
                                                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={activeAgentSettings.includeReports !== false}
                                                                    onChange={(event) => onChangeAgentConfig('quoteWriter', 'includeReports', event.target.checked)}
                                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                                />
                                                                Include the latest report
                                                            </label>
                                                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={activeAgentSettings.includeTranscripts !== false}
                                                                    onChange={(event) => onChangeAgentConfig('quoteWriter', 'includeTranscripts', event.target.checked)}
                                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                                />
                                                                Include transcript summaries
                                                            </label>
                                                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={activeAgentSettings.includeEquipment !== false}
                                                                    onChange={(event) => onChangeAgentConfig('quoteWriter', 'includeEquipment', event.target.checked)}
                                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900"
                                                                />
                                                                Include equipment recommendations
                                                            </label>
                                                        </div>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Extra quote context</span>
                                                            <textarea
                                                                value={activeAgentSettings.additionalInstructions || ''}
                                                                onChange={(event) => onChangeAgentConfig('quoteWriter', 'additionalInstructions', event.target.value)}
                                                                className="mt-1 min-h-[84px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="Optional guidance for this patient's quote (for example which supports to quote and which to bill hourly)"
                                                            />
                                                        </label>

                                                        <label className="block">
                                                            <span className="text-xs font-medium text-gray-700">Worker prompt</span>
                                                            <textarea
                                                                value={activeAgentSettings.workerPrompt || ''}
                                                                onChange={(event) => onChangeAgentConfig('quoteWriter', 'workerPrompt', event.target.value)}
                                                                className="mt-1 min-h-[140px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                                                placeholder="Leave blank to use the built-in NDIS quote-writing prompt"
                                                            />
                                                        </label>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>
        </>
    )
}
