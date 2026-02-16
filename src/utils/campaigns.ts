import { resolveAuthBaseUrl } from './baseUrl'
import { sanitizeDateInput, sanitizeEmailInput, sanitizeTextInput, sanitizeTokenInput } from './sanitize'

const apiBaseUrl = resolveAuthBaseUrl()

export type CampaignMemberRole = 'admin' | 'internal' | 'brand viewer'

export interface CampaignManagedPost {
  id: string
  title: string
  platform: string
  channelId: string
  channelName: string
  views: number
  engagementRate: number
}

export interface CampaignChannelPostsGroup {
  channelId: string
  channelName: string
  platform: string
  posts: Record<string, CampaignManagedPost>
}

export interface MemberAccessInput {
  email: string
  role?: CampaignMemberRole
}

export interface MemberRoleUpdateInput {
  userId: string
  role?: CampaignMemberRole
}

export interface CampaignApiItem {
  id: string
  createdAt: string
  campaignName: string
  brand: string
  startDate: string
  endDate: string
  viewsDelivered: number
  guaranteed: number
  engagementRate: number
  allowedOrgs: string[]
  distributionSources: unknown
  selectedPostIds?: string[]
  selectedChannelId?: string
  posts?: CampaignChannelPostsGroup[]
  allowedMembers: string[]
  allowedMemberRoles?: Record<string, CampaignMemberRole>
  creator: string
}

export interface MemberResolutionItem {
  action?: 'add' | 'remove'
  email: string
  userId?: string
  error?: string
  message: string
}

export interface MemberResolutionSummary {
  added: MemberResolutionItem[]
  removed: MemberResolutionItem[]
  failed: MemberResolutionItem[]
}

export interface CampaignMember {
  id: string
  email: string
  role?: CampaignMemberRole
}

export interface CampaignMembersPayload {
  campaignId: string
  campaignName?: string
  creator?: string
  members: CampaignMember[]
}

export interface CampaignListPayload {
  campaigns: CampaignApiItem[]
  viewerUserId: string
}

export interface CreateCampaignInput {
  campaignName: string
  brand?: string
  startDate: string
  endDate: string
  guaranteed: number
  viewsDelivered?: number
  engagementRate?: number
  allowedOrgs?: string[]
  allowedMembers?: string[]
  allowedMemberRoles?: Record<string, CampaignMemberRole>
  memberEmails?: string[]
  memberAccess?: MemberAccessInput[]
  distributionSources?: unknown
}

export interface CreateCampaignResult {
  campaign: CampaignApiItem
  viewerUserId: string
  memberResolution: MemberResolutionSummary
}

export interface UpdateCampaignMembersInput {
  addMembers?: MemberAccessInput[]
  roleUpdates?: MemberRoleUpdateInput[]
  addEmails?: string[]
  removeEmails?: string[]
  removeUserIds?: string[]
}

export interface UpdateCampaignMembersResult {
  campaignId: string
  members: CampaignMember[]
  updateResult: MemberResolutionSummary
}

export interface UpdateCampaignPostsInput {
  selectedPostIds: string[]
  selectedPosts?: CampaignManagedPost[]
  selectedChannelId?: string
  viewsDelivered: number
  engagementRate: number
}

export interface UpdateCampaignPostsResult {
  campaign: CampaignApiItem
}

export interface UpdateCampaignDetailsInput {
  campaignName: string
  brand: string
  startDate: string
  endDate: string
  guaranteed: number
  guaranteedEngagements: number
}

export interface UpdateCampaignDetailsResult {
  campaign: CampaignApiItem
}

export interface DeleteCampaignResult {
  campaignId: string
}

const asNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const asCampaignMemberRole = (value: unknown): CampaignMemberRole => {
  if (typeof value !== 'string') return 'internal'
  const normalized = value.trim().toLowerCase()
  if (!normalized) return 'internal'
  if (normalized === 'admin' || normalized.includes('admin')) return 'admin'
  if (
    normalized === 'brand viewer' ||
    normalized === 'brand-viewer' ||
    normalized === 'brand_viewer' ||
    normalized === 'brand' ||
    normalized.includes('brand')
  ) {
    return 'brand viewer'
  }
  if (normalized === 'member') return 'internal'
  return 'internal'
}

const campaignMemberRolePriority: Record<CampaignMemberRole, number> = {
  'brand viewer': 1,
  internal: 2,
  admin: 3,
}

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (seen.has(entry)) return false
      seen.add(entry)
      return true
    })
}

