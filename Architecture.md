# ViEngsMeet — Integration Guide

> Backend NestJS đã sẵn sàng. Tài liệu này dành cho 2 team:
> - **Frontend (Next.js)**: đọc **Phần 2**
> - **AI Service (FastAPI)**: đọc **Phần 3**
>
> Cả 2 team đọc **Phần 1** để hiểu bức tranh tổng thể.

---

## PHẦN 1 — TỔNG QUAN

### 1.1 Kiến trúc 3 hệ thống độc lập

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js)                         │
│                                                                 │
│  ┌────────────────────┐        ┌──────────────────────┐         │
│  │ Transcript Module  │        │ Video Call Module    │         │
│  │  (Socket.IO)       │        │  (livekit-client)    │         │
│  └─────────┬──────────┘        └──────────┬───────────┘         │
└────────────┼───────────────────────────────┼────────────────────┘
             │                               │
             │ Socket.IO /audio              │ WebRTC (WSS + UDP)
             │ (WSS)                         │
             ▼                               ▼
   ┌──────────────────────┐        ┌──────────────────────┐
   │  NestJS Gateway      │        │  LiveKit Server      │
   │  api-hackathon.      │        │  livekit-hackathon.  │
   │   dangpham.id.vn     │        │   dangpham.id.vn     │
   │                      │        │                      │
   │  - Socket.IO /audio  │        │  - SFU               │
   │  - POST /livekit/    │───────▶│  - Signaling         │
   │    token             │  JWT   │  - Media forwarding  │
   │  - GET /health       │        │                      │
   └──────────┬───────────┘        └──────────────────────┘
              │                               ▲
              │ raw ws://localhost:8000       │ (client connect trực tiếp
              │ (internal, không public)      │  bằng JWT NestJS cấp)
              ▼
   ┌──────────────────────┐
   │  FastAPI AI Worker   │
   │  (localhost:8000)    │
   │  - VAD + STT + LLM   │
   └──────────────────────┘
```

### 1.2 Nhiệm vụ mỗi hệ thống

| Hệ thống | Nhiệm vụ | Ai code |
|----------|----------|---------|
| **Client** (Next.js) | UI, capture audio, hiển thị transcript, video call | Frontend team |
| **NestJS** | Auth LiveKit, session state, forward audio, broadcast events | ✅ **Đã xong** |
| **FastAPI** | VAD + Speech-to-Text + Translation | AI team |
| **LiveKit Server** | Video call SFU | ✅ Deploy Docker |

### 1.3 Backend NestJS đang expose gì

| Endpoint | Method | Purpose | Ai gọi |
|----------|--------|---------|--------|
| `/audio` (Socket.IO) | WSS | Realtime transcript pipeline | Client |
| `/livekit/token` | POST | Sinh JWT để join room LiveKit | Client |
| `/health` | GET | Health check monitoring | Ops |
| `ws://localhost:8000/ws/session` | — | Bridge sang FastAPI | NestJS gọi FastAPI |

**Base URL production:** `https://api-hackathon.dangpham.id.vn`

---

## PHẦN 2 — CHO FRONTEND DEVELOPER

### 2.1 Cài dependencies

```bash
npm install socket.io-client livekit-client
```

### 2.2 Bootstrap flow — thứ tự thao tác khi vào phòng họp

```
Bước 1: Generate sessionId + clientId
Bước 2: Song song (chạy đồng thời, không cần đợi nhau):
        [A] Kết nối Socket.IO (transcript)
        [B] Lấy token + connect LiveKit (video)
Bước 3: Đợi Socket.IO event 'session.ready' → enable nút mic transcript
Bước 4: User bấm mic → capture audio 16kHz PCM → emit 'audio.chunk'
Bước 5: Nhận events transcript và cập nhật UI
```

### 2.3 Setup identifiers

```typescript
// Cần lưu localStorage để giữ định danh qua reload
function getOrCreateClientId(): string {
  let id = localStorage.getItem('clientId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('clientId', id);
  }
  return id;
}

// sessionId sinh mới mỗi phòng họp, hoặc lấy từ URL nếu join qua link
const sessionId = new URLSearchParams(location.search).get('room')
  ?? crypto.randomUUID();
const clientId = getOrCreateClientId();
```

### 2.4 Transcript integration (Socket.IO)

