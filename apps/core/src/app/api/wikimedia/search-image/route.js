import { NextResponse } from 'next/server'

/**
 * Search Wikimedia Commons for person/actor images
 * GET /api/wikimedia/search-image?name=ActorName
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')
    const category = searchParams.get('category') || 'actor'
    const service = (searchParams.get('service') || 'wikimedia').toLowerCase()
    const thumbWidthParam = searchParams.get('thumbWidth')
    const parsedThumbWidth = Number.parseInt(thumbWidthParam || '', 10)
    const thumbWidth = Number.isFinite(parsedThumbWidth) && parsedThumbWidth > 0
      ? parsedThumbWidth
      : 300

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Name parameter is required' },
        { status: 400 }
      )
    }

    if (service === 'brave') {
      const braveResults = await searchBraveImages(name, category)
      return NextResponse.json({
        success: true,
        images: braveResults,
        count: braveResults.length,
        query: name,
        provider: 'brave'
      })
    }

    // Build search query based on category
    let searchQuery = name
    if (category === 'actor') {
      searchQuery = `${name} actor`
    } else if (category === 'producer') {
      searchQuery = `${name} producer`
    } else if (category === 'company') {
      searchQuery = `${name} production company logo`
    } else if (category === 'key_art') {
      searchQuery = `${name} movie poster film still`
    }

    // Search Wikimedia Commons using the MediaWiki API
    // Use a simpler search that looks for files directly
    const searchUrl = new URL('https://commons.wikimedia.org/w/api.php')
    searchUrl.searchParams.set('action', 'query')
    searchUrl.searchParams.set('format', 'json')
    searchUrl.searchParams.set('list', 'search')
    searchUrl.searchParams.set('srsearch', searchQuery)
    searchUrl.searchParams.set('srnamespace', '6') // File namespace
    searchUrl.searchParams.set('srlimit', '10')
    searchUrl.searchParams.set('origin', '*')

    console.log('Searching Wikimedia for:', name)
    console.log('Search URL:', searchUrl.toString())

    const response = await fetch(searchUrl.toString())

    if (!response.ok) {
      throw new Error(`Wikimedia API responded with status: ${response.status}`)
    }

    const data = await response.json()
    console.log('Wikimedia response:', JSON.stringify(data, null, 2))

    if (!data.query || !data.query.search || data.query.search.length === 0) {
      return NextResponse.json({
        success: true,
        images: [],
        message: 'No images found',
        debug: { query: data.query }
      })
    }

    // Get image info for the found files
    const titles = data.query.search.slice(0, 5).map(item => item.title).join('|')

    const infoUrl = new URL('https://commons.wikimedia.org/w/api.php')
    infoUrl.searchParams.set('action', 'query')
    infoUrl.searchParams.set('format', 'json')
    infoUrl.searchParams.set('titles', titles)
    infoUrl.searchParams.set('prop', 'imageinfo')
    infoUrl.searchParams.set('iiprop', 'url|size|mime')
    infoUrl.searchParams.set('iiurlwidth', String(thumbWidth))
    infoUrl.searchParams.set('origin', '*')

    const infoResponse = await fetch(infoUrl.toString())
    const infoData = await infoResponse.json()

    console.log('Image info response:', JSON.stringify(infoData, null, 2))

    if (!infoData.query || !infoData.query.pages) {
      return NextResponse.json({
        success: true,
        images: [],
        message: 'No image details found'
      })
    }

    // Extract image URLs from the response
    const images = Object.values(infoData.query.pages)
      .filter(page => page.imageinfo && page.imageinfo.length > 0)
      .map(page => {
        const info = page.imageinfo[0]
        return {
          url: info.thumburl || info.url,
          width: info.thumbwidth || info.width,
          height: info.thumbheight || info.height,
          title: page.title,
          pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
          mime: info.mime
        }
      })
      .filter(img => img.mime && img.mime.startsWith('image/'))

    return NextResponse.json({
      success: true,
      images,
      count: images.length,
      query: name,
      provider: 'wikimedia'
    })
  } catch (error) {
    console.error('Wikimedia search error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

async function searchBraveImages(name, category = 'company') {
  const apiKey = process.env.BRAVE_API_KEY

  if (!apiKey) {
    throw new Error('Brave API not configured. Please set BRAVE_API_KEY.')
  }

  const normalizedCategory = String(category || '').trim().toLowerCase()
  const query = normalizedCategory === 'key_art'
    ? `${name} movie poster film still`
    : `${name} production company logo`
  const url = new URL('https://api.search.brave.com/res/v1/images/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '12')
  url.searchParams.set('search_lang', 'en')
  url.searchParams.set('safesearch', 'off')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    let errorText = `Brave API error (${response.status})`
    try {
      const errorData = await response.json()
      if (typeof errorData?.error?.detail === 'string') {
        errorText = errorData.error.detail
      } else if (typeof errorData?.message === 'string') {
        errorText = errorData.message
      }
    } catch {
      // Keep fallback error message.
    }
    throw new Error(errorText)
  }

  const data = await response.json()
  const results = Array.isArray(data?.results) ? data.results : []

  return results
    .map((result) => ({
      url: result?.properties?.url || result?.url || null,
      width: result?.properties?.width || null,
      height: result?.properties?.height || null,
      title: result?.title || result?.description || 'Untitled',
      pageUrl: result?.url || result?.source || null,
      mime: result?.properties?.format || null,
      provider: 'brave'
    }))
    .filter((image) => typeof image.url === 'string' && image.url.length > 0)
    .slice(0, 10)
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
