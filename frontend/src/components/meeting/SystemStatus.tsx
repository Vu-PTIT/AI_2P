import { FlaskConical, Gauge, Hash, Radio, Volume2 } from 'lucide-react'

import { useTranslation } from '@/hooks/useTranslation'
import type { TranslationKey } from '@/i18n/translations'
import { cn } from '@/lib/utils'
import { useMeetingStore } from '@/store/meetingStore'
import type { RealtimeSessionStatus } from '@/types/realtime'

const connectionValueKeys = {
  connecting: 'system.connecting',
  reconnecting: 'system.reconnecting',
  'gateway-connected': 'system.gatewayConnected',
  ended: 'system.sessionEnded',
  error: 'system.connectionIssue',
} as const satisfies Record<RealtimeSessionStatus, TranslationKey>

export interface SystemStatusProps {
  embedded?: boolean
}

export function SystemStatus({
  embedded = false,
}: SystemStatusProps) {
  const { t } = useTranslation()
  const meetingId = useMeetingStore((state) => state.meeting.id)
  const realtimeStatus = useMeetingStore(
    (state) => state.realtimeSession.status,
  )
  const realtimeWarning = useMeetingStore(
    (state) => state.realtimeSession.lastWarning,
  )
  const noiseLevel = useMeetingStore((state) => state.noiseLevel)
  const noiseValueKey =
    noiseLevel === 'unknown'
      ? 'system.awaitingMetrics'
      : (`common.${noiseLevel}` as const)
  const latencyValueKey =
    realtimeStatus === 'error' || realtimeWarning
      ? 'system.unavailable'
      : 'system.awaitingMetrics'
  const connectionValueKey =
    realtimeStatus === 'gateway-connected' && realtimeWarning
      ? 'system.translationLimited'
      : connectionValueKeys[realtimeStatus]
  const statusItems = [
    {
      labelKey: 'system.room',
      value: meetingId,
      icon: Hash,
    },
    {
      labelKey: 'system.connection',
      valueKey: connectionValueKey,
      icon: Radio,
    },
    {
      labelKey: 'system.latency',
      valueKey: latencyValueKey,
      icon: Gauge,
    },
    {
      labelKey: 'system.noise',
      valueKey: noiseValueKey,
      icon: Volume2,
    },
    {
      labelKey: 'system.mode',
      valueKey: 'system.realtimeGateway',
      icon: FlaskConical,
    },
  ] as const satisfies readonly {
    labelKey: TranslationKey
    value?: string
    valueKey?: TranslationKey
    icon: typeof Radio
  }[]

  return (
    <section
      className={cn(!embedded && 'border-t border-line px-4 py-4')}
      aria-labelledby={embedded ? undefined : 'system-status-heading'}
      aria-label={embedded ? t('system.title') : undefined}
    >
      {!embedded && (
        <h3
          id="system-status-heading"
          className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted"
        >
          {t('system.title')}
        </h3>
      )}
      <dl
        className={cn(
          'grid',
          embedded
            ? 'grid-cols-1 gap-x-6 border-t border-line sm:grid-cols-2'
            : 'mt-3 gap-2.5',
        )}
      >
        {statusItems.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.labelKey}
              className={cn(
                'text-xs',
                embedded
                  ? 'border-b border-line py-3.5'
                  : 'flex items-center justify-between gap-3',
              )}
            >
              <dt className="flex items-center gap-2 text-muted">
                <Icon className="size-3.5" aria-hidden="true" />
                {t(item.labelKey)}
              </dt>
              <dd
                className={cn(
                  'font-semibold text-muted-strong',
                  embedded
                    ? 'mt-1.5 break-words pl-[1.375rem] text-sm leading-5'
                    : 'max-w-[10rem] truncate text-right',
                )}
              >
                {'valueKey' in item ? t(item.valueKey) : item.value}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
