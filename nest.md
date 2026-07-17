# ViEngsMeet — NestJS Gateway: Trạng thái hiện tại & Contract cho FastAPI / Client

> Cập nhật: sau khi hoàn thành core realtime pipeline (chưa auth, chưa REST session, chưa export).

---

## 1. NestJS hiện tại đang control cái gì

### 1.1 Đã làm

| Việc | File | Mô tả |
|---|---|---|
| Nhận kết nối client | `audio.gateway.ts` | Socket.IO namespace `/audio`, nhận `sessionId` + `clientId` qua query string |
| Quản lý room | `audio.gateway.ts` | `client.join(sessionId)` — mỗi session là 1 room, nhiều client join chung 1 room = "cuộc họp" |
| Quản lý session state (RAM) | `session.store.ts` | Map trong RAM, KHÔNG dùng DB/Redis. Lưu utterances, danh sách client đang connect |
| Mở kết nối sang FastAPI | `ai-bridge.service.ts` | 1 session = 1 kết nối `ws` (raw WebSocket) sang FastAPI, mở idempotent (client đầu tiên trong room mới trigger mở) |
| Forward audio binary | `audio.gateway.ts` → `ai-bridge.service.ts` | Nhận `audio.chunk` (ArrayBuffer) từ client → forward nguyên vẹn (không decode/re-encode) sang FastAPI qua raw ws |
| Forward control message | `audio.gateway.ts` → `ai-bridge.service.ts` | `speaker.switch` từ client → gửi JSON control xuống FastAPI |
| Nhận event từ FastAPI | `ai-bridge.service.ts` | Parse JSON event từ FastAPI → emit nội bộ qua `EventEmitter2` (event name cố định: `ai.event`) |
| Broadcast event ra room | `audio.gateway.ts` (`@OnEvent('ai.event')`) | Nhận lại event nội bộ → `server.to(sessionId).emit(event.type, event)` — bắn cho **tất cả** client trong room, không phân biệt ai nói |
| Lưu utterance khi dịch xong | `audio.gateway.ts` | Khi nhận `translate.done`, append vào `session.utterances` trong RAM (dùng sau này cho export) |
| Cleanup khi rời session | `audio.gateway.ts` (`handleDisconnect`) | Xoá client khỏi session; nếu room rỗng → đóng luôn kết nối sang FastAPI (`aiBridge.closeSession`) |
| Kết thúc session theo yêu cầu | `audio.gateway.ts` (`session.end`) | Client gửi `session.end` → đánh dấu `endedAt`, broadcast `session.ended` cho cả room |

### 1.2 Chưa làm (nằm ngoài scope core, cần bổ sung sau)

- ❌ REST `POST /sessions` để tạo session trước khi connect WS — hiện tại `sessionId` do **client tự generate UUID** và gửi thẳng qua query string lúc connect
- ❌ Auth (JWT) — tạm thời bỏ, định danh chỉ bằng `clientId` client tự gửi lên, **không xác thực**
- ❌ Export DOCX
- ❌ Glossary CRUD
- ❌ Validate schema của event (chưa dùng Zod/class-validator để chặn payload sai định dạng)

---

## 2. Kiến trúc kết nối (nhắc lại cho rõ)

```
Client ──(Socket.IO, namespace /audio)──> NestJS ──(raw ws)──> FastAPI
       <───────────── broadcast theo room (sessionId) ────────────
```

- **Client ↔ NestJS**: Socket.IO. Vì cần room/broadcast, reconnect tự động.
- **NestJS ↔ FastAPI**: raw `ws` package (KHÔNG phải Socket.IO). FastAPI dùng `@app.websocket()` chuẩn, không nói được giao thức Socket.IO.
- 1 session (cuộc họp) = 1 room bên NestJS = 1 kết nối `ws` duy nhất sang FastAPI, dùng chung cho mọi client trong room đó.

---

## 3. Contract: Client cần implement những WS event gì

