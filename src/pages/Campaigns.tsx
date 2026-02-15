import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import type { CampaignSummary, PostSummary } from '../types/dashboard'
import {
  createCampaign,
  deleteCampaign,
  fetchCampaignMembers,
  fetchCampaigns,
  updateCampaignDetails,
  updateCampaignPosts,
  updateCampaignMembers,
  type CampaignApiItem,
  type CampaignMemberRole,
  type MemberAccessInput,
  type CampaignMember,
  type MemberResolutionItem,
  type MemberResolutionSummary,
} from '../utils/campaigns'
import { formatNumber, formatPercent } from '../utils/format'

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

const normalizeEmail = (value: string) => value.trim().toLowerCase()
const normalizePostId = (value: string) => value.trim()

const normalizeMemberRole = (value: unknown): CampaignMemberRole =>
  value === 'admin' ? 'admin' : 'member'

const createEmptyMemberInput = (): MemberInputRow => ({ email: '', role: 'member' })

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
    if (!existingRole || normalizedRole === 'admin') {
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
    if (!exists) merged.push({ email: normalized, role: 'member' })
  })
  return merged.length ? merged : [createEmptyMemberInput()]
}

const resolveDistribution = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return { brand: 'Unknown brand', ono: 0, clipper: 0 }
  }
  const source = value as Record<string, unknown>
  const brand = typeof source.brand === 'string' && source.brand.trim() ? source.brand.trim() : 'Unknown brand'
  return {
    brand,
    ono: toNumber(source.ono),
    clipper: toNumber(source.clipper),
  }
}

const resolveStatus = (startDate: string, endDate: string, deliveryPercent: number): CampaignSummary['status'] => {
  const startTime = Date.parse(`${startDate}T00:00:00Z`)
  const endTime = Date.parse(`${endDate}T00:00:00Z`)
  const now = Date.now()
  if (!Number.isNaN(startTime) && now < startTime) return 'Draft'
  if (!Number.isNaN(endTime) && now > endTime) return 'Completed'
  if (deliveryPercent >= 100) return 'Overdelivering'
  if (deliveryPercent < 50) return 'At Risk'
  return 'Active'
}

const resolvePacing = (status: CampaignSummary['status']) => {
  if (status === 'Draft') return 'Not started'
  if (status === 'Completed') return 'Finished'
  if (status === 'Overdelivering') return 'Ahead'
  if (status === 'At Risk') return 'Behind'
  return 'On track'
}