#### 2.4.1 Kết nối

```typescript
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('https://api-hackathon.dangpham.id.vn/audio', {
  query: {
    sessionId,
    clientId,
    domain: 'business',        // optional, default 'business'
    languagePair: 'vi-en',     // optional, default 'vi-en'
  },
  transports: ['websocket'],   // BẮT BUỘC — không dùng polling
});

socket.on('connect', () => console.log('Socket connected'));
socket.on('connect_error', (err) => console.error('Connect failed:', err));
```

⚠️ Nếu thiếu `sessionId` hoặc `clientId` → server sẽ disconnect ngay lập tức.

#### 2.4.2 Events bạn PHẢI emit

| Event | Payload | Khi nào gửi |
|-------|---------|-------------|
| `audio.chunk` | `ArrayBuffer` (PCM Int16, 16kHz, mono) | Liên tục ~200ms/chunk khi đang ghi âm |
| `speaker.switch` | `{ speaker: 'vi' \| 'en' }` | Khi user đổi ngôn ngữ đang nói |
| `session.end` | (không payload) | Khi user bấm "Kết thúc meeting" |

⚠️ **CHỈ BẮT ĐẦU gửi `audio.chunk` sau khi nhận `session.ready`**. Nếu gửi sớm hơn, chunk bị drop vì backend chưa kịp mở kết nối AI.

#### 2.4.3 Events bạn PHẢI listen

| Event | Payload | Xử lý UI |
|-------|---------|----------|
| `session.ready` | `{ clientId, sessionId }` | Enable nút mic, chuyển trạng thái "ready" |
| `stt.partial` | `{ text, speaker, utteranceId }` | Hiện text nhạt màu, cùng `utteranceId` thì **replace** |
| `stt.final` | `{ text, speaker, utteranceId }` | Chốt câu nguồn màu đen, tạo entry mới trong danh sách utterance |
| `translate.token` | `{ token, utteranceId }` | Append token vào cột đích (streaming) |
| `translate.done` | `{ fullText, sourceText, speaker, utteranceId }` | Chốt câu dịch, animation highlight |
| `session.ended` | (không payload) | Disable mic, hiện nút "Export" (nếu có) |
| `error` | `{ code, message }` | Toast đỏ |

**Broadcast note:** cả 4 event transcript được broadcast tới **TẤT CẢ client trong room**. Ai cũng thấy transcript của người đang nói. Không phải chỉ người nói mới thấy.

#### 2.4.4 State machine 1 utterance

```
[stt.partial] × N   → cập nhật live source text (replace, không append)
[stt.final]  × 1    → chốt source, status = 'translating'
[translate.token] × N → append vào target text
[translate.done]  × 1  → chốt target, status = 'done'
```

**Ví dụ state:**

```typescript
type Utterance = {
  id: string;           // utteranceId từ backend
  speaker: 'vi' | 'en';
  sourceText: string;   // stt.final
  partialSource?: string; // stt.partial (đang gõ)
  targetText: string;   // build dần từ translate.token
  status: 'transcribing' | 'translating' | 'done';
  timestamp: number;
};

const utterances = new Map<string, Utterance>();

socket.on('stt.partial', ({ text, speaker, utteranceId }) => {
  const utt = utterances.get(utteranceId) ?? {
    id: utteranceId,
    speaker,
    sourceText: '',
    targetText: '',
    status: 'transcribing',
    timestamp: Date.now(),
  };
  utt.partialSource = text;
  utterances.set(utteranceId, utt);
});

socket.on('stt.final', ({ text, speaker, utteranceId }) => {
  const utt = utterances.get(utteranceId);
  if (utt) {
    utt.sourceText = text;
    utt.partialSource = undefined;
    utt.status = 'translating';
  }
});

socket.on('translate.token', ({ token, utteranceId }) => {
  const utt = utterances.get(utteranceId);
  if (utt) utt.targetText += token;
});

socket.on('translate.done', ({ fullText, utteranceId }) => {
  const utt = utterances.get(utteranceId);
  if (utt) {
    utt.targetText = fullText;
    utt.status = 'done';
  }
});
```

#### 2.4.5 Capture audio 16kHz PCM

Browser mặc định cho mic 44.1kHz stereo. Whisper cần **16kHz mono Int16 raw PCM**. Cần AudioWorklet để convert.

