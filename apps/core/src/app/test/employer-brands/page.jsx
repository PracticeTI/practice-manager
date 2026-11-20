import EmployerBrandsBlock from '@/components/EmployerBrandsBlock'

export const metadata = {
    title: 'Employer Brands Block Test',
}

export default function EmployerBrandsTestPage() {
    return (
        <div className="min-h-screen bg-white">
            {/* Top spacer */}
            <div className="h-32" />

            {/* Test content */}
            <div className="px-4 sm:px-6 lg:px-8">
                <EmployerBrandsBlock
                    blockId="test-employer-brands"
                    heading="Previously at"
                />
            </div>

            {/* Bottom spacer */}
            <div className="h-32" />

            {/* Subtle footer info */}
            <div className="border-t border-gray-200 bg-gray-50 py-8 px-4 text-center text-sm text-gray-600">
                <p>EmployerBrandsBlock Component Test</p>
            </div>
        </div>
    )
}
