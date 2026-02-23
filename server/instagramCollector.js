import { INSTAGRAM_SELECTORS, INSTAGRAM_SELECTOR_VERSION } from './instagramSelectors.js'

const INSTAGRAM_BASE_URL = 'https://www.instagram.com'

const normalizeText = (value, maxLength = 300) => {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, maxLength))
}

const normalizeInstagramHandle = (value) => {
  const normalized = normalizeText(value, 120)
  if (!normalized) return ''
  const handleFromMention = normalized.match(/@([a-z0-9._]+)/i)?.[1] || ''
  const candidate = handleFromMention || normalized.replace(/^@+/, '')
  return candidate.toLowerCase().replace(/[^a-z0-9._]/g, '')
}

const createCollectorError = (code, message = '') => {
  const error = new Error(message || code)
  error.code = code
  return error
}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseCompactNumber = (value) => {
  const text = normalizeText(value, 80).toLowerCase().replace(/,/g, '')
  if (!text) return 0
  const match = text.match(/(-?\d+(?:\.\d+)?)([kmb])?/)
  if (!match) return 0
  const base = toNumber(match[1])
  const suffix = match[2] || ''
  if (!suffix) return Math.round(base)
  if (suffix === 'k') return Math.round(base * 1_000)
  if (suffix === 'm') return Math.round(base * 1_000_000)
  if (suffix === 'b') return Math.round(base * 1_000_000_000)
  return Math.round(base)
}

const parseDate = (value) => {
  const text = normalizeText(value, 80)
  if (!text) return ''
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toISOString()
}

const parseMetricValueByLabel = (rows, labelMatcher) => {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const label = normalizeText(row.label, 80).toLowerCase()
    if (!labelMatcher(label)) continue
    const value = parseCompactNumber(row.value)
    if (value > 0) return value
  }
  return 0
}

const parseNumbersFromText = (value) => {
  const text = normalizeText(value, 400).toLowerCase().replace(/,/g, '')
  if (!text) return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reposts: 0 }
  const viewsMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+views?/)
  const likesMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+likes?/)
  const commentsMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+comments?/)
  const sharesMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+shares?/)
  const savesMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+saves?/)
  const repostsMatch = text.match(/(-?\d+(?:\.\d+)?\s*[kmb]?)\s+(?:reposts?|reshares?)/)
  return {
    views: viewsMatch ? parseCompactNumber(viewsMatch[1]) : 0,
    likes: likesMatch ? parseCompactNumber(likesMatch[1]) : 0,
    comments: commentsMatch ? parseCompactNumber(commentsMatch[1]) : 0,
    shares: sharesMatch ? parseCompactNumber(sharesMatch[1]) : 0,
    saves: savesMatch ? parseCompactNumber(savesMatch[1]) : 0,
    reposts: repostsMatch ? parseCompactNumber(repostsMatch[1]) : 0,
  }
}

const sanitizeCookie = (cookie) => {
  if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) return null
  const name = normalizeText(cookie.name, 120)
  const value = normalizeText(cookie.value, 5000)
  const domain = normalizeText(cookie.domain, 180)
  if (!name || !value || !domain) return null
  const sameSiteRaw = normalizeText(cookie.sameSite, 24).toLowerCase()
  const sameSite =
    sameSiteRaw === 'strict'
      ? 'Strict'
      : sameSiteRaw === 'none'
        ? 'None'
        : 'Lax'
  const expires = Number.isFinite(cookie.expires) ? Number(cookie.expires) : -1
  return {
    name,
    value,
    domain,
    path: normalizeText(cookie.path, 120) || '/',
    expires,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite,
  }
}

const resolveInstagramCredentials = (credentials) => {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    return { username: '', password: '' }
  }
  const passwordRaw = typeof credentials.password === 'string' ? credentials.password : ''
  return {
    username: normalizeText(credentials.username, 180),
    password: passwordRaw.slice(0, 240),
  }
}

const isLoginRequiredState = ({ currentUrl = '', pageState = null } = {}) =>
  currentUrl.includes('/accounts/login') || Boolean(pageState?.loginRequired)