**File `public/pcm-worklet.js`:**

```javascript
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    // Float32 [-1..1] → Int16 [-32768..32767]
    const int16 = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
```

**Hook capture:**

```typescript
async function startRecording(socket: Socket) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/pcm-worklet.js');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, 'pcm-processor');

  worklet.port.onmessage = (e) => {
    socket.emit('audio.chunk', e.data);  // ArrayBuffer binary
  };

  source.connect(worklet);
  // Không connect ra destination (không nghe lại tiếng mình)

  return {
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
```

⚠️ **Lưu ý về xung đột mic với LiveKit:** LiveKit cũng cầm mic. Có 2 cách xử lý:

**Cách 1 — Share MediaStream (khuyến nghị):**

```typescript
// Lấy stream 1 lần, dùng cho cả 2
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
});

// LiveKit: publish stream
await room.localParticipant.publishTrack(stream.getAudioTracks()[0]);

// AudioWorklet: capture để gửi transcript
const source = ctx.createMediaStreamSource(stream);
// ...
```

**Cách 2 — 2 getUserMedia calls riêng:**
Browser share device, không xin quyền 2 lần. Đơn giản nhưng có thể có echo.

### 2.5 Video call integration (LiveKit)

#### 2.5.1 Lấy token từ NestJS

```typescript
const res = await fetch('https://api-hackathon.dangpham.id.vn/livekit/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    roomName: sessionId,          // BẮT BUỘC trùng với sessionId Socket.IO
    participantName: clientId,    // BẮT BUỘC trùng với clientId Socket.IO
  }),
});

const { token, url } = await res.json();
// url = "wss://livekit-hackathon.dangpham.id.vn"
```

#### 2.5.2 Connect vào room

```typescript
import { Room, RoomEvent, Track } from 'livekit-client';

const room = new Room();
await room.connect(url, token);
await room.localParticipant.enableCameraAndMicrophone();
```

#### 2.5.3 Handle events

```typescript
// Khi có người mới publish track (hoặc mình vừa join thấy người có sẵn)
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  const container = document.getElementById(`video-${participant.identity}`);
  if (!container) return;

  if (track.kind === Track.Kind.Video) {
    const el = track.attach();
    container.appendChild(el);
  } else if (track.kind === Track.Kind.Audio) {
    track.attach();  // audio auto play
  }
});

// Người rời phòng
room.on(RoomEvent.ParticipantDisconnected, (participant) => {
  document.getElementById(`video-${participant.identity}`)?.replaceChildren();
});

// Người mới join (chưa publish track)
room.on(RoomEvent.ParticipantConnected, (participant) => {
  console.log('New participant:', participant.identity);
  // Có thể tạo sẵn tile trống chờ track
});

// Track unpublish (user tắt cam)
room.on(RoomEvent.TrackUnsubscribed, (track) => {
  track.detach().forEach((el) => el.remove());
});
```

#### 2.5.4 Mapping video ↔ transcript

Vì `participant.identity` (LiveKit) === `clientId` (Socket.IO), bạn có thể overlay transcript lên đúng video tile.

**Hiện tại:** event `translate.done` **không có `clientId`** — chỉ có `speaker` (`vi`/`en`). Nếu cần overlay theo participant cụ thể, backend cần thêm field. Bàn với backend nếu cần.

### 2.6 Kết thúc phiên

```typescript
async function endMeeting() {
  socket.emit('session.end');   // báo NestJS đóng session
  await room.disconnect();       // rời LiveKit
  socket.disconnect();           // đóng Socket.IO
}
```

### 2.7 Env cho Next.js (Vercel)

```
NEXT_PUBLIC_API_URL=https://api-hackathon.dangpham.id.vn
```

Không cần set `LIVEKIT_URL` — NestJS trả về trong response `/livekit/token`.

### 2.8 Full example (skeleton)

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Room, RoomEvent, Track } from 'livekit-client';

