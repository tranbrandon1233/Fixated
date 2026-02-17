import { resolveAuthBaseUrl } from './baseUrl'
import { sanitizeEmailInput, sanitizeTextInput, sanitizeTokenInput } from './sanitize'

const apiBaseUrl = resolveAuthBaseUrl()

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type OrganizationMemberRole = 'admin' | 'internal' | 'brand viewer'
export type OrganizationConnectionPlatform = 'YouTube' | 'Instagram' | 'X'

export interface MemberAccessInput {
  email: string
  role?: OrganizationMemberRole
}

export interface OrganizationMemberRoleUpdateInput {
  userId: string
  role: OrganizationMemberRole
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

export interface OrganizationMember {
  id: string
  email: string
  role: OrganizationMemberRole
}

export interface OrganizationConnectedAccount {
  id: string
  platform: OrganizationConnectionPlatform
  accountName: string
  channelId?: string
  ownerUserId?: string
  connectedAt?: string
}

export interface OrganizationCampaignSummary {
  id: string
  name: string
}

export interface OrganizationApiItem {
  id: string
  createdAt: string
  name: string
  campaigns: string[]
  campaignDirectory: OrganizationCampaignSummary[]
  members: Record<string, OrganizationMemberRole>
  memberDirectory: OrganizationMember[]
  connectedAccounts: OrganizationConnectedAccount[]
  creator: string
  creatorEmail?: string
}

export interface OrganizationListPayload {
  organizations: OrganizationApiItem[]
  viewerUserId: string
}

export interface CreateOrganizationInput {
  name: string
  campaigns?: string[]
  members?: Record<string, OrganizationMemberRole>
  memberAccess?: MemberAccessInput[]
  memberEmails?: string[]
}

export interface CreateOrganizationResult {
  organization: OrganizationApiItem
  viewerUserId: string
  memberResolution: MemberResolutionSummary
}

export interface UpdateOrganizationMembersInput {
  addMembers?: MemberAccessInput[]
  roleUpdates?: OrganizationMemberRoleUpdateInput[]
  addEmails?: string[]
  removeEmails?: string[]
  removeUserIds?: string[]
}

export interface UpdateOrganizationMembersResult {
  organization: OrganizationApiItem
  updateResult: MemberResolutionSummary
}

export interface UpdateOrganizationDetailsInput {
  name: string
  campaigns: string[]
}

export interface UpdateOrganizationDetailsResult {
  organization: OrganizationApiItem
}

export interface DeleteOrganizationResult {
  organizationId: string
}

export interface AddOrganizationConnectionInput {
  platform: OrganizationConnectionPlatform
  accountName: string
}

export interface AddOrganizationConnectionResult {
  organization: OrganizationApiItem
}

export interface RemoveOrganizationConnectionResult {
  organization: OrganizationApiItem
}

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const isUuid = (value: string) => uuidRegex.test(value)

const normalizeConnectionPlatform = (value: unknown): OrganizationConnectionPlatform => {
  if (typeof value !== 'string') return 'YouTube'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'x') return 'X'
  if (normalized === 'instagram') return 'Instagram'
  return 'YouTube'
}

const normalizeRole = (value: unknown): OrganizationMemberRole => {
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
  return 'internal'
}

const rolePriority: Record<OrganizationMemberRole, number> = {
  'brand viewer': 1,
  internal: 2,
  admin: 3,
}

const toUniqueUuidArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: string[] = []
  value.forEach((entry) => {
    const uuid = sanitizeTokenInput(entry, 80)
    if (!isUuid(uuid) || seen.has(uuid)) return
    seen.add(uuid)
    rows.push(uuid)
  })
  return rows
}

const toMemberRoleMap = (value: unknown): Record<string, OrganizationMemberRole> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, OrganizationMemberRole> = {}
  Object.entries(value as Record<string, unknown>).forEach(([userId, role]) => {
    const uuid = sanitizeTokenInput(userId, 80)
    if (!isUuid(uuid)) return
    normalized[uuid] = normalizeRole(role)
  })
  return normalized
}

const normalizeMember = (value: unknown): OrganizationMember | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<OrganizationMember>
  const id = sanitizeTokenInput(row.id, 80)
  if (!isUuid(id)) return null
  return {
    id,
    email: sanitizeEmailInput(row.email),
    role: normalizeRole(row.role),
  }
}

const normalizeConnectedAccount = (value: unknown): OrganizationConnectedAccount | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<OrganizationConnectedAccount>
  const platform = normalizeConnectionPlatform(row.platform)
  const accountName = sanitizeTextInput(row.accountName, { maxLength: 180 })
  if (!accountName) return null
  const channelId = sanitizeTokenInput(row.channelId, 300) || undefined
  const ownerUserId = sanitizeTokenInput((row as { ownerUserId?: unknown }).ownerUserId, 80) || undefined
  const fallbackIdSource = channelId || accountName.toLowerCase().replace(/\s+/g, '-')
  const id = sanitizeTokenInput(row.id, 180) || `${platform.toLowerCase()}:${fallbackIdSource}`
  if (!id) return null
  const connectedAt = sanitizeTokenInput(row.connectedAt, 64) || undefined
  return {
    id,
    platform,
    accountName,
    channelId,
    ownerUserId,
    connectedAt,
  }
}