const mapCampaignToCard = (campaign: CampaignApiItem): CampaignCardModel => {
  const guaranteedViews = toNumber(campaign.guaranteed)
  const deliveredViews = toNumber(campaign.viewsDelivered)
  const engagementRate = toNumber(campaign.engagementRate)
  const deliveredEngagements = deliveredViews > 0 ? Math.round((deliveredViews * engagementRate) / 100) : 0
  const guaranteedEngagements = guaranteedViews > 0 ? Math.round((guaranteedViews * engagementRate) / 100) : 0
  const deliveryPercent = guaranteedViews > 0 ? (deliveredViews / guaranteedViews) * 100 : 0
  const distribution = resolveDistribution(campaign.distributionSources)
  const status = resolveStatus(campaign.startDate, campaign.endDate, deliveryPercent)

  return {
    id: campaign.id,
    name: campaign.campaignName || 'Untitled campaign',
    brand: campaign.brand || distribution.brand,
    status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    guaranteedViews,
    deliveredViews,
    guaranteedEngagements,
    deliveredEngagements,
    pacing: resolvePacing(status),
    distribution: {
      ono: distribution.ono,
      clipper: distribution.clipper,
    },
    creator: campaign.creator,
    allowedMemberRoles: campaign.allowedMemberRoles ?? {},
    selectedPostIds: Array.isArray(campaign.selectedPostIds)
      ? [...new Set(campaign.selectedPostIds.map((entry) => normalizePostId(entry)).filter(Boolean))]
      : [],
    selectedChannelId: typeof campaign.selectedChannelId === 'string' && campaign.selectedChannelId.trim()
      ? campaign.selectedChannelId.trim()
      : undefined,
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

export const Campaigns = () => {
  const {
    summary: youtubeSummary,
    status: youtubeSummaryStatus,
    error: youtubeSummaryError,
  } = useYouTubeSummary()
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
  const [selectedPostIdsDraft, setSelectedPostIdsDraft] = useState<string[]>([])
  const [selectedPostChannelId, setSelectedPostChannelId] = useState('all')

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

  const isManageViewerCreator = useMemo(() => {
    if (!manageCampaign || !viewerUserId) return false
    return manageCampaign.creator === viewerUserId
  }, [manageCampaign, viewerUserId])

  const isManageViewerAdmin = useMemo(() => {
    if (isManageViewerCreator) return true
    if (!viewerUserId) return false
    const viewerMember = members.find((member) => member.id === viewerUserId)
    return normalizeMemberRole(viewerMember?.role) === 'admin'
  }, [isManageViewerCreator, members, viewerUserId])

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
    return isManageViewerAdmin ? collectMemberInputs(addEmailInputs) : []
  }, [addEmailInputs, isManageViewerAdmin])

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

  const availablePosts = useMemo(() => {
    const postById = new Map<string, PostSummary>()
    youtubeSummary.topPosts.forEach((post) => {
      const id = typeof post?.id === 'string' ? normalizePostId(post.id) : ''
      if (!id) return
      postById.set(id, {
        ...post,
        id,
        title: typeof post?.title === 'string' && post.title.trim() ? post.title.trim() : 'Untitled video',
        channelId: typeof post?.channelId === 'string' ? post.channelId.trim() : '',
        channelName: typeof post?.channelName === 'string' ? post.channelName.trim() : '',
        views: toNumber(post?.views),
        engagementRate: toNumber(post?.engagementRate),
      })
    })
    return [...postById.values()].sort((left, right) => right.views - left.views)
  }, [youtubeSummary.topPosts])

  const campaignChannelOptions = useMemo<CampaignChannelOption[]>(() => {
    const channelLabelById = new Map<string, string>()

    youtubeSummary.channels.forEach((channel) => {
      const id = typeof channel?.id === 'string' ? channel.id.trim() : ''
      if (!id) return
      const label = typeof channel?.name === 'string' && channel.name.trim() ? channel.name.trim() : id
      channelLabelById.set(id, label)
    })

    availablePosts.forEach((post) => {
      const id = typeof post.channelId === 'string' ? post.channelId.trim() : ''
      if (!id || channelLabelById.has(id)) return
      const label =
        typeof post.channelName === 'string' && post.channelName.trim()
          ? post.channelName.trim()
          : id
      channelLabelById.set(id, label)
    })

    return [
      { id: 'all', label: 'All channels' },
      ...[...channelLabelById.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    ]
  }, [availablePosts, youtubeSummary.channels])

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

    const start = new Date(draftStart)
    const end = new Date(draftEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
    if (draftStart < todayDate || draftEnd < todayDate) return false
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

    const start = new Date(editStart)
    const end = new Date(editEnd)
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
    setHasCreateSubmitAttempt(true)
    if (hasMissingRequiredCreateField) return
    if (!canSubmit) return
    setCreateError(null)
    setFeedbackModal(null)
    if (draftStart < todayDate || draftEnd < todayDate) {
      setCreateError('Start and end dates must be today or later.')
      return
    }

    setIsSubmitting(true)
    const submittedMembers = collectMemberInputs(inviteEmails)
    const submittedEmails = submittedMembers.map((entry) => entry.email)
    const guaranteedViews = Number(draftGuaranteedViews)
    const guaranteedEngagements = Number(draftGuaranteedEngagements)
    const engagementRate =
      guaranteedViews > 0 ? (guaranteedEngagements / guaranteedViews) * 100 : 0

    try {
      const created = await createCampaign({
        campaignName: draftName.trim(),
        brand: draftBrand.trim(),
        startDate: draftStart,
        endDate: draftEnd,
        guaranteed: guaranteedViews,
        viewsDelivered: 0,
        engagementRate,
        memberAccess: submittedMembers,
        memberEmails: submittedEmails,
        distributionSources: {
          brand: draftBrand.trim(),
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
    if (!manageCampaign || manageSubmitting) return
    const addMembers = pendingAddMembers
    const addEmails = addMembers.map((entry) => entry.email)
    const roleUpdates = isManageViewerCreator ? pendingRoleUpdates : []
    const roleUpdateEmails = roleUpdates.map((entry) => {
      const member = sortedMembers.find((candidate) => candidate.id === entry.userId)
      const email = typeof member?.email === 'string' ? member.email.trim() : ''
      return email || member?.id || entry.userId
    })

    if (!addMembers.length && !roleUpdates.length) {
      setManageError(
        isManageViewerCreator
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
    if (!manageCampaign || !removeMemberTarget || removeMemberSubmitting || !isManageViewerCreator) return
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
    setHasEditSubmitAttempt(true)
    if (hasMissingRequiredEditField || !canSubmitEdit) return

    const guaranteedViews = Number(editGuaranteedViews)
    const guaranteedEngagements = Number(editGuaranteedEngagements)
    setEditSubmitting(true)
    setEditError(null)
    try {
      const result = await updateCampaignDetails(editCampaignTarget.id, {
        campaignName: editName.trim(),
        brand: editBrand.trim(),
        startDate: editStart,
        endDate: editEnd,
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

  const openManagePostsModal = (campaign: CampaignCardModel) => {
    setManagePostsCampaign(campaign)
    setManagePostsError(null)
    setManagePostsSubmitting(false)
    setSelectedPostIdsDraft([...campaign.selectedPostIds])
    const preferredChannelId =
      campaign.selectedChannelId && campaignChannelOptions.some((option) => option.id === campaign.selectedChannelId)
        ? campaign.selectedChannelId
        : 'all'
    setSelectedPostChannelId(preferredChannelId)
  }

  const closeManagePostsModal = () => {
    if (managePostsSubmitting) return
    setManagePostsCampaign(null)
    setManagePostsError(null)
    setSelectedPostIdsDraft([])
    setSelectedPostChannelId('all')
  }

  const handleManagePostsSubmit = async () => {
    if (!managePostsCampaign || managePostsSubmitting) return
    setManagePostsSubmitting(true)
    setManagePostsError(null)
    const deduplicatedPostIds = [...new Set(selectedPostIdsDraft.map((entry) => normalizePostId(entry)).filter(Boolean))]
      .filter((postId) => availablePostIdSet.has(postId))
    try {
      const result = await updateCampaignPosts(managePostsCampaign.id, {
        selectedPostIds: deduplicatedPostIds,
        selectedChannelId: selectedPostChannelId === 'all' ? '' : selectedPostChannelId,
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

  return (
    <>
      <SectionHeader
        title="Campaign ROI Tracking"
        subtitle="Delivery vs guarantee with pacing and ROI metrics."
        actions={
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
        }
      />

      {isCreateOpen ? (
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
                  onChange={(event) => setDraftName(event.target.value)}
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
                  onChange={(event) => setDraftBrand(event.target.value)}
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
                    const nextStart = event.target.value
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
                  onChange={(event) => setDraftEnd(event.target.value)}
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
                  onChange={(event) => setDraftGuaranteedViews(event.target.value)}
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
                  onChange={(event) => setDraftGuaranteedEngagements(event.target.value)}
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
                                  ? { ...value, email: event.target.value }
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
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
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
                  onChange={(event) => setEditName(event.target.value)}
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
                  onChange={(event) => setEditBrand(event.target.value)}
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
                    const nextStart = event.target.value
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
                  onChange={(event) => setEditEnd(event.target.value)}
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
                  onChange={(event) => setEditGuaranteedViews(event.target.value)}
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
                  onChange={(event) => setEditGuaranteedEngagements(event.target.value)}
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
            <div className="section-title">Manage campaign members</div>
            <div className="section-subtitle">{manageCampaign.name}</div>

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
                        return (
                          <div key={member.id} className="split" style={{ fontSize: '13px', padding: '3px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {isManageViewerCreator && !isCampaignCreator ? (
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
                            </div>
                            {isCampaignCreator ? (
                              <span className="muted">Creator (Admin)</span>
                            ) : isManageViewerCreator ? (
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
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                            ) : (
                              <span className="muted">{memberRole === 'admin' ? 'Admin' : 'Member'}</span>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="muted">No members found.</div>
                    )}
                  </div>
                </div>

                {isManageViewerAdmin ? (
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
                                    ? { ...value, email: event.target.value }
                                    : value,
                                ),
                              )
                            }
                            placeholder="add-user@example.com"
                          />
                          {isManageViewerCreator ? (
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
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className="muted" style={{ minWidth: '120px', textAlign: 'right' }}>
                              Member
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
              <button
                className="primary-button"
                onClick={() => void handleManageSubmit()}
                disabled={manageSubmitting || manageLoading || !hasPendingManageChanges}
              >
                {manageSubmitting ? 'Updating...' : 'Submit'}
              </button>
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
              <div className="form-field">
                <label className="section-subtitle">Channel</label>
                <select
                  className="select"
                  value={selectedPostChannelId}
                  onChange={(event) => setSelectedPostChannelId(event.target.value)}
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
                {youtubeSummaryStatus === 'loading' && !availablePosts.length ? (
                  <div className="muted">Loading channel posts...</div>
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
                            {post.platform} · {formatNumber(post.views)} views · {formatPercent(post.engagementRate)}
                          </span>
                        </div>
                      </label>
                    )
                  })
                ) : (
                  <div className="muted">
                    {availablePosts.length
                      ? 'No posts found for the selected channel.'
                      : 'No posts are available yet. Refresh YouTube data and try again.'}
                  </div>
                )}
              </div>

              {youtubeSummaryError ? (
                <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
                  {youtubeSummaryError}
                </div>
              ) : null}
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => closeManagePostsModal()}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleManagePostsSubmit()}
                disabled={managePostsSubmitting}
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
          const isCreator = Boolean(viewerUserId && campaign.creator === viewerUserId)
          const isAdmin = Boolean(
            viewerUserId &&
              campaign.allowedMemberRoles &&
              campaign.allowedMemberRoles[viewerUserId] === 'admin',
          )
          const canManageMembers = isCreator || isAdmin
          const canManageCampaignPosts = isCreator || isAdmin
          const canEditCampaign = isCreator || isAdmin

          return (
            <div key={campaign.id} className="card" style={{ position: 'relative' }}>
              {isCreator ? (
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
                    top: isCreator ? '42px' : '10px',
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
                <div style={canEditCampaign || isCreator ? { marginRight: '82px' } : undefined}>
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
              {canManageMembers || canManageCampaignPosts ? (
                <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      void openManageModal(campaign)
                    }}
                    style={{ flex: '1 1 180px' }}
                  >
                    Manage Members
                  </button>
                  {canManageCampaignPosts ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        openManagePostsModal(campaign)
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
