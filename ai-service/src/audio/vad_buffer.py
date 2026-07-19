"""VAD-aware audio buffer.

Accumulates denoised PCM frames, detects utterance boundaries via silence,
and notifies the session worker when an utterance is ready.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable

import numpy as np

logger = logging.getLogger(__name__)

_SAMPLE_RATE = 16_000
_BYTES_PER_SAMPLE = 2  # 16-bit
_FRAME_MS = 20  # chunk size from client


class VadBuffer:
    """State machine: SILENCE → SPEECH → SILENCE.

    Callbacks:
        on_interim(pcm): called every INTERIM_INTERVAL_S while speech is ongoing.
        on_utterance(pcm): called when silence detected → flush complete utterance.
    """

    def __init__(
        self,
        on_interim: Callable[[np.ndarray], None],
        on_utterance: Callable[[np.ndarray], None],
        silence_ms: int = 400,
        interim_interval_s: float = 1.5,
    ) -> None:
        self._on_interim = on_interim
        self._on_utterance = on_utterance
        self._silence_frames = int(silence_ms / _FRAME_MS)
        self._interim_interval_s = interim_interval_s

        self._speech_buf: list[np.ndarray] = []
        self._silence_count: int = 0
        self._in_speech: bool = False
        self._last_interim: float = 0.0

    def push(self, pcm_float: np.ndarray, is_speech: bool) -> None:
        if is_speech:
            self._speech_buf.append(pcm_float)
            self._silence_count = 0
            self._in_speech = True

            total_samples = sum(len(f) for f in self._speech_buf)
            if total_samples >= _SAMPLE_RATE * 0.4:
                now = time.monotonic()
                if self._last_interim == 0.0 or (now - self._last_interim >= self._interim_interval_s):
                    self._last_interim = now
                    interim_audio = np.concatenate(self._speech_buf)
                    self._on_interim(interim_audio)
        else:
            if self._in_speech:
                self._silence_count += 1
                if self._silence_count >= self._silence_frames:
                    self._flush()

    def flush_remaining(self) -> None:
        """Call on session close to emit any buffered audio."""
        if self._in_speech and self._speech_buf:
            self._flush()

    def reset(self) -> None:
        self._speech_buf.clear()
        self._silence_count = 0
        self._in_speech = False
        self._last_interim = 0.0

    # ------------------------------------------------------------------

    def _flush(self) -> None:
        if not self._speech_buf:
            return
        utterance = np.concatenate(self._speech_buf)
        self.reset()
        logger.debug("Utterance flushed: %.2f s", len(utterance) / _SAMPLE_RATE)
        self._on_utterance(utterance)