export function MeetingRoom({ sessionId }: { sessionId: string }) {
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [isReady, setIsReady] = useState(false);
  const socketRef = useRef<Socket>();
  const roomRef = useRef<Room>();

  useEffect(() => {
    const clientId = getOrCreateClientId();

    // [1] Socket.IO transcript
    const socket = io(`${process.env.NEXT_PUBLIC_API_URL}/audio`, {
      query: { sessionId, clientId },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('session.ready', () => setIsReady(true));
    socket.on('stt.partial', handleSttPartial);
    socket.on('stt.final', handleSttFinal);
    socket.on('translate.token', handleTranslateToken);
    socket.on('translate.done', handleTranslateDone);
    socket.on('error', (e) => console.error(e));

    // [2] LiveKit video
    (async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/livekit/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: sessionId, participantName: clientId }),
      });
      const { token, url } = await res.json();

      const room = new Room();
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      await room.connect(url, token);
      await room.localParticipant.enableCameraAndMicrophone();
      roomRef.current = room;
    })();

    return () => {
      socket.disconnect();
      roomRef.current?.disconnect();
    };
  }, [sessionId]);

  // ... UI render
}
```

### 2.9 Checklist Frontend

- [ ] Install `socket.io-client` + `livekit-client`
- [ ] Generate + persist `clientId` trong localStorage
- [ ] Kết nối Socket.IO với query đầy đủ
- [ ] **Đợi `session.ready` trước khi bắt đầu ghi âm**
- [ ] AudioWorklet capture PCM 16kHz Int16
- [ ] Emit `audio.chunk` liên tục 200ms
- [ ] Listen 4 event transcript, render 2 cột EN/VI
- [ ] Fetch LiveKit token với `roomName = sessionId`, `participantName = clientId`
- [ ] Handle LiveKit events: TrackSubscribed, ParticipantDisconnected
- [ ] Cleanup khi unmount

---

## PHẦN 3 — CHO AI SERVICE DEVELOPER (FASTAPI)

### 3.1 Yêu cầu môi trường

- Python 3.10+
- FastAPI + uvicorn[standard] (dùng uvloop)
- GPU khuyến nghị (RTX 4060+ / A10 / L4) — tối thiểu 12GB VRAM
- Chạy PM2 hoặc systemd, listen `localhost:8000`

### 3.2 WebSocket endpoint bắt buộc

```
ws://localhost:8000/ws/session?sessionId=<uuid>
```

- NestJS mở **đúng 1 kết nối** per session (nhiều client cùng phòng chung 1 ws).
- FastAPI không cần biết có bao nhiêu client — chỉ xử lý 1 luồng audio, gửi 1 luồng event.
- FastAPI **không cần auth** — NestJS đã filter, chỉ NestJS gọi được (localhost).

### 3.3 Messages FastAPI NHẬN từ NestJS

#### Binary frame — audio chunks
- Format: **PCM Int16, 16kHz, mono, raw bytes** (không header, không metadata)
- Chunk size: ~6400 bytes = 200ms audio
- Frequency: ~5 chunks/giây khi user đang nói

#### Text frame — control JSON

```json
// Ngay sau khi accept connection
{ "type": "session.init", "config": { "domain": "business", "languagePair": "vi-en" } }

// Khi user đổi ngôn ngữ đang nói (để chọn model Whisper/PhoWhisper)
{ "type": "speaker.switch", "speaker": "vi" }
{ "type": "speaker.switch", "speaker": "en" }

