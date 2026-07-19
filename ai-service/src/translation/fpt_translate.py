"""FPT LLM Translation — streaming via FPT AI Marketplace.

Endpoint: POST https://mkp-api.fptcloud.com/chat/completions
OpenAI-compatible with stream=True.

Emits partial chunks for translate.partial events, final text for translate.done.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from src import config

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(
    api_key=config.FPT_API_KEY,
    base_url=config.FPT_BASE_URL,
)

_SYSTEM_PROMPTS: dict[str, str] = {
    "vi-en": (
        "You are a professional simultaneous interpreter specializing in Vietnamese–English "
        "business meetings. Your task is to translate the user's latest Vietnamese text into natural, accurate English.\n"
        "CRITICAL RULES:\n"
        "1. Output ONLY the direct translation of the latest message. DO NOT include any explanation, notes, steps, analysis, or introductory/concluding remarks.\n"
        "2. Use the preceding conversation history as short-term memory to maintain strict pronoun consistency (xưng hô), natural continuity, and context across turns.\n"
        "3. If the input text is meaningless noise, filler symbols, or cannot be translated, output exactly nothing (empty string)."
    ),
    "en-vi": (
        "Bạn là phiên dịch viên chuyên nghiệp chuyên về cuộc họp kinh doanh Anh–Việt. "
        "Nhiệm vụ của bạn là dịch văn bản tiếng Anh mới nhất của người dùng sang tiếng Việt chính xác và tự nhiên.\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. CHỈ xuất ra nội dung bản dịch tiếng Việt trực tiếp của tin nhắn mới nhất. TUYỆT ĐỐI KHÔNG giải thích, KHÔNG phân tích, KHÔNG ghi chú hay chia 'Bước 1/Bước 2'.\n"
        "2. Dựa vào ngữ cảnh và lịch sử hội thoại phía trước (trí nhớ phiên dịch) để ghi nhớ và thống nhất đại từ xưng hô (anh/chị/em/thầy/cô/tôi/bạn/chúng tôi...) một cách cực kỳ chuẩn xác, liền mạch và tự nhiên theo văn phong giao tiếp.\n"
        "3. Nếu đầu vào chỉ là ký tự vô nghĩa, dấu câu vô nghĩa (như '- -', '...', '---') hoặc không thể dịch, hãy trả về chuỗi rỗng (không xuất gì cả)."
    ),
}


def _get_system_prompt(
    src_lang: str, tgt_lang: str, glossary: list[dict[str, str]] | None = None
) -> str:
    key = f"{src_lang}-{tgt_lang}"
    base_prompt = _SYSTEM_PROMPTS.get(key, _SYSTEM_PROMPTS["vi-en"])
    if not glossary:
        return base_prompt

    terms_formatted = "\n".join(
        f"- {item.get('original', '')} => {item.get('preferred', '')}"
        + (f" ({item.get('notes')})" if item.get("notes") else "")
        for item in glossary
        if item.get("original") and item.get("preferred")
    )
    if not terms_formatted:
        return base_prompt

    if src_lang == "vi":
        glossary_instruction = (
            "\n\nEXTERNAL MEMORY & DOMAIN GLOSSARY (Strictly enforce when encountered):\n"
            f"{terms_formatted}\n\n"
            "If the speaker mentions any of the abbreviations, domain terms, or product specifications/metrics above, you MUST use the exact preferred definition/translation above."
        )
    else:
        glossary_instruction = (
            "\n\nBỘ NHỚ NGOẠI / TỪ ĐIỂN THUẬT NGỮ CHUYÊN NGÀNH & SỐ LIỆU (Bắt buộc tuân thủ khi gặp):\n"
            f"{terms_formatted}\n\n"
            "Nếu người nói đề cập đến các từ viết tắt, thuật ngữ chuyên ngành hoặc các thông số/số liệu sản phẩm trên, bạn BẮT BUỘC phải dịch chính xác theo kết quả ưu tiên đã cung cấp trong bộ nhớ."
        )
    return base_prompt + glossary_instruction


async def translate_stream(
    text: str,
    src_lang: str,
    tgt_lang: str,
    history: list[tuple[str, str, str]] | None = None,
    glossary: list[dict[str, str]] | None = None,
    mode: str = "final",
) -> AsyncIterator[str]:
    """Translate text, yielding accumulated partial strings.

    Each yield = full accumulated translation so far (not a delta).
    Matches translate.partial semantics: FE replaces current caption.

    mode="interim": uses FPT_STREAM_LLM_MODEL (fast stream AI)
    mode="final": uses FPT_LLM_MODEL (comprehensive AI with full external memory/glossary & context)

    Raises StopAsyncIteration when done.
    """
    if not text.strip() or not any(c.isalnum() for c in text):
        return

    system_prompt = _get_system_prompt(src_lang, tgt_lang, glossary)

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if history:
        # For interim streaming, keep last 2 turns for ultra-fast response.
        # For final full-context translation ("toàn cảnh"), use up to 8 turns.
        history_slice = history[-2:] if mode == "interim" else history[-8:]
        for _src, src_txt, trans_txt in history_slice:
            messages.append({"role": "user", "content": src_txt})
            messages.append({"role": "assistant", "content": trans_txt})
    messages.append({"role": "user", "content": text})

    selected_model = (
        config.FPT_STREAM_LLM_MODEL if mode == "interim" else config.FPT_LLM_MODEL
    )

    try:
        stream = await _client.chat.completions.create(
            model=selected_model,
            messages=messages,
            stream=True,
            temperature=0.2,  # low temp for consistent translation
            timeout=30,
        )

        accumulated = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                accumulated += delta
                yield accumulated  # full text so far → translate.partial

        logger.debug(
            "Translate [%s→%s]: %r → %r",
            src_lang,
            tgt_lang,
            text[:40],
            accumulated[:40],
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Translation error: %s", exc)
        # Yield empty to signal failure without crashing session
        return
