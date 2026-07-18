# AI Speech Lab

Trang test này kết nối thẳng tới raw WebSocket của `ai-service`. Nó không dùng
NestJS realtime gateway hoặc frontend meeting, nên phù hợp để kiểm tra độc lập:

- microphone → PCM16 mono 16 kHz;
- endpointing theo khoảng lặng;
- STT đúng ngôn ngữ nguồn;
- bản dịch tạm `translate.partial` khi người dùng vẫn đang nói;
- streaming bản dịch cuối bằng `translate.token`;
- kết quả cuối `translate.done`.

## 1. Chạy AI worker thật

Dùng đúng Python environment đã cài `ai-service/requirements.txt` và có `.env`:

```bash
cd /path/to/AI_2P/ai-service
python main.py --check
python main.py
```

Worker mặc định mở tại `127.0.0.1:8765`. `--check` phải hoàn tất trước khi mở
web test.

Nếu máy local chưa cài Torch/Silero nhưng chỉ cần thử đường FPT API, có thể chủ
động dùng energy VAD:

```bash
AUDIO_VAD=energy python main.py
```

Đây chỉ là fallback local có chủ đích; môi trường production vẫn nên dùng
`AUDIO_VAD=silero`.

## 2. Serve trang test

Mở terminal thứ hai:

```bash
cd /path/to/AI_2P/ai-service
python -m http.server 4173 --directory web-test
```

Sau đó mở:

```text
http://127.0.0.1:4173
```

Trang phải được serve qua `localhost`/`127.0.0.1`, không mở trực tiếp bằng
`file://`, để trình duyệt cho phép dùng microphone và AudioWorklet.

## Cách đọc kết quả

1. Chọn `EN → VI` nếu bạn sẽ nói tiếng Anh, hoặc `VI → EN` nếu nói tiếng Việt.
2. Bấm **Kết nối AI** và chờ trạng thái **AI sẵn sàng**.
3. Bấm **Bắt đầu nói**, nói trọn một câu rồi bấm **Dừng & chốt câu**.
4. Một câu bình thường phải có cùng `utteranceId` từ `stt.partial` đến
   các `translate.partial` thay thế nhau, `stt.final`, nhiều
   `translate.token`, rồi một `translate.done`.
5. Nếu câu bị cắt thành nhiều lượt, copy phần **Raw event stream** cùng log AI để
   kiểm tra threshold endpointing/VAD.

Khi dừng microphone, trang gửi thêm 800 ms PCM im lặng để worker đạt ngưỡng
endpoint và chốt câu. Audio không được gửi đến backend meeting.