// Trước khi NestJS đóng kết nối
{ "type": "session.close" }
```

### 3.4 Messages FastAPI PHẢI GỬI về NestJS (contract QUAN TRỌNG NHẤT)

Bắt buộc đúng chính xác `type` string (case-sensitive, dấu chấm `.`):

#### 3.4.1 `stt.partial` — text đang gõ dần (nhiều lần)

```json
{
  "type": "stt.partial",
  "text": "Xin chào chúng",
  "speaker": "vi",
  "utteranceId": "utt-abc123"
}
```

#### 3.4.2 `stt.final` — chốt câu nguồn (1 lần / utterance)

```json
{
  "type": "stt.final",
  "text": "Xin chào, chúng tôi đến từ Việt Nam.",
  "speaker": "vi",
  "utteranceId": "utt-abc123"
}
```

#### 3.4.3 `translate.token` — từng token dịch (nhiều lần)

```json
{
  "type": "translate.token",
  "token": " Vietnam",
  "utteranceId": "utt-abc123"
}
```

#### 3.4.4 `translate.done` — chốt bản dịch (1 lần / utterance) — ⚠️ ĐỦ 4 FIELD

```json
{
  "type": "translate.done",
  "fullText": "Hello, we are from Vietnam.",
  "sourceText": "Xin chào, chúng tôi đến từ Việt Nam.",
  "speaker": "vi",
  "utteranceId": "utt-abc123"
}
```

⚠️ **CẢNH BÁO CỰC KỲ QUAN TRỌNG:**
- `translate.done` PHẢI có đầy đủ `fullText`, `sourceText`, `speaker`, `utteranceId`.
- NestJS dùng `sourceText` + `speaker` để lưu utterance vào session store (phục vụ export DOCX sau này).
- Thiếu field → NestJS ghi `undefined`, **không có warning**, đến lúc export mới phát hiện.

#### 3.4.5 `error` — khi có lỗi

```json
{
  "type": "error",
  "code": "STT_FAILED",
  "message": "Whisper crashed on segment"
}
```

### 3.5 `utteranceId` — quy ước sinh id

- **FastAPI sinh id này**, không phải NestJS hay Client.
- Mỗi lần VAD phát hiện 1 câu mới = 1 id mới.
- Format tự do (UUID, counter, timestamp). Ví dụ: `f"utt-{uuid.uuid4().hex[:8]}"`.
- Trong cùng 1 utterance, các event `stt.partial` → `stt.final` → `translate.token` → `translate.done` **PHẢI CÙNG utteranceId**.

### 3.6 Pipeline architecture

3 task async chạy song song, thông nhau qua queue:

```
WebSocket receive loop
  ↓
audio_queue ─→ Task 1: VAD Loop (Silero VAD)
                  ↓ (khi speech end)
              stt_queue ─→ Task 2: STT Loop (Whisper/PhoWhisper)
                              ↓ emit stt.partial, stt.final
                          translate_queue ─→ Task 3: Translate Loop (SEA-LION)
                                                ↓ emit translate.token, translate.done
                                            WebSocket send
```

### 3.7 Skeleton code

```python
# main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import asyncio
import json
import uuid
import logging

logger = logging.getLogger(__name__)
app = FastAPI()

# Load models 1 lần khi startup
whisper_en = None
phowhisper_vi = None
llm = None
vad = None

@app.on_event("startup")
async def load_models():
    global whisper_en, phowhisper_vi, llm, vad
    logger.info("Loading models...")
    # whisper_en = load_whisper('large-v3')
    # phowhisper_vi = load_phowhisper()
    # llm = load_sea_lion()
    # vad = load_silero_vad()
    # warmup với dummy input
    logger.info("Models ready")


@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": all([whisper_en, llm, vad])}


@app.websocket("/ws/session")
async def session_endpoint(websocket: WebSocket, sessionId: str):
    await websocket.accept()
    logger.info(f"Session {sessionId} connected")

    pipeline = SessionPipeline(sessionId, websocket)
    await pipeline.start()

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            # Binary = audio chunk
            if "bytes" in message and message["bytes"]:
                await pipeline.audio_queue.put(message["bytes"])

            # Text = JSON control
            elif "text" in message and message["text"]:
                try:
                    event = json.loads(message["text"])
                    await pipeline.handle_control(event)
                except json.JSONDecodeError as e:
                    logger.warning(f"Invalid JSON: {e}")

    except WebSocketDisconnect:
        logger.info(f"Session {sessionId} disconnected")
    except Exception as e:
        logger.error(f"Session {sessionId} error: {e}", exc_info=True)
    finally:
        await pipeline.cleanup()


