"""Static and per-session glossary management."""

import csv
import json
from typing import Dict, Optional


class GlossaryManager:
    """Manage static glossary plus terms learned during a meeting."""

    def __init__(self, lang_pair: str = "vi-en"):
        self.lang_pair = lang_pair
        self._static: Dict[str, str] = {}
        self._session: Dict[str, str] = {}

    def load_static(self, path: str) -> None:
        """Load a static glossary from JSON or CSV."""
        if path.lower().endswith(".csv"):
            with open(path, newline="", encoding="utf-8-sig") as file:
                reader = csv.DictReader(file)
                for row in reader:
                    term = (row.get("term") or row.get("source") or "").strip()
                    translation = (
                        row.get("translation") or row.get("target") or ""
                    ).strip()
                    if term and translation:
                        self._static[term] = translation
            return

        with open(path, encoding="utf-8-sig") as file:
            data = json.load(file)

        glossary = data.get(self.lang_pair, data) if isinstance(data, dict) else {}
        if not isinstance(glossary, dict):
            raise ValueError("Glossary JSON must be an object")

        self._static.update(
            {
                str(term).strip(): str(translation).strip()
                for term, translation in glossary.items()
                if str(term).strip() and str(translation).strip()
            },
        )

    def add_session_term(self, term: str, translation: str) -> None:
        """Add or update a term during the meeting."""
        term = term.strip()
        translation = translation.strip()
        if term and translation:
            self._session[term] = translation

    def lookup(self, term: str) -> Optional[str]:
        """Session glossary wins over the static glossary."""
        term = term.strip()
        return self._session.get(term) or self._static.get(term)

    def get_all(self) -> Dict[str, str]:
        """Return a merged glossary for ASR biasing or LLM prompts."""
        merged = dict(self._static)
        merged.update(self._session)
        return merged
