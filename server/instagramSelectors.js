export const INSTAGRAM_SELECTOR_VERSION = '2026-02-v1'

export const INSTAGRAM_SELECTORS = {
  profileMetricRows: [
    'header li',
    'section main header li',
  ],
  profileHeaderTitle: [
    'header h1',
    'section main header h2',
    'title',
  ],
  postLinks: [
    'article a[href*="/p/"]',
    'article a[href*="/reel/"]',
  ],
  loginStateSentinels: [
    'form[action*="/accounts/login"]',
    'input[name="username"]',
  ],
  challengeSentinels: [
    'form[action*="/challenge/"]',
  ],
  rateLimitTextPatterns: [
    'please wait a few minutes',
    'try again later',
    'we restrict certain activity',
  ],
}