class SessionPipeline:
    def __init__(self, session_id: str, websocket: WebSocket):
        self.session_id = session_id
        self.ws = websocket
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self.stt_queue: asyncio.Queue = asyncio.Queue()
        self.translate_queue: asyncio.Queue = asyncio.Queue()
        self.current_language = "vi"
        self.domain = "business"
        self.tasks = []

    async def start(self):
        self.tasks = [
            asyncio.create_task(self._vad_loop()),
            asyncio.create_task(self._stt_loop()),
            asyncio.create_task(self._translate_loop()),
        ]

    async def handle_control(self, event: dict):
        etype = event.get("type")
        if etype == "session.init":
            config = event.get("config", {})
            self.domain = config.get("domain", "business")
            language_pair = config.get("languagePair", "vi-en")
            self.current_language = language_pair.split("-")[0]

        elif etype == "speaker.switch":
            self.current_language = event.get("speaker", "vi")

        elif etype == "session.close":
            await self.cleanup()

    async def _vad_loop(self):
        """
        Silero VAD tích luỹ speech segment.
        Khi phát hiện end-of-speech, đẩy segment sang stt_queue.
        """
        import numpy as np
        speech_buffer = []

        try:
            while True:
                chunk_bytes = await self.audio_queue.get()

                # PCM Int16 bytes → numpy array
                pcm = np.frombuffer(chunk_bytes, dtype=np.int16)
                pcm_float = pcm.astype(np.float32) / 32768.0

                # VAD detect
                is_speech = vad.is_speech(pcm_float)

                if is_speech:
                    speech_buffer.append(pcm_float)
                elif speech_buffer:
                    # Speech ended → gộp segment, đẩy sang STT
                    segment = np.concatenate(speech_buffer)
                    speech_buffer.clear()
                    await self.stt_queue.put(segment)

        except asyncio.CancelledError:
            pass

    async def _stt_loop(self):
        """
        Nhận segment audio, chạy Whisper streaming.
        Emit stt.partial nhiều lần, stt.final 1 lần.
        """
        try:
            while True:
                segment = await self.stt_queue.get()
                utt_id = f"utt-{uuid.uuid4().hex[:8]}"

                # Chọn model theo ngôn ngữ hiện tại
                model = phowhisper_vi if self.current_language == "vi" else whisper_en

                # Streaming partial (giả sử model support)
                async for partial in self._transcribe_stream(model, segment):
                    await self.ws.send_json({
                        "type": "stt.partial",
                        "text": partial,
                        "speaker": self.current_language,
                        "utteranceId": utt_id,
                    })

                # Final
                final_text = await self._transcribe_final(model, segment)
                await self.ws.send_json({
                    "type": "stt.final",
                    "text": final_text,
                    "speaker": self.current_language,
                    "utteranceId": utt_id,
                })

                # Đẩy sang translate
                await self.translate_queue.put({
                    "text": final_text,
                    "utt_id": utt_id,
                    "speaker": self.current_language,
                })

        except asyncio.CancelledError:
            pass

    async def _translate_loop(self):
        """
        Nhận text, gọi LLM streaming, emit translate.token + translate.done.
        """
        try:
            while True:
                req = await self.translate_queue.get()

                source_text = req["text"]
                source_lang = req["speaker"]
                target_lang = "en" if source_lang == "vi" else "vi"
                utt_id = req["utt_id"]

                # Build prompt (có thể inject glossary ở đây)
                prompt = self._build_prompt(source_text, source_lang, target_lang)

                # Stream tokens
                full_text = ""
                async for token in self._llm_stream(prompt):
                    full_text += token
                    await self.ws.send_json({
                        "type": "translate.token",
                        "token": token,
                        "utteranceId": utt_id,
                    })

                # ⚠️ CHỐT VỚI ĐỦ 4 FIELD
                await self.ws.send_json({
                    "type": "translate.done",
                    "fullText": full_text,
                    "sourceText": source_text,
                    "speaker": source_lang,
                    "utteranceId": utt_id,
                })

        except asyncio.CancelledError:
            pass

    async def _transcribe_stream(self, model, segment):
        # Implement: streaming Whisper
        # Yield từng partial text
        ...

    async def _transcribe_final(self, model, segment) -> str:
        # Implement: final transcription
        ...

    async def _llm_stream(self, prompt: str):
        # Implement: vLLM streaming
        # Yield từng token
        ...

    def _build_prompt(self, text: str, src: str, tgt: str) -> str:
        return f"Translate from {src} to {tgt}: {text}"

    async def cleanup(self):
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
```

### 3.8 Model recommendations

| Component | Model | VRAM | Note |
|-----------|-------|------|------|
| VAD | Silero VAD | ~50MB (CPU) | `torch.hub.load('snakers4/silero-vad')` |
| STT tiếng Việt | PhoWhisper-large | ~3GB fp16 | HuggingFace `vinai/PhoWhisper-large` |
| STT tiếng Anh | Whisper large-v3 (Faster-Whisper) | ~3GB | `faster-whisper` package, CTranslate2 optimized |
| Translation | Gemma-SEA-LION-v3-9B-IT | ~18GB fp16 / ~9GB int8 | AISG's own model |
| LLM serving | vLLM 0.6+ | — | Continuous batching + streaming |

**Nếu VRAM < 12GB, fallback:**
- STT: dùng Whisper large-v3 cho cả 2 ngôn ngữ (bỏ PhoWhisper)
- Translation: Qwen2.5-7B-Instruct (~14GB fp16 / ~7GB int8)

### 3.9 Test với mock NestJS (không cần chạy backend thật)

```python
# test_client.py
import asyncio
import websockets
import json

