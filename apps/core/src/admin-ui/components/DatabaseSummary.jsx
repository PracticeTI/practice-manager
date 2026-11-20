'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { getAdminAuthHeaders } from '@/lib/clientAdminAuth'

export default function DatabaseSummary({ dbStatus, backendOnline, onRefresh }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [expandedOldest, setExpandedOldest] = useState({})
  const [creatingTables, setCreatingTables] = useState(false)
  const [tableRecords, setTableRecords] = useState({})

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const backendUrl = ''
      const response = await fetch(`${backendUrl}/api/database/summary`, {
        headers: await getAdminAuthHeaders(),
      })
      const data = await response.json()

      if (!data.success) {
        setError(data.message || 'Failed to fetch database summary')
        return
      }

      if (data.isEmpty) {
        setError(data.message)
        return
      }

      setSummary(data)
    } catch (err) {
      console.error('Error fetching database summary:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLoadSummary = useCallback(async () => {
    if (onRefresh) {
      await onRefresh()
    }
    await fetchSummary()
  }, [onRefresh, fetchSummary])

  // Auto-load summary when onRefresh is available
  useEffect(() => {
    const run = async () => {
      try {
        await handleLoadSummary()
      } catch (e) {
        // ignore
      }
    }
    run()
  }, [handleLoadSummary])

  const toggleTableExpansion = (tableName) => {
    setExpanded(prev => ({
      ...prev,
      [tableName]: !prev[tableName]
    }))

    // If expanding content (images) and we don't have records, fetch all
    if (!expanded[tableName] && tableName === 'content_images' && !tableRecords[tableName]) {
      fetchAllContentImages()
    }
  }

  const fetchAllContentImages = async () => {
    try {
      const backendUrl = ''
      const response = await fetch(`${backendUrl}/api/database/content?type=info&subtype=image`)
      const data = await response.json()

      if (data.success && data.content) {
        setTableRecords(prev => ({
          ...prev,
          'content_images': data.content
        }))
      }
    } catch (err) {
      console.error('Error fetching content images:', err)
    }
  }

  const handleCreateTables = async () => {
    setCreatingTables(true)
    setError(null)
    setSuccess(null)

    try {
      const backendUrl = ''
      const response = await fetch(`${backendUrl}/api/database/create-tables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({
          dbType: dbStatus.type
        })
      })

      const data = await response.json()

      if (!data.success) {
        setError(data.error || 'Failed to create tables')
        return
      }

      setSuccess(`Successfully created ${data.tables?.length || 0} tables`)

      // Refresh the summary after creating tables
      setTimeout(() => fetchSummary(), 1000)

    } catch (err) {
      console.error('Error creating tables:', err)
      setError(err.message)
    } finally {
      setCreatingTables(false)
    }
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A'
    try {
      const date = new Date(timestamp)
      return date.toLocaleString()
    } catch {
      return String(timestamp)
    }
  }

  const renderRecordValue = (value) => {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  if (!summary && !loading && !error) {
    return (
      <div className="mt-8 border border-gray-300 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Explorer</h2>
          <button
            onClick={handleLoadSummary}
            className="px-3 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Load Data
          </button>
        </div>
        <p className="text-sm text-gray-600">Click the Load Data button to view database status and controls.</p>
      </div>
    )
  }

  if (!dbStatus || !dbStatus.configured) {
    return (
      <div className="mt-8 border border-gray-300 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Database Summary</h2>
          <span className="px-3 py-1 border border-gray-300 text-gray-600 text-sm">
            Not configured
          </span>
        </div>
        <p className="text-sm text-gray-700">Database status is unavailable until configuration is completed.</p>
      </div>
    )
  }

  return (
    <div className="mt-8 border border-gray-300 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Overview</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadSummary}
            disabled={loading}
            className="px-3 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </>
            )}
          </button>
        </div>
      </div>

      {success && (
        <div className="border border-gray-300 p-4 mb-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium text-gray-900">{success}</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="border border-gray-400 p-4 mb-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="font-medium text-gray-900 mb-3">{error}</p>
              {error.includes('Database is empty') && (
                <div className="flex gap-3">
                  <button
                    onClick={handleCreateTables}
                    disabled={creatingTables}
                    className="px-3 py-2 bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
                  >
                    {creatingTables ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        Create Tables Only
                      </>
                    )}
                  </button>
                </div>
              )}
              {error.includes('has tables but no records') && (
                <div className="flex gap-3">
                  <button
                    disabled={true}
                    className="px-3 py-2 bg-gray-400 text-white hover:bg-gray-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
                    title="Coming soon"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Import from NYC Open Data
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!summary && !error && !loading && (
        <p className="text-gray-500 text-center py-8">
          Click &quot;Load Summary&quot; to view database statistics
        </p>
      )}

      {summary && (
        <div className="space-y-6">
          {/* Overall Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-gray-300 p-4">
              <p className="text-sm font-medium text-gray-600">Database Type</p>
              <p className="text-2xl font-bold text-gray-900">{summary.databaseType}</p>
            </div>
            <div className="border border-gray-300 p-4">
              <p className="text-sm font-medium text-gray-600">Total Tables</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalTables}</p>
            </div>
            <div className="border border-gray-300 p-4">
              <p className="text-sm font-medium text-gray-600">Total Records</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalRecords?.toLocaleString()}</p>
            </div>
          </div>

          {/* Tables Details */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-gray-900">Tables</h3>
            {summary.tables && summary.tables
              .filter(table => !table.name.startsWith('content_'))
              .sort((a, b) => {
                // Order: content_images first, system_settings second, rest in middle
                const order = {
                  'content_images': 0,
                  'system_settings': 1
                }
                const aOrder = order[a.name] ?? 10
                const bOrder = order[b.name] ?? 10
                return aOrder - bOrder
              })
              .map((table) => (
                <div key={table.name} className="border border-gray-300 overflow-hidden">
                  <div className="bg-gray-100 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold text-gray-900">{table.name}</h4>
                      <span className="px-2 py-1 border border-gray-300 text-gray-700 text-xs">
                        {table.recordCount.toLocaleString()} records
                      </span>
                    </div>
                    {table.name === 'content_images' && table.recordCount > 0 && (
                      <button
                        onClick={() => toggleTableExpansion(table.name)}
                        className="text-gray-700 hover:text-gray-900 text-sm font-medium flex items-center gap-1"
                      >
                        {expanded[table.name] ? (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                            Hide Images
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Show Images
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {table.name === 'content_images' && table.recordCount > 0 && expanded[table.name] && (
                    <div className="px-4 py-3 bg-white">
                      {tableRecords[table.name] && Array.isArray(tableRecords[table.name]) ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {tableRecords[table.name].map((image, idx) => (
                            <div key={idx} className="space-y-2">
                              <div className="bg-white border border-gray-300 p-2 aspect-video flex items-center justify-center overflow-hidden">
                                <Image
                                  src={image.metadata?.url || image.url}
                                  alt={image.metadata?.title || image.title || `Image ${idx + 1}`}
                                  unoptimized
                                  width={320}
                                  height={180}
                                  className="w-full h-full object-cover rounded shadow-sm"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                    const fallback = e.currentTarget.parentElement?.querySelector('[data-image-fallback="true"]')
                                    if (fallback) fallback.style.display = 'flex'
                                  }}
                                />
                                <div data-image-fallback="true" style={{ display: 'none' }} className="text-xs text-gray-400 italic p-2 text-center">
                                  Failed to load
                                </div>
                              </div>
                              {(image.metadata?.title || image.title) && (
                                <p className="text-xs text-gray-600 truncate" title={image.metadata?.title || image.title}>
                                  {image.metadata?.title || image.title}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                          <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Loading images...
                        </div>
                      )}
                    </div>
                  )}

                  {table.name !== 'content_images' && table.recordCount > 0 && (
                    <div className="px-4 py-3 bg-white">
                      {table.mostRecentRecord && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-gray-600">
                              <strong>Most Recent Record:</strong>{' '}
                              {table.mostRecentRecord.record?.enddatetime ? (
                                <>
                                  {table.mostRecentRecord.record.enddatetime}
                                  <span className="text-gray-400 ml-2">(enddatetime)</span>
                                </>
                              ) : (
                                <>
                                  {formatTimestamp(table.mostRecentRecord.timestamp)}
                                  <span className="text-gray-400 ml-2">({table.mostRecentRecord.timestampColumn})</span>
                                </>
                              )}
                            </div>
                            <button
                              onClick={() => toggleTableExpansion(table.name)}
                              className="text-gray-700 hover:text-gray-900 text-sm font-medium flex items-center gap-1"
                            >
                              {expanded[table.name] ? (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                  </svg>
                                  Hide Details
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                  Show Details
                                </>
                              )}
                            </button>
                          </div>

                          {(table.name === 'enrichment_sessions' || (table.name === 'system_settings' && table.recordCount > 0)) && null}

                          {table.oldestRecord && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-sm text-gray-600">
                                  <strong>Oldest Record:</strong>{' '}
                                  {table.oldestRecord.record?.enddatetime ? (
                                    <>
                                      {table.oldestRecord.record.enddatetime}
                                      <span className="text-gray-400 ml-2">(enddatetime)</span>
                                    </>
                                  ) : (
                                    <>
                                      {formatTimestamp(table.oldestRecord.timestamp)}
                                      <span className="text-gray-400 ml-2">({table.oldestRecord.timestampColumn})</span>
                                    </>
                                  )}
                                </div>
                                <button
                                  onClick={() => setExpandedOldest(prev => ({
                                    ...prev,
                                    [table.name]: !prev[table.name]
                                  }))}
                                  className="text-gray-700 hover:text-gray-900 text-sm font-medium flex items-center gap-1"
                                >
                                  {expandedOldest[table.name] ? (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                      </svg>
                                      Hide Details
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                      Show Details
                                    </>
                                  )}
                                </button>
                              </div>
                              {expandedOldest[table.name] && (
                                <div className="bg-gray-50 border border-gray-300 p-3 overflow-x-auto">
                                  <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words">
                                    {JSON.stringify(table.oldestRecord.record, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}

                          {expanded[table.name] && (
                            <div className="mt-3 bg-gray-50 border border-gray-300 p-3 overflow-x-auto">
                              <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words">
                                {JSON.stringify(table.mostRecentRecord.record, null, 2)}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {table.recordCount === 0 && (
                    <div className="px-4 py-3 bg-white text-sm text-gray-500">
                      No records in this table
                    </div>
                  )}
                </div>
              ))}

          </div>
        </div>
      )}
    </div>
  )
}