### 3.1 Kết nối

```
URL: ws://<gateway-host>/audio
Query bắt buộc:
  - sessionId: string   (client tự generate UUID, KHÔNG cần gọi REST trước)
  - clientId: string    (client tự generate, nên lưu localStorage để giữ định danh khi reconnect)
Query optional:
  - domain: string        (mặc định "business")
  - languagePair: string  (mặc định "vi-en")
```

Ví dụ (socket.io-client):
```typescript
const socket = io('http://localhost:3001/audio', {
  query: { sessionId, clientId, domain: 'business', languagePair: 'vi-en' },
  transports: ['websocket'],
});
```

⚠️ Nếu thiếu `sessionId` hoặc `clientId`, server sẽ `disconnect` ngay lập tức.

### 3.2 Event client PHẢI emit

| Event name | Payload | Khi nào gửi |
|---|---|---|
| `audio.chunk` | `ArrayBuffer` (PCM Int16, 16kHz, mono) — **binary, KHÔNG JSON, KHÔNG base64** | Liên tục mỗi ~200ms khi đang ghi âm |
| `speaker.switch` | `{ speaker: 'vi' \| 'en' }` | Khi người dùng đổi ngôn ngữ đang nói |
| `session.end` | (không cần payload) | Khi bấm "Kết thúc cuộc họp" |

### 3.3 Event client PHẢI lắng nghe (server → client)

| Event name | Payload | Ý nghĩa |
|---|---|---|
| `session.ready` | `{ clientId, sessionId }` | Xác nhận connect thành công, có thể enable nút mic |
| `stt.partial` | `{ type, text, speaker, utteranceId }` | Text đang nhận dạng (chưa chốt), dùng để hiện live |
| `stt.final` | `{ type, text, speaker, utteranceId }` | Text đã chốt câu nguồn |
| `translate.token` | `{ type, token, utteranceId }` | Từng token bản dịch, append dần vào UI (streaming) |
| `translate.done` | `{ type, fullText, sourceText, speaker, utteranceId }` | Bản dịch hoàn chỉnh cho 1 câu |
| `session.ended` | (không có payload) | Session đã kết thúc, disable mic, có thể trigger export |
| `error` | `{ type, code, message }` | Lỗi (ví dụ mất kết nối AI worker) — nên hiện toast cho user |

**Lưu ý quan trọng:** event `stt.partial`, `stt.final`, `translate.token`, `translate.done` được **broadcast cho TẤT CẢ client trong room**, không chỉ người đang nói — vì đây là tính năng cuộc họp nhiều người cùng xem transcript.

### 3.4 Utterance flow phía client (gợi ý state machine)

```
stt.partial (nhiều lần, cùng utteranceId) → update live text
stt.final (1 lần) → chốt câu nguồn, chuyển trạng thái "translating"
translate.token (nhiều lần) → append vào bản dịch
translate.done (1 lần) → chốt bản dịch, trạng thái "done"
```

---

## 4. Contract: FastAPI cần implement những gì

### 4.1 Endpoint bắt buộc

```
WS /ws/session?sessionId=<uuid>
```

NestJS sẽ mở **đúng 1 kết nối** tới endpoint này cho mỗi session (không mở nhiều lần cho nhiều client cùng room — NestJS đã gộp).

### 4.2 Message FastAPI sẽ NHẬN từ NestJS

| Dạng | Nội dung | Khi nào |
|---|---|---|
| Binary frame | PCM Int16 16kHz mono raw bytes | Liên tục, mỗi chunk ~200ms |
| Text frame (JSON) | `{ "type": "session.init", "config": { "domain": "...", "languagePair": "..." } }` | Ngay sau khi FastAPI accept connection |
| Text frame (JSON) | `{ "type": "speaker.switch", "speaker": "vi" \| "en" }` | Khi client đổi speaker |
| Text frame (JSON) | `{ "type": "session.close" }` | Trước khi NestJS đóng kết nối (room rỗng hoặc session end) |