async def test():
    async with websockets.connect(
        "ws://localhost:8000/ws/session?sessionId=test-session"
    ) as ws:
        # Init
        await ws.send(json.dumps({
            "type": "session.init",
            "config": {"domain": "business", "languagePair": "vi-en"}
        }))

        # Gửi 1 file wav test
        with open("test.wav", "rb") as f:
            audio_data = f.read()

        # Chia thành chunks 200ms (6400 bytes)
        for i in range(0, len(audio_data), 6400):
            await ws.send(audio_data[i:i+6400])
            await asyncio.sleep(0.2)

        # Nhận events
        async for msg in ws:
            print(json.loads(msg))

asyncio.run(test())
```

### 3.10 Checklist AI Service

- [ ] Setup FastAPI + uvicorn, listen `0.0.0.0:8000`
- [ ] Load models khi startup, warmup với dummy input
- [ ] `GET /health` trả về status models
- [ ] `WS /ws/session?sessionId=X` accept connection
- [ ] Handle `session.init`, `speaker.switch`, `session.close`
- [ ] 3 background tasks: VAD → STT → Translate
- [ ] Emit 4 event types với đúng field names
- [ ] `translate.done` ĐỦ 4 field: `fullText`, `sourceText`, `speaker`, `utteranceId`
- [ ] `utteranceId` sinh unique mỗi câu, dùng xuyên suốt 4 event
- [ ] Cleanup pipeline khi WS disconnect (cancel tasks, free memory)
- [ ] Chạy bằng PM2: `pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name fastapi`

---

## PHẦN 4 — TIMELINE FLOW TỔNG THỂ

### 4.1 Sequence diagram meeting 2 người

```
Client A (VN)    Client B (SG)    NestJS      LiveKit      FastAPI
    │                │              │            │            │
    │  [Setup]                                                 │
    │─POST /livekit/token────────────▶            │            │
    │◀──{token, url}────────────────  │            │           │
    │─room.connect(url, token)──────────────────▶  │           │
    │─socket.io(/audio)───────────────▶            │           │
    │                              openSession()──────────────▶│
    │◀──'session.ready'──────────────  │                       │
    │                                                          │
    │                  [B join tương tự]                       │
    │                │                │                        │
    │                │─POST /livekit/token▶                    │
    │                │◀──{token,url}──                         │
    │                │─room.connect─────▶ (LiveKit)            │
    │                │─socket.io───────▶                       │
    │                │◀──'session.ready'                       │
    │                │                                         │
    │                │ [Video call auto: A và B thấy nhau qua  │
    │                │  LiveKit — không đụng NestJS]           │
    │                │                                         │
    │  [A nói]                                                 │
    │─emit 'audio.chunk' (PCM 6400 bytes)─▶                    │
    │                              forwardAudio───────────────▶│
    │                                              VAD detect...│
    │                                              STT running...│
    │                              ◀──stt.partial───────────── │
    │◀──'stt.partial'───────────── │                           │
    │                │◀──'stt.partial'──                       │
    │                              ◀──stt.final────────────── │
    │◀──'stt.final'─────────────── │                           │
    │                │◀──'stt.final'───                        │
    │                                              LLM stream...│
    │                              ◀──translate.token────────  │
    │◀──'translate.token'────────  │                           │
    │                │◀──'translate.token'                     │
    │                              ◀──translate.done─────────  │
    │◀──'translate.done'─────────  │  save utterance to store  │
    │                │◀──'translate.done'                      │
    │                                                          │
    │                │ [B nói tương tự, VN thấy dịch sang EN]  │
    │                                                          │
    │  [A end meeting]                                         │
    │─emit 'session.end'─────────▶                             │
    │◀──'session.ended' (broadcast) ─                          │
    │                │◀──'session.ended'                       │
    │                              closeSession()─────────────▶│
    │─socket.disconnect                                        │
    │─room.disconnect───────────────────────────▶              │