const asMemberRoleMap = (value: unknown): Record<string, CampaignMemberRole> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, CampaignMemberRole> = {}
  Object.entries(value as Record<string, unknown>).forEach(([id, role]) => {
    const trimmedId = id.trim()
    if (!trimmedId) return
    normalized[trimmedId] = asCampaignMemberRole(role)
  })
  return normalized
}

const normalizeCampaignManagedPost = (payload: unknown): CampaignManagedPost | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = payload as Partial<CampaignManagedPost>
  const id = sanitizeTokenInput(row.id, 300)
  if (!id) return null
  return {
    id,
    title: sanitizeTextInput(row.title, { maxLength: 300 }) || 'Untitled post',
    platform: sanitizeTextInput(row.platform, { maxLength: 64 }) || 'YouTube',
    channelId: sanitizeTokenInput(row.channelId, 300),
    channelName: sanitizeTextInput(row.channelName, { maxLength: 180 }),
    views: asNumber(row.views),
    engagementRate: asNumber(row.engagementRate),
  }
}

const normalizeCampaignChannelPostsGroup = (payload: unknown): CampaignChannelPostsGroup | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = payload as Partial<CampaignChannelPostsGroup> & { posts?: unknown }
  const channelId = sanitizeTokenInput(row.channelId, 300)
  const channelName = sanitizeTextInput(row.channelName, { maxLength: 180 })
  const platform = sanitizeTextInput(row.platform, { maxLength: 64 }) || 'YouTube'
  const postsValue = row.posts
  if (!postsValue || typeof postsValue !== 'object' || Array.isArray(postsValue)) return null
  const normalizedPosts: Record<string, CampaignManagedPost> = {}
  Object.entries(postsValue as Record<string, unknown>).forEach(([postId, value]) => {
    const normalized = normalizeCampaignManagedPost({
      ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
      id: postId,
    })
    if (!normalized) return
    normalizedPosts[normalized.id] = normalized
  })
  if (!Object.keys(normalizedPosts).length) return null
  return {
    channelId,
    channelName,
    platform,
    posts: normalizedPosts,
  }
}

const normalizeCampaignPosts = (value: unknown): CampaignChannelPostsGroup[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeCampaignChannelPostsGroup(entry))
    .filter((entry: CampaignChannelPostsGroup | null): entry is CampaignChannelPostsGroup => Boolean(entry))
}

const normalizeMemberResolutionItem = (payload: unknown): MemberResolutionItem | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<MemberResolutionItem>
  const email = sanitizeTextInput(row.email, { maxLength: 320 })
  const message = sanitizeTextInput(row.message, { maxLength: 500 }) || 'Updated.'
  if (!email) return null
  const action = row.action === 'add' || row.action === 'remove' ? row.action : undefined
  const userId = sanitizeTokenInput(row.userId, 64) || undefined
  const error = sanitizeTokenInput(row.error, 120) || undefined
  return { action, email, userId, error, message }
}

const normalizeMemberResolutionSummary = (payload: unknown): MemberResolutionSummary => {
  if (!payload || typeof payload !== 'object') {
    return { added: [], removed: [], failed: [] }
  }
  const value = payload as Partial<MemberResolutionSummary>
  const normalizeList = (items: unknown): MemberResolutionItem[] =>
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeMemberResolutionItem(item))
      .filter((item: MemberResolutionItem | null): item is MemberResolutionItem => Boolean(item))

  return {
    added: normalizeList(value.added),
    removed: normalizeList(value.removed),
    failed: normalizeList(value.failed),
  }
}

