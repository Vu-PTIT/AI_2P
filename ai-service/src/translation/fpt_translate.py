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
        "business meetings. Translate the Vietnamese text to English accurately and naturally. "
        "Preserve business terms exactly. Output only the translation, nothing else."
    ),
    "en-vi": (
        "Bạn là phiên dịch viên chuyên nghiệp chuyên về cuộc họp kinh doanh Anh–Việt. "
        "Dịch văn bản tiếng Anh sang tiếng Việt chính xác và tự nhiên. "
        "Giữ nguyên thuật ngữ kinh doanh. Chỉ xuất bản dịch, không có gì khác."
    ),
}


def _get_system_prompt(src_lang: str, tgt_lang: str) -> str:
    key = f"{src_lang}-{tgt_lang}"
    return _SYSTEM_PROMPTS.get(key, _SYSTEM_PROMPTS["vi-en"])


async def translate_stream(
    text: str,
    src_lang: str,
    tgt_lang: str,
) -> AsyncIterator[str]:
    """Translate text, yielding accumulated partial strings.

    Each yield = full accumulated translation so far (not a delta).
    Matches translate.partial semantics: FE replaces current caption.

    Raises StopAsyncIteration when done.
    """
    if not text.strip():
        return

    system_prompt = _get_system_prompt(src_lang, tgt_lang)

    try:
        stream = await _client.chat.completions.create(
            model=config.FPT_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
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
