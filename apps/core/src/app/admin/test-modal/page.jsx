'use client'

import { useEffect, useState } from 'react'
import ContentModal from '@/admin-ui/components/ContentModal'

export default function TestModalPage() {
    const [isOpen, setIsOpen] = useState(false)
    const [selectedItem, setSelectedItem] = useState(null)

    useEffect(() => {
        document.title = 'Test Modal'
    }, [])

    const postSample = {
        id: '2',
        type: 'post',
        title: 'Top 10 Brooklyn Filming Locations',
        slug: 'brooklyn-filming-locations',
        status: 'draft',
        preview: 'A guide to popular NYC filming spots',
        attributes: {}
    }

    const postTypeConfig = {
        id: 'post',
        label: 'Post',
        icon: '📝',
        domain: 'core',
        attributes: []
    }

    const handleOpen = (item, typeConfig) => {
        setSelectedItem({ item, typeConfig })
        setIsOpen(true)
    }

    const handleChange = (field, value) => {
        setSelectedItem(prev => ({
            ...prev,
            item: {
                ...prev.item,
                [field]: value
            }
        }))
    }

    const handleAttributeChange = (field, value) => {
        setSelectedItem(prev => ({
            ...prev,
            item: {
                ...prev.item,
                attributes: {
                    ...prev.item.attributes,
                    [field]: value
                }
            }
        }))
    }

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-8">ContentModal Test</h1>

            <div className="space-y-4">
                <div className="border border-gray-300 p-6 rounded-lg">
                    <h2 className="text-xl font-semibold mb-4">Core Domain (Post)</h2>
                    <p className="text-gray-600 mb-4">
                        Shows basic fields only (no type-specific attributes)
                    </p>
                    <button
                        onClick={() => handleOpen(postSample, postTypeConfig)}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                    >
                        Open Post Modal
                    </button>
                </div>
            </div>

            {/* Modal */}
            {selectedItem && (
                <ContentModal
                    isOpen={isOpen}
                    item={selectedItem.item}
                    typeConfig={selectedItem.typeConfig}
                    domain={selectedItem.typeConfig.domain}
                    isReadOnly={false}
                    onChange={handleChange}
                    onSave={() => {
                        console.log('Saved:', selectedItem.item)
                        setIsOpen(false)
                    }}
                    onClose={() => setIsOpen(false)}
                    isSaving={false}
                    error={null}
                />
            )}

            {/* Debug: Show modal state */}
            <div className="mt-8 p-4 bg-gray-100 rounded-lg">
                <h3 className="font-semibold mb-2">Modal State (Debug)</h3>
                <pre className="text-xs bg-white p-3 rounded overflow-auto">
                    {JSON.stringify(
                        {
                            isOpen,
                            selectedItem: selectedItem ? {
                                item: selectedItem.item,
                                typeConfig: selectedItem.typeConfig
                            } : null
                        },
                        null,
                        2
                    )}
                </pre>
            </div>
        </div>
    )
}
