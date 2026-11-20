import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

function resolveManifestPath(category) {
  const normalized = String(category || '').toLowerCase()
  if (normalized === 'company' || normalized === 'companies') {
    return path.join(process.cwd(), 'media', 'companies', 'manifest.json')
  }
  if (normalized === 'actor' || normalized === 'actors') {
    return path.join(process.cwd(), 'media', 'actors', 'manifest.json')
  }
  if (normalized === 'key_art' || normalized === 'key-art') {
    return path.join(process.cwd(), 'media', 'key_art', 'manifest.json')
  }
  if (normalized === 'general') {
    return path.join(process.cwd(), 'media', 'general', 'manifest.json')
  }
  return null
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || 'companies'

    const manifestPath = resolveManifestPath(category)
    if (!manifestPath) {
      return NextResponse.json(
        { success: false, error: 'Unsupported category' },
        { status: 400 }
      )
    }

    let resolvedManifestPath = manifestPath
    try {
      await fs.access(resolvedManifestPath)
    } catch {
      const normalized = String(category || '').toLowerCase().replace(/-/g, '_')
      if (normalized === 'key_art') {
        const legacyPath = resolveManifestPath('general')
        if (legacyPath) {
          await fs.access(legacyPath)
          resolvedManifestPath = legacyPath
        }
      } else {
        throw new Error('Manifest not found')
      }
    }

    const content = await fs.readFile(resolvedManifestPath, 'utf8')
    const data = JSON.parse(content)

    return NextResponse.json({
      success: true,
      category,
      images: Array.isArray(data?.images) ? data.images : [],
      lastUpdated: data?.lastUpdated || null
    })
  } catch (error) {
    return NextResponse.json({
      success: true,
      category: 'companies',
      images: [],
      lastUpdated: null
    })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
