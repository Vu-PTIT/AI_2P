"""Fast-path translation backed by the FPT AI Marketplace LLM API.

Previously this loaded a local NLLB model (Transformers/torch), which meant
downloading and holding ~2-3GB of weights in RAM. On a low-RAM box that
competed directly with Whisper for memory and made the worker unstable.
Since the project already talks to FPT AI Factory for quality-path
translation, the fast path now reuses the same API with a fast/cheap model
(FPT_QUALITY_FALLBACK by default), so no local ML model is loaded here at
all -- only a lightweight HTTP client.
"""

from dataclasses import dataclass
import os
import time

from model_errors import ModelUnavailableError


LANG_NAMES = {
    "vi": "Vietnamese",
    "en": "English",
}

DEFAULT_TIMEOUT = 3.0


@dataclass
class TranslationResult:
    """Fast-path translation result."""

    source_text: str
    translated_text: str
    is_fast_path: bool = True
    latency_ms: float = 0.0


class FastPathTranslator:
    """Translate via the FPT AI Marketplace API using a fast/cheap model."""

    def __init__(
        self,
        tier: str = "server",
        client: object | None = None,
        model_name: str | None = None,
    ):
        self.tier = tier
        self.base_url = os.getenv("FPT_AI_FACTORY_BASE_URL") or os.getenv("FPT_BASE_URL")
        self.api_key = os.getenv("FPT_AI_FACTORY_API_KEY") or os.getenv("FPT_API_KEY")
        # NOTE: FAST_MT_MODEL used to hold a HuggingFace repo id for NLLB.
        # It is no longer used here on purpose -- the fast path now expects
        # an FPT chat-completions model name. Set FPT_FAST_MT_MODEL to
        # override, otherwise it reuses FPT_QUALITY_FALLBACK.
        self.model_name = (
            model_name
            or os.getenv("FPT_FAST_MT_MODEL")
            or os.getenv("FPT_QUALITY_FALLBACK")
            or "DeepSeek-V4-Flash"
        )
        self.timeout = float(os.getenv("FAST_MT_TIMEOUT", str(DEFAULT_TIMEOUT)))
        self._client = client

    def preflight(self) -> str:
        """Initialize the lightweight HTTP client. No model weights are loaded."""

        self._ensure_client()
        return f"fpt-fast:{self.model_name}"

    def translate(self, text: str, source_lang: str = "vi", target_lang: str = "en") -> TranslationResult:
        started = time.perf_counter()
        text = text.strip()
        if not text:
            return TranslationResult(source_text=text, translated_text="", latency_ms=0.0)

        client = self._ensure_client()
        source_name = self._language_name(source_lang)
        target_name = self._language_name(target_lang)

        try:
            response = client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a real-time speech translator. Translate the user's "
                            f"{source_name} text into {target_name}. Reply with ONLY the "
                            "translation, no explanations, no quotes."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
                temperature=0.0,
                max_tokens=512,
                timeout=self.timeout,
            )
            translated = (response.choices[0].message.content or "").strip()
        except Exception as error:
            raise ModelUnavailableError(
                f"FPT fast-path translation model '{self.model_name}' is unavailable: {error}",
            ) from error

        return TranslationResult(
            source_text=text,
            translated_text=translated,
            latency_ms=(time.perf_counter() - started) * 1000,
        )

    def _ensure_client(self):
        if self._client is not None:
            return self._client

        if not self.base_url or not self.api_key:
            raise ModelUnavailableError(
                "FPT_AI_FACTORY_BASE_URL / FPT_AI_FACTORY_API_KEY (or FPT_BASE_URL / "
                "FPT_API_KEY) must be set to use the FPT fast-path translator.",
            )

        try:
            from openai import OpenAI
        except ImportError as error:
            raise ModelUnavailableError(
                "The 'openai' package is required to call the FPT AI Marketplace API.",
            ) from error

        self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        return self._client

    def _language_name(self, lang: str) -> str:
        try:
            return LANG_NAMES[lang]
        except KeyError as error:
            raise ValueError(f"Unsupported language: {lang}") from error