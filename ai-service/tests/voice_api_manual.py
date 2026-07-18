"""Manually upload voice_test WAV files to FPT ASR and save transcripts."""

import argparse
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import wave

import numpy as np
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
VOICE_DIR = ROOT / "voice_test"
OUTPUT = VOICE_DIR / "api_results.json"
TARGET_RATE = 16_000


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")

    if sample_width != 2:
        raise ValueError(f"{path.name}: expected PCM16 audio")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1).astype(np.int16)
    if sample_rate != TARGET_RATE:
        size = round(audio.size * TARGET_RATE / sample_rate)
        audio = np.interp(
            np.linspace(0, audio.size - 1, size),
            np.arange(audio.size),
            audio,
        ).astype(np.int16)
    if audio.size / TARGET_RATE > 15:
        raise ValueError(f"{path.name}: audio exceeds the 15-second FPT limit")

    return audio.astype(np.float32) / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--confirm-upload",
        action="store_true",
        help="confirm that voice_test files may be uploaded to FPT",
    )
    args = parser.parse_args()
    if not args.confirm_upload:
        parser.error("--confirm-upload is required because this sends voice files to FPT")

    load_dotenv(ROOT / ".env")
    os.environ.setdefault("WHISPER_LANGUAGE", "vi")
    sys.path.insert(0, str(ROOT))

    from asr.engine import ASREngine

    engine = ASREngine()
    if not engine._use_fpt_asr:
        raise SystemExit("FPT_ASR must be true in ai-service/.env")

    results = []
    for path in sorted(VOICE_DIR.glob("*.wav")):
        started = time.perf_counter()
        try:
            transcript = engine.transcribe_stream(
                SimpleNamespace(
                    audio=load_wav(path),
                    is_speech=True,
                    segment_id=path.stem,
                ),
            )
            result = {
                "file": path.name,
                "status": "success",
                "text": transcript.text,
                "stability": round(transcript.stability_score, 3),
                "elapsed_seconds": round(time.perf_counter() - started, 2),
            }
        except Exception as error:
            result = {
                "file": path.name,
                "status": "error",
                "error": str(error),
                "elapsed_seconds": round(time.perf_counter() - started, 2),
            }

        results.append(result)
        OUTPUT.write_text(
            json.dumps(results, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps(result, ensure_ascii=False))

    print(f"Backend: FPT API; local model loaded: {engine._model is not None}")
    print(f"Results: {OUTPUT}")
    if any(result["status"] == "error" for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
