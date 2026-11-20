'use client'

import { BILLING_EVENT_TYPES } from '@/lib/billingMetadata'
import { formatBillingAmount } from './patientUtils'
export default function PatientBillingTab({
    billingDeletingId,
    billingError,
    billingForm,
    billingLoading,
    billingRecords,
    billingSubmitting,
    onAddBillingRecord,
    onChangeBillingForm,
    onDeleteBillingRecord,
    onRefreshBilling,
}) {
    return (
        <>
<section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-gray-900">Associated Billing Records</h3>
                                <button
                                    type="button"
                                    onClick={onRefreshBilling}
                                    disabled={billingLoading || billingSubmitting}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {billingLoading ? 'Refreshing...' : 'Refresh'}
                                </button>
                            </div>

                            <div className="overflow-x-auto rounded-md border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Event</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Amount</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Occurred</th>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {billingRecords.map((record) => {
                                            const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
                                            const occurredLabel = metadata.occurredAt
                                                ? new Date(metadata.occurredAt).toLocaleString()
                                                : '-'

                                            return (
                                                <tr key={record.id}>
                                                    <td className="px-3 py-2 text-gray-700">{metadata.eventType || '-'}</td>
                                                    <td className="px-3 py-2 text-gray-700">{metadata.status || '-'}</td>
                                                    <td className="px-3 py-2 text-gray-700">{formatBillingAmount(metadata.amount)}</td>
                                                    <td className="px-3 py-2 text-gray-700">{occurredLabel}</td>
                                                    <td className="px-3 py-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteBillingRecord(record.id)}
                                                            disabled={billingDeletingId === record.id || billingSubmitting}
                                                            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {billingDeletingId === record.id ? 'Deleting...' : 'Delete'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        {!billingLoading && billingRecords.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                                                    No billing records for this patient.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="rounded-md border border-gray-200 p-4">
                                <h4 className="text-sm font-semibold text-gray-900">Add Billing Event</h4>
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Event type</span>
                                        <select
                                            value={billingForm.eventType}
                                            onChange={(event) => onChangeBillingForm('eventType', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        >
                                            {BILLING_EVENT_TYPES.map((type) => (
                                                <option key={type} value={type}>{type}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Status</span>
                                        <input
                                            type="text"
                                            value={billingForm.status}
                                            onChange={(event) => onChangeBillingForm('status', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="paid"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Amount</span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={billingForm.amount}
                                            onChange={(event) => onChangeBillingForm('amount', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="120.00"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Invoice ID</span>
                                        <input
                                            type="text"
                                            value={billingForm.invoiceId}
                                            onChange={(event) => onChangeBillingForm('invoiceId', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="inv-0001"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Payment ID</span>
                                        <input
                                            type="text"
                                            value={billingForm.paymentId}
                                            onChange={(event) => onChangeBillingForm('paymentId', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="pay-0001"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-medium text-gray-700">Occurred at</span>
                                        <input
                                            type="datetime-local"
                                            value={billingForm.occurredAt}
                                            onChange={(event) => onChangeBillingForm('occurredAt', event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>
                                    <label className="block md:col-span-3">
                                        <span className="text-xs font-medium text-gray-700">Note</span>
                                        <textarea
                                            value={billingForm.note}
                                            onChange={(event) => onChangeBillingForm('note', event.target.value)}
                                            className="mt-1 min-h-[88px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="Additional billing context"
                                        />
                                    </label>
                                </div>

                                <div className="mt-3 flex items-center justify-end">
                                    <button
                                        type="button"
                                        onClick={onAddBillingRecord}
                                        disabled={billingSubmitting || billingLoading}
                                        className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {billingSubmitting ? 'Adding...' : 'Add Billing Event'}
                                    </button>
                                </div>
                            </div>

                            {billingError && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{billingError}</p>
                            )}
                        </section>
        </>
    )
}
