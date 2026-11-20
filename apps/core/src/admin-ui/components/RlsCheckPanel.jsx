'use client'
import { getAdminAuthHeaders } from '@/lib/clientAdminAuth'

import { useCallback, useEffect, useState } from 'react'

function statusFromCheck(rlsCheck, loading) {
  if (loading) {
    return {
      text: 'Checking...',
      classes: 'bg-gray-50 border-gray-200 text-gray-900',
    }
  }

  if (!rlsCheck) {
    return {
      text: 'Not checked',
      classes: 'bg-gray-50 border-gray-200 text-gray-900',
    }
  }

  if (Number(rlsCheck?.summary?.failedChecks || 0) > 0) {
    return {
      text: 'Issues detected',
      classes: 'bg-red-50 border-red-200 text-red-900',
    }
  }

  if (Number(rlsCheck?.summary?.warningChecks || 0) > 0) {
    return {
      text: 'Warnings',
      classes: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    }
  }

  return {
    text: 'Pass',
    classes: 'bg-green-50 border-green-200 text-green-900',
  }
}

function RlsCheckDetails({ rlsCheck, loading, onRerun }) {
  const routeCoverage = rlsCheck?.details?.routeCoverage
  const unwiredRoutes = routeCoverage?.unwired || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-700">
          Summary: {rlsCheck?.summary?.passedChecks || 0} pass, {rlsCheck?.summary?.warningChecks || 0} warn, {rlsCheck?.summary?.failedChecks || 0} fail
        </p>
        <button
          onClick={onRerun}
          disabled={loading}
          className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Re-run check'}
        </button>
      </div>

      <div className="border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Checks</div>
        <div className="divide-y divide-gray-200">
          {(rlsCheck?.checks || []).map((check) => {
            const tone = check.status === 'pass'
              ? 'text-green-700'
              : check.status === 'warn'
                ? 'text-yellow-700'
                : 'text-red-700'

            return (
              <div key={check.id} className="px-3 py-2">
                <p className={`text-sm font-medium ${tone}`}>{check.label}</p>
                <p className="text-xs text-gray-600 mt-0.5">{check.detail}</p>
              </div>
            )
          })}
          {(!rlsCheck?.checks || rlsCheck.checks.length === 0) && (
            <div className="px-3 py-3 text-sm text-gray-500">No checks available yet.</div>
          )}
        </div>
      </div>

      <div className="border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Errors</div>
        <div className="divide-y divide-gray-200">
          {(rlsCheck?.errors || []).map((errorMessage, idx) => (
            <div key={`rls-error-${idx}`} className="px-3 py-2 text-xs text-red-700">{errorMessage}</div>
          ))}
          {(!rlsCheck?.errors || rlsCheck.errors.length === 0) && (
            <div className="px-3 py-3 text-sm text-gray-500">No errors reported.</div>
          )}
        </div>
      </div>

      <div className="border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Per-table status</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-white text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Table</th>
                <th className="text-left px-3 py-2 font-semibold">RLS</th>
                <th className="text-left px-3 py-2 font-semibold">Policies</th>
                <th className="text-left px-3 py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(rlsCheck?.details?.tableChecks || []).map((tableCheck) => (
                <tr key={tableCheck.tableName} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-900">{tableCheck.tableName}</td>
                  <td className="px-3 py-2 text-gray-700">{tableCheck.rlsEnabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="px-3 py-2 text-gray-700">{tableCheck.policyCount}</td>
                  <td className="px-3 py-2 text-gray-600">{tableCheck.detail}</td>
                </tr>
              ))}
              {(!rlsCheck?.details?.tableChecks || rlsCheck.details.tableChecks.length === 0) && (
                <tr>
                  <td className="px-3 py-3 text-gray-500" colSpan={4}>No table-level results available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Routes without a domain binding</div>
        {routeCoverage ? (
          <>
            <p className="px-3 py-2 text-xs text-gray-600">
              {unwiredRoutes.length} of {routeCoverage.total} routes that touch tenant tables open a plain connection and never set{' '}
              <span className="font-mono">app.current_domain</span>: under the constrained runtime role their queries match no rows, and under a
              login role that bypasses RLS they read across domains. {routeCoverage.bound.length} route(s) bind the domain and{' '}
              {routeCoverage.operator.length} are intentional owner-only operator routes. Captured at build time;{' '}
              <span className="font-mono">npm run rls:coverage</span> prints the same classification.
            </p>
            {unwiredRoutes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-white text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Route</th>
                      <th className="text-left px-3 py-2 font-semibold">Tenant tables</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unwiredRoutes.map((entry) => (
                      <tr key={entry.route} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-gray-900">/api/{entry.route}</td>
                        <td className="px-3 py-2 text-gray-600">{entry.tables.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-3 py-3 text-sm text-gray-500">Every tenant-table route binds the request&apos;s domain.</div>
            )}
          </>
        ) : (
          <div className="px-3 py-3 text-sm text-gray-500">
            This deployment did not capture route coverage at build time. Rebuild it, or run <span className="font-mono">npm run rls:coverage</span>.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Row-level-security posture of the primary database.
 *
 * `card` is the compact status tile the Settings page embeds (details open in a
 * modal). `page` renders the same payload inline, for the read-only
 * /admin/settings/rls route that simulated admin sessions can open.
 */
export default function RlsCheckPanel({ variant = 'card' }) {
  const [rlsCheck, setRlsCheck] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showDetails, setShowDetails] = useState(false)

  const fetchRlsCheck = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/database/rls-check', {
        cache: 'no-store',
        headers: await getAdminAuthHeaders(),
      })
      const data = await response.json().catch(() => null)
      setRlsCheck(data)
    } catch (err) {
      console.error('Error fetching RLS check:', err)
      setRlsCheck({
        success: false,
        checks: [],
        errors: [err?.message || 'Failed to fetch RLS check result'],
        summary: { totalChecks: 0, passedChecks: 0, warningChecks: 0, failedChecks: 1 },
        details: { tableChecks: [] },
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchRlsCheck, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchRlsCheck])

  const status = statusFromCheck(rlsCheck, loading)

  if (variant === 'page') {
    return <RlsCheckDetails rlsCheck={rlsCheck} loading={loading} onRerun={fetchRlsCheck} />
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDetails(true)}
        className={`rounded-lg p-4 border text-left ${status.classes}`}
      >
        <p className="text-xs font-medium">RLS Check</p>
        <p className="text-sm font-bold mt-2">{status.text}</p>
        {!loading && rlsCheck?.summary && (
          <p className="text-xs mt-2 opacity-85">
            {rlsCheck.summary.passedChecks} pass, {rlsCheck.summary.warningChecks} warn, {rlsCheck.summary.failedChecks} fail
          </p>
        )}
      </button>

      {showDetails && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
          <div className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Primary Database RLS Check</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="h-8 w-8 inline-flex items-center justify-center text-gray-700 hover:bg-gray-100 rounded"
                aria-label="Close RLS details"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4">
              <RlsCheckDetails rlsCheck={rlsCheck} loading={loading} onRerun={fetchRlsCheck} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
