import { useEffect } from 'react'
import { useParams } from 'react-router'

import { useMeetingStore } from '@/store/meetingStore'

export function useRoomSession(): string {
  const { roomId } = useParams<{ roomId: string }>()
  const meetingId = useMeetingStore((state) => state.meeting.id)
  const setMeetingId = useMeetingStore((state) => state.setMeetingId)
  const activeRoomId = roomId?.trim() || meetingId

  useEffect(() => {
    if (activeRoomId !== meetingId) {
      setMeetingId(activeRoomId)
    }
  }, [activeRoomId, meetingId, setMeetingId])

  return activeRoomId
}
