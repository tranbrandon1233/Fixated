import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../components/ui/SectionHeader'
import type { CampaignApiItem } from '../utils/campaigns'
import { getInstagramConnectUrl, getXConnectUrl, getYouTubeConnectUrl } from '../utils/auth'
import { fetchCampaigns } from '../utils/campaigns'
import { sanitizeEmailInput, sanitizeTextInput, sanitizeTokenInput } from '../utils/sanitize'
import type { Role } from '../types/dashboard'
import {
  createOrganization,
  deleteOrganization,
  fetchOrganizations,
  removeOrganizationConnection,
  updateOrganizationDetails,
  updateOrganizationMembers,
  type MemberAccessInput,
  type MemberResolutionItem,
  type MemberResolutionSummary,
  type OrganizationApiItem,
  type OrganizationConnectedAccount,
  type OrganizationMember,
  type OrganizationMemberRole,
  type OrganizationMemberRoleUpdateInput,
} from '../utils/organizations'

interface OrganizationsProps {
  role: Role
}

interface MemberInputRow {
  rowId: string
  email: string
  role: OrganizationMemberRole
}

const rolePriority: Record<OrganizationMemberRole, number> = {
  'brand viewer': 1,
  internal: 2,
  admin: 3,
}

const memberRoleOptions: OrganizationMemberRole[] = ['admin', 'internal', 'brand viewer']
type OrganizationViewerRole = OrganizationMemberRole | ''

let memberRowIdCounter = 0
const createMemberRowId = () => {
  memberRowIdCounter += 1
  return `member-row-${memberRowIdCounter}`
}

const createEmptyMemberInput = (): MemberInputRow => ({
  rowId: createMemberRowId(),
  email: '',
  role: 'internal',
})

const formatMemberRoleLabel = (role: OrganizationMemberRole) => {
  if (role === 'brand viewer') return 'Brand Viewer'
  if (role === 'internal') return 'Internal'
  return 'Admin'
}

const roleSelectMinWidth = '170px'

const sanitizeNameInput = (value: string) => sanitizeTextInput(value, { maxLength: 140, trim: false })
const sanitizeEmailFieldInput = (value: string) =>
  sanitizeTextInput(value, { maxLength: 320, trim: false }).replace(/\s+/g, '')