const normalizeCampaignDirectory = (value: unknown): OrganizationCampaignSummary[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: OrganizationCampaignSummary[] = []
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const row = entry as Partial<OrganizationCampaignSummary>
    const id = sanitizeTokenInput(row.id, 80)
    if (!isUuid(id) || seen.has(id)) return
    const name = sanitizeTextInput((row as { name?: unknown }).name, { maxLength: 140 })
    if (!name) return
    seen.add(id)
    rows.push({ id, name })
  })
  return rows
}

const normalizeOrganization = (payload: unknown): OrganizationApiItem | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<OrganizationApiItem>
  const id = sanitizeTokenInput(row.id, 80)
  if (!isUuid(id)) return null
  const memberDirectory = (Array.isArray(row.memberDirectory) ? row.memberDirectory : [])
    .map((entry) => normalizeMember(entry))
    .filter((entry: OrganizationMember | null): entry is OrganizationMember => Boolean(entry))
  const connectedAccountsSource = (row as { connectedAccounts?: unknown }).connectedAccounts
  const connectedAccounts = (Array.isArray(connectedAccountsSource) ? connectedAccountsSource : [])
    .map((entry) => normalizeConnectedAccount(entry))
    .filter((entry: OrganizationConnectedAccount | null): entry is OrganizationConnectedAccount => Boolean(entry))

  return {
    id,
    createdAt: sanitizeTokenInput(row.createdAt, 64),
    name: sanitizeTextInput(row.name, { maxLength: 140 }),
    campaigns: toUniqueUuidArray(row.campaigns),
    campaignDirectory: normalizeCampaignDirectory((row as { campaignDirectory?: unknown }).campaignDirectory),
    members: toMemberRoleMap(row.members),
    memberDirectory,
    connectedAccounts,
    creator: sanitizeTokenInput(row.creator, 80),
    creatorEmail: sanitizeEmailInput((row as { creatorEmail?: unknown }).creatorEmail) || undefined,
  }
}

const normalizeMemberResolutionItem = (payload: unknown): MemberResolutionItem | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Partial<MemberResolutionItem>
  const email = sanitizeTextInput(row.email, { maxLength: 320 })
  const message = sanitizeTextInput(row.message, { maxLength: 500 }) || 'Updated.'
  if (!email) return null
  const action = row.action === 'add' || row.action === 'remove' ? row.action : undefined
  const userId = sanitizeTokenInput(row.userId, 80) || undefined
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
      .map((entry) => normalizeMemberResolutionItem(entry))
      .filter((entry: MemberResolutionItem | null): entry is MemberResolutionItem => Boolean(entry))

  return {
    added: normalizeList(value.added),
    removed: normalizeList(value.removed),
    failed: normalizeList(value.failed),
  }
}

const sanitizeMemberAccess = (value: unknown): MemberAccessInput[] => {
  if (!Array.isArray(value)) return []
  const roleByEmail = new Map<string, OrganizationMemberRole>()
  value.forEach((entry) => {
    const raw =
      typeof entry === 'string'
        ? { email: entry, role: 'internal' as OrganizationMemberRole }
        : entry && typeof entry === 'object'
          ? (entry as MemberAccessInput)
          : null
    if (!raw) return
    const email = sanitizeEmailInput(raw.email)
    if (!email) return
    const role = normalizeRole(raw.role)
    const existing = roleByEmail.get(email)
    if (!existing || rolePriority[role] > rolePriority[existing]) {
      roleByEmail.set(email, role)
    }
  })
  return [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
}

const sanitizeEmailArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((entry) => sanitizeEmailInput(entry)).filter((entry) => Boolean(entry)))]
}

const sanitizeRoleUpdates = (value: unknown): OrganizationMemberRoleUpdateInput[] => {
  if (!Array.isArray(value)) return []
  const roleByUserId = new Map<string, OrganizationMemberRole>()
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const row = entry as Partial<OrganizationMemberRoleUpdateInput>
    const userId = sanitizeTokenInput(row.userId, 80)
    if (!isUuid(userId)) return
    const role = normalizeRole(row.role)
    const existing = roleByUserId.get(userId)
    if (!existing || rolePriority[role] > rolePriority[existing]) {
      roleByUserId.set(userId, role)
    }
  })
  return [...roleByUserId.entries()].map(([userId, role]) => ({ userId, role }))
}

const readErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string') {
    return (payload as { message: string }).message
  }
  return fallback
}

