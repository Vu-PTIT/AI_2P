"""Deployment configuration for the AI worker."""

from config.fpt_models import MODELS as FPT


class DeploymentConfig:
    """Choose tier and language pair before the pipeline starts."""

    def __init__(self, tier: str = "server", lang_pair: str = "vi-en"):
        assert tier in ("edge", "server"), f"Unknown tier: {tier}"
        assert lang_pair, "lang_pair is required"
        self.tier = tier
        self.lang_pair = lang_pair

    def get_model_map(self) -> dict:
        defaults = {
            "edge": {
                "asr": "whisper-small",
                "fast_translation": "nllb-600m-distilled",
                "quality_translation": "local-llm-7b-int4",
                "embedding": "sentence-transformers/all-MiniLM-L6-v2",
            },
            "server": {
                "asr": FPT["asr"],
                "fast_translation": "nllb-3.3b",
                "quality_translation": FPT["quality_llm"],
                "embedding": FPT["embedding"],
                "reranker": FPT["reranker"],
            },
        }
        return {
            "tier": self.tier,
            "lang_pair": self.lang_pair,
            **defaults[self.tier],
        }
