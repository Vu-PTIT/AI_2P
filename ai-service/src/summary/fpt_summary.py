"""FPT LLM Summarization — conversation summary via FPT AI Marketplace.

Endpoint: POST https://mkp-api.fptcloud.com/chat/completions
OpenAI-compatible with stream=True/False.

Emits structured meeting summary matching the 7-part specification.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from src import config

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(
    api_key=config.FPT_API_KEY,
    base_url=config.FPT_BASE_URL,
)

_SUMMARY_SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên nghiệp có nhiệm vụ tổng hợp và viết biên bản tóm tắt cuộc họp/cuộc hội thoại một cách chính xác, súc tích, khách quan và chuyên nghiệp.

QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG VÀ NỘI DUNG:
Hãy tổng hợp nội dung hội thoại được cung cấp và trình bày BẮT BUỘC theo đúng cấu trúc 7 phần dưới đây (sử dụng định dạng Markdown):

# Tóm tắt cuộc họp [Tên hoặc Chủ đề cuộc họp]

## 1. Mục đích cuộc họp
- Nêu rõ mục tiêu chính và các chủ đề trọng tâm được thảo luận trong cuộc họp/hội thoại.

## 2. Nội dung chính được trình bày
(Chia nhỏ thành các mục 2.1, 2.2,... theo từng luồng chủ đề, chức năng hoặc vấn đề chính được trình bày chi tiết trong hội thoại).

## 3. Các nội dung thảo luận và phản hồi từ các bên
(Tóm tắt ý kiến đóng góp, thắc mắc, phản hồi và thảo luận giữa các bên tham gia theo các tiểu mục 3.1, 3.2,... nếu có).

## 4. Các quyết định và thống nhất
- Ghi nhận rõ ràng các điểm đã được các bên đồng thuận và thống nhất triển khai.

## 5. Kế hoạch hành động và phân công trách nhiệm
- Liệt kê chi tiết các công việc cần thực hiện theo định dạng rõ ràng:
  - **[Tên công việc cần làm]**
    - **Phụ trách:** [Người/Bộ phận chịu trách nhiệm]
    - **Thời hạn:** [Thời hạn hoặc mốc thời gian hoàn thành nếu được nhắc đến]

## 6. Mốc thời gian được nêu trong cuộc họp
- Tổng hợp toàn bộ các mốc thời gian quan trọng (thời hạn, ngày chạy thử, ngày chốt, ngày vận hành chính thức...) xuất hiện trong hội thoại.

## 7. Kết luận cuộc họp
- Khái quát lại kết quả đạt được sau cuộc họp và trích dẫn 1-2 câu phát biểu kết luận hoặc ý kiến chỉ đạo trọng tâm (trong ngoặc kép "" nếu phù hợp).

LƯU Ý:
- Chỉ tổng hợp dựa trên thông tin thực tế có trong lịch sử hội thoại/ghi chú. Không tự bịa đặt thông tin.
- Nếu phần nào không có thông tin trong hội thoại, ghi ngắn gọn: "Không có thông tin được ghi nhận trong cuộc họp."
- Sử dụng ngôn ngữ tiếng Việt chuyên nghiệp, văn phong biên bản rõ ràng."""


def _format_conversation_input(
    title: str,
    turns: list[dict[str, Any]] | list[tuple[str, str, str]],
    notes: list[str] | list[dict[str, Any]] | None = None,
) -> str:
    parts = [f"Chủ đề / Tên cuộc họp: {title or 'Cuộc hội thoại'}\n\n--- LỊCH SỬ HỘI THOẠI ---"]
    for idx, turn in enumerate(turns, 1):
        if isinstance(turn, dict):
            speaker = turn.get("speakerName") or turn.get("displayName") or turn.get("speaker") or "Người nói"
            text = turn.get("sourceText") or turn.get("text") or ""
            translated = turn.get("translatedText") or ""
            content = text
            if translated and translated != text:
                content += f" (Dịch: {translated})"
            if content.strip():
                parts.append(f"[{idx}] {speaker}: {content.strip()}")
        elif isinstance(turn, tuple) and len(turn) == 3:
            src_lang, src_txt, trans_txt = turn
            if src_txt.strip():
                parts.append(
                    f"[{idx}] Speaker ({src_lang}): {src_txt.strip()}"
                    + (f" (Dịch: {trans_txt.strip()})" if trans_txt.strip() else "")
                )

    if notes:
        parts.append("\n--- GHI CHÚ TRONG CUỘC HỌP ---")
        for note in notes:
            note_text = note.get("text", "") if isinstance(note, dict) else str(note)
            if note_text.strip():
                parts.append(f"- {note_text.strip()}")

    return "\n".join(parts)


async def summarize_meeting(
    title: str,
    turns: list[dict[str, Any]] | list[tuple[str, str, str]],
    notes: list[str] | list[dict[str, Any]] | None = None,
) -> str:
    """Generate a structured meeting summary using FPT LLM model (non-streaming)."""
    if not turns and not notes:
        return "Không có nội dung hội thoại hoặc ghi chú để tóm tắt."

    user_content = _format_conversation_input(title, turns, notes)

    try:
        response = await _client.chat.completions.create(
            model=config.FPT_SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            timeout=60,
        )
        summary = response.choices[0].message.content or ""
        logger.info("Generated meeting summary for %r (%d turns)", title, len(turns))
        return summary
    except Exception as exc:  # noqa: BLE001
        logger.error("Summary generation error: %s", exc)
        raise


async def summarize_meeting_stream(
    title: str,
    turns: list[dict[str, Any]] | list[tuple[str, str, str]],
    notes: list[str] | list[dict[str, Any]] | None = None,
) -> AsyncIterator[str]:
    """Generate a structured meeting summary, yielding partial accumulated strings."""
    if not turns and not notes:
        yield "Không có nội dung hội thoại hoặc ghi chú để tóm tắt."
        return

    user_content = _format_conversation_input(title, turns, notes)

    try:
        stream = await _client.chat.completions.create(
            model=config.FPT_SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            stream=True,
            temperature=0.3,
            timeout=60,
        )

        accumulated = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                accumulated += delta
                yield accumulated

        logger.info("Streamed meeting summary for %r (%d turns)", title, len(turns))
    except Exception as exc:  # noqa: BLE001
        logger.error("Summary generation stream error: %s", exc)
        raise