export const fetchOrganizations = async (): Promise<OrganizationListPayload> => {
  const response = await fetch(`${apiBaseUrl}/api/organizations`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to load organizations.'))
  }

  const organizations = (Array.isArray(payload?.organizations) ? payload.organizations : [])
    .map((row: unknown) => normalizeOrganization(row))
    .filter((row: OrganizationApiItem | null): row is OrganizationApiItem => Boolean(row))

  const viewerUserId = asString(payload?.viewerUserId).trim()
  return { organizations, viewerUserId }
}

export const createOrganization = async (
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> => {
  const sanitizedMembers: Record<string, OrganizationMemberRole> = {}
  Object.entries(input.members ?? {}).forEach(([userId, role]) => {
    const uuid = sanitizeTokenInput(userId, 80)
    if (!isUuid(uuid)) return
    sanitizedMembers[uuid] = normalizeRole(role)
  })

  const sanitizedInput: CreateOrganizationInput = {
    name: sanitizeTextInput(input.name, { maxLength: 140 }),
    campaigns: toUniqueUuidArray(input.campaigns),
    members: sanitizedMembers,
    memberAccess: sanitizeMemberAccess(input.memberAccess),
    memberEmails: sanitizeEmailArray(input.memberEmails),
  }

  const response = await fetch(`${apiBaseUrl}/api/organizations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to create organization.'))
  }

  const organization = normalizeOrganization(payload?.organization)
  if (!organization) {
    throw new Error('Organization was created but the response payload was invalid.')
  }

  return {
    organization,
    viewerUserId: asString(payload?.viewerUserId).trim(),
    memberResolution: normalizeMemberResolutionSummary(payload?.memberResolution),
  }
}

export const updateOrganizationMembers = async (
  organizationId: string,
  input: UpdateOrganizationMembersInput,
): Promise<UpdateOrganizationMembersResult> => {
  const sanitizedInput: UpdateOrganizationMembersInput = {
    addMembers: sanitizeMemberAccess(input.addMembers),
    roleUpdates: sanitizeRoleUpdates(input.roleUpdates),
    addEmails: sanitizeEmailArray(input.addEmails),
    removeEmails: sanitizeEmailArray(input.removeEmails),
    removeUserIds: toUniqueUuidArray(input.removeUserIds),
  }

  const response = await fetch(`${apiBaseUrl}/api/organizations/${organizationId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to update organization members.'))
  }

  const organization = normalizeOrganization(payload?.organization)
  if (!organization) {
    throw new Error('Organization members were updated but the response payload was invalid.')
  }

  return {
    organization,
    updateResult: normalizeMemberResolutionSummary(payload?.updateResult),
  }
}

export const updateOrganizationDetails = async (
  organizationId: string,
  input: UpdateOrganizationDetailsInput,
): Promise<UpdateOrganizationDetailsResult> => {
  const sanitizedInput: UpdateOrganizationDetailsInput = {
    name: sanitizeTextInput(input.name, { maxLength: 140 }),
    campaigns: toUniqueUuidArray(input.campaigns),
  }

  const response = await fetch(`${apiBaseUrl}/api/organizations/${organizationId}/details`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to update organization details.'))
  }

  const organization = normalizeOrganization(payload?.organization)
  if (!organization) {
    throw new Error('Organization was updated but the response payload was invalid.')
  }

  return { organization }
}

export const deleteOrganization = async (organizationId: string): Promise<DeleteOrganizationResult> => {
  const response = await fetch(`${apiBaseUrl}/api/organizations/${organizationId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to delete organization.'))
  }

  return {
    organizationId: sanitizeTokenInput(payload?.organizationId, 80),
  }
}

export const addOrganizationConnection = async (
  organizationId: string,
  input: AddOrganizationConnectionInput,
): Promise<AddOrganizationConnectionResult> => {
  const sanitizedInput: AddOrganizationConnectionInput = {
    platform: normalizeConnectionPlatform(input.platform),
    accountName: sanitizeTextInput(input.accountName, { maxLength: 180 }),
  }

  const response = await fetch(`${apiBaseUrl}/api/organizations/${organizationId}/connections`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedInput),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to add organization connection.'))
  }

  const organization = normalizeOrganization(payload?.organization)
  if (!organization) {
    throw new Error('Connection was added but the response payload was invalid.')
  }

  return { organization }
}

export const removeOrganizationConnection = async (
  organizationId: string,
  connectionId: string,
): Promise<RemoveOrganizationConnectionResult> => {
  const sanitizedConnectionId = sanitizeTokenInput(connectionId, 180)
  if (!sanitizedConnectionId) {
    throw new Error('Connection id is required.')
  }
  const response = await fetch(
    `${apiBaseUrl}/api/organizations/${organizationId}/connections/${encodeURIComponent(sanitizedConnectionId)}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, 'Unable to remove organization connection.'))
  }

  const organization = normalizeOrganization(payload?.organization)
  if (!organization) {
    throw new Error('Connection was removed but the response payload was invalid.')
  }

  return { organization }
}
