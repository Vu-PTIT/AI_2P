"""Audio front-end backed by denoising, configurable VAD, and diarization."""

from dataclasses import dataclass
import os
from typing import Callable, Optional

import numpy as np

from model_errors import ModelUnavailableError


@dataclass
class AudioSegment:
    """A processed mono audio segment."""

    audio: np.ndarray
    sample_rate: int = 16000
    speaker_id: Optional[str] = None
    is_speech: bool = True
    is_overlap: bool = False
    timestamp_start: float = 0.0
    timestamp_end: float = 0.0


class AudioPipeline:
    """Normalize PCM, reduce noise, segment speech, and attach speaker hints."""

    def __init__(
        self,
        tier: str = "server",
        vad_model: object | None = None,
        get_speech_timestamps: Callable | None = None,
        denoiser: object | None = None,
        diarizer: object | None = None,
        denoise_mode: str | None = None,
        diarization_mode: str | None = None,
        vad_mode: str | None = None,
    ):
        self.tier = tier
        self._vad_model = vad_model
        self._get_speech_timestamps = get_speech_timestamps
        self._denoiser = denoiser
        self._diarizer = diarizer
        self.denoise_mode = (denoise_mode or os.getenv("AUDIO_DENOISE", "gate")).casefold()
        self.diarization_mode = (diarization_mode or os.getenv("AUDIO_DIARIZATION", "off")).casefold()
        self.vad_mode = (vad_mode or os.getenv("AUDIO_VAD", "silero")).casefold()
        self._torch = None
        self._vad_backend = (
            "injected"
            if vad_model is not None and get_speech_timestamps is not None
            else None
        )

    def preflight(self) -> str:
        """Load the configured VAD now so deployment checks fail before traffic."""

        self._ensure_vad()
        return self._vad_backend or self.vad_mode

    def process(self, raw_audio: np.ndarray, sample_rate: int = 16000) -> list[AudioSegment]:
        raw = np.asarray(raw_audio)
        channel_audio = self._normalize_channels(raw) if raw.ndim > 1 else None
        audio = channel_audio.mean(axis=1) if channel_audio is not None else self._normalize(raw)
        if audio.size == 0:
            return []
        audio = self._denoise(audio, sample_rate)

        self._ensure_vad()
        tensor = (
            self._torch.from_numpy(audio)
            if self._torch is not None
            else audio
        )
        timestamps = self._get_speech_timestamps(
            tensor,
            self._vad_model,
            sampling_rate=sample_rate,
        )

        has_overlap = (
            self._has_overlap(timestamps)
            or self._looks_overlapped(audio)
            or self._channels_overlap(channel_audio, timestamps)
        )
        segments = []
        for item in timestamps:
            start = int(item.get("start", 0))
            end = int(item.get("end", 0))
            if end <= start:
                continue
            segments.append(
                AudioSegment(
                    audio=audio[start:end],
                    sample_rate=sample_rate,
                    is_speech=True,
                    is_overlap=has_overlap,
                    timestamp_start=start / sample_rate,
                    timestamp_end=end / sample_rate,
                ),
            )

        self._assign_speakers(segments, channel_audio, audio, sample_rate)
        return segments

    def _ensure_vad(self) -> None:
        if self._vad_model is not None and self._get_speech_timestamps is not None:
            return

        if self.vad_mode == "energy":
            self._vad_model = object()
            self._get_speech_timestamps = self._energy_speech_timestamps
            self._vad_backend = "energy"
            return

        if self.vad_mode != "silero":
            raise ModelUnavailableError(
                f"Unsupported AUDIO_VAD mode: {self.vad_mode}. Use silero or energy.",
            )

        try:
            import torch
        except ImportError as error:
            raise ModelUnavailableError(
                "Torch is required when AUDIO_VAD=silero. Install "
                "ai-service/requirements.txt, or set AUDIO_VAD=energy "
                "for the reduced-accuracy emergency fallback.",
            ) from error

        try:
            try:
                model, utils = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    trust_repo=True,
                )
            except TypeError:
                model, utils = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                )
        except Exception as error:
            raise ModelUnavailableError(
                "Silero VAD is unavailable. Allow its first torch.hub download "
                "and persist the Torch cache, or set AUDIO_VAD=energy for the "
                "reduced-accuracy emergency fallback.",
            ) from error

        self._torch = torch
        self._vad_model = model
        self._get_speech_timestamps = utils[0]
        self._vad_backend = "silero"

    def _energy_speech_timestamps(
        self,
        audio,
        _model,
        sampling_rate: int = 16000,
    ) -> list[dict[str, int]]:
        """Return coarse speech regions without external ML dependencies."""

        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        if samples.size == 0 or sampling_rate <= 0:
            return []

        frame_size = max(1, int(sampling_rate * 0.03))
        frame_count = int(np.ceil(samples.size / frame_size))
        padded = np.pad(
            samples,
            (0, frame_count * frame_size - samples.size),
        )
        frames = padded.reshape(frame_count, frame_size)
        rms = np.sqrt(np.mean(np.square(frames), axis=1))
        peak_rms = float(np.max(rms))
        if peak_rms < 0.008:
            return []

        noise_floor = float(np.percentile(rms, 20))
        threshold = max(
            0.008,
            min(noise_floor * 2.5, peak_rms * 0.6),
        )
        active_frames = np.flatnonzero(rms >= threshold)
        if active_frames.size == 0:
            return []

        max_gap_frames = max(1, int(0.2 / 0.03))
        min_speech_frames = max(1, int(0.12 / 0.03))
        padding_frames = max(1, int(0.06 / 0.03))
        regions: list[tuple[int, int]] = []
        region_start = int(active_frames[0])
        previous_frame = region_start

        for frame_index_value in active_frames[1:]:
            frame_index = int(frame_index_value)
            if frame_index - previous_frame > max_gap_frames:
                regions.append((region_start, previous_frame))
                region_start = frame_index
            previous_frame = frame_index
        regions.append((region_start, previous_frame))

        timestamps = []
        for start_frame, end_frame in regions:
            if end_frame - start_frame + 1 < min_speech_frames:
                continue
            start = max(0, (start_frame - padding_frames) * frame_size)
            end = min(
                samples.size,
                (end_frame + padding_frames + 1) * frame_size,
            )
            if end > start:
                timestamps.append({"start": start, "end": end})
        return timestamps

    def _normalize(self, raw_audio: np.ndarray) -> np.ndarray:
        audio = np.asarray(raw_audio)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        if np.issubdtype(audio.dtype, np.integer):
            limit = max(abs(np.iinfo(audio.dtype).min), np.iinfo(audio.dtype).max)
            return audio.astype(np.float32) / limit

        return audio.astype(np.float32)

    def _normalize_channels(self, raw_audio: np.ndarray) -> np.ndarray:
        audio = np.asarray(raw_audio)
        if audio.ndim != 2:
            return np.empty((0, 0), dtype=np.float32)
        if audio.shape[0] <= 8 and audio.shape[1] > audio.shape[0]:
            audio = audio.T
        if np.issubdtype(audio.dtype, np.integer):
            limit = max(abs(np.iinfo(audio.dtype).min), np.iinfo(audio.dtype).max)
            return audio.astype(np.float32) / limit
        return audio.astype(np.float32)

    def _denoise(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        if self._denoiser is not None:
            return self._apply_denoiser(audio, sample_rate)
        if self.denoise_mode in ("off", "false", "0", "none"):
            return audio
        if self.denoise_mode in ("gate", "auto", "numpy"):
            return self._noise_gate(audio)
        if self.denoise_mode == "noisereduce":
            try:
                import noisereduce as nr
            except ImportError as error:
                raise ModelUnavailableError(
                    "noisereduce is required when AUDIO_DENOISE=noisereduce.",
                ) from error
            return np.asarray(nr.reduce_noise(y=audio, sr=sample_rate), dtype=np.float32)
        raise ModelUnavailableError(f"Unsupported AUDIO_DENOISE mode: {self.denoise_mode}")

    def _apply_denoiser(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        if hasattr(self._denoiser, "reduce_noise"):
            return np.asarray(self._denoiser.reduce_noise(y=audio, sr=sample_rate), dtype=np.float32)
        try:
            return np.asarray(self._denoiser(audio, sample_rate), dtype=np.float32)
        except TypeError:
            return np.asarray(self._denoiser(audio), dtype=np.float32)

    def _noise_gate(self, audio: np.ndarray) -> np.ndarray:
        magnitudes = np.abs(audio)
        if magnitudes.size == 0:
            return audio
        noise_floor = float(np.percentile(magnitudes, 20))
        peak = float(np.max(magnitudes))
        if peak == 0.0 or noise_floor > peak * 0.5:
            return audio
        threshold = max(noise_floor * 2.5, 0.003)
        return np.where(magnitudes >= threshold, audio, 0.0).astype(np.float32)

    def _has_overlap(self, timestamps: list[dict]) -> bool:
        ordered = sorted(
            ((int(item.get("start", 0)), int(item.get("end", 0))) for item in timestamps),
            key=lambda item: item[0],
        )
        return any(current_start < previous_end for (_, previous_end), (current_start, _) in zip(ordered, ordered[1:]))

    def _looks_overlapped(self, audio: np.ndarray) -> bool:
        if audio.size == 0:
            return False

        rms = float(np.sqrt(np.mean(np.square(audio))))
        peak = float(np.max(np.abs(audio)))
        return peak > 0.9 and rms > 0.2

    def _channels_overlap(self, channels: np.ndarray | None, timestamps: list[dict]) -> bool:
        if channels is None or channels.size == 0:
            return False

        ranges = [
            (int(item.get("start", 0)), int(item.get("end", 0)))
            for item in timestamps
            if int(item.get("end", 0)) > int(item.get("start", 0))
        ] or [(0, len(channels))]
        for start, end in ranges:
            window = channels[start:end]
            if window.size == 0:
                continue
            energy = np.sqrt(np.mean(np.square(window), axis=0))
            threshold = max(float(np.max(energy)) * 0.25, 0.02)
            if int(np.sum(energy >= threshold)) >= 2:
                return True
        return False

    def _assign_speakers(
        self,
        segments: list[AudioSegment],
        channels: np.ndarray | None,
        mono_audio: np.ndarray,
        sample_rate: int,
    ) -> None:
        if not segments:
            return
        if channels is not None and channels.size:
            for segment in segments:
                segment.speaker_id = self._dominant_channel(channels, segment, sample_rate)
            return
        if self._diarizer is None and self.diarization_mode in ("off", "false", "0", "none"):
            return

        turns = self._speaker_turns(mono_audio, sample_rate)
        for segment in segments:
            speaker = self._speaker_for_segment(turns, segment)
            if speaker:
                segment.speaker_id = speaker

    def _dominant_channel(self, channels: np.ndarray, segment: AudioSegment, sample_rate: int) -> str | None:
        start = max(0, int(segment.timestamp_start * sample_rate))
        end = min(len(channels), int(segment.timestamp_end * sample_rate))
        window = channels[start:end]
        if window.size == 0:
            return None
        energy = np.sqrt(np.mean(np.square(window), axis=0))
        if float(np.max(energy)) <= 0.0:
            return None
        return f"speaker_{int(np.argmax(energy)) + 1}"

    def _speaker_turns(self, audio: np.ndarray, sample_rate: int) -> list[tuple[float, float, str]]:
        diarizer = self._ensure_diarizer()
        try:
            result = diarizer({"waveform": self._waveform(audio), "sample_rate": sample_rate})
        except TypeError:
            result = diarizer(audio, sample_rate)
        return list(self._iter_speaker_turns(result))

    def _ensure_diarizer(self):
        if self._diarizer is not None:
            return self._diarizer

        try:
            from pyannote.audio import Pipeline
        except ImportError as error:
            raise ModelUnavailableError(
                "pyannote.audio is required when AUDIO_DIARIZATION=pyannote.",
            ) from error

        token = os.getenv("PYANNOTE_AUTH_TOKEN") or None
        model_name = os.getenv("PYANNOTE_MODEL", "pyannote/speaker-diarization-3.1")
        try:
            self._diarizer = Pipeline.from_pretrained(model_name, token=token)
        except TypeError:
            self._diarizer = Pipeline.from_pretrained(model_name, use_auth_token=token)
        return self._diarizer

    def _waveform(self, audio: np.ndarray):
        try:
            import torch
        except ImportError as error:
            raise ModelUnavailableError("torch is required for pyannote diarization.") from error
        return torch.from_numpy(audio).unsqueeze(0)

    def _iter_speaker_turns(self, result) -> list[tuple[float, float, str]]:
        if isinstance(result, list):
            for item in result:
                if isinstance(item, dict):
                    yield (
                        float(item.get("start", 0.0)),
                        float(item.get("end", 0.0)),
                        str(item.get("speaker") or item.get("speaker_id") or ""),
                    )
            return
        if hasattr(result, "itertracks"):
            for turn, _, speaker in result.itertracks(yield_label=True):
                yield (float(turn.start), float(turn.end), str(speaker))

    def _speaker_for_segment(
        self,
        turns: list[tuple[float, float, str]],
        segment: AudioSegment,
    ) -> str | None:
        best_speaker = None
        best_overlap = 0.0
        for start, end, speaker in turns:
            overlap = min(end, segment.timestamp_end) - max(start, segment.timestamp_start)
            if speaker and overlap > best_overlap:
                best_speaker = speaker
                best_overlap = overlap
        return best_speaker
