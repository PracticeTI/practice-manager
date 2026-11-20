'use client'

import { AI_PROVIDER_OPTIONS } from '@/lib/ai/providers'

export default function SetupRequiredModal({ isOpen, onClose }) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg border border-gray-300 bg-white">
                <div className="flex items-start justify-between border-b border-gray-300 px-5 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Setup required</h2>
                        <p className="mt-1 text-sm text-gray-600">
                            Add these environment variables, then restart the server.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close setup instructions"
                        className="text-gray-600 transition-colors hover:text-gray-900"
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-5 px-5 py-4">
                    <div>
                        <p className="text-sm font-medium text-gray-900">Database</p>
                        <code className="mt-1 block break-all border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                            DATABASE_URL=postgresql://user:password@host:5432/database
                        </code>
                    </div>

                    <div>
                        <p className="text-sm font-medium text-gray-900">AI provider</p>
                        <code className="mt-1 block break-all border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                            [PROVIDER]_API_KEY=
                        </code>
                        <p className="mt-2 text-xs text-gray-600">
                            Supported providers: {AI_PROVIDER_OPTIONS.map((provider) => provider.label).join(', ')}
                        </p>
                    </div>

                    <p className="text-xs text-gray-600">
                        Set these in <code>.env.local</code> for local development, or in your hosting
                        provider&apos;s environment variables.
                    </p>
                </div>

                <div className="border-t border-gray-300 px-5 py-3 text-right">
                    <button
                        type="button"
                        onClick={onClose}
                        className="bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    )
}
