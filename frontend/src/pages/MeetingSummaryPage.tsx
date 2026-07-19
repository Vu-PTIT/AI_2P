import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  ArrowRight,
  CalendarClock,
  Check,
  Clipboard,
  Copy,
  Download,
  Languages,
  ListChecks,
  RotateCcw,
  Timer,
  UsersRound,
} from 'lucide-react'
import { useNavigate } from 'react-router'

import { BrandMark } from '@/components/layout/BrandMark'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'
import { ConversationTurnCard } from '@/components/meeting/ConversationTurnCard'
import { FormattedAiSummary } from '@/components/meeting/FormattedAiSummary'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useClipboard } from '@/hooks/useClipboard'
import { useRoomSession } from '@/hooks/useRoomSession'
import { useTranslation } from '@/hooks/useTranslation'
import { API_URL } from '@/lib/config'
import { ROUTES } from '@/lib/constants'
import { createRoomId } from '@/lib/meetingIdentity'
import {
  formatDurationLabel,
  formatDateTime,
  formatLanguagePair,
} from '@/lib/formatters'
import {
  createTranscriptFileName,
  createTranscriptText,
} from '@/lib/transcript'
import { cn } from '@/lib/utils'
import { useMeetingStore } from '@/store/meetingStore'
import type { ActionItem } from '@/types/meeting'

type SummaryTab = 'summary' | 'transcript'

