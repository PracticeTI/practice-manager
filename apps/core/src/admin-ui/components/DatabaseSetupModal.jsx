'use client'

import { useCallback, useState, useEffect } from 'react'

const DATABASE_OPTIONS = [
  {
    id: 'postgres',
    name: 'PostgreSQL',
    type: 'PostgreSQL',
    description: 'PostgreSQL database (local, Supabase, or any PostgreSQL host)',
    icon: '🐘',
    freeLimit: 'Varies by host',
    setupUrl: 'https://supabase.com',
    envVars: [
      { key: 'DATABASE_URL', label: 'Connection URL', placeholder: 'postgresql://user:pass@host:port/db' }
    ]
  },
  {
    id: 'mongodb',
    name: 'MongoDB Atlas',
    type: 'MongoDB',
    description: 'Cloud-hosted MongoDB database',
    icon: '🍃',
    freeLimit: '512MB storage, shared cluster',
    setupUrl: 'https://www.mongodb.com/cloud/atlas/register',
    envVars: [
      { key: 'MONGODB_URI', label: 'Connection String', placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net/dbname' }
    ]
  }
]

export default function DatabaseSetupModal({ isOpen, onClose, onSetup, currentDbType, currentEnvValues, onTestConnection }) {
  const [selectedDb, setSelectedDb] = useState(null)
  const [envValues, setEnvValues] = useState({})
  const [step, setStep] = useState('select') // 'select', 'configure', 'instructions'
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [detectingLocal, setDetectingLocal] = useState(false)
  const [detectError, setDetectError] = useState(null)
  const resolveEnvKey = useCallback((env) => env.key, [])
  const modalTitle = 'Database Configuration'


  // When currentEnvValues changes and we have a selected database, update the form values
  useEffect(() => {
    if (isOpen && selectedDb && currentEnvValues && Object.keys(currentEnvValues).length > 0) {
      const newValues = {}
      selectedDb.envVars.forEach(env => {
        const envKey = resolveEnvKey(env)
        newValues[envKey] = currentEnvValues[envKey] || ''
      })
      console.log('useEffect updating envValues:', newValues)
      const timeoutId = window.setTimeout(() => {
        setEnvValues(newValues)
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [currentEnvValues, selectedDb, isOpen, resolveEnvKey])

  // Reset modal state when closing
  useEffect(() => {
    if (!isOpen) {
      const timeoutId = window.setTimeout(() => {
        setSelectedDb(null)
        setEnvValues({})
        setStep('select')
        setIsEditing(false)
        setSaveError(null)
        setInitialized(false)
        setDetectError(null)
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [isOpen])

  // Initialize modal with existing settings when it opens
  useEffect(() => {
    if (isOpen && !initialized && currentEnvValues && Object.keys(currentEnvValues).length > 0) {
      console.log('Modal initializing with:', { currentDbType, currentEnvValues })

      // Detect database type from available environment variables
      let currentDb = null
      const hasMongo = currentEnvValues.MONGODB_URI
      const hasPostgres = currentEnvValues.DATABASE_URL

      if (hasMongo) {
        console.log('Detected MongoDB')
        currentDb = DATABASE_OPTIONS.find(db => db.id === 'mongodb')
      } else if (hasPostgres) {
        console.log('Detected PostgreSQL')
        currentDb = DATABASE_OPTIONS.find(db => db.id === 'postgres')
      } else if (currentDbType && currentDbType.toLowerCase().includes('mongo')) {
        console.log('Detected MongoDB (via currentDbType)')
        currentDb = DATABASE_OPTIONS.find(db => db.id === 'mongodb')
      }

      if (currentDb) {
        console.log('Selected database:', currentDb.name)
        const initialValues = {}
        currentDb.envVars.forEach(env => {
          const envKey = resolveEnvKey(env)
          initialValues[envKey] = currentEnvValues[envKey] || ''
          console.log(`Setting ${envKey}:`, initialValues[envKey])
        })
        const timeoutId = window.setTimeout(() => {
          setSelectedDb(currentDb)
          setEnvValues(initialValues)
          setStep('configure')
          setIsEditing(true)
          setInitialized(true)
        }, 0)
        return () => window.clearTimeout(timeoutId)
      } else {
        console.warn('Could not detect database type')
      }
    }
  }, [isOpen, initialized, currentEnvValues, currentDbType, resolveEnvKey])

  if (!isOpen) {
    return null
  }

  const handleDbSelect = (db) => {
    setSelectedDb(db)
    setStep('configure')
    setIsEditing(false)
    // Initialize env values
    const initialValues = {}
    db.envVars.forEach(env => {
      initialValues[resolveEnvKey(env)] = ''
    })
    setEnvValues(initialValues)
  }

  const handleEnvChange = (key, value) => {
    setEnvValues(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleContinue = () => {
    const requiredKeys = selectedDb?.envVars
      .filter(env => env.required !== false)
      .map(env => resolveEnvKey(env)) || []

    const missing = requiredKeys.some(key => !envValues[key]?.trim())
    if (missing) {
      alert('Please fill in all required fields')
      return
    }
    setStep('instructions')
  }

  const handleDetectLocalPostgres = async () => {
    if (!selectedDb || selectedDb.id !== 'postgres') return
    setDetectError(null)
    setDetectingLocal(true)

    try {
      const adminToken = localStorage.getItem('adminToken')
      const response = await fetch('/api/database/detect-local', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to detect local PostgreSQL')
      }

      if (data.running && data.suggestedUrl) {
        const envKey = resolveEnvKey(selectedDb.envVars[0])
        setEnvValues(prev => ({
          ...prev,
          [envKey]: data.suggestedUrl
        }))
        alert(`Found PostgreSQL on ${data.host}:${data.port}. We filled a template URL—please replace user, password, and database before saving.`)
      } else {
        alert(data.message || 'No local PostgreSQL detected on common ports.')
      }
    } catch (error) {
      console.error('Detect local PostgreSQL failed:', error)
      setDetectError(error.message)
      alert(error.message)
    } finally {
      setDetectingLocal(false)
    }
  }

  const handleTestConnection = async () => {
    if (!onTestConnection) {
      alert('Test connection function not available')
      return
    }

    setIsTesting(true)
    try {
      const result = await onTestConnection(selectedDb?.type, envValues)
      if (result.connected) {
        alert(`✅ Database connection successful!\n\nType: ${result.type}\n${result.timestamp ? `Timestamp: ${new Date(result.timestamp).toLocaleString()}` : ''}`)
      } else {
        let msg = `❌ Connection test failed.`
        if (result.error) msg += `\n\nError: ${result.error}`
        if (result.suggestion) msg += `\n\n💡 ${result.suggestion}`
        alert(msg)
      }
    } catch (error) {
      alert(`Error testing connection: ${error.message}`)
    } finally {
      setIsTesting(false)
    }
  }

  const handleComplete = async () => {
    setSaving(true)
    setSaveError(null)

    try {
      const adminToken = localStorage.getItem('adminToken')
      const backendUrl = ''

      const response = await fetch(`${backendUrl}/api/database/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          envVars: envValues,
        })
      })

      if (!response.ok) {
        let errorMessage = `Server error: ${response.status}`
        try {
          const data = await response.json()
          errorMessage = data.error || errorMessage
        } catch (parseError) {
          // Response wasn't JSON - likely an HTML error page
          const text = await response.text()
          if (text.includes('Internal Server Error')) {
            errorMessage = 'Backend server error. Check that the backend is running and restart it if needed.'
          } else if (text.length < 200) {
            errorMessage = text
          }
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()

      if (data.isProduction) {
        // Show platform-specific instructions
        const instructions = data.platform === 'vercel'
          ? data.instructions.vercel
          : data.instructions.general

        const instructionText = instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')
        alert(`⚠️ Production Environment Detected\n\nYou're running on ${data.platform === 'vercel' ? 'Vercel' : 'a production platform'}. Environment variables must be set through your platform's dashboard:\n\n${instructionText}\n\nThe variables have been copied to your clipboard.`)

        // Copy to clipboard
        const envText = Object.entries(envValues)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
        navigator.clipboard.writeText(envText)

        onSetup(selectedDb, envValues)
      } else {
        // Local development success
        alert('✅ Database configuration saved to .env.local!\n\n' + data.note)
        onSetup(selectedDb, envValues)
      }

    } catch (error) {
      console.error('Error saving configuration:', error)
      setSaveError(error.message)
    } finally {
      setSaving(false)
    }
  }

  const resetModal = () => {
    setSelectedDb(null)
    setEnvValues({})
    setStep('select')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-300 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {isEditing ? `Edit ${modalTitle}` : modalTitle}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {step === 'select' && 'Choose a database service to get started'}
              {step === 'configure' && `${isEditing ? 'Update' : 'Configure'} ${selectedDb?.name}`}
              {step === 'instructions' && `${isEditing ? 'Update' : 'Complete'} the database setup`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step 1: Select Database */}
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-gray-700 mb-6">
                No database connection found. Choose one of the following options to get started:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {DATABASE_OPTIONS.map((db) => (
                  <button
                    key={db.id}
                    onClick={() => handleDbSelect(db)}
                    className="text-left p-6 border border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer"
                  >
                    <div className="text-4xl mb-3">{db.icon}</div>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">{db.name}</h3>
                    <p className="text-sm text-gray-600 mb-3">{db.description}</p>
                    <div className="text-xs text-gray-600 border border-gray-300 p-2">
                      <strong>Free tier:</strong> {db.freeLimit}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Configure Database */}
          {step === 'configure' && selectedDb && (
            <div className="space-y-6">
              {selectedDb.id !== 'local' ? (
                <div className="border border-gray-300 p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">📋 Before you start:</h3>
                  <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
                    <li>Create a free account at <a href={selectedDb.setupUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">{selectedDb.id === 'postgres' ? 'Supabase' : selectedDb.name}</a></li>
                    <li>Create a new database/cluster</li>
                    <li>Copy your connection credentials</li>
                    <li>Paste them in the fields below</li>
                  </ol>
                </div>
              ) : selectedDb.id === 'postgres' ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-2">💻 PostgreSQL Setup:</h3>
                  <div className="text-sm text-blue-800 space-y-2">
                    <p><strong>For Local PostgreSQL:</strong></p>
                    <ol className="list-decimal list-inside ml-2 space-y-1">
                      <li>Install: <code className="bg-blue-100 px-1 rounded">brew install postgresql</code></li>
                      <li>Start: <code className="bg-blue-100 px-1 rounded">brew services start postgresql</code></li>
                      <li>Create database: <code className="bg-blue-100 px-1 rounded">createdb practice</code></li>
                      <li>Connection string: <code className="bg-blue-100 px-1 rounded">postgresql://localhost:5432/practice</code></li>
                    </ol>
                    <p className="mt-3"><strong>For Supabase:</strong></p>
                    <ol className="list-decimal list-inside ml-2 space-y-1">
                      <li>Create account at <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline">supabase.com</a></li>
                      <li>Create a new project</li>
                      <li>Copy connection string from Settings → Database</li>
                      <li>Use the connection pooling URL for best performance</li>
                    </ol>
                  </div>
                </div>
              ) : null}

              {selectedDb.id === 'postgres' && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleDetectLocalPostgres}
                    disabled={detectingLocal}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {detectingLocal ? 'Detecting local PostgreSQL...' : '🔎 Auto-detect local PostgreSQL'}
                  </button>
                  <p className="text-xs text-gray-600">Fills a localhost template if a server is listening on common ports.</p>
                  {detectError && <p className="text-xs text-red-600">{detectError}</p>}
                </div>
              )}

              <div className="space-y-4">
                {selectedDb.envVars.map((env) => (
                  <div key={resolveEnvKey(env)}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {env.label}
                    </label>
                    <input
                      type="text"
                      value={envValues[resolveEnvKey(env)] || ''}
                      onChange={(e) => handleEnvChange(resolveEnvKey(env), e.target.value)}
                      placeholder={env.placeholder}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={resetModal}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTesting ? 'Testing...' : '🧪 Test Connection'}
                </button>
                <button
                  onClick={handleContinue}
                  className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-900 transition-colors text-sm"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Instructions */}
          {step === 'instructions' && selectedDb && (
            <div className="space-y-6">
              <div className={`rounded-lg p-4 ${isEditing ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
                <h3 className={`font-semibold mb-2 ${isEditing ? 'text-blue-900' : 'text-green-900'}`}>
                  {isEditing ? '✏️ Review your changes' : '✅ Configuration ready!'}
                </h3>
                <p className={`text-sm ${isEditing ? 'text-blue-800' : 'text-green-800'}`}>
                  {isEditing
                    ? 'Review the updated configuration below and save your changes.'
                    : 'Click the button below to save your configuration.'}
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h4 className="font-semibold text-gray-900 mb-3">Environment variables:</h4>
                <div className="bg-gray-900 text-gray-100 rounded p-4 font-mono text-sm overflow-x-auto">
                  {Object.entries(envValues).map(([key, value]) => (
                    <div key={key} className="mb-2">
                      {key}={value}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    const envText = Object.entries(envValues)
                      .map(([key, value]) => `${key}=${value}`)
                      .join('\n')
                    navigator.clipboard.writeText(envText)
                    alert('Copied to clipboard!')
                  }}
                  className="mt-3 px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors text-sm"
                >
                  📋 Copy to Clipboard
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">💡 How this works:</h4>
                <div className="text-sm text-blue-800 space-y-2">
                  <p><strong>Local Development:</strong> Variables will be saved to <code className="bg-blue-100 px-1 rounded">/.env.local</code>. Restart your server after saving.</p>
                  <p><strong>Production (Vercel/Netlify):</strong> You&apos;ll get instructions to add these to your hosting platform&apos;s dashboard, as .env.local files don&apos;t work in production deployments.</p>
                </div>
              </div>

              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-semibold text-red-900 mb-2">❌ Error:</h4>
                  <p className="text-sm text-red-800">{saveError}</p>
                  <p className="text-xs text-red-700 mt-2">
                    You can still manually copy the variables above and add them to your environment.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={resetModal}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isEditing ? 'Cancel' : 'Start Over'}
                </button>
                <button
                  onClick={handleComplete}
                  disabled={saving}
                  className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${isEditing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {isEditing ? 'Updating...' : 'Saving...'}
                    </>
                  ) : (
                    isEditing ? 'Update Configuration' : 'Save Configuration'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
