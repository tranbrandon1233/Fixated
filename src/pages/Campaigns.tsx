import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { SectionHeader } from '../components/ui/SectionHeader'
import type { CampaignSummary, Role } from '../types/dashboard'
import {
  createCampaign,
  deleteCampaign,
  fetchCampaignAvailablePosts,
  fetchCampaignMembers,
  fetchCampaigns,
  updateCampaignDetails,
  updateCampaignPosts,
  updateCampaignMembers,
  type CampaignApiItem,
  type CampaignManagedPost,
  type CampaignMemberRole,
  type MemberAccessInput,
  type CampaignMember,
  type MemberResolutionItem,
  type MemberResolutionSummary,
} from '../utils/campaigns'
import { formatNumber, formatPercent } from '../utils/format'
import { resolveCampaignLifecycle } from '../utils/campaignPerformance'
import {
  sanitizeDateInput,
  sanitizeEmailInput,
  sanitizeTextInput,
  sanitizeTokenInput,
} from '../utils/sanitize'

interface CampaignCardModel extends CampaignSummary {
  creator: string
  allowedMemberRoles: Record<string, CampaignMemberRole>
  selectedPostIds: string[]
  selectedChannelId?: string
}

interface FeedbackState {
  title: string
  summary: MemberResolutionSummary
  submittedEmails?: string[]
}

interface MemberInputRow {
  email: string
  role: CampaignMemberRole
}

interface CampaignChannelOption {
  id: string
  label: string
}

interface CampaignChannelSelectionState extends CampaignChannelOption {
  totalPosts: number
  selectedPosts: number
  checked: boolean
  partial: boolean
}

interface CampaignsProps {
  role: Role
}

type CampaignViewerRole = CampaignMemberRole | ''

const hasResolutionRows = (summary: MemberResolutionSummary) => flattenResolutionItems(summary).length > 0

const statusTone = (status: string) => {
  if (status === 'Overdelivering') return 'success'
  if (status === 'At Risk') return 'danger'
  if (status === 'Active') return 'warning'
  return 'default'
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeEmail = (value: string) => sanitizeEmailInput(value)
const normalizePostId = (value: string) => sanitizeTokenInput(value, 300)
const sanitizeNumericInput = (value: string) =>
  sanitizeTextInput(value, { maxLength: 24 }).replace(/[^0-9.]/g, '')
const sanitizeEmailFieldInput = (value: string) =>
  sanitizeTextInput(value, { maxLength: 320, trim: false })

const resolveViewerCampaignRole = (
  campaign: CampaignCardModel,
  viewerUserId: string,
): CampaignViewerRole => {
  const normalizedViewerId = sanitizeTokenInput(viewerUserId, 80)
  if (!normalizedViewerId) return ''
  if (campaign.creator === normalizedViewerId) return 'admin'
  const memberRole = campaign.allowedMemberRoles?.[normalizedViewerId]
  return memberRole ? normalizeMemberRole(memberRole) : ''
}

const campaignRolePriority: Record<CampaignMemberRole, number> = {
  'brand viewer': 1,
  internal: 2,
  admin: 3,
}

const normalizeMemberRole = (value: unknown): CampaignMemberRole => {
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
  if (normalized === 'member') return 'internal'
  return 'internal'
}

const formatCampaignMemberRoleLabel = (role: CampaignMemberRole) => {
  if (role === 'brand viewer') return 'Brand Viewer'
  if (role === 'internal') return 'Internal'
  return 'Admin'
}

const campaignMemberRoleOptions: CampaignMemberRole[] = ['admin', 'internal', 'brand viewer']

const createEmptyMemberInput = (): MemberInputRow => ({ email: '', role: 'internal' })

const buildMemberInputSignature = (inputs: MemberInputRow[]) =>
  JSON.stringify(
    inputs.map((entry) => ({
      email: normalizeEmail(entry.email),
      role: normalizeMemberRole(entry.role),
    })),
  )

const collectMemberInputs = (inputs: MemberInputRow[]): MemberAccessInput[] => {
  const roleByEmail = new Map<string, CampaignMemberRole>()
  inputs.forEach((entry) => {
    const normalizedEmail = normalizeEmail(entry.email)
    if (!normalizedEmail) return
    const normalizedRole = normalizeMemberRole(entry.role)
    const existingRole = roleByEmail.get(normalizedEmail)
    if (!existingRole || campaignRolePriority[normalizedRole] > campaignRolePriority[existingRole]) {
      roleByEmail.set(normalizedEmail, normalizedRole)
    }
  })
  return [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
}

const extractEmailsFromCsvText = (content: string) => {
  const matches = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return [...new Set(matches.map((entry) => normalizeEmail(entry)))]
}

const mergeEmailInputs = (current: MemberInputRow[], additions: string[]) => {
  const merged = [...current]
  additions.forEach((email) => {
    const normalized = normalizeEmail(email)
    if (!normalized) return
    const exists = merged.some((entry) => normalizeEmail(entry.email) === normalized)
    if (!exists) merged.push({ email: normalized, role: 'internal' })
  })
  return merged.length ? merged : [createEmptyMemberInput()]
}

const resolveDistribution = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return { brand: 'Unknown brand', ono: 0, clipper: 0 }
  }
  const source = value as Record<string, unknown>
  const brand = sanitizeTextInput(source.brand, { maxLength: 140 }) || 'Unknown brand'
  return {
    brand,
    ono: toNumber(source.ono),
    clipper: toNumber(source.clipper),
  }
}

const mapCampaignToCard = (campaign: CampaignApiItem): CampaignCardModel => {
  const guaranteedViews = toNumber(campaign.guaranteed)
  const deliveredViews = toNumber(campaign.viewsDelivered)
  const engagementRate = toNumber(campaign.engagementRate)
  const deliveredEngagements = deliveredViews > 0 ? Math.round((deliveredViews * engagementRate) / 100) : 0
  const guaranteedEngagements = guaranteedViews > 0 ? Math.round((guaranteedViews * engagementRate) / 100) : 0
  const distribution = resolveDistribution(campaign.distributionSources)
  const lifecycle = resolveCampaignLifecycle({
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    guaranteedViews,
    deliveredViews,
  })
  const sanitizedSelectedChannelId = sanitizeTokenInput(campaign.selectedChannelId, 300)

  return {
    id: campaign.id,
    name: sanitizeTextInput(campaign.campaignName, { maxLength: 140 }) || 'Untitled campaign',
    brand: sanitizeTextInput(campaign.brand, { maxLength: 140 }) || distribution.brand,
    status: lifecycle.status,
    startDate: sanitizeTokenInput(campaign.startDate, 32),
    endDate: sanitizeTokenInput(campaign.endDate, 32),
    guaranteedViews,
    deliveredViews,
    guaranteedEngagements,
    deliveredEngagements,
    pacing: lifecycle.pacing,
    distribution: {
      ono: distribution.ono,
      clipper: distribution.clipper,
    },
    creator: campaign.creator,
    allowedMemberRoles: campaign.allowedMemberRoles ?? {},
    selectedPostIds: Array.isArray(campaign.selectedPostIds)
      ? [...new Set(campaign.selectedPostIds.map((entry) => normalizePostId(entry)).filter(Boolean))]
      : [],
    selectedChannelId: sanitizedSelectedChannelId || undefined,
  }
}

const flattenResolutionItems = (summary: MemberResolutionSummary): MemberResolutionItem[] => [
  ...summary.added.map((entry) => ({ ...entry, action: 'add' as const })),
  ...summary.removed.map((entry) => ({ ...entry, action: 'remove' as const })),
  ...summary.failed,
]