const dismissInstagramLoginInterrupts = async (page) => {
  const selectors = [
    'button:has-text("Only allow essential cookies")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Allow essential and optional cookies")',
    'button:has-text("Allow optional cookies")',
    'button:has-text("Not now")',
    'button:has-text("Not Now")',
  ]
  for (const selector of selectors) {
    const candidate = page.locator(selector).first()
    try {
      if (await candidate.isVisible({ timeout: 900 })) {
        await candidate.click({ timeout: 1500 })
        await page.waitForTimeout(200)
      }
    } catch {
      // Ignore UI variants and stale elements.
    }
  }
}

const authenticateInstagramSession = async ({
  page,
  timeoutMs,
  credentials,
}) => {
  const resolvedCredentials = resolveInstagramCredentials(credentials)
  if (!resolvedCredentials.username || !resolvedCredentials.password) {
    return { authenticatedByCredentials: false }
  }

  await page.goto(`${INSTAGRAM_BASE_URL}/accounts/login/`, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  })
  await page.waitForTimeout(900)
  await dismissInstagramLoginInterrupts(page)

  let currentUrl = page.url()
  let pageState = await readPageState(page)
  if (currentUrl.includes('/challenge/') || pageState.challengeRequired) {
    throw createCollectorError('instagram_challenge_required', 'Instagram challenge is required.')
  }
  if (pageState.rateLimited) {
    throw createCollectorError('instagram_rate_limited', 'Instagram rate-limited this request.')
  }
  if (!isLoginRequiredState({ currentUrl, pageState })) {
    return { authenticatedByCredentials: false }
  }

  const usernameField = page.locator('input[name="username"]').first()
  const passwordField = page.locator('input[name="password"]').first()
  await usernameField.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 15_000) })
  await usernameField.fill(resolvedCredentials.username)
  await passwordField.fill(resolvedCredentials.password)

  const submitButton = page.locator('button[type="submit"]').first()
  let submitted = false
  try {
    await submitButton.click({ timeout: 4_000 })
    submitted = true
  } catch {
    // Fall through to keyboard submit.
  }
  if (!submitted) {
    try {
      await passwordField.press('Enter', { timeout: 4_000 })
      submitted = true
    } catch {
      // Fall through to auth error below.
    }
  }
  if (!submitted) {
    throw createCollectorError('instagram_auth_required', 'Instagram login form submission failed.')
  }

  await page.waitForTimeout(2_400)
  await dismissInstagramLoginInterrupts(page)
  currentUrl = page.url()
  pageState = await readPageState(page)
  if (currentUrl.includes('/challenge/') || pageState.challengeRequired) {
    throw createCollectorError('instagram_challenge_required', 'Instagram challenge is required.')
  }
  if (pageState.rateLimited) {
    throw createCollectorError('instagram_rate_limited', 'Instagram rate-limited this request.')
  }
  if (isLoginRequiredState({ currentUrl, pageState })) {
    throw createCollectorError('instagram_auth_required', 'Instagram credentials were rejected.')
  }
  return { authenticatedByCredentials: true }
}

const loadPlaywrightChromium = async () => {
  try {
    const playwright = await import('playwright')
    if (playwright?.chromium) return playwright.chromium
  } catch {
    // Fall through to playwright-core.
  }
  try {
    const playwrightCore = await import('playwright-core')
    if (playwrightCore?.chromium) return playwrightCore.chromium
  } catch {
    // Ignored.
  }
  return null
}

const classifyCollectorException = (error) => {
  const code = normalizeText(error?.code || error?.message || '', 120).toLowerCase()
  if (!code) return 'collection_failed'
  if (code.includes('playwright_not_installed')) return 'collector_unavailable'
  if (code.includes('challenge')) return 'challenge_required'
  if (code.includes('auth_required')) return 'auth_required'
  if (code.includes('rate_limited')) return 'rate_limited'
  if (code.includes('timeout')) return 'timeout'
  if (code.includes('ui_changed')) return 'ui_changed'
  if (code.includes('net::') || code.includes('network')) return 'temporary_network'
  return 'collection_failed'
}

const readPageState = async (page) =>
  page.evaluate((selectors) => {
    const normalize = (value, maxLength = 300) =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, maxLength)) : ''
    const bodyText = normalize(document.body?.innerText || '', 2000).toLowerCase()
    const loginRequired = selectors.loginStateSentinels.some((selector) => document.querySelector(selector))
    const challengeRequired = selectors.challengeSentinels.some((selector) => document.querySelector(selector))
    const rateLimited = selectors.rateLimitTextPatterns.some((pattern) => bodyText.includes(pattern.toLowerCase()))
    return {
      loginRequired,
      challengeRequired,
      rateLimited,
      bodyText,
    }
  }, INSTAGRAM_SELECTORS)