⚠️ FastAPI **không cần tự phân biệt client nào gửi** — NestJS đã gộp mọi client trong room thành 1 luồng audio duy nhất gửi xuống. Nếu cần multi-speaker riêng biệt sau này, phải bàn lại thiết kế (hiện tại là single-stream per session).

### 4.3 Message FastAPI PHẢI gửi lại cho NestJS

Bắt buộc đúng field name, NestJS parse trực tiếp JSON này và bắn nguyên `type` làm tên Socket.IO event:

```json
{ "type": "stt.partial", "text": "...", "speaker": "vi", "utteranceId": "..." }
{ "type": "stt.final", "text": "...", "speaker": "vi", "utteranceId": "..." }
{ "type": "translate.token", "token": "...", "utteranceId": "..." }
{ "type": "translate.done", "fullText": "...", "sourceText": "...", "speaker": "vi", "utteranceId": "..." }
```

**Field bắt buộc theo từng loại:**
- Mọi event cần `type` và `utteranceId` (để client group đúng theo câu)
- `translate.done` **bắt buộc phải có** `sourceText` và `speaker` — vì NestJS dùng 2 field này để lưu vào `session.utterances` (phục vụ export DOCX sau này). Thiếu field này thì export sẽ bị rỗng/lỗi, không có warning nào báo trước.

### 4.4 `utteranceId` — quy ước

FastAPI là bên **sinh ra** `utteranceId` (mỗi lần VAD phát hiện 1 câu mới = 1 id mới, có thể dùng UUID hoặc counter). NestJS và Client không sinh id này, chỉ dùng để group các event `stt.partial → stt.final → translate.token(s) → translate.done` lại với nhau.

---

## 5. Những thứ NestJS "dùng của FastAPI" — checklist khi FastAPI code xong

- [ ] FastAPI phải accept connection và gửi được `session.ready`-tương-đương? **Không cần** — NestJS tự gửi `session.ready` cho client ngay khi client connect, không đợi FastAPI xác nhận gì cả. FastAPI chỉ cần sẵn sàng nhận audio ngay sau khi nhận `session.init`.
- [ ] Event `type` phải khớp chính xác string (`stt.partial`, không phải `stt_partial` hay `sttPartial`)
- [ ] JSON phải hợp lệ — NestJS hiện **không có try/catch phân loại lỗi chi tiết**, nếu parse JSON lỗi sẽ chỉ log và bỏ qua message đó (client sẽ không thấy gì, không có thông báo lỗi cụ thể)
- [ ] Audio format phải đúng PCM Int16 16kHz mono — FastAPI không cần convert gì thêm, NestJS forward nguyên bytes không xử lý

---

## 6. Cấu hình môi trường (`.env`) hiện tại

```
PORT=3001
AI_WS_URL=ws://localhost:8000/ws/session   # đổi sang địa chỉ FastAPI thật khi deploy
```

---

## 7. Đã test bằng gì

Core pipeline đã verify bằng **mock AI server** (Node `ws`, không phải FastAPI thật), giả lập gửi lại đúng 4 loại event theo thứ tự `stt.partial → stt.final → translate.token → translate.done` sau khi nhận audio binary. FastAPI thật cần đảm bảo đúng cùng contract JSON này để không cần sửa gì bên NestJS.

---

## 8. Rủi ro đã biết, chưa fix (tham khảo thêm khi cần)

- `client.handshake.query.sessionId` có thể là `string[]` nếu client gửi trùng query key — chưa validate.
- Chưa có interval dọn session "mồ côi" trong RAM nếu client rớt mạng bất thường không trigger đúng `disconnect`.
- Chưa validate schema JSON event nhận từ FastAPI (không dùng class-validator/Zod) — event sai field sẽ âm thầm bị bỏ qua hoặc gây lỗi runtime khi ghi vào `session.utterances`.