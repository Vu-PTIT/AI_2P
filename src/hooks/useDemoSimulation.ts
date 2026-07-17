import { useCallback, useEffect, useRef } from 'react'

import { demoTurnScripts } from '@/data/mockMeeting'
import { DEMO_TIMING } from '@/lib/constants'
import { useMeetingStore } from '@/store/meetingStore'
import type { ConversationTurn } from '@/types/meeting'

const revealText = (text: string, slice: number, totalSlices: number): string =>
  text.slice(0, Math.ceil((text.length * slice) / totalSlices))

const revealTextChunk = (
  text: string,
  slice: number,
  totalSlices: number,
): string => {
  const previousEnd = Math.ceil((text.length * (slice - 1)) / totalSlices)
  const currentEnd = Math.ceil((text.length * slice) / totalSlices)

  return text.slice(previousEnd, currentEnd)
}

export function useDemoSimulation() {
  const timerIdsRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId))
    timerIdsRef.current = []
  }, [])

  const schedule = useCallback(
    (runId: number, delay: number, callback: () => void) => {
      const timerId = window.setTimeout(() => {
        if (useMeetingStore.getState().demoRunId === runId) {
          callback()
        }
      }, delay)
      timerIdsRef.current.push(timerId)
    },
    [],
  )

  const runDemo = useCallback(() => {
    clearTimers()

    const store = useMeetingStore.getState()
    const runId = store.beginDemo()

    demoTurnScripts.forEach((script, turnIndex) => {
      const turnOffset = turnIndex * DEMO_TIMING.nextTurnAtMs

      schedule(runId, turnOffset, () => {
        const currentStore = useMeetingStore.getState()
        const currentSpeaker =
          currentStore.meeting.participants.find(
            (participant) => participant.id === script.speakerId,
          )?.name ?? script.speakerName

        const turn: ConversationTurn = {
          id: script.id,
          roomId: currentStore.meeting.id,
          sequenceNumber: turnIndex + 1,
          speakerId: script.speakerId,
          speakerName: currentSpeaker,
          sourceLanguage: script.sourceLanguage,
          targetLanguage: script.targetLanguage,
          timestampSeconds: script.timestampSeconds,
          startedAt: Date.now(),
          originalText: '',
          translatedText: '',
          status: 'listening',
        }

        currentStore.addTurn(turn)
      })

      schedule(runId, turnOffset + DEMO_TIMING.listeningMs, () => {
        useMeetingStore
          .getState()
          .updateTurn(script.id, { status: 'transcribing' })
      })

      for (
        let slice = 1;
        slice <= DEMO_TIMING.transcriptSlices;
        slice += 1
      ) {
        schedule(
          runId,
          turnOffset +
            DEMO_TIMING.listeningMs +
            slice * DEMO_TIMING.transcriptSliceMs,
          () => {
            useMeetingStore.getState().applyRealtimeEvent({
              type: 'stt.partial',
              text: revealText(
                  script.originalText,
                  slice,
                  DEMO_TIMING.transcriptSlices,
                ),
              speaker: script.sourceLanguage,
              utteranceId: script.id,
            })
          },
        )
      }

      schedule(runId, turnOffset + DEMO_TIMING.draftAtMs, () => {
        useMeetingStore.getState().applyRealtimeEvent({
          type: 'stt.final',
          text: script.originalText,
          speaker: script.sourceLanguage,
          utteranceId: script.id,
        })
      })

      for (let slice = 1; slice <= 5; slice += 1) {
        schedule(
          runId,
          turnOffset + DEMO_TIMING.draftAtMs + slice * 100,
          () => {
            useMeetingStore.getState().applyRealtimeEvent({
              type: 'translate.token',
              token: revealTextChunk(script.draftTranslation, slice, 5),
              utteranceId: script.id,
            })
          },
        )
      }

      schedule(runId, turnOffset + DEMO_TIMING.finalAtMs, () => {
        const currentTurn = useMeetingStore
          .getState()
          .meeting.turns.find((turn) => turn.id === script.id)

        if (!currentTurn?.isEdited) {
          useMeetingStore.getState().applyRealtimeEvent({
            type: 'translate.done',
            fullText: script.finalTranslation,
            sourceText: script.originalText,
            speaker: script.sourceLanguage,
            utteranceId: script.id,
          })
        }
      })
    })

    schedule(
      runId,
      demoTurnScripts.length * DEMO_TIMING.nextTurnAtMs,
      () => useMeetingStore.getState().completeDemo(),
    )
  }, [clearTimers, schedule])

  const resetDemo = useCallback(() => {
    clearTimers()
    useMeetingStore.getState().resetDemo()
  }, [clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  return { runDemo, resetDemo }
}