export const collectInstagramMetricsWithPlaywright = async ({
  accountHandle,
  accountName = '',
  cookies = [],
  credentials = null,
  maxPosts = 12,
  timeoutMs = 45_000,
} = {}) => {
  const normalizedHandle = normalizeInstagramHandle(accountHandle || accountName)
  if (!normalizedHandle) {
    throw new Error('invalid_instagram_account_handle')
  }

  const chromium = await loadPlaywrightChromium()
  if (!chromium) {
    throw createCollectorError('playwright_not_installed', 'Playwright is not installed in this runtime.')
  }

  const contextCookies = Array.isArray(cookies)
    ? cookies.map((cookie) => sanitizeCookie(cookie)).filter((cookie) => Boolean(cookie))
    : []
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  })

  try {
    if (contextCookies.length) {
      await context.addCookies(contextCookies)
    }

    const page = await context.newPage()
    await authenticateInstagramSession({
      page,
      timeoutMs,
      credentials,
    })
    await page.goto(`${INSTAGRAM_BASE_URL}/${encodeURIComponent(normalizedHandle)}/`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })

    const currentUrl = page.url()
    const pageState = await readPageState(page)
    if (isLoginRequiredState({ currentUrl, pageState })) {
      throw createCollectorError('instagram_auth_required', 'Instagram session is not authenticated.')
    }
    if (currentUrl.includes('/challenge/') || pageState.challengeRequired) {
      throw createCollectorError('instagram_challenge_required', 'Instagram challenge is required.')
    }
    if (pageState.rateLimited) {
      throw createCollectorError('instagram_rate_limited', 'Instagram rate-limited this request.')
    }

    await page.waitForTimeout(1200)
    const profile = await page.evaluate((selectors) => {
      const normalize = (value, maxLength = 240) =>
        typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, maxLength)) : ''
      const metricRowSet = new Set()
      selectors.profileMetricRows.forEach((selector) => {
        if (typeof selector !== 'string' || !selector.trim()) return
        document.querySelectorAll(selector).forEach((row) => metricRowSet.add(row))
      })
      const rows = Array.from(metricRowSet).map((row) => {
        const ariaLabel = normalize(row.getAttribute('aria-label') || '', 120).toLowerCase()
        if (ariaLabel.includes('followers')) {
          return { label: 'followers', value: ariaLabel }
        }
        if (ariaLabel.includes('following')) {
          return { label: 'following', value: ariaLabel }
        }
        if (ariaLabel.includes('posts')) {
          return { label: 'posts', value: ariaLabel }
        }
        const titleElement = row.querySelector('a span[title], span[title], div[title]')
        const titleText = normalize(titleElement?.getAttribute('title') || '', 120)
        const rowText = normalize(row.textContent || '', 200).toLowerCase()
        if (rowText.includes('followers')) {
          return { label: 'followers', value: titleText || rowText }
        }
        if (rowText.includes('following')) {
          return { label: 'following', value: titleText || rowText }
        }
        if (rowText.includes('posts')) {
          return { label: 'posts', value: titleText || rowText }
        }
        return { label: '', value: '' }
      })
      const postLinks = Array.from(
        new Set(
          selectors.postLinks
            .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
            .map((anchor) => {
              const href = anchor.getAttribute('href') || ''
              if (!href) return ''
              try {
                return new URL(href, window.location.origin).toString()
              } catch {
                return ''
              }
            })
            .filter((href) => Boolean(href)),
        ),
      )
      const headerTitle = (() => {
        for (const selector of selectors.profileHeaderTitle) {
          const candidate = normalize(document.querySelector(selector)?.textContent || '', 200)
          if (candidate) return candidate
        }
        return ''
      })()
      return {
        rows,
        postLinks,
        displayName: headerTitle.replace(/\s*\(.*?\)\s*$/g, '').trim(),
      }
    }, INSTAGRAM_SELECTORS)

    const hasProfileStructure = await page.evaluate((selectors) => {
      const hasRows = selectors.profileMetricRows.some((selector) => document.querySelector(selector))
      const hasTitle = selectors.profileHeaderTitle.some((selector) => document.querySelector(selector))
      const hasPosts = selectors.postLinks.some((selector) => document.querySelector(selector))
      return hasRows || hasTitle || hasPosts
    }, INSTAGRAM_SELECTORS)
    if (!hasProfileStructure) {
      throw createCollectorError('instagram_ui_changed', 'Instagram profile selectors returned no content.')
    }

    const followers = parseMetricValueByLabel(profile.rows, (label) => label.includes('follower'))
    const postsCount = parseMetricValueByLabel(profile.rows, (label) => label.includes('post'))
    const collectedPosts = []
    const sanitizedMaxPosts = Math.max(1, Math.min(50, toNumber(maxPosts) || 12))
    const candidateLimit = Math.max(
      sanitizedMaxPosts,
      Math.min(100, Math.max(sanitizedMaxPosts * 4, sanitizedMaxPosts + 8)),
    )
    const uniqueLinks = Array.isArray(profile.postLinks) ? profile.postLinks.slice(0, candidateLimit) : []

    for (const postUrl of uniqueLinks) {
      const postPage = await context.newPage()
      try {
        await postPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        await postPage.waitForTimeout(600)
        const postState = await readPageState(postPage)
        if (postState.challengeRequired) {
          throw createCollectorError('instagram_challenge_required', 'Instagram challenge was encountered while loading a post.')
        }
        if (postState.loginRequired) {
          throw createCollectorError('instagram_auth_required', 'Instagram session became unauthenticated while loading a post.')
        }
        if (postState.rateLimited) {
          throw createCollectorError('instagram_rate_limited', 'Instagram rate-limited post scraping.')
        }

        const parsedPost = await postPage.evaluate(() => {
          const normalize = (value, maxLength = 300) =>
            typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, maxLength)) : ''
          const postId = (() => {
            const match = window.location.pathname.match(/\/(?:p|reel)\/([^/]+)/)
            return match?.[1] ? normalize(match[1], 80) : ''
          })()
          const title = normalize(
            document.querySelector('meta[property="og:title"]')?.getAttribute('content')
              || document.querySelector('title')?.textContent
              || '',
            280,
          )
          const description = normalize(
            document.querySelector('meta[property="og:description"]')?.getAttribute('content')
              || '',
            600,
          )
          const caption = normalize(
            document.querySelector('meta[property="og:title"]')?.getAttribute('content')
              || '',
            600,
          )
          const publishedAt = normalize(
            document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
              || document.querySelector('time')?.getAttribute('datetime')
              || '',
            80,
          )

          let ldLikes = 0
          let ldComments = 0
          let ldViews = 0
          let ldShares = 0
          let ldSaves = 0
          let ldReposts = 0
          try {
            const ldRaw = document.querySelector('script[type="application/ld+json"]')?.textContent || ''
            if (ldRaw) {
              const parsed = JSON.parse(ldRaw)
              const interactions = Array.isArray(parsed?.interactionStatistic)
                ? parsed.interactionStatistic
                : [parsed?.interactionStatistic]
              for (const interaction of interactions) {
                const type = normalize(interaction?.interactionType?.['@type'] || interaction?.interactionType || '', 80).toLowerCase()
                const value = Number(interaction?.userInteractionCount)
                if (!Number.isFinite(value)) continue
                if (type.includes('like')) ldLikes = Math.max(ldLikes, value)
                if (type.includes('comment')) ldComments = Math.max(ldComments, value)
                if (type.includes('watch') || type.includes('view')) ldViews = Math.max(ldViews, value)
                if (type.includes('share')) ldShares = Math.max(ldShares, value)
                if (type.includes('save')) ldSaves = Math.max(ldSaves, value)
                if (type.includes('repost') || type.includes('reshare')) ldReposts = Math.max(ldReposts, value)
              }
            }
          } catch {
            // Ignore malformed JSON-LD.
          }

          const readMetricFromInlineJson = (keys) => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script[type="text/javascript"]'))
              .map((node) => normalize(node?.textContent || '', 600_000))
              .filter((entry) => entry.length > 0)
            let maxValue = 0
            for (const raw of scripts) {
              for (const key of keys) {
                if (!key) continue
                const regex = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'gi')
                let match = regex.exec(raw)
                while (match) {
                  const parsedValue = Number(match[1])
                  if (Number.isFinite(parsedValue)) {
                    maxValue = Math.max(maxValue, parsedValue)
                  }
                  match = regex.exec(raw)
                }
              }
            }
            return maxValue
          }

          const readNestedCountFromInlineJson = (keys) => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script[type="text/javascript"]'))
              .map((node) => normalize(node?.textContent || '', 600_000))
              .filter((entry) => entry.length > 0)
            let maxValue = 0
            for (const raw of scripts) {
              for (const key of keys) {
                if (!key) continue
                const regex = new RegExp(`"${key}"\\s*:\\s*\\{[^{}]{0,240}?"count"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'gi')
                let match = regex.exec(raw)
                while (match) {
                  const parsedValue = Number(match[1])
                  if (Number.isFinite(parsedValue)) {
                    maxValue = Math.max(maxValue, parsedValue)
                  }
                  match = regex.exec(raw)
                }
              }
            }
            return maxValue
          }

          const jsonLikes = Math.max(
            readMetricFromInlineJson(['like_count', 'edge_liked_by_count']),
            readNestedCountFromInlineJson(['edge_media_preview_like', 'edge_liked_by']),
          )
          const jsonComments = Math.max(
            readMetricFromInlineJson(['comment_count', 'edge_media_to_comment_count']),
            readNestedCountFromInlineJson(['edge_media_to_comment']),
          )
          const jsonViews = readMetricFromInlineJson(['video_view_count', 'play_count', 'view_count'])
          const jsonShares = readMetricFromInlineJson(['share_count', 'ig_share_count'])
          const jsonSaves = readMetricFromInlineJson(['save_count'])
          const jsonReposts = readMetricFromInlineJson(['repost_count', 'reshare_count', 'reel_reshare_count'])

          return {
            postId,
            title,
            description,
            caption,
            publishedAt,
            likes: Math.max(ldLikes, jsonLikes),
            comments: Math.max(ldComments, jsonComments),
            views: Math.max(ldViews, jsonViews),
            shares: Math.max(ldShares, jsonShares),
            saves: Math.max(ldSaves, jsonSaves),
            reposts: Math.max(ldReposts, jsonReposts),
          }
        })

        const parsedByText = parseNumbersFromText(`${parsedPost.description} ${parsedPost.caption}`)
        const likes = Math.max(parsedPost.likes || 0, parsedByText.likes)
        const comments = Math.max(parsedPost.comments || 0, parsedByText.comments)
        const views = Math.max(parsedPost.views || 0, parsedByText.views)
        const shares = Math.max(parsedPost.shares || 0, parsedByText.shares)
        const saves = Math.max(parsedPost.saves || 0, parsedByText.saves)
        const reposts = Math.max(parsedPost.reposts || 0, parsedByText.reposts)
        const postId = normalizeText(parsedPost.postId, 80)
        if (!postId) continue

        collectedPosts.push({
          id: postId,
          url: postUrl,
          title: normalizeText(parsedPost.title, 280) || 'Instagram post',
          publishedAt: parseDate(parsedPost.publishedAt),
          views,
          likes,
          comments,
          saves,
          shares,
          reposts,
          engagements: likes + comments + saves + shares + reposts,
        })
      } finally {
        await postPage.close().catch(() => null)
      }
    }

    const toIsoTime = (value) => {
      const parsed = Date.parse(normalizeText(value, 64))
      return Number.isFinite(parsed) ? parsed : 0
    }
    const recentPosts = collectedPosts
      .sort((left, right) => {
        const byPublishedAt = toIsoTime(right?.publishedAt) - toIsoTime(left?.publishedAt)
        if (byPublishedAt !== 0) return byPublishedAt
        return Math.max(0, toNumber(right?.views)) - Math.max(0, toNumber(left?.views))
      })
      .slice(0, sanitizedMaxPosts)

    return {
      account: {
        accountId: normalizedHandle,
        accountName: normalizeText(accountName, 200) || normalizeText(profile.displayName, 200) || normalizedHandle,
        followers,
        postsCount,
        reach: 0,
        impressions: 0,
      },
      posts: recentPosts,
      collectedAt: new Date().toISOString(),
      selectorVersion: INSTAGRAM_SELECTOR_VERSION,
    }
  } catch (error) {
    const code = classifyCollectorException(error)
    throw createCollectorError(`instagram_${code}`, error instanceof Error ? error.message : code)
  } finally {
    await context.close().catch(() => null)
    await browser.close().catch(() => null)
  }
}
