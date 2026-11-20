'use client'

export default function InfoSummary({ activeDatabaseString }) {
  const dashboardHost = typeof window !== 'undefined'
    ? `${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`
    : 'localhost:3000'

  return (
    <div className="bg-white rounded-lg shadow p-6 h-full flex flex-col">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Info</h2>
      <div className="space-y-5 text-sm">
        <div>
          <div className="text-gray-600">Core Dashboard</div>
          <div className="mt-1 min-w-0 break-all font-mono text-xs text-gray-900">
            {dashboardHost}
          </div>
        </div>
        <div>
          <div className="text-gray-600">Active Database</div>
          <div className="mt-1 min-w-0 break-all font-mono text-xs text-gray-900">
            {activeDatabaseString || 'Not configured'}
          </div>
        </div>
      </div>
    </div>
  )
}
