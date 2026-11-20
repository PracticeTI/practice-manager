'use client'

import { useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    AssistantRuntimeProvider,
    ThreadPrimitive,
    MessagePrimitive,
    ComposerPrimitive,
    useAuiState,
} from '@assistant-ui/react'
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/ai-sdk'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import { FALLBACK_ASSISTANT_WELCOME } from '@/lib/assistantConfig'

/**
 * assistant-ui runtime wired to our gated, streaming backend route. All admin
 * requests carry the bearer token in the transport headers.
 *
 * `bare` removes the outer card chrome so the chat can be embedded inside a
 * modal/app shell that supplies its own border and background.
 * `welcome` customises the empty-state copy for the active domain (falls back
 * to generic portal copy when not provided).
 * `suggestions` are clickable starter chips ({ label, prompt }) shown under the
 * welcome message that pre-fill the composer.
 * `initialPrompt` is sent as a user message as soon as the chat is mounted, or
 * whenever `initialPromptKey` changes – used when another admin surface (e.g.
 * the header search box) hands a prompt to the assistant.
 * `domainKey` selects the domain's own assistant artwork for the empty-state
 * avatar (falling back to the generic glyph when the domain ships none).
 */
export default function AssistantChat({
    bare = false,
    domainKey = '',
    welcome = '',
    suggestions = [],
    initialPrompt = '',
    initialPromptKey = 0,
} = {}) {
    const runtime = useChatRuntime({
        transport: useMemo(
            () =>
                new AssistantChatTransport({
                    api: '/api/admin/assistant',
                    headers: () => {
                        const token = typeof window !== 'undefined'
                            ? window.localStorage.getItem('adminToken')
                            : ''
                        return {
                            Authorization: token ? `Bearer ${token}` : '',
                        }
                    },
                }),
            []
        ),
    })

    // Send a prompt handed over by the host surface (e.g. the header search
    // box). Routed through the composer runtime — the same path the Send button
    // uses — so the run starts exactly as a typed message would. The key guard
    // lets a repeated prompt send again; the ref keeps each key to one send.
    const sentPromptKeyRef = useRef(null)
    useEffect(() => {
        const prompt = String(initialPrompt || '').trim()
        if (!prompt || sentPromptKeyRef.current === initialPromptKey) return
        sentPromptKeyRef.current = initialPromptKey

        try {
            const composer = runtime.thread.composer
            composer.setText(prompt)
            Promise.resolve(composer.send()).catch(() => {
                // A rejected send restores the draft, so the prompt stays in the composer.
            })
        } catch {
            // Composer not available yet – the chat still opens, just unsent.
        }
    }, [initialPrompt, initialPromptKey, runtime])

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <div className={`flex h-full flex-col overflow-hidden bg-white ${bare ? '' : 'rounded-lg border border-gray-200 shadow-sm'}`}>
                <AssistantThread domainKey={domainKey} welcome={welcome} suggestions={suggestions} />
            </div>
        </AssistantRuntimeProvider>
    )
}

