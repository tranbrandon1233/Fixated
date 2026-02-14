import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { SectionHeader } from '../components/ui/SectionHeader'
import type { CampaignSummary } from '../types/dashboard'
import {
  createCampaign,
  deleteCampaign,
  fetchCampaignMembers,
  fetchCampaigns,
  updateCampaignMembers,
  type CampaignApiItem,
  type CampaignMember,
  type MemberResolutionItem,
  type MemberResolutionSummary,
} from '../utils/campaigns'
import { formatNumber, formatPercent } from '../utils/format'

interface CampaignCardModel extends CampaignSummary {
  creator: string
}

interface FeedbackState {
  title: string
  summary: MemberResolutionSummary
  submittedEmails?: string[]
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

const collectEmails = (inputs: string[]) =>
  [...new Set(inputs.map((entry) => normalizeEmail(entry)).filter((entry) => entry.length > 0))]

const extractEmailsFromCsvText = (content: string) => {
  const matches = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return [...new Set(matches.map((entry) => normalizeEmail(entry)))]
}

const mergeEmailInputs = (current: string[], additions: string[]) => {
  const merged = [...current]
  additions.forEach((email) => {
    const normalized = normalizeEmail(email)
    if (!normalized) return
    const exists = merged.some((entry) => normalizeEmail(entry) === normalized)
    if (!exists) merged.push(normalized)
  })
  return merged.length ? merged : ['']
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
  const [inviteEmails, setInviteEmails] = useState<string[]>([''])

  const [manageCampaign, setManageCampaign] = useState<CampaignCardModel | null>(null)
  const [members, setMembers] = useState<CampaignMember[]>([])
  const [manageLoading, setManageLoading] = useState(false)
  const [manageSubmitting, setManageSubmitting] = useState(false)
  const [manageError, setManageError] = useState<string | null>(null)
  const [addEmailInputs, setAddEmailInputs] = useState<string[]>([''])
  const [removeMemberTarget, setRemoveMemberTarget] = useState<CampaignMember | null>(null)
  const [removeMemberSubmitting, setRemoveMemberSubmitting] = useState(false)
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null)
  const [deleteCampaignTarget, setDeleteCampaignTarget] = useState<CampaignCardModel | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const todayDate = useMemo(() => {
    const now = new Date()
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    return localTime.toISOString().slice(0, 10)
  }, [])

  const minEndDate = useMemo(() => {
    if (!draftStart || draftStart < todayDate) return todayDate
    return draftStart
  }, [draftStart, todayDate])

  const resetCreateDraft = () => {
    setHasCreateSubmitAttempt(false)
    setDraftName('')
    setDraftBrand('')
    setDraftStart('')
    setDraftEnd('')
    setDraftGuaranteedViews('')
    setDraftGuaranteedEngagements('')
    setInviteEmails([''])
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

  const formatCampaignDate = (value: string) => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const readCsvIntoInputs = async (
    event: ChangeEvent<HTMLInputElement>,
    setter: Dispatch<SetStateAction<string[]>>,
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
    const submittedEmails = collectEmails(inviteEmails)
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
    setAddEmailInputs([''])
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
    const addEmails = collectEmails(addEmailInputs)
    if (!addEmails.length) {
      setManageError('Enter at least one email or upload a CSV file.')
      return
    }
    setManageSubmitting(true)
    setManageError(null)
    try {
      const result = await updateCampaignMembers(manageCampaign.id, {
        addEmails,
      })
      setMembers(result.members)
      setFeedbackModal({
        title: `Updated members for ${manageCampaign.name}`,
        summary: result.updateResult,
        submittedEmails: addEmails,
      })
      setAddEmailInputs([''])
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Unable to update campaign members.')
    } finally {
      setManageSubmitting(false)
    }
  }

  const handleRemoveMember = async () => {
    if (!manageCampaign || !removeMemberTarget || removeMemberSubmitting) return
    setRemoveMemberSubmitting(true)
    setRemoveMemberError(null)
    try {
      const result = await updateCampaignMembers(manageCampaign.id, {
        removeUserIds: [removeMemberTarget.id],
      })
      setMembers(result.members)
      setFeedbackModal({
        title: `Updated members for ${manageCampaign.name}`,
        summary: result.updateResult,
        submittedEmails: [removeMemberTarget.email || removeMemberTarget.id],
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
      setDeleteCampaignTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete campaign.')
    } finally {
      setDeleteSubmitting(false)
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
                    {inviteEmails.map((email, index) => (
                      <div key={`invite-email-${index}`} className="split" style={{ gap: '8px' }}>
                        <input
                          className="input"
                          value={email}
                          onChange={(event) =>
                            setInviteEmails((previous) =>
                              previous.map((value, fieldIndex) =>
                                fieldIndex === index ? event.target.value : value,
                              ),
                            )
                          }
                          placeholder="user@example.com"
                        />
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
                      onClick={() => setInviteEmails((previous) => [...previous, ''])}
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
                    {members.length ? (
                      members.map((member) => {
                        const isCampaignCreator = Boolean(manageCampaign && member.id === manageCampaign.creator)
                        return (
                          <div key={member.id} className="split" style={{ fontSize: '13px', padding: '3px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {!isCampaignCreator ? (
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
                            {isCampaignCreator ? <span className="muted">Creator</span> : null}
                          </div>
                        )
                      })
                    ) : (
                      <div className="muted">No members found.</div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '14px', display: 'grid', gap: '12px' }}>
                  <div className="form-field">
                    <label className="section-subtitle">Add emails</label>
                    {addEmailInputs.map((email, index) => (
                      <div key={`add-email-${index}`} className="split" style={{ marginTop: '6px', gap: '8px' }}>
                        <input
                          className="input"
                          value={email}
                          onChange={(event) =>
                            setAddEmailInputs((previous) =>
                              previous.map((value, fieldIndex) =>
                                fieldIndex === index ? event.target.value : value,
                              ),
                            )
                          }
                          placeholder="add-user@example.com"
                        />
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
                        onClick={() => setAddEmailInputs((previous) => [...previous, ''])}
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
              </>
            )}

            <div className="modal-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setManageCampaign(null)
                  setManageError(null)
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
                disabled={manageSubmitting || manageLoading}
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
              <div className="split">
                <div>
                  <div className="section-title">{campaign.name}</div>
                  <div className="section-subtitle">{campaign.brand}</div>
                </div>
                <div style={isCreator ? { marginRight: '30px' } : undefined}>
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
              </div>
              {isCreator ? (
                <div style={{ marginTop: '14px' }}>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      void openManageModal(campaign)
                    }}
                  >
                    Manage Members
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
