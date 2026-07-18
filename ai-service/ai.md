# Real-Time VI-EN Meeting Translator — Kiến trúc luồng v2 (hoàn chỉnh)

So với bản gốc, bản này bổ sung 7 phần còn thiếu (đã bỏ TTS — chỉ dùng text, output là chữ để bên kia đọc):
1. Xử lý **ASR revision** (ASR tự sửa từ đã nhận diện)
2. **Glossary động theo phiên họp** (không chỉ config tĩnh)
3. **Giải nghĩa từ viết tắt/thuật ngữ (acronym resolution)** — VD: VIC là viết tắt của gì, tên đầy đủ tiếng Việt là gì
4. **RAG — Domain Knowledge Layer**: nạp tài liệu chuyên ngành/lịch sử hội thoại để AI có "kiến thức nền" khi dịch, không chỉ dựa vào model chung
5. Xử lý **overlapping speech** (2 người nói chồng tiếng)
6. **Fallback / graceful degradation** khi model hoặc mạng lỗi
7. **UI diff-based update** để tránh giật khi câu thay đổi

> Lưu ý: bỏ hẳn tầng TTS. Toàn bộ output là TEXT hiển thị song song 2 ngôn ngữ trên màn hình để người còn lại đọc trực tiếp — giúp đơn giản hoá pipeline, giảm 1 tầng có thể lỗi, và giảm latency vì không phải chờ tổng hợp giọng nói.

---