const normalizeCampaign = (payload: unknown): CampaignApiItem | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<CampaignApiItem>
  const id = asString(row.id).trim()
  if (!id) return null
  const allowedMemberRoles = asMemberRoleMap((row as { allowedMemberRoles?: unknown }).allowedMemberRoles)
  const allowedMembersFromPayload = asStringArray(row.allowedMembers)
  const posts = normalizeCampaignPosts((row as { posts?: unknown }).posts)
  const selectedPostIdsFromPosts = posts.flatMap((group) => Object.keys(group.posts))
  const selectedPostIdsFromPayload = asStringArray((row as { selectedPostIds?: unknown }).selectedPostIds)
    .map((entry) => sanitizeTokenInput(entry, 300))
    .filter((entry) => Boolean(entry))
  const selectedPostIds = [...new Set([...selectedPostIdsFromPosts, ...selectedPostIdsFromPayload])]
  const selectedChannelIdFromPosts = posts[0]?.channelId ?? ''

  return {
    id,
    createdAt: asString(row.createdAt),
    campaignName: sanitizeTextInput(row.campaignName, { maxLength: 140 }),
    brand: sanitizeTextInput(row.brand, { maxLength: 140 }),
    startDate: sanitizeDateInput(row.startDate),
    endDate: sanitizeDateInput(row.endDate),
    viewsDelivered: asNumber(row.viewsDelivered),
    guaranteed: asNumber(row.guaranteed),
    engagementRate: asNumber(row.engagementRate),
    allowedOrgs: asStringArray(row.allowedOrgs),
    distributionSources: row.distributionSources ?? null,
    selectedPostIds,
    selectedChannelId:
      sanitizeTokenInput((row as { selectedChannelId?: unknown }).selectedChannelId, 300)
      || selectedChannelIdFromPosts
      || undefined,
    posts,
    allowedMembers: allowedMembersFromPayload.length ? allowedMembersFromPayload : Object.keys(allowedMemberRoles),
    allowedMemberRoles,
    creator: sanitizeTokenInput(row.creator, 64),
  }
}

const normalizeCampaignMember = (payload: unknown): CampaignMember | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<CampaignMember>
  const id = asString(row.id).trim()
  if (!id) return null
  return {
    id,
    email: sanitizeEmailInput(row.email),
    role: asCampaignMemberRole(row.role),
  }
}

const readErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string') {
    return (payload as { message: string }).message
  }
  return fallback
}

const toUniqueValues = (values: string[]) => [...new Set(values)]

export const fetchCampaigns = async (): Promise<CampaignListPayload> => {
  const response = await fetch(`${apiBaseUrl}/api/campaigns`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to load campaigns.'))
  }

  const campaigns = (Array.isArray(payload?.campaigns) ? payload.campaigns : [])
    .map((row: unknown) => normalizeCampaign(row))
    .filter((row: CampaignApiItem | null): row is CampaignApiItem => Boolean(row))
  const viewerUserId = asString(payload?.viewerUserId).trim()
  return { campaigns, viewerUserId }
}