const formatDateTime = (value: string) => {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

const extractEmailsFromCsvText = (content: string) => {
  const matches = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return [...new Set(matches.map((entry) => sanitizeEmailInput(entry)).filter((entry) => Boolean(entry)))]
}

const normalizeMemberRole = (value: unknown): OrganizationMemberRole => {
  if (typeof value !== 'string') return 'internal'
  const normalized = value.trim().toLowerCase()
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

const collectMemberAccess = (inputs: MemberInputRow[]): MemberAccessInput[] => {
  const roleByEmail = new Map<string, OrganizationMemberRole>()
  inputs.forEach((entry) => {
    const email = sanitizeEmailInput(entry.email)
    if (!email) return
    const memberRole = normalizeMemberRole(entry.role)
    const existing = roleByEmail.get(email)
    if (!existing || rolePriority[memberRole] > rolePriority[existing]) {
      roleByEmail.set(email, memberRole)
    }
  })
  return [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
}

const mergeMemberInputs = (current: MemberInputRow[], additions: string[]) => {
  const merged = [...current]
  additions.forEach((emailValue) => {
    const email = sanitizeEmailInput(emailValue)
    if (!email) return
    if (merged.some((entry) => sanitizeEmailInput(entry.email) === email)) return
    merged.push({ rowId: createMemberRowId(), email, role: 'internal' })
  })
  return merged.length ? merged : [createEmptyMemberInput()]
}

const hasResolutionRows = (summary: MemberResolutionSummary | null) =>
  Boolean(summary && (summary.added.length || summary.removed.length || summary.failed.length))

const mergeOrganizations = (
  previous: OrganizationApiItem[],
  organization: OrganizationApiItem,
) => {
  const remaining = previous.filter((entry) => entry.id !== organization.id)
  return [organization, ...remaining]
}

const resolveOrganizationMembers = (organization: OrganizationApiItem): OrganizationMember[] => {
  if (organization.memberDirectory.length) return organization.memberDirectory
  return Object.entries(organization.members).map(([id, role]) => ({ id, email: '', role }))
}

const sortOrganizationMembers = (
  organization: OrganizationApiItem,
  members: OrganizationMember[],
): OrganizationMember[] =>
  [...members].sort((left, right) => {
    const leftIsCreator = left.id === organization.creator
    const rightIsCreator = right.id === organization.creator
    if (leftIsCreator && !rightIsCreator) return -1
    if (!leftIsCreator && rightIsCreator) return 1

    const leftLabel = sanitizeTextInput(left.email || left.id, { maxLength: 320 }).toLowerCase()
    const rightLabel = sanitizeTextInput(right.email || right.id, { maxLength: 320 }).toLowerCase()
    if (leftLabel < rightLabel) return -1
    if (leftLabel > rightLabel) return 1
    return 0
  })

const resolveViewerOrganizationRole = (
  organization: OrganizationApiItem,
  viewerUserId: string,
): OrganizationViewerRole => {
  const normalizedViewerId = sanitizeTokenInput(viewerUserId, 80)
  if (!normalizedViewerId) return ''
  if (organization.creator === normalizedViewerId) return 'admin'
  const memberRole = organization.members[normalizedViewerId]
  return memberRole ? normalizeMemberRole(memberRole) : ''
}

const canManageOrganizationMembersByRole = (viewerRole: OrganizationViewerRole) =>
  viewerRole === 'admin'

const canEditOrganizationByRole = (viewerRole: OrganizationViewerRole) =>
  viewerRole === 'admin' || viewerRole === 'internal'

const canDeleteOrganizationByRole = (viewerRole: OrganizationViewerRole) => viewerRole === 'admin'

const canChangeOrganizationMemberRolesByRole = (viewerRole: OrganizationViewerRole) =>
  viewerRole === 'admin'

const canEditOrganizationNameByRole = (viewerRole: OrganizationViewerRole) => viewerRole === 'admin'
const canManageOrganizationConnectionsByRole = (viewerRole: OrganizationViewerRole) =>
  viewerRole === 'admin'

const formatConnectedAccountLabel = (account: OrganizationConnectedAccount) =>
  `${sanitizeTextInput(account.accountName, { maxLength: 180 }) || 'Unknown account'} [${account.platform}]`

const MemberFeedback = ({
  title,
  summary,
}: {
  title: string
  summary: MemberResolutionSummary
}) => {
  const renderRows = (rows: MemberResolutionItem[], isFailure = false) =>
    rows.map((row, index) => (
      <div
        key={`${row.email}-${row.userId ?? index}-${row.error ?? 'ok'}`}
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '8px 10px',
          background: 'var(--surface)',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{row.email}</div>
        <div className="section-subtitle" style={{ marginTop: '2px' }}>
          {row.message}
        </div>
        {isFailure ? (
          <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '2px' }}>
            Reason: {row.error ? row.error.replace(/_/g, ' ') : 'unknown'}
          </div>
        ) : null}
      </div>
    ))

  return (
    <div
      style={{
        marginTop: '12px',
        border: '1px dashed var(--border)',
        borderRadius: '10px',
        padding: '10px 12px',
      }}
    >
      <div className="section-subtitle">{title}</div>
      <div className="section-subtitle">
        Added {summary.added.length} | Failed {summary.failed.length}
      </div>

      {summary.added.length ? (
        <div style={{ marginTop: '10px' }}>
          <div className="section-subtitle" style={{ fontWeight: 600 }}>Added members</div>
          <div className="grid" style={{ marginTop: '6px', gap: '6px' }}>
            {renderRows(summary.added)}
          </div>
        </div>
      ) : null}

      {summary.failed.length ? (
        <div style={{ marginTop: '10px' }}>
          <div className="section-subtitle" style={{ fontWeight: 600, color: 'var(--danger)' }}>Failed members</div>
          <div className="grid" style={{ marginTop: '6px', gap: '6px' }}>
            {renderRows(summary.failed, true)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export const Organizations = ({ role }: OrganizationsProps) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [organizations, setOrganizations] = useState<OrganizationApiItem[]>([])
  const [viewerUserId, setViewerUserId] = useState('')
  const [campaigns, setCampaigns] = useState<CampaignApiItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(null)

  const [orgName, setOrgName] = useState('')
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([])
  const [createMemberInputs, setCreateMemberInputs] = useState<MemberInputRow[]>([createEmptyMemberInput()])
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)
  const [createFeedback, setCreateFeedback] = useState<MemberResolutionSummary | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [manageOrg, setManageOrg] = useState<OrganizationApiItem | null>(null)
  const [manageMemberInputs, setManageMemberInputs] = useState<MemberInputRow[]>([createEmptyMemberInput()])
  const [manageError, setManageError] = useState<string | null>(null)
  const [manageSuccess, setManageSuccess] = useState<string | null>(null)
  const [manageFeedback, setManageFeedback] = useState<MemberResolutionSummary | null>(null)
  const [manageSubmitting, setManageSubmitting] = useState(false)
  const [removeUserIdSubmitting, setRemoveUserIdSubmitting] = useState('')
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, OrganizationMemberRole>>({})
  const [editOrg, setEditOrg] = useState<OrganizationApiItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCampaignIds, setEditCampaignIds] = useState<string[]>([])
  const [editError, setEditError] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [deleteOrg, setDeleteOrg] = useState<OrganizationApiItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [connectionsOrg, setConnectionsOrg] = useState<OrganizationApiItem | null>(null)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [connectionsSuccess, setConnectionsSuccess] = useState<string | null>(null)
  const [connectionsSubmitting, setConnectionsSubmitting] = useState(false)
  const [removeConnectionIdSubmitting, setRemoveConnectionIdSubmitting] = useState('')
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const canCreateOrganizations = role === 'admin'
  const normalizedViewerId = useMemo(() => sanitizeTokenInput(viewerUserId, 80), [viewerUserId])

  useEffect(() => {
    let cancelled = false

    const loadPage = async () => {
      setIsLoading(true)
      setLoadError(null)
      setCampaignLoadError(null)

      const [organizationsResult, campaignsResult] = await Promise.allSettled([
        fetchOrganizations(),
        fetchCampaigns(),
      ])

      if (cancelled) return

      if (organizationsResult.status === 'fulfilled') {
        setOrganizations(organizationsResult.value.organizations)
        setViewerUserId(organizationsResult.value.viewerUserId)
      } else {
        setViewerUserId('')
        setLoadError(organizationsResult.reason instanceof Error
          ? organizationsResult.reason.message
          : 'Unable to load organizations.')
      }

      if (campaignsResult.status === 'fulfilled') {
        setCampaigns(campaignsResult.value.campaigns)
      } else {
        setCampaignLoadError(campaignsResult.reason instanceof Error
          ? campaignsResult.reason.message
          : 'Unable to load campaigns.')
      }

      setIsLoading(false)
    }

    void loadPage()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const provider = sanitizeTextInput(searchParams.get('provider'), { maxLength: 32 }).toLowerCase()
    if (provider !== 'youtube' && provider !== 'instagram' && provider !== 'x') return
    const status = sanitizeTextInput(searchParams.get('status'), { maxLength: 16 }).toLowerCase()
    const message = sanitizeTextInput(searchParams.get('message'), { maxLength: 240 })
    const organizationId = sanitizeTokenInput(searchParams.get('organizationId'), 80)
    const providerLabel = provider === 'instagram' ? 'Instagram' : provider === 'x' ? 'X' : 'YouTube'
    if (status === 'success') {
      const prefix = organizationId
        ? `${providerLabel} account connected to organization.`
        : `${providerLabel} account connected.`
      setActionSuccess(message || prefix)
    } else {
      setLoadError(message || `${providerLabel} connection failed.`)
    }
    navigate('/organizations', { replace: true })
  }, [navigate, searchParams])

  const campaignLabelById = useMemo(() => {
    const labels = new Map<string, string>()
    campaigns.forEach((campaign) => {
      const label = sanitizeTextInput(campaign.campaignName, { maxLength: 140 }) || campaign.id
      labels.set(campaign.id, label)
    })
    organizations.forEach((organization) => {
      organization.campaignDirectory.forEach((campaign) => {
        const label = sanitizeTextInput(campaign.name, { maxLength: 140 }) || campaign.id
        if (!labels.has(campaign.id)) {
          labels.set(campaign.id, label)
        }
      })
    })
    return labels
  }, [campaigns, organizations])

  const sortedOrganizations = useMemo(
    () =>
      [...organizations].sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
      ),
    [organizations],
  )

  const manageViewerRole = useMemo(
    () => (manageOrg ? resolveViewerOrganizationRole(manageOrg, viewerUserId) : ''),
    [manageOrg, viewerUserId],
  )
  const canManageMembersForManageOrg = canManageOrganizationMembersByRole(manageViewerRole)
  const canChangeMemberRolesForManageOrg = canChangeOrganizationMemberRolesByRole(manageViewerRole)
  const editViewerRole = useMemo(
    () => (editOrg ? resolveViewerOrganizationRole(editOrg, viewerUserId) : ''),
    [editOrg, viewerUserId],
  )
  const canEditNameForEditOrg = canEditOrganizationNameByRole(editViewerRole)
  const connectionsViewerRole = useMemo(
    () => (connectionsOrg ? resolveViewerOrganizationRole(connectionsOrg, viewerUserId) : ''),
    [connectionsOrg, viewerUserId],
  )
  const canManageConnectionsForConnectionsOrg = canManageOrganizationConnectionsByRole(connectionsViewerRole)

  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaignIds((previous) =>
      previous.includes(campaignId)
        ? previous.filter((id) => id !== campaignId)
        : [...previous, campaignId],
    )
  }

  const toggleEditCampaign = (campaignId: string) => {
    setEditCampaignIds((previous) =>
      previous.includes(campaignId)
        ? previous.filter((id) => id !== campaignId)
        : [...previous, campaignId],
    )
  }

  const updateMemberInput = (
    updater: Dispatch<SetStateAction<MemberInputRow[]>>,
    rowId: string,
    key: keyof MemberInputRow,
    value: string,
  ) => {
    updater((previous) =>
      previous.map((entry) => {
        if (entry.rowId !== rowId) return entry
        if (key === 'role') return { ...entry, role: normalizeMemberRole(value) }
        return { ...entry, email: sanitizeEmailFieldInput(value) }
      }),
    )
  }

  const removeMemberInput = (
    updater: Dispatch<SetStateAction<MemberInputRow[]>>,
    rowId: string,
  ) => {
    updater((previous) => {
      if (previous.length <= 1) return previous
      return previous.filter((entry) => entry.rowId !== rowId)
    })
  }

  const importCsvEmails = async (
    event: ChangeEvent<HTMLInputElement>,
    onEmails: (emails: string[]) => void,
    onError: (message: string | null) => void,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      onError('CSV file is too large. Use files up to 3MB.')
      return
    }

    try {
      const content = await file.text()
      const emails = extractEmailsFromCsvText(content)
      if (!emails.length) {
        onError('No valid emails were found in the CSV file.')
        return
      }
      onEmails(emails)
      onError(null)
    } catch {
      onError('Unable to read CSV file.')
    }
  }

  const handleCreateCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    await importCsvEmails(
      event,
      (emails) => setCreateMemberInputs((previous) => mergeMemberInputs(previous, emails)),
      (message) => setCreateError(message),
    )
  }

  const handleManageCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    await importCsvEmails(
      event,
      (emails) => setManageMemberInputs((previous) => mergeMemberInputs(previous, emails)),
      (message) => setManageError(message),
    )
  }

  const createOrganizationAndMaybeConnectYouTube = async (connectYouTubeAfterCreate = false) => {
    setCreateError(null)
    setCreateSuccess(null)
    setCreateFeedback(null)
    setActionSuccess(null)

    if (!canCreateOrganizations) {
      setCreateError('Only admins can create organizations.')
      return
    }

    const sanitizedName = sanitizeTextInput(orgName, { maxLength: 140 })
    if (!sanitizedName) {
      setCreateError('Organization name is required.')
      return
    }

    const memberAccess = collectMemberAccess(createMemberInputs)
    const campaignIds = [...new Set(
      selectedCampaignIds
        .map((entry) => sanitizeTokenInput(entry, 80))
        .filter((entry) => Boolean(entry)),
    )]

    setIsSubmitting(true)
    try {
      const result = await createOrganization({
        name: sanitizedName,
        campaigns: campaignIds,
        memberAccess,
      })
      setOrganizations((previous) => mergeOrganizations(previous, result.organization))
      if (result.viewerUserId) {
        setViewerUserId(result.viewerUserId)
      }
      setOrgName('')
      setSelectedCampaignIds([])
      setCreateMemberInputs([createEmptyMemberInput()])
      setCreateSuccess(
        connectYouTubeAfterCreate
          ? `Created organization "${result.organization.name}". Redirecting to YouTube...`
          : `Created organization "${result.organization.name}".`,
      )
      setCreateFeedback(result.memberResolution)
      if (connectYouTubeAfterCreate) {
        window.location.assign(getYouTubeConnectUrl({ organizationId: result.organization.id, path: '/organizations' }))
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create organization.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateOrganization = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void createOrganizationAndMaybeConnectYouTube(false)
  }

  const openManageModal = (organization: OrganizationApiItem) => {
    const viewerOrganizationRole = resolveViewerOrganizationRole(organization, viewerUserId)
    if (!canManageOrganizationMembersByRole(viewerOrganizationRole)) return
    setManageOrg(organization)
    setManageMemberInputs([createEmptyMemberInput()])
    setManageError(null)
    setManageSuccess(null)
    setManageFeedback(null)
    setRemoveUserIdSubmitting('')
    setMemberRoleEdits({})
  }

  const closeManageModal = () => {
    if (manageSubmitting) return
    setManageOrg(null)
    setManageMemberInputs([createEmptyMemberInput()])
    setManageError(null)
    setManageSuccess(null)
    setManageFeedback(null)
    setRemoveUserIdSubmitting('')
    setMemberRoleEdits({})
  }

  const applyOrganizationUpdate = (organization: OrganizationApiItem) => {
    setOrganizations((previous) => mergeOrganizations(previous, organization))
    setManageOrg((previous) => (previous && previous.id === organization.id ? organization : previous))
    setEditOrg((previous) => (previous && previous.id === organization.id ? organization : previous))
    setDeleteOrg((previous) => (previous && previous.id === organization.id ? organization : previous))
    setConnectionsOrg((previous) => (previous && previous.id === organization.id ? organization : previous))
    setMemberRoleEdits({})
  }

  const openConnectionsModal = (organization: OrganizationApiItem) => {
    const viewerOrganizationRole = resolveViewerOrganizationRole(organization, viewerUserId)
    if (!viewerOrganizationRole) return
    setConnectionsOrg(organization)
    setConnectionsError(null)
    setConnectionsSuccess(null)
    setConnectionsSubmitting(false)
    setRemoveConnectionIdSubmitting('')
  }

  const closeConnectionsModal = () => {
    if (connectionsSubmitting || removeConnectionIdSubmitting) return
    setConnectionsOrg(null)
    setConnectionsError(null)
    setConnectionsSuccess(null)
    setConnectionsSubmitting(false)
    setRemoveConnectionIdSubmitting('')
  }

  const handleConnectYouTube = () => {
    if (!connectionsOrg || !canManageConnectionsForConnectionsOrg) return
    window.location.assign(getYouTubeConnectUrl({ organizationId: connectionsOrg.id, path: '/organizations' }))
  }

  const handleConnectInstagram = () => {
    if (!connectionsOrg || !canManageConnectionsForConnectionsOrg) return
    window.location.assign(getInstagramConnectUrl({ organizationId: connectionsOrg.id, path: '/organizations' }))
  }

  const handleConnectX = () => {
    if (!connectionsOrg || !canManageConnectionsForConnectionsOrg) return
    setConnectionsError(null)
    setConnectionsSuccess(null)
    window.location.assign(getXConnectUrl({ organizationId: connectionsOrg.id, path: '/organizations' }))
  }


  const handleRemoveConnection = async (connectionId: string) => {
    if (!connectionsOrg || !connectionId) return
    if (!canManageConnectionsForConnectionsOrg) {
      setConnectionsError('Brand viewers may view connected accounts but cannot edit them.')
      return
    }
    setRemoveConnectionIdSubmitting(connectionId)
    setConnectionsError(null)
    setConnectionsSuccess(null)
    try {
      const result = await removeOrganizationConnection(connectionsOrg.id, connectionId)
      applyOrganizationUpdate(result.organization)
      setConnectionsSuccess('Connection removed.')
    } catch (err) {
      setConnectionsError(err instanceof Error ? err.message : 'Unable to remove connected account.')
    } finally {
      setRemoveConnectionIdSubmitting('')
    }
  }

  const updateMemberRoleEdit = (
    memberId: string,
    currentRole: OrganizationMemberRole,
    nextRoleInput: string,
  ) => {
    const nextRole = normalizeMemberRole(nextRoleInput)
    setMemberRoleEdits((previous) => {
      if (nextRole === currentRole) {
        const remaining = { ...previous }
        delete remaining[memberId]
        return remaining
      }
      return { ...previous, [memberId]: nextRole }
    })
  }

  const handleAddMembers = async () => {
    if (!manageOrg) return
    if (!canManageMembersForManageOrg) {
      setManageError('Only organization admins can manage organization members.')
      return
    }
    setManageError(null)
    setManageSuccess(null)
    setManageFeedback(null)
    setActionSuccess(null)

    const requestedAddMembers = collectMemberAccess(manageMemberInputs)
    const addMembers = canChangeMemberRolesForManageOrg
      ? requestedAddMembers
      : requestedAddMembers.map((entry) => ({ ...entry, role: 'internal' as OrganizationMemberRole }))
    const roleUpdates = canChangeMemberRolesForManageOrg
      ? resolveOrganizationMembers(manageOrg).reduce<OrganizationMemberRoleUpdateInput[]>(
          (updates, member) => {
            if (!member.id || member.id === manageOrg.creator) return updates
            const currentRole = normalizeMemberRole(member.role)
            const requestedRole = memberRoleEdits[member.id]
            if (!requestedRole || requestedRole === currentRole) return updates
            updates.push({ userId: member.id, role: requestedRole })
            return updates
          },
          [],
        )
      : []

    if (!addMembers.length && !roleUpdates.length) {
      setManageError(
        canChangeMemberRolesForManageOrg
          ? 'Enter at least one valid email to add or update at least one member role.'
          : 'Enter at least one valid email to add.',
      )
      return
    }

    setManageSubmitting(true)
    try {
      const result = await updateOrganizationMembers(manageOrg.id, {
        addMembers: addMembers.length ? addMembers : undefined,
        roleUpdates: roleUpdates.length ? roleUpdates : undefined,
      })
      applyOrganizationUpdate(result.organization)
      setManageMemberInputs([createEmptyMemberInput()])
      setManageSuccess(roleUpdates.length ? 'Members and roles updated.' : 'Members updated.')
      setManageFeedback(result.updateResult)
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Unable to update organization members.')
    } finally {
      setManageSubmitting(false)
    }
  }

  const handleRemoveMember = async (member: OrganizationMember) => {
    if (!manageOrg || !member.id) return
    if (!canManageMembersForManageOrg) {
      setManageError('Only organization admins can manage organization members.')
      return
    }
    setManageError(null)
    setManageSuccess(null)
    setManageFeedback(null)
    setActionSuccess(null)
    setRemoveUserIdSubmitting(member.id)
    setManageSubmitting(true)

    try {
      const result = await updateOrganizationMembers(manageOrg.id, { removeUserIds: [member.id] })
      applyOrganizationUpdate(result.organization)
      setManageSuccess('Member removed.')
      setManageFeedback(result.updateResult)
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Unable to remove member.')
    } finally {
      setRemoveUserIdSubmitting('')
      setManageSubmitting(false)
    }
  }

  const openEditModal = (organization: OrganizationApiItem) => {
    const viewerOrganizationRole = resolveViewerOrganizationRole(organization, viewerUserId)
    if (!canEditOrganizationByRole(viewerOrganizationRole)) return
    setEditOrg(organization)
    setEditName(organization.name)
    setEditCampaignIds([...organization.campaigns])
    setEditError(null)
    setActionSuccess(null)
  }

  const closeEditModal = () => {
    if (editSubmitting) return
    setEditOrg(null)
    setEditName('')
    setEditCampaignIds([])
    setEditError(null)
  }

  const handleSaveEdit = async () => {
    if (!editOrg) return
    if (!canEditOrganizationByRole(editViewerRole)) {
      setEditError('Only organization admin and internal members can edit organizations.')
      return
    }
    setEditError(null)
    setActionSuccess(null)

    const sanitizedName = canEditNameForEditOrg
      ? sanitizeTextInput(editName, { maxLength: 140 })
      : sanitizeTextInput(editOrg.name, { maxLength: 140 })
    if (!sanitizedName) {
      setEditError('Organization name is required.')
      return
    }
    const sanitizedCampaignIds = [...new Set(
      editCampaignIds
        .map((entry) => sanitizeTokenInput(entry, 80))
        .filter((entry) => Boolean(entry)),
    )]

    setEditSubmitting(true)
    try {
      const result = await updateOrganizationDetails(editOrg.id, {
        name: sanitizedName,
        campaigns: sanitizedCampaignIds,
      })
      applyOrganizationUpdate(result.organization)
      setActionSuccess(`Updated organization "${result.organization.name}".`)
      setEditOrg(null)
      setEditName('')
      setEditCampaignIds([])
      setEditError(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update organization.')
    } finally {
      setEditSubmitting(false)
    }
  }

  const openDeleteModal = (organization: OrganizationApiItem) => {
    const viewerOrganizationRole = resolveViewerOrganizationRole(organization, viewerUserId)
    if (!canDeleteOrganizationByRole(viewerOrganizationRole)) return
    setDeleteOrg(organization)
    setDeleteError(null)
    setActionSuccess(null)
  }

  const closeDeleteModal = () => {
    if (deleteSubmitting) return
    setDeleteOrg(null)
    setDeleteError(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteOrg) return
    if (!canDeleteOrganizationByRole(resolveViewerOrganizationRole(deleteOrg, viewerUserId))) {
      setDeleteError('Only organization admin members can delete organizations.')
      return
    }
    setDeleteSubmitting(true)
    setDeleteError(null)
    setActionSuccess(null)
    try {
      await deleteOrganization(deleteOrg.id)
      setOrganizations((previous) => previous.filter((entry) => entry.id !== deleteOrg.id))
      if (manageOrg?.id === deleteOrg.id) {
        setManageOrg(null)
      }
      if (editOrg?.id === deleteOrg.id) {
        setEditOrg(null)
      }
      if (connectionsOrg?.id === deleteOrg.id) {
        setConnectionsOrg(null)
      }
      setActionSuccess(`Deleted organization "${deleteOrg.name}".`)
      setDeleteOrg(null)
      setDeleteError(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete organization.')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  return (
    <>
      <SectionHeader
        title="Organizations"
        subtitle="Create organizations with campaign access and member roles."
      />

      {loadError ? (
        <div className="card">
          <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
            {loadError}
          </div>
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="section-subtitle" style={{ color: 'var(--success)' }}>
            {actionSuccess}
          </div>
        </div>
      ) : null}

      {canCreateOrganizations ? (
        <form className="card" onSubmit={handleCreateOrganization}>
          <div className="section-title">Create organization</div>
          <div className="section-subtitle">Members are added by email and stored as user UUID role mappings.</div>

          <div className="grid grid-2" style={{ marginTop: '16px' }}>
            <label className="form-field">
              <span>Organization name</span>
              <input
                className="input"
                type="text"
                value={orgName}
                onChange={(event) => setOrgName(sanitizeNameInput(event.target.value))}
                placeholder="Organization name"
                autoComplete="off"
                maxLength={140}
                required
              />
            </label>
          </div>

          <div style={{ marginTop: '18px' }}>
            <div className="section-title" style={{ fontSize: '14px' }}>
              Campaign access
            </div>
            <div className="section-subtitle">Campaigns you can access are shown here.</div>
            {campaignLoadError ? (
              <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '6px' }}>
                {campaignLoadError}
              </div>
            ) : null}
            <div className="check-row" style={{ marginTop: '10px' }}>
              {campaigns.map((campaign) => (
                <label key={campaign.id} className="check-pill">
                  <input
                    type="checkbox"
                    checked={selectedCampaignIds.includes(campaign.id)}
                    onChange={() => toggleCampaign(campaign.id)}
                  />
                  <span>{sanitizeTextInput(campaign.campaignName, { maxLength: 140 }) || campaign.id}</span>
                </label>
              ))}
              {!campaigns.length ? <span className="muted">No accessible campaigns were found.</span> : null}
            </div>
          </div>

          <div style={{ marginTop: '20px' }}>
            <div className="section-title" style={{ fontSize: '14px' }}>
              Member emails
            </div>
            <div className="section-subtitle">Assign admin, internal, or brand viewer per email.</div>
            <div className="grid" style={{ marginTop: '10px' }}>
              {createMemberInputs.map((entry, index) => (
                <div key={entry.rowId} className="split">
                  <input
                    className="input"
                    type="email"
                    value={entry.email}
                    onChange={(event) =>
                      updateMemberInput(setCreateMemberInputs, entry.rowId, 'email', event.target.value)}
                    placeholder="name@company.com"
                    autoComplete="off"
                    aria-label={`Organization member email ${index + 1}`}
                  />
                        <select
                          className="select"
                          value={entry.role}
                          onChange={(event) =>
                            updateMemberInput(setCreateMemberInputs, entry.rowId, 'role', event.target.value)}
                          aria-label={`Organization member role ${index + 1}`}
                          style={{ minWidth: roleSelectMinWidth }}
                        >
                          {memberRoleOptions.map((option) => (
                            <option key={option} value={option}>
                              {formatMemberRoleLabel(option)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => removeMemberInput(setCreateMemberInputs, entry.rowId)}
                    disabled={createMemberInputs.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="filter-bar" style={{ marginTop: '10px' }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setCreateMemberInputs((previous) => [...previous, createEmptyMemberInput()])}
              >
                Add member email
              </button>
              <label className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                Import CSV emails
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(event) => void handleCreateCsvImport(event)}
                />
              </label>
            </div>
          </div>

          {createError ? (
            <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '12px' }}>
              {createError}
            </div>
          ) : null}
          {createSuccess ? (
            <div className="section-subtitle" style={{ color: 'var(--success)', marginTop: '12px' }}>
              {createSuccess}
            </div>
          ) : null}
          {createFeedback && hasResolutionRows(createFeedback) ? (
            <MemberFeedback title="Create member processing" summary={createFeedback} />
          ) : null}

          <div className="modal-actions">
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create organization'}
            </button>
           
          </div>
        </form>
      ) : (
        <div className="card">
          <div className="section-subtitle">Only admins can create organizations.</div>
        </div>
      )}

      {isLoading ? (
        <div className="card">
          <div className="section-subtitle">Loading organizations...</div>
        </div>
      ) : null}

      {!isLoading && !organizations.length ? (
        <div className="card">
          <div className="section-subtitle">No organizations are visible to your account yet.</div>
        </div>
      ) : null}

      {!isLoading && sortedOrganizations.length ? (
        <div className="grid grid-2">
          {sortedOrganizations.map((organization) => {
            const members = sortOrganizationMembers(
              organization,
              resolveOrganizationMembers(organization),
            )
            const creatorEmail = sanitizeEmailInput(
              organization.creatorEmail || members.find((member) => member.id === organization.creator)?.email || '',
            )
            const viewerOrganizationRole = resolveViewerOrganizationRole(organization, viewerUserId)
            const canEditOrganization = canEditOrganizationByRole(viewerOrganizationRole)
            const canDeleteOrganization = canDeleteOrganizationByRole(viewerOrganizationRole)
            const canManageOrganizationMembers = canManageOrganizationMembersByRole(viewerOrganizationRole)
            const canEditOrganizationName = canEditOrganizationNameByRole(viewerOrganizationRole)
            const canManageOrganizationConnections = canManageOrganizationConnectionsByRole(viewerOrganizationRole)
            const connectedAccountLabels = organization.connectedAccounts.map((account) =>
              formatConnectedAccountLabel(account),
            )
            return (
              <div key={organization.id} className="card" style={{ position: 'relative' }}>
                {canDeleteOrganization ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: '8px',
                    }}
                  >
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ width: '32px', minWidth: '32px', padding: '4px 0' }}
                      aria-label={`Delete ${organization.name || 'organization'}`}
                      onClick={() => openDeleteModal(organization)}
                    >
                      X
                    </button>
                  </div>
                ) : null}
                <div className="split">
                  <div>
                    <div className="section-title">{organization.name || 'Untitled organization'}</div>
                    <div className="section-subtitle">Created {formatDateTime(organization.createdAt)}</div>
                  </div>
                </div>

                <div className="grid grid-3" style={{ marginTop: '14px' }}>
                  <div className="kpi">
                    <div className="kpi-label">Campaigns</div>
                    <div className="kpi-value" style={{ fontSize: '18px' }}>
                      {organization.campaigns.length}
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Members</div>
                    <div className="kpi-value" style={{ fontSize: '18px' }}>
                      {members.length}
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Creator</div>
                    <div className="kpi-value" style={{ fontSize: '12px' }}>
                      {creatorEmail || 'Unknown email'}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '14px' }}>
                  <div className="section-subtitle">Campaigns</div>
                  <div className="grid" style={{ marginTop: '6px', gap: '6px' }}>
                    {organization.campaigns.length ? (
                      organization.campaigns.map((campaignId) => (
                        <div key={campaignId} style={{ fontSize: '12px' }}>
                          {campaignLabelById.get(campaignId) ?? campaignId}
                        </div>
                      ))
                    ) : (
                      <div className="muted" style={{ fontSize: '12px' }}>
                        No campaigns assigned.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '14px' }}>
                  <div className="section-subtitle">Members</div>
                  <div className="grid" style={{ marginTop: '6px', gap: '6px' }}>
                    {members.length ? (
                      members.map((member) => {
                        const isViewer = Boolean(normalizedViewerId && member.id === normalizedViewerId)
                        return (
                        <div
                          key={member.id}
                          className={`split member-row ${isViewer ? 'self' : ''}`}
                          style={{ fontSize: '12px', borderBottom: '1px dashed var(--border)', paddingBottom: '4px' }}
                        >
                          <span>{member.email || member.id}</span>
                          {isViewer ? <span className="pill self-tag">You</span> : null}
                          <span className="pill">{member.role}</span>
                        </div>
                      )})
                    ) : (
                      <div className="muted" style={{ fontSize: '12px' }}>
                        No members assigned.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '14px' }}>
                  <div className="section-subtitle">Connected accounts</div>
                  <div className="grid" style={{ marginTop: '6px', gap: '6px' }}>
                    {connectedAccountLabels.length ? (
                      connectedAccountLabels.map((label) => (
                        <div key={label} style={{ fontSize: '12px' }}>
                          {label}
                        </div>
                      ))
                    ) : (
                      <div className="muted" style={{ fontSize: '12px' }}>
                        No accounts connected.
                      </div>
                    )}
                  </div>
                </div>

                {canEditOrganization || canManageOrganizationMembers || canManageOrganizationConnections ? (
                  <div className="modal-actions" style={{ marginTop: '14px' }}>
                    {canEditOrganization ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openEditModal(organization)}
                      >
                        {canEditOrganizationName ? 'Edit Organization' : 'Manage Campaigns'}
                      </button>
                    ) : null}
                    {canManageOrganizationMembers ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openManageModal(organization)}
                      >
                        Manage members
                      </button>
                    ) : null}
                    {canManageOrganizationConnections ? (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => openConnectionsModal(organization)}
                      >
                        Manage Connections
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {editOrg ? (
        <div className="modal-backdrop" role="presentation" onClick={closeEditModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">Edit organization</div>
            <div className="section-subtitle">
              {canEditNameForEditOrg
                ? 'Update organization name and campaign access.'
                : 'Update campaign access. Organization name is read-only for internal members.'}
            </div>

            <label className="form-field" style={{ marginTop: '14px' }}>
              <span>Organization name</span>
              <input
                className="input"
                type="text"
                value={editName}
                onChange={(event) => setEditName(sanitizeNameInput(event.target.value))}
                placeholder="Organization name"
                autoComplete="off"
                maxLength={140}
                disabled={!canEditNameForEditOrg}
              />
            </label>

            <div style={{ marginTop: '14px' }}>
              <div className="section-subtitle">Campaign access</div>
              <div className="check-row" style={{ marginTop: '8px' }}>
                {campaigns.map((campaign) => (
                  <label key={campaign.id} className="check-pill">
                    <input
                      type="checkbox"
                      checked={editCampaignIds.includes(campaign.id)}
                      onChange={() => toggleEditCampaign(campaign.id)}
                    />
                    <span>{sanitizeTextInput(campaign.campaignName, { maxLength: 140 }) || campaign.id}</span>
                  </label>
                ))}
              </div>
            </div>

            {editError ? (
              <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '12px' }}>
                {editError}
              </div>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeEditModal} disabled={editSubmitting}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void handleSaveEdit()} disabled={editSubmitting}>
                {editSubmitting ? 'Saving...' : canEditNameForEditOrg ? 'Save changes' : 'Save campaigns'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOrg ? (
        <div className="modal-backdrop" role="presentation" onClick={closeDeleteModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">Delete organization?</div>
            <div className="section-subtitle">
              Are you sure you want to delete "{deleteOrg.name || 'this organization'}"? This cannot be undone.
            </div>

            {deleteError ? (
              <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '12px' }}>
                {deleteError}
              </div>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeDeleteModal} disabled={deleteSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleteSubmitting}
                style={{ background: 'var(--danger)' }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete organization'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {manageOrg ? (
        <div className="modal-backdrop" role="presentation" onClick={closeManageModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">Manage organization members</div>
            <div className="section-subtitle">{manageOrg.name}</div>

            <div style={{ marginTop: '12px' }}>
              <div className="section-subtitle">Current members</div>
              <div className="grid" style={{ marginTop: '8px', gap: '8px' }}>
                {sortOrganizationMembers(manageOrg, resolveOrganizationMembers(manageOrg)).map((member) => {
                  const isViewer = Boolean(normalizedViewerId && member.id === normalizedViewerId)
                  return (
                  <div
                    key={member.id}
                    className={`split member-row ${isViewer ? 'self' : ''}`}
                    style={{ fontSize: '13px' }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{member.email || member.id}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {isViewer ? <span className="pill self-tag">You</span> : null}
                      {member.id === manageOrg.creator ? (
                        <span className="pill">Creator</span>
                      ) : (
                        <select
                          className="select"
                          value={memberRoleEdits[member.id] ?? normalizeMemberRole(member.role)}
                          onChange={(event) => {
                            if (!canChangeMemberRolesForManageOrg) {
                              setManageError('Only organization admin members can change member roles.')
                              return
                            }
                            updateMemberRoleEdit(
                              member.id,
                              normalizeMemberRole(member.role),
                              event.target.value,
                            )
                          }}
                          disabled={manageSubmitting}
                          aria-label={`Organization member role for ${member.email || member.id}`}
                          style={{ minWidth: roleSelectMinWidth }}
                        >
                          {memberRoleOptions.map((option) => (
                            <option key={option} value={option}>
                              {formatMemberRoleLabel(option)}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void handleRemoveMember(member)}
                        disabled={!canManageMembersForManageOrg || manageSubmitting || member.id === manageOrg.creator}
                      >
                        {removeUserIdSubmitting === member.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            </div>

            <div style={{ marginTop: '16px' }}>
              <div className="section-subtitle">Add members by email</div>
              <div className="grid" style={{ marginTop: '8px' }}>
                {manageMemberInputs.map((entry) => (
                  <div key={entry.rowId} className="split">
                    <input
                      className="input"
                      type="email"
                      value={entry.email}
                      onChange={(event) =>
                        updateMemberInput(setManageMemberInputs, entry.rowId, 'email', event.target.value)}
                      placeholder="name@company.com"
                      autoComplete="off"
                    />
                    <select
                      className="select"
                      value={entry.role}
                      onChange={(event) => {
                        if (!canChangeMemberRolesForManageOrg) {
                          setManageError('Only organization admin members can change member roles.')
                          return
                        }
                        updateMemberInput(setManageMemberInputs, entry.rowId, 'role', event.target.value)
                      }}
                      disabled={manageSubmitting}
                      style={{ minWidth: roleSelectMinWidth }}
                    >
                      {memberRoleOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatMemberRoleLabel(option)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeMemberInput(setManageMemberInputs, entry.rowId)}
                      disabled={manageMemberInputs.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="filter-bar" style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setManageMemberInputs((previous) => [...previous, createEmptyMemberInput()])}
                  disabled={manageSubmitting}
                >
                  Add row
                </button>
                <label className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  Import CSV emails
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: 'none' }}
                    onChange={(event) => void handleManageCsvImport(event)}
                    disabled={manageSubmitting}
                  />
                </label>
              </div>
            </div>

            {manageError ? (
              <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '12px' }}>
                {manageError}
              </div>
            ) : null}
            {manageSuccess ? (
              <div className="section-subtitle" style={{ color: 'var(--success)', marginTop: '12px' }}>
                {manageSuccess}
              </div>
            ) : null}
            {manageFeedback && hasResolutionRows(manageFeedback) ? (
              <MemberFeedback title="Member update processing" summary={manageFeedback} />
            ) : null}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeManageModal} disabled={manageSubmitting}>
                Close
              </button>
              <button type="button" className="primary-button" onClick={() => void handleAddMembers()} disabled={manageSubmitting}>
                {manageSubmitting ? 'Saving...' : canChangeMemberRolesForManageOrg ? 'Save member changes' : 'Add members'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {connectionsOrg ? (
        <div className="modal-backdrop" role="presentation" onClick={closeConnectionsModal}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">Manage Connections</div>
            <div className="section-subtitle">{connectionsOrg.name}</div>
            {!canManageConnectionsForConnectionsOrg ? (
              <div className="section-subtitle" style={{ marginTop: '8px' }}>
                Read-only access. Only organization admins can edit connected accounts.
              </div>
            ) : null}

            <div style={{ marginTop: '14px' }}>
              <div className="section-subtitle">Connected accounts</div>
              <div className="grid" style={{ marginTop: '8px', gap: '8px' }}>
                {connectionsOrg.connectedAccounts.length ? (
                  connectionsOrg.connectedAccounts.map((account) => (
                    <div key={account.id} className="split member-row" style={{ fontSize: '13px' }}>
                      <span>{formatConnectedAccountLabel(account)}</span>
                      {canManageConnectionsForConnectionsOrg ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleRemoveConnection(account.id)}
                          disabled={Boolean(removeConnectionIdSubmitting)}
                        >
                          {removeConnectionIdSubmitting === account.id ? 'Removing...' : 'Disconnect'}
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="muted">No accounts connected.</div>
                )}
              </div>
            </div>

            {canManageConnectionsForConnectionsOrg ? (
              <>
                <div style={{ marginTop: '16px' }}>
                  <div className="section-subtitle">Connect YouTube</div>
                  <div className="filter-bar" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleConnectYouTube}
                      disabled={connectionsSubmitting || Boolean(removeConnectionIdSubmitting)}
                    >
                      Connect YouTube Account
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: '16px' }}>
                  <div className="section-subtitle">Connect Instagram</div>
                  <div className="section-subtitle" style={{ marginTop: '4px' }}>
                    Connect through Instagram OAuth to link an account to this organization.
                  </div>
                  <div className="filter-bar" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleConnectInstagram}
                      disabled={connectionsSubmitting || Boolean(removeConnectionIdSubmitting)}
                    >
                      Connect Instagram Account
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: '16px' }}>
                  <div className="section-subtitle">Connect X/Twitter</div>
                  <div className="section-subtitle" style={{ marginTop: '4px' }}>
                    Connect through X OAuth to link the signed-in X account to this organization.
                  </div>
                  <div className="filter-bar" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleConnectX}
                      disabled={connectionsSubmitting || Boolean(removeConnectionIdSubmitting)}
                    >
                      Connect X Account
                    </button>
                  </div>
                </div>

              </>
            ) : null}

            {connectionsError ? (
              <div className="section-subtitle" style={{ color: 'var(--danger)', marginTop: '12px' }}>
                {connectionsError}
              </div>
            ) : null}
            {connectionsSuccess ? (
              <div className="section-subtitle" style={{ color: 'var(--success)', marginTop: '12px' }}>
                {connectionsSuccess}
              </div>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeConnectionsModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