export default function MeetingSummaryPage() {
  const navigate = useNavigate()
  const { locale, t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SummaryTab>('summary')
  const [showCompactOverview, setShowCompactOverview] = useState(false)
  const tabListId = useId()
  const overviewRef = useRef<HTMLDivElement>(null)
  useRoomSession()
  const meeting = useMeetingStore((state) => state.meeting)
  const prepareAnotherMeeting = useMeetingStore(
    (state) => state.prepareAnotherMeeting,
  )
  const setAiSummary = useMeetingStore((state) => state.setAiSummary)
  const setAiSummaryStatus = useMeetingStore(
    (state) => state.setAiSummaryStatus,
  )
  const { copy, copyState } = useClipboard()
  const displayedTurns = meeting.turns
  const displayedDuration = meeting.durationSeconds
  const displayedNotes = meeting.notes
  const hasSummaryContent =
    displayedTurns.length > 0 || displayedNotes.length > 0
  const hasTranscript = displayedTurns.length > 0
  const participantNames = meeting.participants
    .map((participant) => participant.name.trim())
    .filter(Boolean)
  const participantLabel =
    participantNames.length > 0
      ? participantNames.join(', ')
      : t('summary.notRecorded')
  const dateTimeLabel = meeting.startedAt
    ? formatDateTime(meeting.startedAt, locale)
    : t('summary.notRecorded')

  const aiSummary = meeting.aiSummary
  const aiSummaryStatus = meeting.aiSummaryStatus || 'idle'

  useEffect(() => {
    const overview = overviewRef.current
    if (!overview) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const hasScrolledPastOverview =
          !entry.isIntersecting && entry.boundingClientRect.bottom <= 64
        setShowCompactOverview(hasScrolledPastOverview)
      },
      {
        rootMargin: '-64px 0px 0px',
        threshold: 0,
      },
    )

    observer.observe(overview)
    return () => observer.disconnect()
  }, [])

  const startAiSummaryGeneration = useCallback(async () => {
    if (!hasSummaryContent) return
    setAiSummary('', 'loading')
    try {
      const response = await fetch(`${API_URL}/summary/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meeting.title,
          turns: meeting.turns,
          notes: meeting.notes,
        }),
      })
      if (!response.body) {
        throw new Error('No stream body received')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              if (data.type === 'summary.partial') {
                setAiSummary(data.summary, 'streaming')
              } else if (data.type === 'summary.done') {
                setAiSummary(data.summary, 'done')
              } else if (data.type === 'error') {
                setAiSummaryStatus('error')
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      }
    } catch {
      setAiSummaryStatus('error')
    }
  }, [
    hasSummaryContent,
    meeting.notes,
    meeting.title,
    meeting.turns,
    setAiSummary,
    setAiSummaryStatus,
  ])

  useEffect(() => {
    if (
      hasSummaryContent &&
      (!meeting.aiSummaryStatus || meeting.aiSummaryStatus === 'idle') &&
      !meeting.aiSummary
    ) {
      startAiSummaryGeneration()
    }
  }, [
    hasSummaryContent,
    meeting.aiSummaryStatus,
    meeting.aiSummary,
    startAiSummaryGeneration,
  ])

  let summaryText: string
  let actionItems: ActionItem[]
  let decisions: string[]

  {
    if (displayedTurns.length === 0 && displayedNotes.length === 0) {
      summaryText = t('summary.emptyTitle')
    } else {
      summaryText = t(
        displayedTurns.length === 1
          ? 'summary.generatedOne'
          : 'summary.generatedMany',
        {
          title: meeting.title,
          count: displayedTurns.length,
        },
      )

      const summaryParticipantNames = meeting.participants
        .map((participant) => participant.name.trim())
        .filter(Boolean)
        .join(', ')
      if (summaryParticipantNames) {
        summaryText += ` ${t('summary.participantsSentence', {
          participants: summaryParticipantNames,
        })}`
      }

      if (displayedNotes.length > 0) {
        summaryText += ` ${t('summary.notesSentence', {
          notes: displayedNotes
            .map((note) => note.text)
            .join('; '),
        })}`
      }
    }

    const actionNotes = displayedNotes.filter((note) => {
      const textLower = note.text.toLowerCase()
      return (
        textLower.includes('việc cần làm') ||
        textLower.includes('cần làm') ||
        textLower.includes('todo') ||
        textLower.includes('action') ||
        textLower.includes('task')
      )
    })

    actionItems = actionNotes.map((note, index) => {
      let owner = t('summary.unassigned')
      for (const participant of meeting.participants) {
        if (
          participant.name &&
          note.text
            .toLowerCase()
            .includes(participant.name.toLowerCase())
        ) {
          owner = participant.name
          break
        }
      }

      let title = note.text
      const prefixes = [
        'việc cần làm:',
        'việc cần làm',
        'cần làm:',
        'cần làm',
        'todo:',
        'todo',
        'action:',
        'action',
        'task:',
        'task',
      ]
      for (const prefix of prefixes) {
        if (title.toLowerCase().startsWith(prefix)) {
          title = title.substring(prefix.length).trim()
          if (title.startsWith(':') || title.startsWith('-')) {
            title = title.substring(1).trim()
          }
          break
        }
      }
      title = title.charAt(0).toUpperCase() + title.slice(1)

      return {
        id: `action-dynamic-${index}`,
        title,
        owner,
        status: 'open' as const,
      }
    })

    const decisionNotes = displayedNotes.filter((note) => {
      const textLower = note.text.toLowerCase()
      return (
        textLower.includes('quyết định') ||
        textLower.includes('decision') ||
        textLower.includes('thống nhất') ||
        textLower.includes('agree')
      )
    })

    decisions = decisionNotes.map((note) => {
      let title = note.text
      const prefixes = [
        'quyết định:',
        'quyết định',
        'decision:',
        'decision',
        'thống nhất:',
        'thống nhất',
      ]
      for (const prefix of prefixes) {
        if (title.toLowerCase().startsWith(prefix)) {
          title = title.substring(prefix.length).trim()
          if (title.startsWith(':') || title.startsWith('-')) {
            title = title.substring(1).trim()
          }
          break
        }
      }
      return title.charAt(0).toUpperCase() + title.slice(1)
    })
  }

  const copyableSummary = (aiSummary ?? '').trim() || summaryText
  const summaryTabs = [
    {
      id: 'summary',
      label: t('summary.summaryTab'),
      icon: Clipboard,
    },
    {
      id: 'transcript',
      label: t('summary.transcriptTab'),
      icon: Languages,
    },
  ] as const

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) => {
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (tabIndex + 1) % summaryTabs.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex =
        (tabIndex - 1 + summaryTabs.length) % summaryTabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = summaryTabs.length - 1
    }

    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = summaryTabs[nextIndex]
    setActiveTab(nextTab.id)
    requestAnimationFrame(() => {
      document
        .getElementById(`${tabListId}-${nextTab.id}-tab`)
        ?.focus()
    })
  }

  const downloadTranscript = () => {
    const exportMeeting = {
      ...meeting,
      turns: displayedTurns,
      durationSeconds: displayedDuration,
    }
    const blob = new Blob(
      [`\uFEFF${createTranscriptText(exportMeeting, locale)}`],
      {
        type: 'text/plain;charset=utf-8',
      },
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = createTranscriptFileName(meeting.title)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const startAnotherMeeting = () => {
    const roomId = createRoomId()
    prepareAnotherMeeting()
    useMeetingStore.getState().setMeetingId(roomId)
    navigate(ROUTES.setup(roomId))
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a className="skip-link" href="#summary-content">
        {t('summary.skip')}
      </a>

      <header className="sticky top-0 z-50 border-b border-line bg-canvas-deep">
        <div className="mx-auto flex min-h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <BrandMark to="/" />
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <StatusBadge tone="success">{t('summary.ended')}</StatusBadge>
          </div>
        </div>
      </header>

      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-x-0 top-16 z-40 border-b border-line bg-canvas-deep transition-[transform,opacity] duration-200 ease-[var(--ease-out-expo)]',
          showCompactOverview
            ? 'translate-y-0 opacity-100'
            : '-translate-y-full opacity-0',
        )}
      >
        <div className="mx-auto flex min-h-14 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-primary">
              {t('summary.eyebrow')}
            </p>
            <p className="mt-0.5 truncate text-sm font-bold tracking-[-0.01em] text-ink sm:text-base">
              {meeting.title}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-strong">
            <CalendarClock className="size-4 text-muted" />
            <span>{dateTimeLabel}</span>
          </div>
        </div>
      </div>

      <main
        id="summary-content"
        className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"
      >
        <div
          ref={overviewRef}
          className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="max-w-3xl">
            <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-primary">
              {t('summary.eyebrow')}
            </p>
            <h1 className="mt-2 text-balance text-[clamp(1.875rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.045em] text-ink">
              {meeting.title}
            </h1>
          </div>
          <div className="max-w-xl">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={hasSummaryContent ? 'primary' : 'secondary'}
                leadingIcon={
                  copyState === 'copied' ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )
                }
                onClick={() => void copy(copyableSummary)}
                disabled={!hasSummaryContent}
                aria-describedby={
                  hasSummaryContent ? undefined : 'summary-actions-support'
                }
              >
                {copyState === 'copied'
                  ? t('summary.copied')
                  : t('summary.copy')}
              </Button>
              <Button
                variant="secondary"
                leadingIcon={
                  <Download className="size-4" aria-hidden="true" />
                }
                onClick={downloadTranscript}
                disabled={!hasTranscript}
                aria-describedby={
                  hasTranscript ? undefined : 'summary-actions-support'
                }
              >
                {t('summary.download')}
              </Button>
              <Button
                variant={hasSummaryContent ? 'secondary' : 'primary'}
                trailingIcon={
                  <ArrowRight className="size-4" aria-hidden="true" />
                }
                onClick={startAnotherMeeting}
                className={!hasSummaryContent ? 'w-full sm:w-auto' : undefined}
              >
                {t('summary.startAnotherShort')}
              </Button>
            </div>
            {!hasTranscript && (
              <p
                id="summary-actions-support"
                className="mt-3 text-xs leading-5 text-muted"
              >
                {t(
                  hasSummaryContent
                    ? 'summary.noTranscriptAction'
                    : 'summary.noContentActions',
                )}
              </p>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 border-b border-line lg:grid-cols-[0.8fr_0.8fr_1fr_1.4fr_1.8fr]">
          <MetadataItem
            icon={<Timer className="size-4" aria-hidden="true" />}
            label={t('summary.duration')}
            value={formatDurationLabel(displayedDuration, locale)}
          />
          <MetadataItem
            icon={<ListChecks className="size-4" aria-hidden="true" />}
            label={t('summary.conversationTurns')}
            value={displayedTurns.length.toString()}
          />
          <MetadataItem
            icon={<Languages className="size-4" aria-hidden="true" />}
            label={t('summary.languages')}
            value={formatLanguagePair(meeting.languageOrder, locale)}
          />
          <MetadataItem
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
            label={t('summary.dateTime')}
            value={dateTimeLabel}
          />
          <MetadataItem
            icon={<UsersRound className="size-4" aria-hidden="true" />}
            label={t('summary.participants')}
            value={participantLabel}
          />
        </dl>

        <div className="grid gap-7 py-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10 lg:py-8">
          <nav className="min-w-0" aria-label={t('summary.tabsLabel')}>
            <div className="lg:sticky lg:top-[8rem]">
              <p className="hidden text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted lg:block">
                {t('summary.detailLabel')}
              </p>
              <div
                id={tabListId}
                role="tablist"
                aria-label={t('summary.tabsLabel')}
                className="grid grid-cols-2 gap-1 rounded-xl bg-panel-raised p-1 lg:mt-3 lg:grid-cols-1 lg:rounded-none lg:bg-transparent lg:p-0"
              >
                {summaryTabs.map((tab, tabIndex) => {
                  const Icon = tab.icon
                  const selected = activeTab === tab.id

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`${tabListId}-${tab.id}-tab`}
                      aria-controls={`${tabListId}-${tab.id}-panel`}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(event) =>
                        handleTabKeyDown(event, tabIndex)
                      }
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:justify-start',
                        selected
                          ? 'bg-panel text-ink shadow-[0_1px_3px_rgb(16_24_40/0.1)] lg:bg-panel-raised lg:shadow-none'
                          : 'text-muted hover:bg-panel hover:text-muted-strong lg:hover:bg-panel-raised',
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {tab.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </nav>

          <div className="min-w-0">
            {activeTab === 'summary' && (
              <div
                role="tabpanel"
                id={`${tabListId}-summary-panel`}
                aria-labelledby={`${tabListId}-summary-tab`}
              >
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
                  <section
                    aria-labelledby="summary-heading"
                    className="rounded-[14px] border border-line-strong bg-panel px-5 py-6 shadow-[0_8px_24px_rgb(16_24_40/0.04)] sm:px-7 sm:py-8"
                  >
                    <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-primary">
                        <Clipboard
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <h2
                          id="summary-heading"
                          className="text-xs font-bold uppercase tracking-[0.12em]"
                        >
                          {t('summary.title')} · {t('summary.aiModel')}
                        </h2>
                      </div>
                      {hasSummaryContent && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={startAiSummaryGeneration}
                          disabled={
                            aiSummaryStatus === 'loading' ||
                            aiSummaryStatus === 'streaming'
                          }
                          className="h-9 gap-1.5 self-start text-xs sm:self-auto"
                        >
                          <RotateCcw
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          {aiSummaryStatus === 'loading' ||
                          aiSummaryStatus === 'streaming'
                            ? t('summary.generating')
                            : t('summary.regenerateAi')}
                        </Button>
                      )}
                    </div>
                    <div className="mt-6">
                      {aiSummaryStatus === 'loading' && !aiSummary ? (
                        <div className="flex flex-col gap-3 py-6">
                          <div className="flex items-center gap-2 text-sm font-medium text-primary animate-pulse">
                            <span
                              className="size-2 rounded-full bg-primary animate-ping"
                              aria-hidden="true"
                            />
                            {t('summary.generatingDescription')}
                          </div>
                          <div className="h-4 w-3/4 rounded bg-panel-hover animate-pulse" />
                          <div className="h-4 w-1/2 rounded bg-panel-hover animate-pulse" />
                          <div className="h-4 w-5/6 rounded bg-panel-hover animate-pulse" />
                        </div>
                      ) : aiSummary ? (
                        <FormattedAiSummary
                          content={aiSummary}
                          isStreaming={aiSummaryStatus === 'streaming'}
                        />
                      ) : (
                        <p className="max-w-[70ch] break-words text-base leading-8 text-ink-soft sm:text-lg">
                          {summaryText}
                        </p>
                      )}
                    </div>
                    {hasSummaryContent && !aiSummary && (
                      <p className="mt-4 max-w-[70ch] text-xs leading-5 text-muted">
                        {t('summary.localNotice')}
                      </p>
                    )}
                  </section>

                  <section
                    aria-labelledby="actions-heading"
                    className="self-start rounded-[14px] border border-line bg-panel px-5 py-6 sm:px-6"
                  >
                    <h2
                      id="actions-heading"
                      className="text-sm font-bold text-ink"
                    >
                      {t('summary.actionItems')}
                    </h2>
                    {actionItems.length === 0 ? (
                      <p className="mt-4 text-xs leading-relaxed text-muted">
                        {t('summary.noActionItems')}
                      </p>
                    ) : (
                      <ol className="mt-4 divide-y divide-line">
                        {actionItems.map((item, index) => (
                          <ActionItemRow
                            key={item.id}
                            item={item}
                            index={index}
                          />
                        ))}
                      </ol>
                    )}
                  </section>
                </div>

                <section
                  aria-labelledby="decisions-heading"
                  className="mt-6 border-y border-line py-8"
                >
                  <div className="grid gap-6 xl:grid-cols-[13rem_1fr]">
                    <div>
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted">
                        {t('summary.alignedOutcomes')}
                      </p>
                      <h2
                        id="decisions-heading"
                        className="mt-2 text-xl font-bold tracking-[-0.025em]"
                      >
                        {t('summary.decisions')}
                      </h2>
                    </div>
                    {decisions.length === 0 ? (
                      <p className="text-xs leading-5 text-muted xl:pl-4">
                        {t('summary.noDecisions')}
                      </p>
                    ) : (
                      <ol className="grid gap-3 sm:grid-cols-2">
                        {decisions.map((decision, index) => (
                          <li
                            key={`${decision}-${index}`}
                            className="flex min-w-0 gap-4 break-words border-l border-line-strong pl-4 text-sm leading-6 text-ink-soft"
                          >
                            <span className="font-bold text-primary">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            {decision}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </section>

                <section
                  aria-labelledby="notes-heading"
                  className="border-b border-line py-8"
                >
                  <div className="grid gap-6 xl:grid-cols-[13rem_1fr]">
                    <div>
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted">
                        {t('sidebar.notesTitle')}
                      </p>
                      <h2
                        id="notes-heading"
                        className="mt-2 text-xl font-bold tracking-[-0.025em]"
                      >
                        {t('summary.notesSection')}
                      </h2>
                    </div>
                    {displayedNotes.length === 0 ? (
                      <p className="text-xs leading-5 text-muted xl:pl-4">
                        {t('summary.noNotes')}
                      </p>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {displayedNotes.map((note, index) => (
                          <li
                            key={note.id || index}
                            className="flex min-w-0 gap-4 break-words border-l border-line-strong pl-4 text-sm leading-6 text-ink-soft"
                          >
                            {note.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'transcript' && (
              <section
                role="tabpanel"
                id={`${tabListId}-transcript-panel`}
                aria-labelledby={`${tabListId}-transcript-tab`}
              >
                <div className="mb-6 flex items-end justify-between gap-4 border-b border-line pb-5">
                  <div>
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted">
                      {t('summary.fullRecord')}
                    </p>
                    <h2
                      id="transcript-heading"
                      className="mt-2 text-2xl font-bold tracking-[-0.03em]"
                    >
                      {t('summary.transcript')}
                    </h2>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {t(
                      displayedTurns.length === 1
                        ? 'common.turn'
                        : 'common.turns',
                      { count: displayedTurns.length },
                    )}
                  </span>
                </div>

                {displayedTurns.length > 0 ? (
                  <ol className="grid gap-3">
                    {displayedTurns.map((turn) => (
                      <ConversationTurnCard
                        key={turn.id}
                        turn={turn}
                        compact
                        readOnly
                      />
                    ))}
                  </ol>
                ) : (
                  <div className="border-y border-line py-12 text-center">
                    <p className="text-sm font-semibold text-ink-soft">
                      {t('summary.emptyTitle')}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {t('summary.emptyDescription')}
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        <div className="mt-12 flex justify-center border-t border-line pt-8">
          <Button
            variant="secondary"
            leadingIcon={<RotateCcw className="size-4" aria-hidden="true" />}
            onClick={startAnotherMeeting}
          >
            {t('summary.startAnother')}
          </Button>
        </div>

        <p className="sr-only" aria-live="polite">
          {copyState === 'copied'
            ? t('summary.copySuccess')
            : copyState === 'failed'
              ? t('summary.copyFailed')
              : ''}
        </p>
      </main>
    </div>
  )
}

interface MetadataItemProps {
  icon: React.ReactNode
  label: string
  value: string
}

function MetadataItem({ icon, label, value }: MetadataItemProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-r border-t border-line px-1 py-3 even:border-r-0 last:col-span-2 last:border-r-0 sm:gap-3 sm:px-5 sm:py-4 lg:col-span-1 lg:border-r lg:first:pl-0 lg:last:col-span-1 lg:last:border-r-0">
      <span className="text-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted">
          {label}
        </dt>
        <dd className="mt-1 break-words text-sm font-semibold text-ink-soft">
          {value}
        </dd>
      </div>
    </div>
  )
}

interface ActionItemRowProps {
  item: ActionItem
  index: number
}

function ActionItemRow({ item, index }: ActionItemRowProps) {
  const { t } = useTranslation()
  const { copy, copyState } = useClipboard()

  return (
    <li className="grid gap-3 py-4 first:pt-1">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xs font-bold tabular-nums text-muted">
          {String(index + 1).padStart(2, '0')}
        </span>
        <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-6 text-ink-soft">
          {item.title}
        </p>
        <IconButton
          label={
            copyState === 'copied'
              ? t('summary.actionCopied')
              : t('summary.copyAction')
          }
          icon={
            copyState === 'copied' ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )
          }
          onClick={() => void copy(item.title)}
        />
      </div>
      <div className="ml-7 flex items-center justify-between gap-3">
        <span className="min-w-0 break-words text-xs text-muted">
          {item.owner}
        </span>
        <StatusBadge tone="warning">{t('common.open')}</StatusBadge>
      </div>
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied'
          ? t('summary.actionCopied')
          : copyState === 'failed'
            ? t('summary.actionCopyFailed')
            : ''}
      </span>
    </li>
  )
}
