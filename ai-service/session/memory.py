"""Session memory and meeting-minute export."""

from collections import deque
from dataclasses import dataclass
import json
from pathlib import Path
from typing import List


@dataclass
class SessionEntry:
    """One transcript line."""

    speaker_id: str
    source_text: str
    translated_text: str
    timestamp: float = 0.0


class SlidingWindow:
    """Bounded context window for quality-path prompts."""

    def __init__(self, max_size: int = 10):
        self._window: deque = deque(maxlen=max_size)

    def add(self, entry: SessionEntry) -> None:
        self._window.append(entry)

    def get_context(self) -> List[SessionEntry]:
        return list(self._window)

    def resize(self, new_size: int) -> None:
        old = list(self._window)
        self._window = deque(old[-new_size:], maxlen=new_size)


class SessionManager:
    """Manage transcript, sliding context, and learned glossary."""

    def __init__(self):
        self.window = SlidingWindow()
        self.transcript: List[SessionEntry] = []
        self.session_glossary: dict[str, str] = {}

    def add_entry(self, entry: SessionEntry) -> None:
        self.window.add(entry)
        self.transcript.append(entry)

    def add_session_term(self, term: str, translation: str) -> None:
        term = term.strip()
        translation = translation.strip()
        if term and translation:
            self.session_glossary[term] = translation

    def generate_minutes(self) -> str:
        if not self.transcript:
            return "Meeting minutes\n\nNo transcript yet."

        lines = ["Meeting minutes", "", "Transcript:"]
        for entry in self.transcript:
            lines.append(
                f"- [{entry.timestamp:.1f}s] {entry.speaker_id}: "
                f"{entry.source_text} -> {entry.translated_text}",
            )

        actions = [
            entry.translated_text or entry.source_text
            for entry in self.transcript
            if self._looks_like_action(entry.source_text)
            or self._looks_like_action(entry.translated_text)
        ]
        lines.extend(["", "Action items:"])
        if actions:
            lines.extend(f"- {action}" for action in actions)
        else:
            lines.append("- None")
        return "\n".join(lines)

    def export(self, path: str) -> None:
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if output_path.suffix.lower() == ".json":
            data = {
                "transcript": [entry.__dict__ for entry in self.transcript],
                "session_glossary": self.session_glossary,
                "minutes": self.generate_minutes(),
            }
            output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            return

        output_path.write_text(self.generate_minutes(), encoding="utf-8")

    def _looks_like_action(self, text: str) -> bool:
        lower = text.casefold()
        return any(marker in lower for marker in ("action", "todo", "need to", "can ", "phai "))
