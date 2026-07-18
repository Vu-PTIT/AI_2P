"""Acronym and business-term resolution."""

import csv
import json
from typing import Dict, Optional, Tuple


class AcronymResolver:
    """Resolve acronyms and track first occurrence within a meeting."""

    def __init__(self):
        self._table: Dict[str, Tuple[str, str, str]] = {}
        self._seen_in_session: set[str] = set()

    def load_table(self, path: str) -> None:
        """Load acronym definitions from JSON or CSV."""
        if path.lower().endswith(".csv"):
            with open(path, newline="", encoding="utf-8-sig") as file:
                reader = csv.DictReader(file)
                for row in reader:
                    self.add(
                        row.get("acronym", ""),
                        row.get("full") or row.get("full_name") or "",
                        row.get("vi", ""),
                        row.get("en", ""),
                    )
            return

        with open(path, encoding="utf-8-sig") as file:
            data = json.load(file)

        if not isinstance(data, dict):
            raise ValueError("Acronym JSON must be an object")

        for acronym, value in data.items():
            if isinstance(value, dict):
                self.add(
                    acronym,
                    str(value.get("full", "")).strip(),
                    str(value.get("vi", "")).strip(),
                    str(value.get("en", "")).strip(),
                )
            elif isinstance(value, (list, tuple)) and len(value) == 3:
                self.add(acronym, str(value[0]), str(value[1]), str(value[2]))

    def add(self, acronym: str, full_name: str, vi: str, en: str) -> None:
        acronym = acronym.strip().upper()
        if acronym and full_name:
            self._table[acronym] = (full_name.strip(), vi.strip(), en.strip())

    def resolve(self, acronym: str) -> Optional[Tuple[str, str, str]]:
        """Return (full_name, vi_translation, en_translation), if known."""
        return self._table.get(acronym.strip().upper())

    def is_first_occurrence(self, acronym: str) -> bool:
        """Return True once per acronym per meeting."""
        key = acronym.strip().upper()
        if key not in self._seen_in_session:
            self._seen_in_session.add(key)
            return True
        return False

    def learn_from_session(self, acronym: str, full_name: str, vi: str, en: str) -> None:
        """Learn an acronym from this meeting."""
        self.add(acronym, full_name, vi, en)

    def get_all(self) -> Dict[str, Tuple[str, str, str]]:
        return dict(self._table)
