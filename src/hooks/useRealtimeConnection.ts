import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

import { useMeetingStore } from '@/store/meetingStore'
import { AudioStreamer } from '@/lib/audioStreamer'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SOCKET_URL) ||
  'https://api-hackathon.dangpham.id.vn'

export function useRealtimeConnection() {
  const meeting = useMeetingStore((state) => state.meeting)
  const microphoneEnabled = useMeetingStore((state) => state.microphoneEnabled)
  const realtimeSession = useMeetingStore((state) => state.realtimeSession)
  const applyRealtimeEvent = useMeetingStore((state) => state.applyRealtimeEvent)
  const setAudioInputLevel = useMeetingStore((state) => state.setAudioInputLevel)

  const socketRef = useRef<Socket | null>(null)
  const streamerRef = useRef<AudioStreamer | null>(null)

  const { id: roomId, status: meetingStatus, languageOrder } = meeting
  const { clientId } = realtimeSession
  const speaker = languageOrder[0] // Trình duyệt này nói ngôn ngữ đầu tiên trong list

  // Quản lý kết nối Socket.IO
  useEffect(() => {
    if (meetingStatus !== 'live') {
      // Dọn dẹp nếu cuộc họp không ở trạng thái live
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      return
    }

    if (socketRef.current) return

    const socket = io(`${SOCKET_URL}/audio`, {
      query: {
        sessionId: roomId,
        clientId,
        domain: 'business',
        languagePair: 'vi-en',
      },
      transports: ['websocket'],
      reconnection: false,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Socket.IO connected to backend')
      // Đánh dấu người nói ban đầu ngay sau khi connect
      socket.emit('speaker.switch', { speaker })
    })

    socket.on('session.ready', (data: { clientId: string; sessionId: string }) => {
      applyRealtimeEvent({
        type: 'session.ready',
        clientId: data.clientId,
        sessionId: data.sessionId,
      })
    })

    socket.on('stt.partial', (data) => {
      applyRealtimeEvent({
        type: 'stt.partial',
        text: data.text,
        speaker: data.speaker,
        utteranceId: data.utteranceId,
      })
    })

    socket.on('stt.final', (data) => {
      applyRealtimeEvent({
        type: 'stt.final',
        text: data.text,
        speaker: data.speaker,
        utteranceId: data.utteranceId,
      })
    })

    socket.on('translate.token', (data) => {
      applyRealtimeEvent({
        type: 'translate.token',
        token: data.token,
        utteranceId: data.utteranceId,
      })
    })

    socket.on('translate.done', (data) => {
      applyRealtimeEvent({
        type: 'translate.done',
        fullText: data.fullText,
        sourceText: data.sourceText,
        speaker: data.speaker,
        utteranceId: data.utteranceId,
      })
    })

    socket.on('session.ended', () => {
      applyRealtimeEvent({ type: 'session.ended' })
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    })

    socket.on('error', (err: { code?: string; message: string }) => {
      applyRealtimeEvent({
        type: 'error',
        code: err.code || 'UNKNOWN_ERROR',
        message: err.message || 'Lỗi kết nối Socket',
      })
    })

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected')
      applyRealtimeEvent({ type: 'session.ended' })
      socketRef.current = null
    })

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [meetingStatus, roomId, clientId, applyRealtimeEvent, speaker])

  // Đồng bộ speaker switch khi ngôn ngữ thay đổi trong phòng
  useEffect(() => {
    if (socketRef.current) {
      if (socketRef.current.connected) {
        socketRef.current.emit('speaker.switch', { speaker })
      } else {
        socketRef.current.once('connect', () => {
          socketRef.current?.emit('speaker.switch', { speaker })
        })
      }
    }
  }, [speaker])

  // Quản lý truyền phát microphone âm thanh
  useEffect(() => {
    const isLive = meetingStatus === 'live'

    // Cần bật mic và đang họp trực tuyến
    if (isLive && microphoneEnabled) {
      let activeStreamer = streamerRef.current

      const startStreamer = async () => {
        try {
          if (activeStreamer) {
            activeStreamer.stop()
          }

          // Luôn emit speaker switch trước khi stream để backend định tuyến đúng
          if (socketRef.current) {
            if (socketRef.current.connected) {
              socketRef.current.emit('speaker.switch', { speaker })
            } else {
              socketRef.current.once('connect', () => {
                socketRef.current?.emit('speaker.switch', { speaker })
              })
            }
          }

          const streamer = new AudioStreamer({
            sampleRate: 16000,
            chunkSize: 4096,
            onAudioChunk: (chunk) => {
              if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit('audio.chunk', chunk)
              }
            },
            onVolume: (vol) => {
              // Normalize volume sang 0.0 - 1.0 cho UI
              setAudioInputLevel(vol / 100)
            },
          })

          await streamer.start()
          streamerRef.current = streamer
        } catch (err) {
          console.error('Lỗi truy cập microphone:', err)
          setAudioInputLevel(0)
        }
      }

      startStreamer()
    } else {
      // Tắt mic
      if (streamerRef.current) {
        streamerRef.current.stop()
        streamerRef.current = null
      }
      setAudioInputLevel(0)
    }

    return () => {
      if (streamerRef.current) {
        streamerRef.current.stop()
        streamerRef.current = null
      }
    }
  }, [meetingStatus, microphoneEnabled, speaker, setAudioInputLevel])

  // Hàm thủ công kết thúc phiên
  const endSession = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('session.end')
    }
  }

  return { endSession }
}
