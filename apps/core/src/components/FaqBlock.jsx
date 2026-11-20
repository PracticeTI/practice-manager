'use client'

import { useState } from 'react'
import { resolveBlockAnchorId } from '@/lib/blockAnchors'

export default function FaqBlock({ blockId, slug = '', heading, items = [] }) {
    const validItems = items.filter((item) => {
        return String(item?.question || '').trim() || String(item?.answer || '').trim()
    })

    if (validItems.length === 0) return null

    const sectionId = resolveBlockAnchorId({ slug, blockId })

    return (
        <section id={sectionId} className="space-y-5">
            {heading ? (
                <h3 className="text-xl font-semibold text-gray-900">{heading}</h3>
            ) : null}
            <dl className="space-y-2">
                {validItems.map((item, index) => (
                    <FaqItem
                        key={`${blockId}-faq-${index}`}
                        number={index + 1}
                        question={item.question}
                        answer={item.answer}
                    />
                ))}
            </dl>
        </section>
    )
}

function FaqItem({ number, question, answer }) {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <div
            className={[
                'rounded-lg border-l-4 transition-colors duration-200',
                isOpen
                    ? 'border-sky-400 bg-sky-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
            ].join(' ')}
        >
            <dt>
                <button
                    type="button"
                    onClick={() => setIsOpen((prev) => !prev)}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left"
                    aria-expanded={isOpen}
                >
                    <span
                        className={[
                            'flex-shrink-0 w-6 text-right text-xs font-semibold tabular-nums transition-colors duration-200',
                            isOpen ? 'text-sky-500' : 'text-gray-400'
                        ].join(' ')}
                        aria-hidden="true"
                    >
                        {String(number).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-base font-medium text-gray-900">{question}</span>
                    <span
                        className={[
                            'flex-shrink-0 transition-all duration-200',
                            isOpen ? 'text-sky-400 rotate-180' : 'text-gray-400 rotate-0'
                        ].join(' ')}
                        aria-hidden="true"
                    >
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </span>
                </button>
            </dt>
            <div
                className="grid transition-all duration-300 ease-in-out"
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
                <dd className="overflow-hidden">
                    <p className="px-4 pb-4 pl-14 text-sm text-gray-600 leading-relaxed">
                        {answer}
                    </p>
                </dd>
            </div>
        </div>
    )
}