const MemberFeedback = ({ feedback }: { feedback: FeedbackState }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const rows = flattenResolutionItems(feedback.summary)
  const submittedEmails = [...new Set((feedback.submittedEmails ?? []).map((entry) => normalizeEmail(entry)).filter(Boolean))]
  const resolvedEmails = [
    ...new Set(
      [...feedback.summary.added, ...feedback.summary.removed]
        .map((entry) => normalizeEmail(entry.email))
        .filter(Boolean),
    ),
  ]
  const failedEmails = feedback.summary.failed
    .map((entry) => normalizeEmail(entry.email))
    .filter((entry) => entry.length > 0)
  const canCopyFailed = failedEmails.length > 0

  const handleCopyFailed = async () => {
    if (!canCopyFailed) return
    try {
      await navigator.clipboard.writeText([...new Set(failedEmails)].join('\n'))
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
    window.setTimeout(() => setCopyState('idle'), 1500)
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="split">
        <div className="section-title">{feedback.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="section-subtitle">
            Added {feedback.summary.added.length} | Removed {feedback.summary.removed.length} | Failed{' '}
            {feedback.summary.failed.length}
          </div>
          {canCopyFailed ? (
            <button className="ghost-button" type="button" onClick={() => void handleCopyFailed()}>
              {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy failed emails'}
            </button>
          ) : null}
        </div>
      </div>
      {submittedEmails.length ? (
        <div
          style={{
            marginTop: '10px',
            border: '1px dashed var(--border)',
            borderRadius: '10px',
            padding: '8px 10px',
            display: 'grid',
            gap: '4px',
            fontSize: '12px',
          }}
        >
          <div>
            <strong>Submitted ({submittedEmails.length}):</strong> {submittedEmails.join(', ')}
          </div>
          <div>
            <strong>Resolved ({resolvedEmails.length}):</strong>{' '}
            {resolvedEmails.length ? resolvedEmails.join(', ') : 'None'}
          </div>
          <div>
            <strong>Failed ({failedEmails.length}):</strong> {failedEmails.length ? failedEmails.join(', ') : 'None'}
          </div>
        </div>
      ) : null}
      <div
        style={{
          marginTop: '10px',
          maxHeight: '180px',
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '8px 10px',
        }}
      >
        {rows.length ? (
          rows.map((entry, index) => {
            const tone = entry.error ? 'var(--danger)' : 'var(--muted)'
            const prefix =
              entry.action === 'remove' ? 'Remove' : entry.action === 'add' ? 'Add' : 'Result'
            return (
              <div
                key={`${entry.email}-${entry.action ?? 'none'}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '84px 1fr',
                  gap: '8px',
                  fontSize: '13px',
                  padding: '4px 0',
                  borderBottom: index < rows.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span className="muted">{prefix}</span>
                <span style={{ color: tone }}>
                  <strong>{entry.email}</strong> - {entry.message}
                </span>
              </div>
            )
          })
        ) : (
          <div className="muted" style={{ fontSize: '13px' }}>
            No member emails were processed.
          </div>
        )}
      </div>
    </div>
  )
}

export const Campaigns = ({ role }: CampaignsProps) => {
  const [campaignList, setCampaignList] = useState<CampaignCardModel[]>([])
  const [viewerUserId, setViewerUserId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedbackModal, setFeedbackModal] = useState<FeedbackState | null>(null)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [hasCreateSubmitAttempt, setHasCreateSubmitAttempt] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftBrand, setDraftBrand] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [draftGuaranteedViews, setDraftGuaranteedViews] = useState('')
  const [draftGuaranteedEngagements, setDraftGuaranteedEngagements] = useState('')
  const [inviteEmails, setInviteEmails] = useState<MemberInputRow[]>([createEmptyMemberInput()])

  const [manageCampaign, setManageCampaign] = useState<CampaignCardModel | null>(null)
  const [members, setMembers] = useState<CampaignMember[]>([])
  const [manageLoading, setManageLoading] = useState(false)
  const [manageSubmitting, setManageSubmitting] = useState(false)
  const [manageError, setManageError] = useState<string | null>(null)
  const [addEmailInputs, setAddEmailInputs] = useState<MemberInputRow[]>([createEmptyMemberInput()])
  const [manageAddInputsBaseline, setManageAddInputsBaseline] = useState(
    buildMemberInputSignature([createEmptyMemberInput()]),
  )
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, CampaignMemberRole>>({})
  const [removeMemberTarget, setRemoveMemberTarget] = useState<CampaignMember | null>(null)
  const [removeMemberSubmitting, setRemoveMemberSubmitting] = useState(false)
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null)
  const [deleteCampaignTarget, setDeleteCampaignTarget] = useState<CampaignCardModel | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editCampaignTarget, setEditCampaignTarget] = useState<CampaignCardModel | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [hasEditSubmitAttempt, setHasEditSubmitAttempt] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBrand, setEditBrand] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editGuaranteedViews, setEditGuaranteedViews] = useState('')
  const [editGuaranteedEngagements, setEditGuaranteedEngagements] = useState('')
  const [managePostsCampaign, setManagePostsCampaign] = useState<CampaignCardModel | null>(null)
  const [managePostsSubmitting, setManagePostsSubmitting] = useState(false)
  const [managePostsError, setManagePostsError] = useState<string | null>(null)
  const [managePostsLoading, setManagePostsLoading] = useState(false)
  const [availableConnectedAccounts, setAvailableConnectedAccounts] = useState<string[]>([])
  const [availablePosts, setAvailablePosts] = useState<CampaignManagedPost[]>([])
  const [campaignChannelOptions, setCampaignChannelOptions] = useState<CampaignChannelOption[]>([
    { id: 'all', label: 'All connected accounts' },
  ])
  const [selectedPostIdsDraft, setSelectedPostIdsDraft] = useState<string[]>([])
  const [selectedPostChannelId, setSelectedPostChannelId] = useState('all')
  const canCreateCampaignByRole = role === 'admin'

  const todayDate = useMemo(() => {
    const now = new Date()
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    return localTime.toISOString().slice(0, 10)
  }, [])

  const minEndDate = useMemo(() => {
    if (!draftStart || draftStart < todayDate) return todayDate
    return draftStart
  }, [draftStart, todayDate])

  const minEditEndDate = useMemo(() => {
    if (!editStart) return ''
    return editStart
  }, [editStart])

  const manageViewerRole = useMemo<CampaignViewerRole>(() => {
    if (!manageCampaign) return ''
    return resolveViewerCampaignRole(manageCampaign, viewerUserId)
  }, [manageCampaign, viewerUserId])
  const normalizedViewerId = useMemo(() => sanitizeTokenInput(viewerUserId, 80), [viewerUserId])
  const isManageViewerAdmin = manageViewerRole === 'admin'
  // Campaign member assignment is managed from the organization member modal.
  const canManageMembersForManageCampaign = false

  const sortedMembers = useMemo(() => {
    if (!manageCampaign) return members
    const creatorId = manageCampaign.creator
    return [...members].sort((left, right) => {
      if (left.id === creatorId && right.id !== creatorId) return -1
      if (right.id === creatorId && left.id !== creatorId) return 1
      const leftLabel = (left.email || left.id).toLowerCase()
      const rightLabel = (right.email || right.id).toLowerCase()
      return leftLabel.localeCompare(rightLabel)
    })
  }, [manageCampaign, members])

  const pendingAddMembers = useMemo(() => {
    return canManageMembersForManageCampaign
      ? collectMemberInputs(addEmailInputs)
      : []
  }, [addEmailInputs, canManageMembersForManageCampaign])

  const pendingRoleUpdates = useMemo(() => {
    if (!manageCampaign) return []
    return sortedMembers
      .filter((member) => member.id !== manageCampaign.creator)
      .map((member) => {
        const requestedRole = memberRoleEdits[member.id]
        if (!requestedRole) return null
        const currentRole = normalizeMemberRole(member.role)
        if (requestedRole === currentRole) return null
        return { userId: member.id, role: requestedRole }
      })
      .filter(
        (
          entry,
        ): entry is {
          userId: string
          role: CampaignMemberRole
        } => Boolean(entry),
      )
  }, [manageCampaign, memberRoleEdits, sortedMembers])

  const addInputSignature = useMemo(() => buildMemberInputSignature(addEmailInputs), [addEmailInputs])

  const hasPendingManageChanges = useMemo(
    () =>
      addInputSignature !== manageAddInputsBaseline || Object.keys(memberRoleEdits).length > 0,
    [addInputSignature, manageAddInputsBaseline, memberRoleEdits],
  )

  const visiblePostsForChannel = useMemo(() => {
    if (selectedPostChannelId === 'all') return availablePosts
    const hasChannelTaggedPosts = availablePosts.some((post) => Boolean(post.channelId))
    if (!hasChannelTaggedPosts) return availablePosts
    return availablePosts.filter((post) => post.channelId === selectedPostChannelId)
  }, [availablePosts, selectedPostChannelId])

  const selectedCampaignPosts = useMemo(() => {
    if (!selectedPostIdsDraft.length || !availablePosts.length) return []
    const selectedIds = new Set(selectedPostIdsDraft.map((entry) => normalizePostId(entry)))
    return availablePosts.filter((post) => selectedIds.has(normalizePostId(post.id)))
  }, [availablePosts, selectedPostIdsDraft])

  const selectedPostIdSet = useMemo(
    () => new Set(selectedPostIdsDraft.map((entry) => normalizePostId(entry)).filter(Boolean)),
    [selectedPostIdsDraft],
  )

  const campaignChannelSelectableOptions = useMemo(
    () => campaignChannelOptions.filter((option) => option.id !== 'all'),
    [campaignChannelOptions],
  )

  const postIdsByChannelId = useMemo(() => {
    const grouped = new Map<string, Set<string>>()
    availablePosts.forEach((post) => {
      const channelId = sanitizeTokenInput(post.channelId, 300)
      const postId = normalizePostId(post.id)
      if (!channelId || !postId) return
      const existing = grouped.get(channelId) ?? new Set<string>()
      existing.add(postId)
      grouped.set(channelId, existing)
    })
    return new Map(
      [...grouped.entries()].map(([channelId, postIds]) => [channelId, [...postIds.values()]]),
    )
  }, [availablePosts])

  const campaignChannelSelections = useMemo<CampaignChannelSelectionState[]>(
    () =>
      campaignChannelSelectableOptions.map((option) => {
        const postIds = postIdsByChannelId.get(option.id) ?? []
        const selectedPosts = postIds.reduce(
          (count, postId) => (selectedPostIdSet.has(postId) ? count + 1 : count),
          0,
        )
        const totalPosts = postIds.length
        return {
          ...option,
          totalPosts,
          selectedPosts,
          checked: totalPosts > 0 && selectedPosts === totalPosts,
          partial: selectedPosts > 0 && selectedPosts < totalPosts,
        }
      }),
    [campaignChannelSelectableOptions, postIdsByChannelId, selectedPostIdSet],
  )

  const availablePostIdSet = useMemo(
    () => new Set(availablePosts.map((post) => normalizePostId(post.id)).filter(Boolean)),
    [availablePosts],
  )

  const selectedPostTotals = useMemo(() => {
    const totals = selectedCampaignPosts.reduce(
      (accumulator, post) => {
        const views = toNumber(post.views)
        const engagementRate = toNumber(post.engagementRate)
        accumulator.views += views
        accumulator.engagements += (views * engagementRate) / 100
        return accumulator
      },
      { views: 0, engagements: 0 },
    )
    return {
      viewsDelivered: Math.round(totals.views),
      engagementRate: totals.views > 0 ? (totals.engagements / totals.views) * 100 : 0,
    }
  }, [selectedCampaignPosts])

  const resetCreateDraft = () => {
    setHasCreateSubmitAttempt(false)
    setDraftName('')
    setDraftBrand('')
    setDraftStart('')
    setDraftEnd('')
    setDraftGuaranteedViews('')
    setDraftGuaranteedEngagements('')
    setInviteEmails([createEmptyMemberInput()])
  }

  const createRequiredFieldErrors = useMemo(() => {
    return {
      draftName: !draftName.trim() ? 'Campaign name is required.' : '',
      draftBrand: !draftBrand.trim() ? 'Brand is required.' : '',
      draftStart: !draftStart ? 'Start date is required.' : '',
      draftEnd: !draftEnd ? 'End date is required.' : '',
      draftGuaranteedViews: !draftGuaranteedViews ? 'Guaranteed views is required.' : '',
      draftGuaranteedEngagements: !draftGuaranteedEngagements ? 'Guaranteed engagements is required.' : '',
    }
  }, [draftBrand, draftEnd, draftGuaranteedEngagements, draftGuaranteedViews, draftName, draftStart])

  const hasMissingRequiredCreateField = useMemo(() => {
    return Object.values(createRequiredFieldErrors).some(Boolean)
  }, [createRequiredFieldErrors])

  const editRequiredFieldErrors = useMemo(() => {
    return {
      editName: !editName.trim() ? 'Campaign name is required.' : '',
      editBrand: !editBrand.trim() ? 'Brand is required.' : '',
      editStart: !editStart ? 'Start date is required.' : '',
      editEnd: !editEnd ? 'End date is required.' : '',
      editGuaranteedViews: !editGuaranteedViews ? 'Guaranteed views is required.' : '',
      editGuaranteedEngagements: !editGuaranteedEngagements ? 'Guaranteed engagements is required.' : '',
    }
  }, [editBrand, editEnd, editGuaranteedEngagements, editGuaranteedViews, editName, editStart])

  const hasMissingRequiredEditField = useMemo(() => {
    return Object.values(editRequiredFieldErrors).some(Boolean)
  }, [editRequiredFieldErrors])

  const canSubmit = useMemo(() => {
    if (
      !draftName.trim() ||
      !draftBrand.trim() ||
      !draftStart ||
      !draftEnd ||
      !draftGuaranteedViews ||
      !draftGuaranteedEngagements
    ) {
      return false
    }

    const normalizedStart = sanitizeDateInput(draftStart)
    const normalizedEnd = sanitizeDateInput(draftEnd)
    if (!normalizedStart || !normalizedEnd) return false
    const start = new Date(normalizedStart)
    const end = new Date(normalizedEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
    if (normalizedStart < todayDate || normalizedEnd < todayDate) return false
    const guaranteedViews = Number(draftGuaranteedViews)
    const guaranteedEngagements = Number(draftGuaranteedEngagements)
    if (
      !Number.isFinite(guaranteedViews) ||
      !Number.isFinite(guaranteedEngagements) ||
      guaranteedViews < 0 ||
      guaranteedEngagements < 0
    ) {
      return false
    }
    return start <= end
  }, [
    draftBrand,
    draftEnd,
    draftGuaranteedEngagements,
    draftGuaranteedViews,
    draftName,
    draftStart,
    todayDate,
  ])

  const canSubmitEdit = useMemo(() => {
    if (
      !editName.trim() ||
      !editBrand.trim() ||
      !editStart ||
      !editEnd ||
      !editGuaranteedViews ||
      !editGuaranteedEngagements
    ) {
      return false
    }

    const normalizedStart = sanitizeDateInput(editStart)
    const normalizedEnd = sanitizeDateInput(editEnd)
    if (!normalizedStart || !normalizedEnd) return false
    const start = new Date(normalizedStart)
    const end = new Date(normalizedEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
    const guaranteedViews = Number(editGuaranteedViews)
    const guaranteedEngagements = Number(editGuaranteedEngagements)
    if (
      !Number.isFinite(guaranteedViews) ||
      !Number.isFinite(guaranteedEngagements) ||
      guaranteedViews < 0 ||
      guaranteedEngagements < 0
    ) {
      return false
    }
    return start <= end
  }, [editBrand, editEnd, editGuaranteedEngagements, editGuaranteedViews, editName, editStart])

  useEffect(() => {
    let cancelled = false

    const loadCampaignList = async () => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const response = await fetchCampaigns()
        if (cancelled) return
        setViewerUserId(response.viewerUserId)
        setCampaignList(response.campaigns.map((row) => mapCampaignToCard(row)))
      } catch (err) {
        if (cancelled) return
        setCampaignList([])
        setLoadError(err instanceof Error ? err.message : 'Unable to load campaigns.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadCampaignList()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!managePostsCampaign) return
    const hasSelectedChannel = campaignChannelOptions.some((option) => option.id === selectedPostChannelId)
    if (hasSelectedChannel) return

    const preferredChannelId =
      managePostsCampaign.selectedChannelId && campaignChannelOptions.some((option) => option.id === managePostsCampaign.selectedChannelId)
        ? managePostsCampaign.selectedChannelId
        : campaignChannelOptions[0]?.id ?? 'all'
    setSelectedPostChannelId(preferredChannelId)
  }, [campaignChannelOptions, managePostsCampaign, selectedPostChannelId])

  const formatCampaignDate = (value: string) => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const readCsvIntoInputs = async (
    event: ChangeEvent<HTMLInputElement>,
    setter: Dispatch<SetStateAction<MemberInputRow[]>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsedEmails = extractEmailsFromCsvText(text)
      if (!parsedEmails.length) {
        setError('No email addresses were detected in the CSV file.')
        return
      }
      setter((previous) => mergeEmailInputs(previous, parsedEmails))
      setError(null)
    } catch {
      setError('Unable to parse CSV file.')
    }
  }

  const handleCreate = async () => {
    if (isSubmitting) return
    if (!canCreateCampaignByRole) {
      setCreateError('Only admins can create campaigns.')
      return
    }
    setHasCreateSubmitAttempt(true)
    if (hasMissingRequiredCreateField) return
    if (!canSubmit) return
    setCreateError(null)
    setFeedbackModal(null)
    const sanitizedDraftStart = sanitizeDateInput(draftStart)
    const sanitizedDraftEnd = sanitizeDateInput(draftEnd)
    if (!sanitizedDraftStart || !sanitizedDraftEnd) {
      setCreateError('Start and end dates must use YYYY-MM-DD format.')
      return
    }
    if (sanitizedDraftStart < todayDate || sanitizedDraftEnd < todayDate) {
      setCreateError('Start and end dates must be today or later.')
      return
    }

    setIsSubmitting(true)
    const sanitizedDraftName = sanitizeTextInput(draftName, { maxLength: 140 })
    const sanitizedDraftBrand = sanitizeTextInput(draftBrand, { maxLength: 140 })
    const submittedMembers = collectMemberInputs(inviteEmails)
    const submittedEmails = submittedMembers.map((entry) => entry.email)
    const guaranteedViews = Number(draftGuaranteedViews)
    const guaranteedEngagements = Number(draftGuaranteedEngagements)
    const engagementRate =
      guaranteedViews > 0 ? (guaranteedEngagements / guaranteedViews) * 100 : 0

    try {
      const created = await createCampaign({
        campaignName: sanitizedDraftName,
        brand: sanitizedDraftBrand,
        startDate: sanitizedDraftStart,
        endDate: sanitizedDraftEnd,
        guaranteed: guaranteedViews,
        viewsDelivered: 0,
        engagementRate,
        memberAccess: submittedMembers,
        memberEmails: submittedEmails,
        distributionSources: {
          brand: sanitizedDraftBrand,
          ono: 0,
          clipper: 0,
        },
      })

      if (created.viewerUserId) setViewerUserId(created.viewerUserId)
      const newCard = mapCampaignToCard(created.campaign)
      setCampaignList((previous) => [newCard, ...previous.filter((row) => row.id !== newCard.id)])
      setIsCreateOpen(false)
      setFeedbackModal({
        title: 'Campaign created. Member invite results',
        summary: created.memberResolution,
        submittedEmails,
      })
      resetCreateDraft()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create campaign.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openManageModal = async (campaign: CampaignCardModel) => {
    const viewerRole = resolveViewerCampaignRole(campaign, viewerUserId)
    if (!viewerRole) return
    setManageCampaign(campaign)
    setMembers([])
    setManageLoading(true)
    setManageError(null)
    setAddEmailInputs([createEmptyMemberInput()])
    setManageAddInputsBaseline(buildMemberInputSignature([createEmptyMemberInput()]))
    setMemberRoleEdits({})
    setRemoveMemberTarget(null)
    setRemoveMemberError(null)
    try {
      const payload = await fetchCampaignMembers(campaign.id)
      setMembers(payload.members)
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Unable to load campaign members.')
    } finally {
      setManageLoading(false)
    }
  }

  const handleManageSubmit = async () => {
    if (!canManageMembersForManageCampaign) return
    if (!manageCampaign || manageSubmitting) return
    const addMembers = pendingAddMembers
    const addEmails = addMembers.map((entry) => entry.email)
    const roleUpdates = isManageViewerAdmin ? pendingRoleUpdates : []
    const roleUpdateEmails = roleUpdates.map((entry) => {
      const member = sortedMembers.find((candidate) => candidate.id === entry.userId)
      const email = normalizeEmail(member?.email ?? '')
      return email || member?.id || entry.userId
    })

    if (!addMembers.length && !roleUpdates.length) {
      setManageError(
        isManageViewerAdmin
          ? 'Enter at least one email, upload a CSV file, or change a member role.'
          : 'Enter at least one email or upload a CSV file.',
      )
      return
    }
    setManageSubmitting(true)
    setManageError(null)
    try {
      const result = await updateCampaignMembers(manageCampaign.id, {
        addMembers: addMembers.length ? addMembers : undefined,
        addEmails: addEmails.length ? addEmails : undefined,
        roleUpdates: roleUpdates.length ? roleUpdates : undefined,
      })
      setMembers(result.members)
      setFeedbackModal({
        title: `Updated members for ${manageCampaign.name}`,
        summary: result.updateResult,
        submittedEmails: [
          ...addEmails,
          ...roleUpdateEmails,
        ],
      })
      setAddEmailInputs([createEmptyMemberInput()])
      setManageAddInputsBaseline(buildMemberInputSignature([createEmptyMemberInput()]))
      setMemberRoleEdits({})
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Unable to update campaign members.')
    } finally {
      setManageSubmitting(false)
    }
  }

  const handleRemoveMember = async () => {
    if (!canManageMembersForManageCampaign) return
    if (!manageCampaign || !removeMemberTarget || removeMemberSubmitting) return
    setRemoveMemberSubmitting(true)
    setRemoveMemberError(null)
    try {
      const target = removeMemberTarget
      const result = await updateCampaignMembers(manageCampaign.id, {
        removeUserIds: [target.id],
      })
      setMembers(result.members)
      setMemberRoleEdits((previous) => {
        const next = { ...previous }
        delete next[target.id]
        return next
      })
      setFeedbackModal({
        title: `Updated members for ${manageCampaign.name}`,
        summary: result.updateResult,
        submittedEmails: [target.email || target.id],
      })
      setRemoveMemberTarget(null)
    } catch (err) {
      setRemoveMemberError(err instanceof Error ? err.message : 'Unable to remove campaign member.')
    } finally {
      setRemoveMemberSubmitting(false)
    }
  }

  const handleDeleteCampaign = async () => {
    if (!deleteCampaignTarget || deleteSubmitting) return
    if (resolveViewerCampaignRole(deleteCampaignTarget, viewerUserId) !== 'admin') return
    setDeleteSubmitting(true)
    setDeleteError(null)
    try {
      await deleteCampaign(deleteCampaignTarget.id)
      setCampaignList((previous) => previous.filter((row) => row.id !== deleteCampaignTarget.id))
      if (manageCampaign?.id === deleteCampaignTarget.id) {
        setManageCampaign(null)
        setManageError(null)
        setMembers([])
      }
      if (managePostsCampaign?.id === deleteCampaignTarget.id) {
        setManagePostsCampaign(null)
        setManagePostsError(null)
        setSelectedPostIdsDraft([])
        setSelectedPostChannelId('all')
      }
      if (editCampaignTarget?.id === deleteCampaignTarget.id) {
        setEditCampaignTarget(null)
        setHasEditSubmitAttempt(false)
        setEditError(null)
      }
      setDeleteCampaignTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete campaign.')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const openEditModal = (campaign: CampaignCardModel) => {
    const viewerRole = resolveViewerCampaignRole(campaign, viewerUserId)
    if (viewerRole !== 'admin' && viewerRole !== 'internal') return
    setEditCampaignTarget(campaign)
    setHasEditSubmitAttempt(false)
    setEditError(null)
    setEditName(campaign.name)
    setEditBrand(campaign.brand)
    setEditStart(campaign.startDate)
    setEditEnd(campaign.endDate)
    setEditGuaranteedViews(String(campaign.guaranteedViews))
    setEditGuaranteedEngagements(String(campaign.guaranteedEngagements))
  }

  const closeEditModal = () => {
    if (editSubmitting) return
    setEditCampaignTarget(null)
    setHasEditSubmitAttempt(false)
    setEditError(null)
    setEditName('')
    setEditBrand('')
    setEditStart('')
    setEditEnd('')
    setEditGuaranteedViews('')
    setEditGuaranteedEngagements('')
  }

  const handleEditCampaign = async () => {
    if (!editCampaignTarget || editSubmitting) return
    const viewerRole = resolveViewerCampaignRole(editCampaignTarget, viewerUserId)
    if (viewerRole !== 'admin' && viewerRole !== 'internal') return
    setHasEditSubmitAttempt(true)
    if (hasMissingRequiredEditField || !canSubmitEdit) return

    const guaranteedViews = Number(editGuaranteedViews)
    const guaranteedEngagements = Number(editGuaranteedEngagements)
    const sanitizedEditName = sanitizeTextInput(editName, { maxLength: 140 })
    const sanitizedEditBrand = sanitizeTextInput(editBrand, { maxLength: 140 })
    const sanitizedEditStart = sanitizeDateInput(editStart)
    const sanitizedEditEnd = sanitizeDateInput(editEnd)
    if (!sanitizedEditStart || !sanitizedEditEnd) {
      setEditError('Start and end dates must use YYYY-MM-DD format.')
      return
    }
    setEditSubmitting(true)
    setEditError(null)
    try {
      const result = await updateCampaignDetails(editCampaignTarget.id, {
        campaignName: sanitizedEditName,
        brand: sanitizedEditBrand,
        startDate: sanitizedEditStart,
        endDate: sanitizedEditEnd,
        guaranteed: guaranteedViews,
        guaranteedEngagements,
      })
      const updatedCard = mapCampaignToCard(result.campaign)
      setCampaignList((previous) =>
        previous.map((campaign) => (campaign.id === updatedCard.id ? updatedCard : campaign)),
      )
      if (manageCampaign?.id === updatedCard.id) {
        setManageCampaign(updatedCard)
      }
      if (managePostsCampaign?.id === updatedCard.id) {
        setManagePostsCampaign(updatedCard)
      }
      if (deleteCampaignTarget?.id === updatedCard.id) {
        setDeleteCampaignTarget(updatedCard)
      }
      setEditCampaignTarget(null)
      setHasEditSubmitAttempt(false)
      setEditError(null)
      setEditName('')
      setEditBrand('')
      setEditStart('')
      setEditEnd('')
      setEditGuaranteedViews('')
      setEditGuaranteedEngagements('')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update campaign.')
    } finally {
      setEditSubmitting(false)
    }
  }

  const openManagePostsModal = async (campaign: CampaignCardModel) => {
    const viewerRole = resolveViewerCampaignRole(campaign, viewerUserId)
    if (viewerRole !== 'admin' && viewerRole !== 'internal') return
    setManagePostsCampaign(campaign)
    setManagePostsLoading(true)
    setManagePostsError(null)
    setManagePostsSubmitting(false)
    setAvailableConnectedAccounts([])
    setAvailablePosts([])
    setCampaignChannelOptions([{ id: 'all', label: 'All connected accounts' }])
    setSelectedPostIdsDraft([])
    setSelectedPostChannelId('all')
    try {
      const payload = await fetchCampaignAvailablePosts(campaign.id)
      const nextOptions: CampaignChannelOption[] = [
        { id: 'all', label: 'All connected accounts' },
        ...payload.channels,
      ]
      const dedupedOptions = [
        ...new Map(nextOptions.map((option) => [option.id, option])).values(),
      ]
      const availablePostIdSet = new Set(
        payload.posts.map((post) => normalizePostId(post.id)).filter(Boolean),
      )
      const selectedFromCampaign = campaign.selectedPostIds
        .map((entry) => normalizePostId(entry))
        .filter((entry) => availablePostIdSet.has(entry))
      const preferredChannelId =
        campaign.selectedChannelId && dedupedOptions.some((option) => option.id === campaign.selectedChannelId)
          ? campaign.selectedChannelId
          : dedupedOptions[0]?.id ?? 'all'

      setAvailableConnectedAccounts(payload.accountLabels)
      setAvailablePosts(payload.posts)
      setCampaignChannelOptions(dedupedOptions)
      setSelectedPostIdsDraft([...new Set(selectedFromCampaign)])
      setSelectedPostChannelId(preferredChannelId)
    } catch (err) {
      setManagePostsError(err instanceof Error ? err.message : 'Unable to load available campaign posts.')
    } finally {
      setManagePostsLoading(false)
    }
  }

  const closeManagePostsModal = () => {
    if (managePostsSubmitting) return
    setManagePostsCampaign(null)
    setManagePostsLoading(false)
    setManagePostsError(null)
    setAvailableConnectedAccounts([])
    setAvailablePosts([])
    setCampaignChannelOptions([{ id: 'all', label: 'All connected accounts' }])
    setSelectedPostIdsDraft([])
    setSelectedPostChannelId('all')
  }

  const handleManagePostsSubmit = async () => {
    if (!managePostsCampaign || managePostsSubmitting) return
    const viewerRole = resolveViewerCampaignRole(managePostsCampaign, viewerUserId)
    if (viewerRole !== 'admin' && viewerRole !== 'internal') return
    setManagePostsSubmitting(true)
    setManagePostsError(null)
    const deduplicatedPostIds = [...new Set(selectedPostIdsDraft.map((entry) => normalizePostId(entry)).filter(Boolean))]
      .filter((postId) => availablePostIdSet.has(postId))
    try {
      const result = await updateCampaignPosts(managePostsCampaign.id, {
        selectedPostIds: deduplicatedPostIds,
        selectedPosts: selectedCampaignPosts.map((post) => ({
          id: normalizePostId(post.id),
          title: sanitizeTextInput(post.title, { maxLength: 300 }) || 'Untitled post',
          platform: sanitizeTextInput(post.platform, { maxLength: 64 }) || 'YouTube',
          channelId: sanitizeTokenInput(post.channelId, 300),
          channelName: sanitizeTextInput(post.channelName, { maxLength: 180 }),
          views: toNumber(post.views),
          engagementRate: toNumber(post.engagementRate),
        })),
        selectedChannelId: selectedPostChannelId === 'all'
          ? ''
          : sanitizeTokenInput(selectedPostChannelId, 300),
        viewsDelivered: selectedPostTotals.viewsDelivered,
        engagementRate: selectedPostTotals.engagementRate,
      })
      const updatedCard = mapCampaignToCard(result.campaign)
      setCampaignList((previous) =>
        previous.map((campaign) => (campaign.id === updatedCard.id ? updatedCard : campaign)),
      )
      setManagePostsCampaign(null)
      setManagePostsError(null)
      setSelectedPostIdsDraft([])
      setSelectedPostChannelId('all')
    } catch (err) {
      setManagePostsError(err instanceof Error ? err.message : 'Unable to update campaign posts.')
    } finally {
      setManagePostsSubmitting(false)
    }
  }

  const toggleChannelPosts = (channelId: string, enabled: boolean) => {
    const normalizedChannelId = sanitizeTokenInput(channelId, 300)
    if (!normalizedChannelId) return
    setSelectedPostIdsDraft((previous) => {
      const next = new Set(previous.map((entry) => normalizePostId(entry)).filter(Boolean))
      const channelPostIds = postIdsByChannelId.get(normalizedChannelId) ?? []
      channelPostIds.forEach((postId) => {
        if (enabled) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
      })
      return [...next]
    })
  }

  return (
    <>
      <SectionHeader
        title="Campaign ROI Tracking"
        subtitle="Delivery vs guarantee with pacing and ROI metrics."
        actions={canCreateCampaignByRole ? (
          <button
            className="primary-button"
            onClick={() => {
              setCreateError(null)
              setHasCreateSubmitAttempt(false)
              setIsCreateOpen(true)
            }}
          >
            Create campaign
          </button>
        ) : null}
      />

      {isCreateOpen && canCreateCampaignByRole ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Create campaign</div>
            <div className="section-subtitle">Add key details and optional member emails.</div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="form-field">
                <label className="section-subtitle">Campaign name</label>
                <input
                  className="input"
                  style={hasCreateSubmitAttempt && createRequiredFieldErrors.draftName ? { borderColor: 'var(--danger)' } : undefined}
                  value={draftName}
                  onChange={(event) => setDraftName(sanitizeTextInput(event.target.value, { maxLength: 140 }))}
                  placeholder="PowerPlay Q2"
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftName ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftName}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Brand</label>
                <input
                  className="input"
                  style={hasCreateSubmitAttempt && createRequiredFieldErrors.draftBrand ? { borderColor: 'var(--danger)' } : undefined}
                  value={draftBrand}
                  onChange={(event) => setDraftBrand(sanitizeTextInput(event.target.value, { maxLength: 140 }))}
                  placeholder="Vertex Energy"
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftBrand ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftBrand}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Start date</label>
                <input
                  className="input"
                  style={
                    hasCreateSubmitAttempt && createRequiredFieldErrors.draftStart
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={draftStart}
                  onChange={(event) => {
                    const nextStart = sanitizeDateInput(event.target.value)
                    setDraftStart(nextStart)
                    if (draftEnd && nextStart && draftEnd < nextStart) {
                      setDraftEnd(nextStart)
                    }
                  }}
                  type="date"
                  min={todayDate}
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftStart ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftStart}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">End date</label>
                <input
                  className="input"
                  style={hasCreateSubmitAttempt && createRequiredFieldErrors.draftEnd ? { borderColor: 'var(--danger)' } : undefined}
                  value={draftEnd}
                  onChange={(event) => setDraftEnd(sanitizeDateInput(event.target.value))}
                  type="date"
                  min={minEndDate}
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftEnd ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftEnd}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed views</label>
                <input
                  className="input"
                  style={
                    hasCreateSubmitAttempt && createRequiredFieldErrors.draftGuaranteedViews
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={draftGuaranteedViews}
                  onChange={(event) => setDraftGuaranteedViews(sanitizeNumericInput(event.target.value))}
                  type="number"
                  min={0}
                  step={1}
                  placeholder="50000000"
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftGuaranteedViews ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftGuaranteedViews}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed engagements</label>
                <input
                  className="input"
                  style={
                    hasCreateSubmitAttempt && createRequiredFieldErrors.draftGuaranteedEngagements
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={draftGuaranteedEngagements}
                  onChange={(event) => setDraftGuaranteedEngagements(sanitizeNumericInput(event.target.value))}
                  type="number"
                  min={0}
                  step={1}
                  placeholder="2300000"
                />
                {hasCreateSubmitAttempt && createRequiredFieldErrors.draftGuaranteedEngagements ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {createRequiredFieldErrors.draftGuaranteedEngagements}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="form-field" style={{ marginTop: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <label className="section-subtitle">Member emails (optional)</label>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {inviteEmails.map((member, index) => (
                      <div key={`invite-email-${index}`} className="split" style={{ gap: '8px' }}>
                        <input
                          className="input"
                          value={member.email}
                          onChange={(event) =>
                            setInviteEmails((previous) =>
                              previous.map((value, fieldIndex) =>
                                fieldIndex === index
                                  ? { ...value, email: sanitizeEmailFieldInput(event.target.value) }
                                  : value,
                              ),
                            )
                          }
                          placeholder="user@example.com"
                        />
                        <select
                          className="select"
                          value={member.role}
                          onChange={(event) =>
                            setInviteEmails((previous) =>
                              previous.map((value, fieldIndex) =>
                                fieldIndex === index
                                  ? { ...value, role: normalizeMemberRole(event.target.value) }
                                  : value,
                                ),
                            )
                          }
                          style={{ minWidth: '120px' }}
                        >
                          {campaignMemberRoleOptions.map((option) => (
                            <option key={option} value={option}>
                              {formatCampaignMemberRoleLabel(option)}
                            </option>
                          ))}
                        </select>
                        {inviteEmails.length > 1 ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              setInviteEmails((previous) =>
                                previous.filter((_value, fieldIndex) => fieldIndex !== index),
                              )
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setInviteEmails((previous) => [...previous, createEmptyMemberInput()])}
                    >
                      + Add email
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <label className="section-subtitle">Upload CSV (optional)</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      void readCsvIntoInputs(event, setInviteEmails, setCreateError)
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setCreateError(null)
                  setHasCreateSubmitAttempt(false)
                  setIsCreateOpen(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => void handleCreate()}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create campaign'}
              </button>
            </div>
            {createError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {createError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editCampaignTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Edit campaign</div>
            <div className="section-subtitle">{editCampaignTarget.name}</div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="form-field">
                <label className="section-subtitle">Campaign name</label>
                <input
                  className="input"
                  style={hasEditSubmitAttempt && editRequiredFieldErrors.editName ? { borderColor: 'var(--danger)' } : undefined}
                  value={editName}
                  onChange={(event) => setEditName(sanitizeTextInput(event.target.value, { maxLength: 140 }))}
                  placeholder="PowerPlay Q2"
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editName ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editName}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Brand</label>
                <input
                  className="input"
                  style={hasEditSubmitAttempt && editRequiredFieldErrors.editBrand ? { borderColor: 'var(--danger)' } : undefined}
                  value={editBrand}
                  onChange={(event) => setEditBrand(sanitizeTextInput(event.target.value, { maxLength: 140 }))}
                  placeholder="Vertex Energy"
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editBrand ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editBrand}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Start date</label>
                <input
                  className="input"
                  style={
                    hasEditSubmitAttempt && editRequiredFieldErrors.editStart
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={editStart}
                  onChange={(event) => {
                    const nextStart = sanitizeDateInput(event.target.value)
                    setEditStart(nextStart)
                    if (editEnd && nextStart && editEnd < nextStart) {
                      setEditEnd(nextStart)
                    }
                  }}
                  type="date"
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editStart ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editStart}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">End date</label>
                <input
                  className="input"
                  style={hasEditSubmitAttempt && editRequiredFieldErrors.editEnd ? { borderColor: 'var(--danger)' } : undefined}
                  value={editEnd}
                  onChange={(event) => setEditEnd(sanitizeDateInput(event.target.value))}
                  type="date"
                  min={minEditEndDate || undefined}
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editEnd ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editEnd}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed views</label>
                <input
                  className="input"
                  style={
                    hasEditSubmitAttempt && editRequiredFieldErrors.editGuaranteedViews
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={editGuaranteedViews}
                  onChange={(event) => setEditGuaranteedViews(sanitizeNumericInput(event.target.value))}
                  type="number"
                  min={0}
                  step={1}
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editGuaranteedViews ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editGuaranteedViews}
                  </div>
                ) : null}
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed engagements</label>
                <input
                  className="input"
                  style={
                    hasEditSubmitAttempt && editRequiredFieldErrors.editGuaranteedEngagements
                      ? { borderColor: 'var(--danger)' }
                      : undefined
                  }
                  value={editGuaranteedEngagements}
                  onChange={(event) => setEditGuaranteedEngagements(sanitizeNumericInput(event.target.value))}
                  type="number"
                  min={0}
                  step={1}
                />
                {hasEditSubmitAttempt && editRequiredFieldErrors.editGuaranteedEngagements ? (
                  <div className="section-subtitle" style={{ marginTop: '6px', color: 'var(--danger)' }}>
                    {editRequiredFieldErrors.editGuaranteedEngagements}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => closeEditModal()}
                disabled={editSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleEditCampaign()}
                disabled={editSubmitting}
              >
                {editSubmitting ? 'Saving...' : 'Save campaign'}
              </button>
            </div>
            {editError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {editError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {manageCampaign ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Campaign members</div>
            <div className="section-subtitle">{manageCampaign.name}</div>
            {!isManageViewerAdmin ? (
              <div className="section-subtitle">Read-only access. Only campaign admins can edit members.</div>
            ) : null}

            {manageLoading ? (
              <div className="section-subtitle" style={{ marginTop: '12px' }}>
                Loading members...
              </div>
            ) : (
              <>
                <div style={{ marginTop: '12px' }}>
                  <div className="section-subtitle">Current members</div>
                  <div
                    style={{
                      marginTop: '6px',
                      maxHeight: '150px',
                      overflowY: 'auto',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      padding: '8px 10px',
                    }}
                  >
                    {sortedMembers.length ? (
                      sortedMembers.map((member) => {
                        const isCampaignCreator = Boolean(manageCampaign && member.id === manageCampaign.creator)
                        const memberRole = memberRoleEdits[member.id] ?? normalizeMemberRole(member.role)
                        const isViewer = Boolean(normalizedViewerId && member.id === normalizedViewerId)
                        return (
                          <div
                            key={member.id}
                            className={`split member-row ${isViewer ? 'self' : ''}`}
                            style={{ fontSize: '13px', padding: '3px 0' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {canManageMembersForManageCampaign && !isCampaignCreator ? (
                                <button
                                  type="button"
                                  className="ghost-button"
                                  aria-label={`Remove ${member.email || member.id}`}
                                  onClick={() => {
                                    setRemoveMemberTarget(member)
                                    setRemoveMemberError(null)
                                  }}
                                  style={{
                                    width: '20px',
                                    height: '20px',
                                    minWidth: '20px',
                                    padding: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: 1,
                                  }}
                                >
                                  x
                                </button>
                              ) : null}
                              <span>{member.email || member.id}</span>
                              {isViewer ? <span className="pill self-tag">You</span> : null}
                            </div>
                            {isCampaignCreator ? (
                              <span className="muted">Creator (Admin)</span>
                            ) : isManageViewerAdmin ? (
                              <select
                                className="select"
                                value={memberRole}
                                onChange={(event) => {
                                  const nextRole = normalizeMemberRole(event.target.value)
                                  const currentRole = normalizeMemberRole(member.role)
                                  setMemberRoleEdits((previous) => {
                                    if (nextRole === currentRole) {
                                      const next = { ...previous }
                                      delete next[member.id]
                                      return next
                                    }
                                    return { ...previous, [member.id]: nextRole }
                                  })
                                }}
                                style={{ minWidth: '120px' }}
                              >
                                {campaignMemberRoleOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {formatCampaignMemberRoleLabel(option)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted">{formatCampaignMemberRoleLabel(memberRole)}</span>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="muted">No members found.</div>
                    )}
                  </div>
                </div>

                {canManageMembersForManageCampaign ? (
                  <div style={{ marginTop: '14px', display: 'grid', gap: '12px' }}>
                    <div className="form-field">
                      <label className="section-subtitle">Add emails</label>
                      {addEmailInputs.map((member, index) => (
                        <div key={`add-email-${index}`} className="split" style={{ marginTop: '6px', gap: '8px' }}>
                          <input
                            className="input"
                            value={member.email}
                            onChange={(event) =>
                              setAddEmailInputs((previous) =>
                                previous.map((value, fieldIndex) =>
                                  fieldIndex === index
                                    ? { ...value, email: sanitizeEmailFieldInput(event.target.value) }
                                    : value,
                                ),
                              )
                            }
                            placeholder="add-user@example.com"
                          />
                          {isManageViewerAdmin ? (
                            <select
                              className="select"
                              value={member.role}
                              onChange={(event) =>
                                setAddEmailInputs((previous) =>
                                  previous.map((value, fieldIndex) =>
                                    fieldIndex === index
                                      ? { ...value, role: normalizeMemberRole(event.target.value) }
                                      : value,
                                  ),
                                )
                              }
                              style={{ minWidth: '120px' }}
                            >
                              {campaignMemberRoleOptions.map((option) => (
                                <option key={option} value={option}>
                                  {formatCampaignMemberRoleLabel(option)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="muted" style={{ minWidth: '120px', textAlign: 'right' }}>
                              Internal
                            </span>
                          )}
                          {addEmailInputs.length > 1 ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() =>
                                setAddEmailInputs((previous) =>
                                  previous.filter((_value, fieldIndex) => fieldIndex !== index),
                                )
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <div className="split" style={{ marginTop: '8px' }}>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setAddEmailInputs((previous) => [...previous, createEmptyMemberInput()])}
                        >
                          + Add email
                        </button>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(event) => {
                            void readCsvIntoInputs(event, setAddEmailInputs, setManageError)
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className="modal-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setManageCampaign(null)
                  setManageError(null)
                  setAddEmailInputs([createEmptyMemberInput()])
                  setManageAddInputsBaseline(buildMemberInputSignature([createEmptyMemberInput()]))
                  setMemberRoleEdits({})
                  setRemoveMemberTarget(null)
                  setRemoveMemberError(null)
                }}
                disabled={manageSubmitting}
              >
                Close
              </button>
              {canManageMembersForManageCampaign ? (
                <button
                  className="primary-button"
                  onClick={() => void handleManageSubmit()}
                  disabled={manageSubmitting || manageLoading || !hasPendingManageChanges}
                >
                  {manageSubmitting ? 'Updating...' : 'Submit'}
                </button>
              ) : null}
            </div>

            {manageError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {manageError}
              </div>
            ) : null}

          </div>
        </div>
      ) : null}

      {managePostsCampaign ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Manage campaign posts</div>
            <div className="section-subtitle">{managePostsCampaign.name}</div>

            <div style={{ marginTop: '14px', display: 'grid', gap: '12px' }}>
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  fontSize: '13px',
                  display: 'grid',
                  gap: '6px',
                }}
              >
                <div className="section-subtitle">Connected accounts</div>
                {availableConnectedAccounts.length ? (
                  <div className="check-row">
                    {availableConnectedAccounts.map((label) => (
                      <span className="pill" key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No connected accounts are available for this campaign.</div>
                )}
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  fontSize: '13px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div className="section-subtitle">Campaign account checkmarks</div>
                {campaignChannelSelections.length ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {campaignChannelSelections.map((option) => (
                      <label
                        key={option.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '20px 1fr',
                          gap: '10px',
                          alignItems: 'start',
                          cursor: option.totalPosts > 0 ? 'pointer' : 'not-allowed',
                          opacity: option.totalPosts > 0 ? 1 : 0.65,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={option.checked}
                          ref={(node) => {
                            if (!node) return
                            node.indeterminate = option.partial
                          }}
                          onChange={(event) => toggleChannelPosts(option.id, event.target.checked)}
                          disabled={managePostsLoading || option.totalPosts === 0}
                        />
                        <div style={{ display: 'grid', gap: '2px' }}>
                          <span>{option.label}</span>
                          <span className="muted">
                            {option.totalPosts > 0
                              ? `${formatNumber(option.selectedPosts)}/${formatNumber(option.totalPosts)} posts selected`
                              : 'No posts available yet for this account'}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No connected accounts can be selected for this campaign yet.</div>
                )}
              </div>

              <div className="form-field">
                <label className="section-subtitle">Channel</label>
                <select
                  className="select"
                  value={selectedPostChannelId}
                  onChange={(event) => setSelectedPostChannelId(sanitizeTokenInput(event.target.value, 300))}
                  disabled={managePostsLoading}
                >
                  {campaignChannelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  fontSize: '13px',
                  display: 'grid',
                  gap: '4px',
                }}
              >
                <div className="split">
                  <span className="muted">Selected posts</span>
                  <strong>{formatNumber(selectedCampaignPosts.length)}</strong>
                </div>
                <div className="split">
                  <span className="muted">Views delivered</span>
                  <strong>{formatNumber(selectedPostTotals.viewsDelivered)}</strong>
                </div>
                <div className="split">
                  <span className="muted">Engagement rate</span>
                  <strong>{formatPercent(selectedPostTotals.engagementRate)}</strong>
                </div>
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                {managePostsLoading ? (
                  <div className="muted">Loading connected posts...</div>
                ) : visiblePostsForChannel.length ? (
                  visiblePostsForChannel.map((post) => {
                    const postId = normalizePostId(post.id)
                    const checked = selectedPostIdSet.has(postId)
                    return (
                      <label
                        key={postId}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '20px 1fr',
                          gap: '10px',
                          alignItems: 'start',
                          fontSize: '13px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedPostIdsDraft((previous) => {
                              const currentSet = new Set(
                                previous.map((entry) => normalizePostId(entry)).filter(Boolean),
                              )
                              if (event.target.checked) {
                                currentSet.add(postId)
                              } else {
                                currentSet.delete(postId)
                              }
                              return [...currentSet]
                            })
                          }}
                        />
                        <div style={{ display: 'grid', gap: '2px' }}>
                          <span>{post.title || 'Untitled video'}</span>
                          <span className="muted">
                            {post.channelName || post.platform} | {formatNumber(post.views)} views | {formatPercent(post.engagementRate)}
                          </span>
                        </div>
                      </label>
                    )
                  })
                ) : (
                  <div className="muted">
                    {availablePosts.length
                      ? 'No posts found for the selected channel.'
                      : 'No posts are available from connected accounts yet.'}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => closeManagePostsModal()}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleManagePostsSubmit()}
                disabled={managePostsSubmitting || managePostsLoading}
              >
                {managePostsSubmitting ? 'Saving...' : 'Save posts'}
              </button>
            </div>

            {managePostsError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {managePostsError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {removeMemberTarget && manageCampaign ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Remove member?</div>
            <div className="section-subtitle" style={{ marginTop: '8px' }}>
              Remove <strong>{removeMemberTarget.email || removeMemberTarget.id}</strong> from{' '}
              <strong>{manageCampaign.name}</strong>?
            </div>
            <div className="modal-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (removeMemberSubmitting) return
                  setRemoveMemberTarget(null)
                  setRemoveMemberError(null)
                }}
                disabled={removeMemberSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleRemoveMember()}
                disabled={removeMemberSubmitting}
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                {removeMemberSubmitting ? 'Removing...' : 'Remove member'}
              </button>
            </div>
            {removeMemberError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {removeMemberError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {feedbackModal ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            {hasResolutionRows(feedbackModal.summary) || feedbackModal.submittedEmails?.length ? (
              <MemberFeedback feedback={feedbackModal} />
            ) : (
              <div>
                <div className="section-title">{feedbackModal.title}</div>
                <div className="section-subtitle" style={{ marginTop: '10px' }}>
                  No member emails were processed.
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => setFeedbackModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCampaignTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Delete campaign?</div>
            <div className="section-subtitle" style={{ marginTop: '8px' }}>
              This will permanently delete <strong>{deleteCampaignTarget.name}</strong>.
            </div>
            <div className="modal-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (deleteSubmitting) return
                  setDeleteCampaignTarget(null)
                  setDeleteError(null)
                }}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleDeleteCampaign()}
                disabled={deleteSubmitting}
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete campaign'}
              </button>
            </div>
            {deleteError ? (
              <div className="section-subtitle" style={{ marginTop: '8px', color: 'var(--danger)' }}>
                {deleteError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="card">
          <div className="section-subtitle">Loading campaigns...</div>
        </div>
      ) : null}

      {!isLoading && loadError ? (
        <div className="card">
          <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
            {loadError}
          </div>
        </div>
      ) : null}

      {!isLoading && !loadError && !campaignList.length ? (
        <div className="card">
          <div className="section-subtitle">No campaigns are visible to your account yet.</div>
        </div>
      ) : null}

      <div className="grid grid-3">
        {campaignList.map((campaign) => {
          const deliveryPercent = campaign.guaranteedViews
            ? (campaign.deliveredViews / campaign.guaranteedViews) * 100
            : 0
          const engagementRate = campaign.deliveredViews
            ? (campaign.deliveredEngagements / campaign.deliveredViews) * 100
            : 0
          const viewerCampaignRole = resolveViewerCampaignRole(campaign, viewerUserId)
          const canViewMembers = Boolean(viewerCampaignRole)
          const canManageCampaignPosts = viewerCampaignRole === 'admin' || viewerCampaignRole === 'internal'
          const canEditCampaign = viewerCampaignRole === 'admin'
          const canDeleteCampaign = viewerCampaignRole === 'admin'

          return (
            <div key={campaign.id} className="card" style={{ position: 'relative' }}>
              {canDeleteCampaign ? (
                <button
                  className="ghost-button"
                  type="button"
                  aria-label={`Delete ${campaign.name}`}
                  onClick={() => {
                    setDeleteCampaignTarget(campaign)
                    setDeleteError(null)
                  }}
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '26px',
                    height: '26px',
                    minWidth: '26px',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              ) : null}
              {canEditCampaign ? (
                <button
                  className="ghost-button"
                  type="button"
                  aria-label={`Edit ${campaign.name}`}
                  onClick={() => {
                    openEditModal(campaign)
                  }}
                  style={{
                    position: 'absolute',
                    top: canDeleteCampaign ? '42px' : '10px',
                    right: '10px',
                    padding: '4px 10px',
                    minHeight: '24px',
                    fontSize: '12px',
                    lineHeight: 1.2,
                  }}
                >
                  Edit
                </button>
              ) : null}
              <div className="split">
                <div>
                  <div className="section-title">{campaign.name}</div>
                  <div className="section-subtitle">{campaign.brand}</div>
                </div>
                <div style={canEditCampaign || canDeleteCampaign ? { marginRight: '82px' } : undefined}>
                  <Badge tone={statusTone(campaign.status)} label={campaign.status} />
                </div>
              </div>
              <div className="muted" style={{ marginTop: '8px' }}>
                {formatCampaignDate(campaign.startDate)} - {formatCampaignDate(campaign.endDate)}
              </div>
              <div style={{ marginTop: '16px' }}>
                <div className="split">
                  <span className="muted">Views delivered</span>
                  <strong>{formatNumber(campaign.deliveredViews)}</strong>
                </div>
                <div className="split">
                  <span className="muted">Guaranteed</span>
                  <strong>{formatNumber(campaign.guaranteedViews)}</strong>
                </div>
                <div style={{ marginTop: '10px' }}>
                  <ProgressBar value={deliveryPercent} />
                </div>
                <div className="split" style={{ marginTop: '8px' }}>
                  <span className="muted">Delivery</span>
                  <span>{formatPercent(deliveryPercent)}</span>
                </div>
              </div>
              <div className="grid grid-2" style={{ marginTop: '16px' }}>
                <div className="card compact">
                  <div className="kpi-label">Engagement rate</div>
                  <div className="kpi-value">{formatPercent(engagementRate)}</div>
                </div>
                <div className="card compact">
                  <div className="kpi-label">Pacing</div>
                  <div className="kpi-value">{campaign.pacing}</div>
                </div>
              </div>
              <div style={{ marginTop: '16px' }}>
                <div className="section-subtitle">Distribution source</div>
                <div className="split" style={{ marginTop: '6px' }}>
                  <span className="muted">ONO channels</span>
                  <span>{campaign.distribution.ono}%</span>
                </div>
                <div className="split">
                  <span className="muted">Clipper network</span>
                  <span>{campaign.distribution.clipper}%</span>
                </div>
                <div className="split">
                  <span className="muted">Assigned posts</span>
                  <span>{formatNumber(campaign.selectedPostIds.length)}</span>
                </div>
              </div>
              {canViewMembers || canManageCampaignPosts ? (
                <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {canViewMembers ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        void openManageModal(campaign)
                      }}
                      style={{ flex: '1 1 180px' }}
                    >
                      View Members
                    </button>
                  ) : null}
                  {canManageCampaignPosts ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        void openManagePostsModal(campaign)
                      }}
                      style={{ flex: '1 1 180px' }}
                    >
                      Manage Posts
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}

