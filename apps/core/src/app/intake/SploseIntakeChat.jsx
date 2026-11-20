'use client'

// The original intake experience: a chat assistant over the practice's Splose
// embedded form. Kept as one of the two intake options rather than replaced, so a
// practice that already runs it keeps exactly the behaviour it had.

import { useState, useEffect, useRef } from 'react'

function createSessionId() {
  if (typeof globalThis !== 'undefined') {
    const webCrypto = globalThis.crypto
    if (webCrypto?.randomUUID) {
      return webCrypto.randomUUID()
    }
    if (webCrypto?.getRandomValues) {
      const bytes = new Uint8Array(16)
      webCrypto.getRandomValues(bytes)
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    }
  }

  return `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export default function SploseIntakeChat() {
  const openingAssistantMessage = "Hi, I’m Kate’s virtual assistant and I can fill out the intake form for you. Would you like to get started"
  const [activeTab, setActiveTab] = useState('assistant')
  const [schema, setSchema] = useState(null)
  const [schemaError, setSchemaError] = useState(null)
  const [messages, setMessages] = useState([])
  const [answers, setAnswers] = useState({})
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [saved, setSaved] = useState(null)
  const sessionIdRef = useRef(null)
  const bottomRef = useRef(null)
  const inFlightTurnKeyRef = useRef(null)

  if (!sessionIdRef.current) {
    sessionIdRef.current = createSessionId()
  }

  // Load schema and kick off the first question
  useEffect(() => {
    fetch('/api/intake/schema')
      .then(r => r.json())
      .then(s => {
        if (s.error) { setSchemaError(s.error); return }
        setSchema(s)
        setMessages([{ role: 'assistant', content: openingAssistantMessage, options: ["Sure!", "I\u2019d rather fill out the form myself"] }])
      })
      .catch(err => setSchemaError(err.message))
  }, []) // intentionally empty — only runs once on mount

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendToAgent(currentMessages, currentAnswers, currentSchema, userText) {
    const turnKey = JSON.stringify({ userText, answers: currentAnswers })
    if (inFlightTurnKeyRef.current === turnKey) return

    inFlightTurnKeyRef.current = turnKey
    const newMessages = [...currentMessages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('/api/intake/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          answers: currentAnswers,
          schema: currentSchema,
        }),
      })
      const data = await res.json()

      const updatedAnswers = { ...currentAnswers }
      if (data.fieldId && data.fieldValue !== null) {
        updatedAnswers[data.fieldId] = data.fieldValue
      }

      const withReply = [...newMessages, { role: 'assistant', content: data.reply, options: data.options ?? [] }]
      setMessages(withReply)
      setAnswers(updatedAnswers)
      if (data.isComplete) setIsComplete(true)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      if (inFlightTurnKeyRef.current === turnKey) {
        inFlightTurnKeyRef.current = null
      }
      setLoading(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading || !schema) return
    setInput('')
    await sendToAgent(messages, answers, schema, text)
  }

  async function handleQuickReply(choice) {
    if (loading || !schema) return
    if (choice === "I’d rather fill out the form myself") {
      setActiveTab('form')
    }
    await sendToAgent(messages, answers, schema, choice)
  }

  function updateAnswer(fieldId, value) {
    setAnswers(prev => ({
      ...prev,
      [fieldId]: value,
    }))
  }

  function renderFieldInput(field) {
    const value = answers[field.id] ?? ''
    const isDropdown = Array.isArray(field.options) && field.options.length > 0
    const type = String(field.type || '').toLowerCase()

    if (isDropdown) {
      return (
        <select
          value={value}
          onChange={e => updateAnswer(field.id, e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
        >
          <option value="">Select an option</option>
          {field.options.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )
    }

    if (type === 'multiline' || type === 'textarea' || type === 'longtext') {
      return (
        <textarea
          value={value}
          onChange={e => updateAnswer(field.id, e.target.value)}
          rows={4}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          placeholder={field.label}
        />
      )
    }

    let inputType = 'text'
    if (type.includes('date')) inputType = 'date'
    else if (type.includes('email')) inputType = 'email'
    else if (type.includes('phone')) inputType = 'tel'
    else if (type.includes('number') || type.includes('numeric')) inputType = 'number'

    return (
      <input
        type={inputType}
        value={value}
        onChange={e => updateAnswer(field.id, e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        placeholder={field.label}
      />
    )
  }

  async function handleSave() {
    setLoading(true)
    try {
      const res = await fetch('/api/intake/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current, answers, transcript: messages, schema }),
      })
      const data = await res.json()
      setSaved(data)
    } catch (err) {
      setSaved({ error: err.message })
    } finally {
      setLoading(false)
    }
  }

  const requiredFields = schema?.fields.filter(f => f.required) ?? []
  const answeredCount = requiredFields.filter(f => answers[f.id] !== undefined).length
  const progress = requiredFields.length ? Math.round((answeredCount / requiredFields.length) * 100) : 0
  const canSave = isComplete || (requiredFields.length > 0 && answeredCount === requiredFields.length)

  if (schemaError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50">
        <p className="text-red-700 font-medium">Failed to load form schema: {schemaError}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-3 px-2 sm:py-8 sm:px-4">
      <div className="w-full max-w-none sm:max-w-2xl flex flex-col gap-4">

        {/* Header */}
        <div className="bg-transparent border-0 rounded-none shadow-none p-0 sm:bg-white sm:border sm:border-gray-200 sm:rounded-xl sm:p-5 sm:shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            {schema ? schema.orgName : 'Loading…'} — Intake
          </h1>
          {schema && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Required fields completed</span>
                <span>{answeredCount} / {requiredFields.length}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Chat window */}
        <div className="bg-transparent border-0 rounded-none shadow-none sm:bg-white sm:border sm:border-gray-200 sm:rounded-xl sm:shadow-sm flex flex-col" style={{ minHeight: '420px' }}>
          <div className="px-4 pt-4 pb-2 border-b border-gray-100">
            <div className="inline-flex rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('assistant')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'assistant' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                  }`}
              >
                Assistant
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'form' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                  }`}
              >
                Form
              </button>
            </div>
          </div>

          {activeTab === 'assistant' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" style={{ maxHeight: '520px' }}>
                {!schema && (
                  <p className="text-sm text-gray-400 text-center py-8">Loading form…</p>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="flex flex-col gap-2 max-w-xs">
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user'
                            ? 'bg-violet-600 text-white rounded-br-sm'
                            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                          }`}
                      >
                        {m.content}
                      </div>
                      {m.role === 'assistant' && Array.isArray(m.options) && m.options.length > 0 && i === messages.length - 1 && !loading && !isComplete && (
                        <div className="flex flex-wrap gap-2 pl-1">
                          {m.options.map((option, optionIndex) => (
                            <button
                              key={`${i}-${optionIndex}-${option}`}
                              type="button"
                              onClick={() => handleQuickReply(option)}
                              className="text-sm bg-white border border-violet-200 text-violet-700 rounded-full px-3 py-1.5 hover:bg-violet-50 transition-colors"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div
                      className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3"
                      aria-label="Assistant is typing"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:120ms]" />
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:240ms]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              {!isComplete && (
                <form
                  onSubmit={handleSend}
                  className="border-t border-gray-100 bg-white sm:bg-transparent p-3 flex gap-2"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={schema ? 'Type your answer…' : 'Loading…'}
                    disabled={loading || !schema}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:bg-gray-50"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim() || !schema}
                    className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-violet-700 transition-colors"
                  >
                    Send
                  </button>
                </form>
              )}
            </>
          )}

          {activeTab === 'form' && (
            <div className="p-4 overflow-y-auto" style={{ maxHeight: '520px' }}>
              <p className="text-xs text-gray-500 mb-4">
                This form stays in sync with Assistant. You can fill fields here directly at any time.
              </p>
              {!schema && (
                <p className="text-sm text-gray-400 text-center py-8">Loading form…</p>
              )}
              {schema?.fields?.length > 0 && (
                <div className="space-y-4">
                  {schema.fields.map(field => (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-gray-800 mb-1">
                        {field.label}
                        {field.required ? ' *' : ''}
                      </label>
                      {renderFieldInput(field)}
                      <p className="mt-1 text-xs text-gray-400">{field.section}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save button */}
        {canSave && !saved && (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-green-600 text-white rounded-xl px-4 py-3 font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
          >
            {loading ? 'Saving…' : 'Save Responses'}
          </button>
        )}

        {/* Save confirmation */}
        {saved && !saved.error && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
            <p className="font-semibold mb-1">Responses saved</p>
            <p>ID: <code className="font-mono text-xs">{saved.id}</code></p>
            <p>Saved at: {saved.savedAt}</p>
            <p className="mt-2 text-xs text-green-600">Stored in system_settings → intake_responses_v1</p>
          </div>
        )}
        {saved?.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            Save error: {saved.error}
          </div>
        )}

      </div>
    </div>
  )
}
