import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..')

const CONTENT_TYPE_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}
const DISABLE_LOCAL_IMAGE_LOOKUP = process.env.VERCEL === '1' || process.env.VERCEL === 'true'

function resolveFolder(category) {
  const normalized = String(category || '').toLowerCase()
  if (normalized === 'actor' || normalized === 'actors') return 'actors'
  if (normalized === 'company' || normalized === 'companies') return 'companies'
  if (normalized === 'key_art' || normalized === 'key-art') return 'key_art'
  if (normalized === 'general') return 'general'
  return null
}

export async function GET(request) {
  try {
    if (DISABLE_LOCAL_IMAGE_LOOKUP) {
      return NextResponse.json(
        { success: false, error: 'Local image lookup is unavailable in serverless runtime' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const fileParam = searchParams.get('file')

    if (!category || !fileParam) {
      return NextResponse.json(
        { success: false, error: 'category and file are required' },
        { status: 400 }
      )
    }

    const folder = resolveFolder(category)
    if (!folder) {
      return NextResponse.json(
        { success: false, error: 'Unsupported category' },
        { status: 400 }
      )
    }

    const safeFile = path.basename(fileParam)
    const normalizedCategory = String(category || '').toLowerCase().replace(/-/g, '_')
    const isKeyArtCategory = normalizedCategory === 'key_art' || normalizedCategory === 'general'
    const basePaths = isKeyArtCategory ? ['media'] : ['content', 'media']
    const folderCandidates = folder === 'key_art' || folder === 'general'
      ? ['key_art', 'general']
      : [folder]

    let buffer
    let foundFile = null

    // Try exact match first
    for (const basePath of basePaths) {
      for (const folderName of folderCandidates) {
        const filePath = path.join(PROJECT_ROOT, basePath, folderName, safeFile)
        try {
          buffer = await fs.readFile(filePath)
          foundFile = safeFile
          break
        } catch (error) {
          // Try next location
        }
      }
      if (buffer) {
        break
      }
    }

    // If exact match not found, try fuzzy matching
    if (!buffer) {
      const searchTerm = path.parse(safeFile).name.toLowerCase() // Remove extension from search term

      for (const basePath of basePaths) {
        for (const folderName of folderCandidates) {
          const dirPath = path.join(PROJECT_ROOT, basePath, folderName)
          try {
            const files = await fs.readdir(dirPath)
            // Find files that contain the search term
            const matchingFile = files.find(file => {
              const fileNameWithoutExt = path.parse(file).name.toLowerCase()
              return fileNameWithoutExt.includes(searchTerm) || searchTerm.includes(fileNameWithoutExt)
            })

            if (matchingFile) {
              const filePath = path.join(dirPath, matchingFile)
              buffer = await fs.readFile(filePath)
              foundFile = matchingFile
              break
            }
          } catch (error) {
            // Try next location
          }
        }
        if (buffer) {
          break
        }
      }
    }

    if (!buffer) {
      return NextResponse.json(
        { success: false, error: 'Image not found' },
        { status: 404 }
      )
    }

    const ext = path.extname(foundFile || safeFile).toLowerCase()
    const contentType = CONTENT_TYPE_MAP[ext] || 'application/octet-stream'

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Image not found' },
      { status: 404 }
    )
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