export const createCampaign = async (input: CreateCampaignInput): Promise<CreateCampaignResult> => {
  const sanitizedMemberAccess = Array.isArray(input.memberAccess)
    ? (() => {
      const roleByEmail = new Map<string, CampaignMemberRole>()
      input.memberAccess.forEach((entry) => {
        const email = sanitizeEmailInput(entry.email)
        if (!email) return
        const role = asCampaignMemberRole(entry.role)
        const existing = roleByEmail.get(email)
        if (!existing || campaignMemberRolePriority[role] > campaignMemberRolePriority[existing]) {
          roleByEmail.set(email, role)
        }
      })
      return [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
    })()
    : undefined
  const sanitizedMemberEmails = Array.isArray(input.memberEmails)
    ? toUniqueValues(input.memberEmails.map((entry) => sanitizeEmailInput(entry)).filter((entry) => Boolean(entry)))
    : undefined
  const sanitizedInput: CreateCampaignInput = {
    ...input,
    campaignName: sanitizeTextInput(input.campaignName, { maxLength: 140 }),
    brand: sanitizeTextInput(input.brand, { maxLength: 140 }),
    startDate: sanitizeDateInput(input.startDate),
    endDate: sanitizeDateInput(input.endDate),
    memberAccess: sanitizedMemberAccess,
    memberEmails: sanitizedMemberEmails,
  }

  const response = await fetch(`${apiBaseUrl}/api/campaigns`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to create campaign.'))
  }
  const campaign = normalizeCampaign(payload?.campaign)
  if (!campaign) {
    throw new Error('Campaign was created but the response payload was invalid.')
  }

  const viewerUserId = asString(payload?.viewerUserId).trim()
  const memberResolution = normalizeMemberResolutionSummary(payload?.memberResolution)
  return { campaign, viewerUserId, memberResolution }
}

export const fetchCampaignMembers = async (campaignId: string): Promise<CampaignMembersPayload> => {
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/members`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to load campaign members.'))
  }

  return {
    campaignId: asString(payload?.campaignId).trim(),
    campaignName: asString(payload?.campaignName).trim() || undefined,
    creator: asString(payload?.creator).trim() || undefined,
    members: (Array.isArray(payload?.members) ? payload.members : [])
      .map((row: unknown) => normalizeCampaignMember(row))
      .filter((row: CampaignMember | null): row is CampaignMember => Boolean(row)),
  }
}

export const updateCampaignMembers = async (
  campaignId: string,
  input: UpdateCampaignMembersInput,
): Promise<UpdateCampaignMembersResult> => {
  const sanitizedInput: UpdateCampaignMembersInput = {
    addMembers: Array.isArray(input.addMembers)
      ? input.addMembers
        .map((entry) => ({
          email: sanitizeEmailInput(entry.email),
          role: asCampaignMemberRole(entry.role),
        }))
        .filter((entry) => Boolean(entry.email))
      : undefined,
    roleUpdates: Array.isArray(input.roleUpdates)
      ? input.roleUpdates
        .map((entry) => ({
          userId: sanitizeTokenInput(entry.userId, 80),
          role: asCampaignMemberRole(entry.role),
        }))
        .filter((entry) => Boolean(entry.userId))
      : undefined,
    addEmails: Array.isArray(input.addEmails)
      ? input.addEmails.map((entry) => sanitizeEmailInput(entry)).filter((entry) => Boolean(entry))
      : undefined,
    removeEmails: Array.isArray(input.removeEmails)
      ? input.removeEmails.map((entry) => sanitizeEmailInput(entry)).filter((entry) => Boolean(entry))
      : undefined,
    removeUserIds: Array.isArray(input.removeUserIds)
      ? input.removeUserIds.map((entry) => sanitizeTokenInput(entry, 80)).filter((entry) => Boolean(entry))
      : undefined,
  }

  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to update campaign members.'))
  }

  return {
    campaignId: asString(payload?.campaignId).trim(),
    members: (Array.isArray(payload?.members) ? payload.members : [])
      .map((row: unknown) => normalizeCampaignMember(row))
      .filter((row: CampaignMember | null): row is CampaignMember => Boolean(row)),
    updateResult: normalizeMemberResolutionSummary(payload?.updateResult),
  }
}

export const updateCampaignPosts = async (
  campaignId: string,
  input: UpdateCampaignPostsInput,
): Promise<UpdateCampaignPostsResult> => {
  const deduplicatedSelectedPosts = (() => {
    const byId = new Map<string, CampaignManagedPost>()
    ;(Array.isArray(input.selectedPosts) ? input.selectedPosts : []).forEach((entry) => {
      const normalized = normalizeCampaignManagedPost(entry)
      if (!normalized) return
      byId.set(normalized.id, normalized)
    })
    return [...byId.values()]
  })()
  const sanitizedInput: UpdateCampaignPostsInput = {
    selectedPostIds: toUniqueValues(
      input.selectedPostIds
        .map((entry) => sanitizeTokenInput(entry, 300))
        .filter((entry) => Boolean(entry)),
    ),
    selectedPosts: deduplicatedSelectedPosts,
    selectedChannelId: sanitizeTokenInput(input.selectedChannelId, 300) || undefined,
    viewsDelivered: asNumber(input.viewsDelivered),
    engagementRate: asNumber(input.engagementRate),
  }

  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/posts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to update campaign posts.'))
  }
  const campaign = normalizeCampaign(payload?.campaign)
  if (!campaign) {
    throw new Error('Campaign posts were updated but the response payload was invalid.')
  }
  return { campaign }
}

export const updateCampaignDetails = async (
  campaignId: string,
  input: UpdateCampaignDetailsInput,
): Promise<UpdateCampaignDetailsResult> => {
  const sanitizedInput: UpdateCampaignDetailsInput = {
    campaignName: sanitizeTextInput(input.campaignName, { maxLength: 140 }),
    brand: sanitizeTextInput(input.brand, { maxLength: 140 }),
    startDate: sanitizeDateInput(input.startDate),
    endDate: sanitizeDateInput(input.endDate),
    guaranteed: asNumber(input.guaranteed),
    guaranteedEngagements: asNumber(input.guaranteedEngagements),
  }

  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/details`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to update campaign details.'))
  }
  const campaign = normalizeCampaign(payload?.campaign)
  if (!campaign) {
    throw new Error('Campaign was updated but the response payload was invalid.')
  }
  return { campaign }
}

export const deleteCampaign = async (campaignId: string): Promise<DeleteCampaignResult> => {
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to delete campaign.'))
  }

  return {
    campaignId: asString(payload?.campaignId).trim(),
  }
}