```

### 4.2 Latency budget (target)

| Stage | Target |
|-------|--------|
| Client mic → NestJS (Socket.IO) | 30-80ms |
| NestJS forward → FastAPI (localhost) | 1-3ms |
| VAD detect end-of-speech | 300-500ms |
| STT streaming partial | 200-500ms |
| SEA-LION first token | 300-500ms |
| SEA-LION full translation | 500-1000ms |
| FastAPI → NestJS → Client broadcast | 30-80ms |
| **Perceived (partial visible)** | **~600-900ms** |
| **Complete (translation done)** | **~1.2-1.8s** |

---

## PHẦN 5 — NESTJS ĐÃ SỬA/BỔ SUNG

Trước khi deploy, các fix đã áp dụng:

1. **`audio.gateway.ts` — `session.end` handler**: thêm `this.aiBridge.closeSession(sessionId)` để đóng WS AI ngay khi user chủ động kết thúc.

2. **`app.controller.ts` — Health endpoint**: thêm `GET /health` để monitoring/deploy check:
   ```typescript
   @Controller()
   export class AppController {
     @Get('health')
     health() {
       return { status: 'ok', ts: Date.now() };
     }
   }
   ```

3. **Env keys** khớp chính xác giữa `.env` NestJS và `livekit.yaml`.

Không sửa gì khác ở logic core — pipeline transcript giữ nguyên như đã test bằng mock.

---

## PHẦN 6 — DEPLOY & OPS

### 6.1 Subdomain (bạn tự setup nginx)

| Subdomain | Target | Protocol |
|-----------|--------|----------|
| `api-hackathon.dangpham.id.vn` | `127.0.0.1:3001` | HTTPS + WSS |
| `livekit-hackathon.dangpham.id.vn` | `127.0.0.1:7880` | HTTPS + WSS |

Frontend deploy Vercel, không cần subdomain riêng.

### 6.2 Firewall

```bash
sudo ufw allow 50000:50100/udp   # LiveKit media
sudo ufw allow 7881/tcp          # LiveKit TCP fallback
```

### 6.3 PM2 processes

```bash
pm2 start dist/main.js --name nestjs
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name fastapi
pm2 save
pm2 startup
```

### 6.4 LiveKit Docker

```bash
docker compose up -d livekit
```

### 6.5 Env `.env` cho NestJS

```
PORT=3001
AI_WS_URL=ws://localhost:8000/ws/session
LIVEKIT_API_KEY=<khớp livekit.yaml>
LIVEKIT_API_SECRET=<khớp livekit.yaml>
LIVEKIT_URL=wss://livekit-hackathon.dangpham.id.vn
```

---

## PHẦN 7 — TROUBLESHOOTING

| Triệu chứng | Nguyên nhân | Fix |
|-------------|-------------|-----|
| Client connect Socket.IO bị disconnect ngay | Thiếu `sessionId` hoặc `clientId` trong query | Check query string |
| Client emit audio nhưng không có transcript | Emit trước khi nhận `session.ready` → chunk bị drop | Đợi event `session.ready` |
| `translate.done` xong nhưng export DOCX rỗng | FastAPI thiếu `sourceText` hoặc `speaker` field | Check FastAPI event schema |
| LiveKit connect fail "invalid token" | Key/secret `.env` không khớp `livekit.yaml` | Verify 2 file khớp chính xác |
| Video call kết nối nhưng không thấy hình | Firewall chặn UDP 50000-50100 | Mở UFW |
| WSS "Mixed Content" error trên FE Vercel | LIVEKIT_URL đang là `ws://` | Đổi sang `wss://` |
| FastAPI crash khi nhận audio | PCM format sai (không phải Int16 16kHz mono) | Client check AudioWorklet convert đúng |
| Utterance transcript loạn thứ tự | Nhiều `utteranceId` bị trùng | FastAPI sinh unique id mỗi câu |

---

**Xong. File này là ground truth cho cả 3 team.** Nếu có thay đổi contract event, update file này trước khi code.