## TẦNG 0: CONFIG LAYER (chọn trước khi chạy)

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 0: CONFIG LAYER                                         │
│  - deployment_tier: "edge" | "server"                        │
│  - lang_pair: "vi-en" | "vi-km" | "vi-lo" | ...               │
│  - model_map theo tier + lang_pair                            │
│  - glossary TĨNH theo lang_pair (thuật ngữ chung, tên miền)   │
│                                                                │
│  ➕ MỚI: SESSION GLOSSARY LOADER                               │
│    - Trước khi họp: cho phép nhập nhanh (voice hoặc text)     │
│      tên người tham dự, tên công ty, sản phẩm, con số quan    │
│      trọng (VD: "Nanyang Technological University", "AI       │
│      Singapore", tên riêng của khách mời)                     │
│    - Merge vào contextual biasing của ASR + prompt của LLM    │
│    - Có thể cập nhật GIỮA buổi họp (thêm từ mới khi phát      │
│      sinh) mà không cần khởi động lại pipeline                │
│                                                                │
│  ➕ MỚI: ACRONYM & TERM RESOLUTION ENGINE                      │
│    - Vấn đề: họp business hay có từ viết tắt (VIC, KPI, MOU,  │
│      JV, ROI, tên viết tắt dự án riêng...) → dịch máy móc      │
│      từng chữ sẽ vô nghĩa hoặc sai với người nghe ngôn ngữ kia │
│    - Lớp 1 — TRA CỨU TĨNH: bảng acronym → (nghĩa gốc, bản     │
│      dịch VI, bản dịch EN), nạp sẵn theo domain + acronym      │
│      riêng của buổi họp (gộp vào session glossary ở trên,      │
│      VD: "VIC = Vietnam Innovation Challenge = Thách thức Đổi  │
│      mới Sáng tạo Việt Nam")                                    │
│    - Lớp 2 — SUY LUẬN THEO NGỮ CẢNH: nếu acronym không có      │
│      trong bảng hoặc có nhiều nghĩa khả dĩ, LLM ở quality-path │
│      dùng sliding window câu trước/sau để đoán nghĩa đúng       │
│    - Cách hiện trong bản dịch: lần đầu xuất hiện → viết tắt +   │
│      chú thích nghĩa mở rộng trong ngoặc; các lần sau chỉ cần   │
│      viết tắt (giống cách người thật ghi biên bản họp)          │
│      VD: "VIC" → "VIC (Vietnam Innovation Challenge)" → các     │
│      câu sau chỉ còn "VIC"                                       │
│    - Nếu KHÔNG suy luận được (confidence thấp): không tự bịa    │
│      nghĩa — giữ nguyên acronym gốc, đánh dấu nhỏ trên UI (VD    │
│      dấu "?") để người dùng bấm tra/gõ nghĩa ngay lúc đó, hệ    │
│      thống ghi nhớ cho các lần xuất hiện sau trong cùng phiên   │
│    - Acronym học được trong phiên → lưu vào session glossary    │
│      (Tầng 5) để tái sử dụng cho các buổi họp sau cùng đối tác  │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 0.5: RAG — DOMAIN KNOWLEDGE LAYER (MỚI — chưa có ở bản gốc)

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 0.5: RAG DOMAIN KNOWLEDGE LAYER                          │
│                                                                │
│  MỤC TIÊU: cho AI "kiến thức nền" về cuộc họp/ngành cụ thể,   │
│  thay vì chỉ dịch chay dựa trên model chung chung. Khác với   │
│  Session Glossary (chỉ là cặp từ↔nghĩa ngắn), RAG cho phép     │
│  AI hiểu NGỮ CẢNH RỘNG: nội dung tài liệu, quan hệ giữa các    │
│  bên, số liệu dự án, lịch sử trao đổi trước đó...              │
│                                                                │
│  NGUỒN DỮ LIỆU (nạp trước hoặc trong lúc họp):                 │
│   - Tài liệu chuẩn bị: agenda, slide thuyết trình, hợp đồng    │
│     nháp, profile công ty/dự án, báo cáo tài chính liên quan   │
│   - Biên bản các buổi họp trước với cùng đối tác (lấy từ       │
│     Tầng 5 của phiên trước, nếu có)                             │
│   - Tài liệu chuyên ngành: bảng thuật ngữ ngành (VD: pháp lý,  │
│     tài chính, công nghệ), quy định/tiêu chuẩn liên quan        │
│                                                                  │
│  PIPELINE NẠP DỮ LIỆU (offline, trước khi họp bắt đầu):          │
│   Tài liệu → chunk theo đoạn/mục → embedding (model nhỏ, chạy   │
│   local để không lộ dữ liệu nhạy cảm ra ngoài — khớp với yêu    │
│   cầu "on-premise" của đề bài) → lưu vào Vector DB cục bộ        │
│   (Edge: FAISS/Chroma nhẹ; Server: Chroma/Milvus/pgvector)       │
│                                                                    │
│  TRUY XUẤT REAL-TIME (trong lúc họp, gắn vào Quality Path):       │
│   - Với mỗi câu/segment đang dịch, lấy chủ đề hiện tại từ         │
│     sliding window → query Vector DB → top-k (3-5) đoạn liên      │
│     quan nhất (retrieval)                                          │
│   - Bơm các đoạn này vào prompt của LLM cùng với: câu ASR,         │
│     sliding window hội thoại, session glossary, acronym table      │
│   - Retrieval phải NHANH (<100-150ms) để không phá vỡ timeout      │
│     1.0-1.5s của quality-path → dùng vector DB nhẹ, index sẵn,     │
│     không gọi API bên ngoài                                        │
│   - Nếu retrieval không kịp/không có kết quả liên quan → LLM vẫn   │
│     chạy bình thường KHÔNG có RAG context (không chặn pipeline)    │
│                                                                      │
│  VÍ DỤ THỰC TẾ: khi ai đó nói "theo điều khoản 3.2 trong bản       │
│  MOU" → RAG kéo đúng nội dung điều khoản 3.2 từ tài liệu đã nạp,   │
│  giúp LLM dịch chính xác thay vì chỉ dịch chữ suông "điều khoản    │
│  3.2" mà không biết nó nói về cái gì                                │
│                                                                      │
│  QUYỀN RIÊNG TƯ: dữ liệu tài liệu chỉ tồn tại trong phiên (hoặc     │
│  lưu cục bộ nếu người dùng chọn giữ lại cho lần họp sau), không     │
│  gửi ra ngoài nếu chạy on-premise → cộng điểm bonus "confidential   │
│  information" của đề bài                                            │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 1: Audio Front-end + xử lý chồng tiếng

```
[N mic riêng theo người / mic array cho phòng lớn]
                        |
                        v
┌───────────────────────────────────────────────────────────┐
│ TẦNG 1: Audio Front-end                                      │
│  - Denoising: RNNoise (edge) / Demucs, DeepFilterNet (server) │
│  - VAD neural: Silero VAD (cả 2 tier)                          │
│  - Diarization: tách mic vật lý (edge) / embedding pyannote    │
│    (server, mic dùng chung)                                    │
│                                                                │
│  ➕ MỚI: OVERLAP DETECTION                                     │
│    - Phát hiện khi 2+ nguồn âm thanh có năng lượng giọng nói   │
│      chồng lên nhau trong cùng khung thời gian                 │
│    - Nếu dùng mic riêng theo người: tách kênh độc lập → xử lý  │
│      song song 2 luồng ASR riêng biệt, không bị lẫn             │
│    - Nếu dùng mic array dùng chung: khi overlap được phát       │
│      hiện, UI hiển thị rõ nhãn "⚠ nhiều người nói cùng lúc" và  │
│      ưu tiên giọng có năng lượng lớn nhất / gần mic nhất, đồng  │
│      thời BUFFER phần audio chồng để xử lý lại (không huỷ)      │
│    - Khuyến nghị demo: ưu tiên setup mic riêng theo người để    │
│      loại bỏ rủi ro này ngay từ phần cứng                       │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 2: ASR Streaming + cơ chế Revision

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 2: ASR Streaming                                         │
│  - Edge: Whisper-small/PhoWhisper-small, quantized             │
│  - Server: Whisper-large fine-tuned đa vùng miền                │
│  - Contextual biasing = glossary tĩnh + session glossary        │
│  - Word-level timestamp + confidence score                      │
│  - Code-switching: cho phép ASR output đa ngôn ngữ trong        │
│    cùng 1 câu (không ép về 1 ngôn ngữ), gắn language-tag theo   │
│    từng cụm từ                                                  │
│                                                                  │
│  ➕ MỚI: REVISION HANDLER                                       │
│    - Mỗi segment ASR có "stability_score" (mức ổn định của       │
│      từ, tăng dần theo thời gian/context tích luỹ)               │
│    - Nếu MT/LLM đã dịch 1 segment với stability thấp, và sau     │
│      đó ASR SỬA LẠI segment đó → segment được đánh dấu "DIRTY"  │
│    - Chữ xám: luôn cho phép dịch lại khi DIRTY (rẻ, chưa hiện    │
│      final)                                                     │
│    - Chữ trắng (đã chốt): CHỈ patch lại nếu revision làm thay    │
│      đổi Ý NGHĨA cốt lõi (tên riêng, số liệu, phủ định "không"  │
│      bị thêm/bớt) — dùng rule nhẹ + LLM check nhanh, không patch │
│      cho các sửa lỗi chính tả/ngữ điệu nhỏ để tránh UI giật liên │
│      tục                                                         │
│    - Khi patch chữ trắng: hiển thị hiệu ứng nhẹ (gạch ngang bản  │
│      cũ 0.5s rồi thay, không xoá đột ngột) để người dùng nhận ra │
│      có điều chỉnh mà không bị rối mắt                           │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 2.5: Rẽ nhánh kép + Latency Budget rõ ràng

```
              ┌─────────┴─────────┐
              │    RẼ NHÁNH KÉP    │
              └─────────┬─────────┘
                │                 │
                v                 v
┌──────────────────────┐  ┌────────────────────────────────┐
│ FAST PATH              │  │ QUALITY PATH                      │
│ MT nhỏ theo tier:       │  │ Semantic chunking (pause, prosody,│
│ - Edge: NLLB-600M       │  │ filler word)                       │
│   distilled             │  │ Xử lý câu bị cắt ngang: buffer     │
│ - Server: NLLB-3.3B     │  │ theo speaker, timeout 5s tự flush  │
│ Buffer 2s cố định       │  │ ➕ RAG retrieval (Tầng 0.5): lấy    │
│ Hiện ngay: CHỮ XÁM      │  │   top-k đoạn tài liệu liên quan     │
│ Target: < 0.8s          │  │   theo chủ đề câu hiện tại          │
│                          │  │ LLM theo tier:                     │
│                          │  │ - Edge: 3B-7B quantized (int4)     │
│                          │  │ - Server: 32B-70B qua vLLM         │
│                          │  │ Input: câu ASR + sliding window    │
│                          │  │ 5-10 câu + glossary (tĩnh+phiên)   │
│                          │  │ + acronym table + RAG context      │
│                          │  │ Timeout: 1.5s (edge)/1.0s (server) │
│                          │  │ (đã tính cả thời gian retrieval)   │
└──────────────────────┘  └────────────────────────────────┘
```

### ➕ MỚI: Bảng Latency Budget end-to-end (mục tiêu, không phải cam kết cứng)

| Chặng | Edge tier | Server tier |
|---|---|---|
| Audio front-end (denoise+VAD) | ~50-100ms | ~80-150ms |
| ASR streaming (partial) | ~150-300ms | ~200-400ms |
| Fast path MT | ~200-400ms | ~150-300ms |
| **→ Chữ xám xuất hiện** | **~0.4-0.8s** | **~0.5-0.9s** |
| RAG retrieval (song song, nằm trong ngân sách quality-path) | ~50-100ms | ~30-80ms |
| Quality path LLM (nếu kịp, đã gồm RAG) | ~1.0-1.5s | ~0.6-1.0s |
| **→ Chữ trắng chốt (best case)** | **~1.5-2.3s** | **~1.1-1.9s** |

→ Vì không còn TTS, đây cũng là mốc kết thúc toàn bộ pipeline cho mỗi câu — không có chặng nào cộng thêm phía sau.

→ Mục đích: để đội biết rõ ngưỡng cần đo/tối ưu khi test thật, và để giám khảo thấy nhóm có con số cụ thể chứ không chỉ mô tả định tính (ăn điểm mục "Latency and responsiveness" 20%).

---

## TẦNG 2.7: Fallback / Graceful Degradation (MỚI — toàn bộ tầng này chưa có ở bản gốc)

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 2.7: HEALTH MONITOR & FALLBACK                           │
│                                                                │
│  Giám sát liên tục:                                            │
│   - Quality-path timeout xảy ra liên tiếp N lần (VD: 3 lần)     │
│   - GPU OOM / model crash                                       │
│   - Mất kết nối mạng (nếu server tier chạy qua network nội bộ) │
│   - Mic mất tín hiệu / độ ồn vượt ngưỡng                         │
│                                                                  │
│  Hành động fallback theo mức độ:                                 │
│   Mức 1 (nhẹ): Quality-path chậm → tự động RÚT NGẮN sliding      │
│     window (5-10 câu → 2-3 câu) để LLM xử lý nhanh hơn, giảm     │
│     chất lượng context một chút nhưng vẫn kịp timeout             │
│   Mức 2 (vừa): Quality-path fail liên tục → TẠM TẮT quality       │
│     path, chỉ dùng fast-path (chữ xám tự động thành chữ trắng     │
│     sau buffer, không chờ LLM), UI hiện cảnh báo nhỏ "chế độ      │
│     dịch nhanh" để không làm gián đoạn cuộc họp                   │
│   Mức 3 (nặng): Server tier mất kết nối → tự động CHUYỂN sang     │
│     model edge cục bộ đã preload sẵn (không cần internet), UI     │
│     hiện "đã chuyển sang chế độ offline"                          │
│   Mức 4 (khẩn cấp): Toàn bộ pipeline lỗi → hiện transcript ASR    │
│     gốc (chưa dịch) kèm nút "thử lại", tránh màn hình trắng hoàn  │
│     toàn khi đang demo live                                       │
│                                                                    │
│  ➜ Nguyên tắc: LUÔN có output nào đó hiển thị, không bao giờ để   │
│    UI đứng im hoặc trắng trong lúc demo trước giám khảo            │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 4: UI Timeline theo Speaker (bổ sung diff-update)

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 4: UI Timeline theo Speaker                               │
│  - Danh sách theo thời gian, nhãn Speaker 1..N                  │
│  - Text gốc + bản dịch song song, trạng thái xám/trắng          │
│  - Không đổi giao diện dù chạy tier nào                          │
│  ➕ MỚI: DIFF-BASED UPDATE — khi câu thay đổi (do revision),      │
│    chỉ re-render phần từ bị thay đổi (dùng thuật toán diff text  │
│    đơn giản), KHÔNG re-render toàn bộ câu → tránh giật/nhấp       │
│    nháy gây khó chịu khi đọc trong cuộc họp thật                  │
│  ➕ MỚI: chỉ báo trạng thái hệ thống nhỏ, không gây phân tâm       │
│    (VD: chấm xanh/vàng/đỏ góc màn hình) phản ánh mức fallback     │
│    hiện tại từ Tầng 2.7                                           │
└───────────────────────────────────────────────────────────┘
```

---

## TẦNG 5: Trí nhớ phiên họp (giữ nguyên, bổ sung nhỏ)

```
┌───────────────────────────────────────────────────────────┐
│ TẦNG 5: Trí nhớ phiên họp                                       │
│  - Sliding window context (mọi tier)                             │
│  - Vector DB + tóm tắt định kỳ (chỉ server tier nếu edge không   │
│    đủ tài nguyên)                                                 │
│  - Biên bản họp + action items tự động cuối buổi                  │
│  ➕ MỚI: session glossary (Tầng 0) được lưu kèm biên bản, để       │
│    tái sử dụng cho các buổi họp tiếp theo với cùng đối tác         │
│  ➕ MỚI: DÙNG CHUNG Vector DB với Tầng 0.5 (RAG) — không xây 2     │
│    hệ thống lưu trữ riêng biệt. Sau khi họp xong, transcript +    │
│    bản dịch của chính buổi họp này cũng được embedding và thêm    │
│    vào cùng Vector DB đó → buổi họp SAU với cùng đối tác sẽ có     │
│    RAG context còn giàu hơn (vừa tài liệu gốc, vừa lịch sử họp)   │
└───────────────────────────────────────────────────────────┘
```

---

## Tóm tắt các điểm ăn theo rubric

| Tiêu chí | Trọng số | Phần bổ sung giúp ăn điểm |
|---|---|---|
| Translation accuracy | 30% | Session glossary động, xử lý code-switching, revision handler, acronym & term resolution, **RAG domain knowledge** (hiểu ngữ cảnh tài liệu/số liệu thật của buổi họp) |
| Latency & responsiveness | 20% | Bảng latency budget cụ thể (đã tính cả RAG retrieval), bỏ TTS để giảm 1 chặng gây trễ |
| UX & meeting flow | 20% | Diff-based UI update, cảnh báo overlap không gây phân tâm |
| Robustness | 15% | Toàn bộ Tầng 2.7 (fallback 4 mức), overlap detection, RAG không chặn pipeline nếu retrieval fail |
| Technical design & deployability | 15% | Kiến trúc rõ ràng theo tier, có giám sát sức khoẻ hệ thống, RAG chạy local (ăn điểm on-premise/confidential) |

