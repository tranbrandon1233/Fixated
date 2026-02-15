import { resolveAuthBaseUrl } from './baseUrl'

const apiBaseUrl = resolveAuthBaseUrl()

export type CampaignMemberRole = 'admin' | 'member'

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
  return typeof value === 'string' && value.trim().toLowerCase() === 'admin' ? 'admin' : 'member'
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

const normalizeMemberResolutionItem = (payload: unknown): MemberResolutionItem | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<MemberResolutionItem>
  const email = asString(row.email).trim()
  const message = asString(row.message).trim() || 'Updated.'
  if (!email) return null
  const action = row.action === 'add' || row.action === 'remove' ? row.action : undefined
  const userId = asString(row.userId).trim() || undefined
  const error = asString(row.error).trim() || undefined
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

  return {
    id,
    createdAt: asString(row.createdAt),
    campaignName: asString(row.campaignName),
    brand: asString(row.brand),
    startDate: asString(row.startDate),
    endDate: asString(row.endDate),
    viewsDelivered: asNumber(row.viewsDelivered),
    guaranteed: asNumber(row.guaranteed),
    engagementRate: asNumber(row.engagementRate),
    allowedOrgs: asStringArray(row.allowedOrgs),
    distributionSources: row.distributionSources ?? null,
    selectedPostIds: asStringArray((row as { selectedPostIds?: unknown }).selectedPostIds),
    selectedChannelId: asString((row as { selectedChannelId?: unknown }).selectedChannelId).trim() || undefined,
    allowedMembers: allowedMembersFromPayload.length ? allowedMembersFromPayload : Object.keys(allowedMemberRoles),
    allowedMemberRoles,
    creator: asString(row.creator),
  }
}

const normalizeCampaignMember = (payload: unknown): CampaignMember | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<CampaignMember>
  const id = asString(row.id).trim()
  if (!id) return null
  return {
    id,
    email: asString(row.email).trim(),
    role: asCampaignMemberRole(row.role),
  }
}

const readErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string') {
    return (payload as { message: string }).message
  }
  return fallback
}

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
  const response = await fetch(`${apiBaseUrl}/api/campaigns`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/posts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/details`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