function AssistantThread({ domainKey, welcome, suggestions }) {
    const isEmpty = useAuiState((s) => s.thread.messages.length === 0)
    const isRunning = useAuiState((s) => s.thread.isRunning)
    const composerEmpty = useAuiState((s) => s.composer.isEmpty)

    return (
        <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
            <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className={`mx-auto flex w-full max-w-3xl flex-col px-4 ${isEmpty ? 'h-full' : 'min-h-full'}`}>
                    {isEmpty && (
                        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                                <AssistantAvatar domainKey={domainKey} iconClassName="h-6 w-6" imageClassName="h-8 w-8" />
                            </div>
                            <h2 className="text-xl font-semibold text-gray-900">How can I help you today?</h2>
                            <p className="mt-1 max-w-md text-sm text-gray-500">
                                {welcome || FALLBACK_ASSISTANT_WELCOME}
                            </p>
                            {Array.isArray(suggestions) && suggestions.length > 0 && (
                                <div className="mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2">
                                    {suggestions.map((suggestion, index) => {
                                        const prompt = String(suggestion?.prompt || '').trim()
                                        const label = String(suggestion?.label || prompt || 'Ask').trim()
                                        if (!prompt) return null
                                        return (
                                            <button
                                                key={`${index}-${label}`}
                                                type="button"
                                                onClick={() => fillComposer(prompt)}
                                                title={prompt}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                                            >
                                                <span className="text-gray-400">+</span>
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {!isEmpty && (
                        <div className="flex flex-1 flex-col justify-end gap-4 py-4">
                            <ThreadPrimitive.Messages>
                                {() => <AssistantMessageItem />}
                            </ThreadPrimitive.Messages>
                        </div>
                    )}

                    <div className="sticky bottom-0 -mx-4 bg-white px-4 pb-4 pt-2">
                        <AssistantComposer composerEmpty={composerEmpty} isRunning={isRunning} />
                    </div>
                </div>
            </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
    )
}

function AssistantMessageItem() {
    const role = useAuiState((s) => s.message.role)

    if (role === 'user') {
        return (
            <MessagePrimitive.Root className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gray-900 px-4 py-2 text-sm leading-relaxed text-white">
                    <MessagePrimitive.Parts
                        components={{
                            Text: ({ text }) => (
                                <span className="whitespace-pre-wrap break-words">{text}</span>
                            ),
                        }}
                    />
                </div>
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-gray-200 bg-gray-50 px-4 py-2 text-sm leading-relaxed text-gray-800">
                <MessagePrimitive.Parts
                    components={{
                        Text: AssistantMarkdown,
                        Empty: AssistantThinking,
                    }}
                />
            </div>
        </MessagePrimitive.Root>
    )
}

function AssistantThinking() {
    const isRunning = useAuiState((s) => s.thread.isRunning)
    if (!isRunning) return null

    return (
        <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
        </span>
    )
}

function AssistantComposer({ composerEmpty, isRunning }) {
    return (
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition-colors focus-within:border-gray-400">
            <ComposerPrimitive.Input
                rows={1}
                autoFocus
                enterKeyHint="send"
                aria-label="Message input"
                placeholder="Message the assistant…"
                className="max-h-40 min-h-[38px] w-full flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400"
            />
            {isRunning ? (
                <ComposerPrimitive.Cancel asChild>
                    <button
                        type="button"
                        aria-label="Stop generating"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700"
                    >
                        <span className="block h-3 w-3 rounded-sm bg-white" />
                    </button>
                </ComposerPrimitive.Cancel>
            ) : (
                <ComposerPrimitive.Send asChild>
                    <button
                        type="button"
                        aria-label="Send message"
                        disabled={composerEmpty}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                        <SendIcon />
                    </button>
                </ComposerPrimitive.Send>
            )}
        </ComposerPrimitive.Root>
    )
}

function fillComposer(prompt) {
    if (typeof window === 'undefined' || !window.HTMLTextAreaElement) return
    const input = document.querySelector('textarea[aria-label="Message input"]')
    if (!input) return

    const nextValue = String(prompt || '')
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    if (valueSetter) valueSetter.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus({ preventScroll: true })
    try {
        input.setSelectionRange(nextValue.length, nextValue.length)
    } catch {
        // Older browsers may not support setSelectionRange on textareas.
    }
}

function SendIcon() {
    return (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-6 6m6-6l6 6" />
        </svg>
    )
}

const MARKDOWN_COMPONENTS = {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0 last:mb-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0 last:mb-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0 last:mb-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-medium first:mt-0 last:mb-0">{children}</h4>,
    ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">
            {children}
        </a>
    ),
    blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-gray-300 pl-3 text-gray-600">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-gray-200" />,
    pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-[13px] leading-relaxed text-gray-100">
            {children}
        </pre>
    ),
    code: ({ className, children }) => {
        const isBlock = /language-/.test(String(className || ''))
        if (isBlock) {
            return <code className={className}>{children}</code>
        }
        return <code className="rounded bg-gray-200/70 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    },
}

function AssistantMarkdown({ text }) {
    const value = String(text || '')
    if (!value.trim()) return null
    return (
        <div className="break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {value}
            </ReactMarkdown>
        </div>
    )
}
