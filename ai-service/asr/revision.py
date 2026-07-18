"""ASR revision handling."""

from dataclasses import dataclass
from dataclasses import field
from difflib import SequenceMatcher
import re


@dataclass
class RevisionResult:
    """Decision for a revised ASR segment."""

    segment_id: str
    is_dirty: bool = False
    is_semantic_change: bool = False
    old_text: str = ""
    new_text: str = ""
    diff: list[dict] = field(default_factory=list)


class RevisionHandler:
    """Decide whether a changed ASR segment should be translated again."""

    def check_revision(self, old_segment, new_segment) -> RevisionResult:
        old_text = getattr(old_segment, "text", "") or ""
        new_text = getattr(new_segment, "text", "") or ""
        semantic_change = self._semantic_change(old_text, new_text)
        is_final = bool(getattr(old_segment, "is_final", False))
        stability = float(getattr(old_segment, "stability_score", 0.0) or 0.0)
        is_dirty = old_text != new_text and (not is_final or stability < 0.8 or semantic_change)

        return RevisionResult(
            segment_id=getattr(new_segment, "segment_id", "")
            or getattr(old_segment, "segment_id", ""),
            is_dirty=is_dirty,
            is_semantic_change=semantic_change,
            old_text=old_text,
            new_text=new_text,
            diff=self._diff(old_text, new_text),
        )

    def _semantic_change(self, old_text: str, new_text: str) -> bool:
        return (
            self._numbers(old_text) != self._numbers(new_text)
            or self._acronyms(old_text) != self._acronyms(new_text)
            or self._negations(old_text) != self._negations(new_text)
        )

    def _numbers(self, text: str) -> set[str]:
        return set(re.findall(r"\b\d+(?:[.,]\d+)?%?\b", text))

    def _acronyms(self, text: str) -> set[str]:
        return set(re.findall(r"\b[A-Z]{2,}\b", text))

    def _negations(self, text: str) -> set[str]:
        words = set(re.findall(r"\w+", text.casefold()))
        return words & {"khong", "kh\u00f4ng", "chua", "ch\u01b0a", "no", "not", "never", "without"}

    def _diff(self, old_text: str, new_text: str) -> list[dict]:
        old_words = old_text.split()
        new_words = new_text.split()
        changes = []
        for tag, old_start, old_end, new_start, new_end in SequenceMatcher(
            a=old_words,
            b=new_words,
        ).get_opcodes():
            changes.append(
                {
                    "op": tag,
                    "old": " ".join(old_words[old_start:old_end]),
                    "new": " ".join(new_words[new_start:new_end]),
                    "oldRange": [old_start, old_end],
                    "newRange": [new_start, new_end],
                },
            )
        return changes
