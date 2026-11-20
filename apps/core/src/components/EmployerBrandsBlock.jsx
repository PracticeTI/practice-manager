'use client'

import Image from 'next/image'

const EMPLOYERS = [
    { id: 'asana', name: 'Asana', logo: '/employers/asana.png' },
    { id: 'fairfax', name: 'Fairfax', logo: '/employers/fairfax.png' },
    { id: 'linkedin', name: 'LinkedIn', logo: '/employers/linkedin.png' },
    { id: 'slackforce', name: 'Slack / Salesforce', logo: '/employers/slackforce.png' },
    { id: 'thryv', name: 'Thryv', logo: '/employers/thryv.png' },
    { id: 'webcentral', name: 'WebCentral', logo: '/employers/webcentral.png' },
]

export default function EmployerBrandsBlock({ blockId = 'employer-brands', heading = 'Previously at' }) {
    // Duplicate logos for seamless ticker loop
    const tickerLogos = [...EMPLOYERS, ...EMPLOYERS]

    return (
        <section id={blockId} className="py-8">
            {heading && (
                <h3 className="mb-8 text-center text-lg font-semibold text-gray-900">
                    {heading}
                </h3>
            )}

            {/* Ticker container */}
            <div className="mx-auto max-w-6xl">
                <div className="overflow-hidden bg-gray-50 rounded-lg py-8 px-4">
                    {/* Scrolling ticker with very slow animation */}
                    <style>{`
                        @keyframes slowScroll {
                            0% {
                                transform: translateX(0);
                            }
                            100% {
                                transform: translateX(-50%);
                            }
                        }
                        .ticker-scroll {
                            animation: slowScroll 15s linear infinite;
                        }
                        .ticker-logo {
                            filter: brightness(0.88) saturate(0.85) contrast(0.98);
                            transition: filter 0.3s ease;
                            opacity: 0.85;
                        }
                        .ticker-logo:hover {
                            filter: brightness(1) saturate(1) contrast(1);
                            opacity: 1;
                        }
                    `}</style>

                    <div className="ticker-scroll flex gap-12">
                        {tickerLogos.map((employer, index) => (
                            <div
                                key={`${employer.id}-${index}`}
                                className="flex min-w-max items-center justify-center px-6"
                            >
                                <div className={`ticker-logo relative ${employer.id === 'slackforce' ? 'h-14 w-64' :
                                    employer.id === 'linkedin' ? 'h-12 w-36 scale-75' :
                                        employer.id === 'asana' ? 'h-12 w-36 scale-90' :
                                            employer.id === 'thryv' ? 'h-12 w-36 scale-90' :
                                                'h-14 w-44'
                                    }`}>
                                    <Image
                                        src={employer.logo}
                                        alt={employer.name}
                                        fill
                                        className="object-contain object-center"
                                        priority={false}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
}
