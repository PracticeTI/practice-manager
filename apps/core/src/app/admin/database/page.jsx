'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DatabaseSummary from '@/admin-ui/components/DatabaseSummary'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getAdminAuthHeaders, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'

export default function DatabasePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dbStatus, setDbStatus] = useState(null)
  const [backendOnline, setBackendOnline] = useState(false)
  const [checkingBackend, setCheckingBackend] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [migrationResult, setMigrationResult] = useState(null)
  const router = useRouter()
  const backendUrl = ''

  useEffect(() => {
    document.title = 'Database'
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAdmin() {
      const token = await getOrCreateAdminTokenForLocalhost()
      if (cancelled) {
        return
      }

      if (!token) {
        router.push('/login')
        return
      }

      setIsAuthenticated(true)
      setLoading(false)
    }

    bootstrapAdmin()

    return () => {
      cancelled = true
    }
  }, [router])

  const checkDatabaseStatus = async () => {
    setCheckingBackend(true)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${backendUrl}/api/database/check`, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache',
        headers: await getAdminAuthHeaders(),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Backend responded with status: ${response.status}`)
      }

      const data = await response.json()
      setDbStatus(data)
      setBackendOnline(true)
    } catch (error) {
      console.error('Failed to check database status:', error)
      setBackendOnline(false)
      setDbStatus(null)
    } finally {
      setCheckingBackend(false)
    }
  }

  const runMigration = async () => {
    if (!confirm('This will DELETE all production records and remove the borough, neighborhood, and area columns. Continue?')) {
      return
    }

    setMigrating(true)
    setMigrationResult(null)
    try {
      const response = await fetch(`${backendUrl}/api/database/migrate-to-attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAdminAuthHeaders()) }
      })

      const data = await response.json()
      setMigrationResult(data)

      if (data.success) {
        await checkDatabaseStatus()
      }
    } catch (error) {
      console.error('Migration failed:', error)
      setMigrationResult({
        success: false,
        error: error.message
      })
    } finally {
      setMigrating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Backend Status Banner */}
      {!checkingBackend && !backendOnline && (
        <div className="bg-red-600 text-white px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-semibold">API Server Not Running</p>
                <p className="text-sm text-red-100">Start the One API server to view database information</p>
              </div>
            </div>
            <button
              onClick={checkDatabaseStatus}
              className="px-4 py-2 bg-white text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Instructions Banner */}
      {!checkingBackend && !backendOnline && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
          <div className="max-w-7xl mx-auto">
            <p className="text-sm text-yellow-900">
              <strong>To start the API:</strong> Open a terminal in the project root and run: <code className="bg-yellow-100 px-2 py-1 rounded">npm run dev</code>
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <AdminHeader title="Data" />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Migration Tool */}
          {backendOnline && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Location Data Migration</h2>
              <p className="text-gray-600 mb-4">
                Migrate location data from columns (borough, neighborhood, area) to flexible JSON attributes.
                This will delete all production records and drop the old columns.
              </p>

              <button
                onClick={runMigration}
                disabled={migrating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {migrating ? 'Running Migration...' : 'Run Migration'}
              </button>

              {migrationResult && (
                <div className={`mt-4 p-4 rounded-lg ${migrationResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <h3 className={`font-semibold ${migrationResult.success ? 'text-green-900' : 'text-red-900'}`}>
                    {migrationResult.success ? 'Migration Successful' : 'Migration Failed'}
                  </h3>
                  {migrationResult.steps && (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {migrationResult.steps.map((step, i) => (
                        <li key={i}>✓ {step}</li>
                      ))}
                    </ul>
                  )}
                  {migrationResult.error && (
                    <p className="mt-2 text-sm text-red-700">{migrationResult.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <DatabaseSummary
            dbStatus={dbStatus}
            backendOnline={backendOnline}
            onRefresh={checkDatabaseStatus}
          />
        </div>
      </main>
    </div>
  )
}

