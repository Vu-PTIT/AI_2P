import {
  Camera,
  Mic,
  RefreshCw,
  Speaker,
  X,
} from 'lucide-react'

import type {
  MediaDeviceOption,
  MediaDevicesState,
} from '@/hooks/useMediaDevices'
import { useTranslation } from '@/hooks/useTranslation'
import type { TranslationKey } from '@/i18n/translations'
import { cn } from '@/lib/utils'

export interface MeetingDeviceMenuProps {
  id: string
  mediaDevices: MediaDevicesState
  microphoneId: string
  cameraId: string
  speakerId: string
  onSelectMicrophone: (deviceId: string) => void
  onSelectCamera: (deviceId: string) => void
  onSelectSpeaker: (deviceId: string) => void
  onClose: () => void
}

export function MeetingDeviceMenu({
  id,
  mediaDevices,
  microphoneId,
  cameraId,
  speakerId,
  onSelectMicrophone,
  onSelectCamera,
  onSelectSpeaker,
  onClose,
}: MeetingDeviceMenuProps) {
  const { t } = useTranslation()
  const statusKey =
    mediaDevices.listStatus === 'checking'
      ? 'controls.deviceListChecking'
      : mediaDevices.listStatus === 'unsupported'
        ? 'controls.deviceListUnsupported'
        : mediaDevices.listStatus === 'error'
          ? 'controls.deviceListError'
          : null

  return (
    <section
      id={id}
      role="dialog"
      aria-label={t('controls.deviceMenuTitle')}
      aria-describedby={`${id}-description`}
      className="absolute bottom-[calc(100%+0.625rem)] right-0 z-40 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-[14px] border border-line-strong bg-panel text-left text-ink shadow-[0_18px_48px_rgb(16_24_40/0.2)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-[-0.01em]">
            {t('controls.deviceMenuTitle')}
          </h2>
          <p
            id={`${id}-description`}
            className="mt-1 text-xs leading-5 text-muted"
          >
            {t('controls.deviceMenuDescription')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={t('controls.refreshDevices')}
            title={t('controls.refreshDevices')}
            onClick={() => void mediaDevices.refresh()}
            className="grid size-11 place-items-center rounded-[10px] text-muted-strong transition-colors hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('controls.closeDeviceMenu')}
            title={t('controls.closeDeviceMenu')}
            onClick={onClose}
            className="grid size-11 place-items-center rounded-[10px] text-muted-strong transition-colors hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid max-h-[min(28rem,calc(100dvh-8rem))] gap-4 overflow-y-auto overscroll-y-contain px-4 py-4">
        {statusKey && (
          <p
            role={mediaDevices.listStatus === 'error' ? 'alert' : 'status'}
            className={cn(
              'rounded-[10px] border px-3 py-2 text-xs leading-5',
              mediaDevices.listStatus === 'error'
                ? 'border-red-200 bg-red-50 text-danger'
                : 'border-line bg-panel-muted text-muted-strong',
            )}
          >
            {t(statusKey)}
          </p>
        )}

        <DeviceSelect
          label={t('devices.microphone')}
          icon={<Mic className="size-4" aria-hidden="true" />}
          value={microphoneId}
          options={mediaDevices.microphones}
          emptyLabel={t('devices.noMicrophone')}
          fallbackKey="devices.microphoneFallback"
          disabled={
            mediaDevices.listStatus !== 'ready' ||
            mediaDevices.microphones.length === 0
          }
          onChange={onSelectMicrophone}
        />

        <DeviceSelect
          label={t('devices.camera')}
          icon={<Camera className="size-4" aria-hidden="true" />}
          value={cameraId}
          options={mediaDevices.cameras}
          emptyLabel={t('devices.noCamera')}
          fallbackKey="devices.cameraFallback"
          disabled={
            mediaDevices.listStatus !== 'ready' ||
            mediaDevices.cameras.length === 0
          }
          onChange={onSelectCamera}
        />

        <div className="grid gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <Speaker className="size-4" aria-hidden="true" />
            {t('devices.speaker')}
          </span>
          {mediaDevices.outputSelectionSupported &&
          mediaDevices.speakers.length > 0 ? (
            <select
              value={speakerId}
              onChange={(event) => onSelectSpeaker(event.target.value)}
              className="h-11 min-w-0 rounded-[10px] border border-line-strong bg-panel px-3 text-sm text-ink outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              {mediaDevices.speakers.map((device, index) => (
                <option key={device.id} value={device.id}>
                  {device.label ||
                    t('devices.speakerFallback', {
                      count: index + 1,
                    })}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex min-h-11 items-center rounded-[10px] border border-line bg-panel-muted/65 px-3 text-sm text-muted-strong">
              {t('devices.systemSpeaker')}
            </div>
          )}
        </div>
      </div>

    </section>
  )
}

interface DeviceSelectProps {
  label: string
  icon: React.ReactNode
  value: string
  options: MediaDeviceOption[]
  emptyLabel: string
  fallbackKey:
    | 'devices.microphoneFallback'
    | 'devices.cameraFallback'
  disabled: boolean
  onChange: (deviceId: string) => void
}

function DeviceSelect({
  label,
  icon,
  value,
  options,
  emptyLabel,
  fallbackKey,
  disabled,
  onChange,
}: DeviceSelectProps) {
  const { t } = useTranslation()

  return (
    <label className="grid gap-2 text-xs font-semibold text-ink-soft">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-11 min-w-0 rounded-[10px] border border-line-strong bg-panel px-3 text-sm font-normal text-ink outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.length === 0 ? (
          <option value="">{emptyLabel}</option>
        ) : (
          options.map((device, index) => (
            <option key={device.id} value={device.id}>
              {device.label ||
                t(fallbackKey as TranslationKey, {
                  count: index + 1,
                })}
            </option>
          ))
        )}
      </select>
    </label>
  )
}
