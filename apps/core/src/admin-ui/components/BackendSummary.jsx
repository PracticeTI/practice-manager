'use client'
import { getAdminAuthHeaders } from '@/lib/clientAdminAuth'
import RlsCheckPanel from '@/admin-ui/components/RlsCheckPanel'

import { useState, useEffect } from 'react'

export default function BackendSummary({
  backendOnline,
  openAiStatus,
  onSetupOpenAi,
  onTestOpenAi,
  testingOpenAi,
  onOpenDatabaseSettings
}) {
  const [backendInfo, setBackendInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})

  const fetchBackendInfo = async () => {
    setLoading(true)
    setError(null)

    try {
      const backendUrl = ''
      const response = await fetch(`${backendUrl}/api/database/check`, {
        headers: await getAdminAuthHeaders(),
      })
      const data = await response.json()

      setBackendInfo(data)
    } catch (err) {
      console.error('Error fetching backend info:', err)
      setError('Failed to fetch backend information')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (backendOnline) {
      const timeoutId = window.setTimeout(fetchBackendInfo, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [backendOnline])

  const toggleExpansion = (key) => {
    setExpanded(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const getProviderInfo = (url) => {
    if (!url) return { provider: 'Unknown', location: 'Unknown' }

    try {
      const urlObj = new URL(url)
      const host = urlObj.hostname || url

      // Detect provider from hostname
      if (host.includes('supabase')) return { provider: 'Supabase', location: 'Cloud' }
      if (host.includes('amazonaws')) return { provider: 'AWS RDS', location: 'Cloud' }
      if (host.includes('azure')) return { provider: 'Azure', location: 'Cloud' }
      if (host.includes('mongo')) return { provider: 'MongoDB Cloud', location: 'Cloud' }
      if (host.includes('railway')) return { provider: 'Railway', location: 'Cloud' }
      if (host.includes('neon')) return { provider: 'Neon', location: 'Cloud' }
      if (host.includes('render')) return { provider: 'Render', location: 'Cloud' }
      if (host.includes('localhost') || host === '127.0.0.1') return { provider: 'PostgreSQL', location: 'Local' }
      if (url.startsWith('mongodb+srv')) return { provider: 'MongoDB', location: 'Cloud' }
      return { provider: 'PostgreSQL', location: 'Local' }
    } catch (e) {
      return { provider: 'Unknown', location: 'Unknown' }
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 h-full flex flex-col">
      {/* Top half: header + status */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">System</h2>
        </div>

        {!backendOnline && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-yellow-900">API Offline</p>
                <p className="text-sm text-yellow-700 mt-1">Configure the database in the Configuration section below to get started.</p>
              </div>
            </div>
          </div>
        )}

        {backendOnline && (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <p className="font-medium text-red-900">{error}</p>
                </div>
              </div>
            )}

            {!backendInfo && !error && !loading && (
              <p className="text-gray-500 text-center py-8">
                Click &quot;Refresh&quot; to load backend information
              </p>
            )}

            {backendInfo && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {error ? (
                  <>
                    <RlsCheckPanel />

                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600">Environment</p>
                      <p className="text-sm font-bold text-gray-900 mt-2">
                        {process.env.NODE_ENV === 'production' ? 'Prod' : 'Dev'}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <RlsCheckPanel />

                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                      <p className="text-xs font-medium text-purple-600">Environment</p>
                      <p className="text-sm font-bold text-purple-900 mt-2">
                        {process.env.NODE_ENV === 'production' ? 'Prod' : 'Dev'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}

