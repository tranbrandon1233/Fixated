import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { resolveAuthBaseUrl } from '../utils/baseUrl'
import { sanitizeTextInput, sanitizeTokenInput } from '../utils/sanitize'

type PreviewType = 'pdf' | 'csv'

const normalizeType = (value: string | null): PreviewType => (value === 'pdf' ? 'pdf' : 'csv')

export const ExportPreview = () => {
  const [searchParams] = useSearchParams()
  const previewId = sanitizeTokenInput(searchParams.get('id'), 80)
  const previewType = normalizeType(searchParams.get('type'))
  const fileName = sanitizeTextInput(searchParams.get('fileName'), { maxLength: 180 })
  const [csvContent, setCsvContent] = useState('')
  const [pdfObjectUrl, setPdfObjectUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [loadedId, setLoadedId] = useState('')
  const authBaseUrl = resolveAuthBaseUrl()

  const fileUrl = useMemo(() => {
    if (!previewId) return ''
    return `${authBaseUrl}/api/exports/preview/${encodeURIComponent(previewId)}`
  }, [authBaseUrl, previewId])

  useEffect(() => {
    if (!fileUrl || !previewId) return

    let cancelled = false
    let nextPdfObjectUrl = ''

    const loadPreview = async () => {
      try {
        const response = await fetch(fileUrl, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const message =
            payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
              ? (payload as { message: string }).message
              : 'Export preview not found or expired.'
          if (!cancelled) {
            setErrorMessage(message)
            setLoadedId(previewId)
          }
          return
        }

        if (previewType === 'pdf') {
          const blob = await response.blob()
          nextPdfObjectUrl = URL.createObjectURL(blob)
          if (!cancelled) {
            setPdfObjectUrl(nextPdfObjectUrl)
            setCsvContent('')
            setErrorMessage('')
            setLoadedId(previewId)
          }
          return
        }

        const text = await response.text()
        if (!cancelled) {
          setCsvContent(text)
          setPdfObjectUrl('')
          setErrorMessage('')
          setLoadedId(previewId)
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Unable to load export preview.')
          setLoadedId(previewId)
        }
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
      if (nextPdfObjectUrl) URL.revokeObjectURL(nextPdfObjectUrl)
    }
  }, [fileUrl, previewId, previewType])

  const isReady = loadedId === previewId && !errorMessage
  const resolvedFileName = fileName || (previewType === 'pdf' ? 'report.pdf' : 'report.csv')

  if (!previewId) {
    return (
      <div className="card">
        <div className="section-title">Export preview unavailable</div>
        <div className="section-subtitle" style={{ marginTop: '8px' }}>
          Missing export preview id. Generate a new preview from Reports.
        </div>
      </div>
    )
  }

  if (loadedId === previewId && errorMessage) {
    return (
      <div className="card">
        <div className="section-title">Export preview unavailable</div>
        <div className="section-subtitle" style={{ marginTop: '8px' }}>
          {errorMessage}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="split">
        <div>
          <div className="section-title">Export preview</div>
          <div className="section-subtitle">{resolvedFileName}</div>
        </div>
        <a className="primary-button" href={fileUrl} download={resolvedFileName}>
          Download file
        </a>
      </div>

      {!isReady ? (
        <div className="section-subtitle" style={{ marginTop: '16px' }}>
          Loading export preview...
        </div>
      ) : previewType === 'pdf' ? (
        <iframe
          src={pdfObjectUrl || fileUrl}
          title={resolvedFileName}
          style={{
            width: '100%',
            minHeight: '78vh',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            marginTop: '16px',
            background: 'var(--surface)',
          }}
        />
      ) : (
        <pre
          style={{
            marginTop: '16px',
            maxHeight: '78vh',
            overflow: 'auto',
            padding: '16px',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            background: 'var(--surface-alt)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {csvContent}
        </pre>
      )}
    </div>
  )
}
