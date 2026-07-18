"""AI worker entrypoint for the real-time VI-EN meeting translator."""

import argparse
import asyncio

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency in local dev
    load_dotenv = None

if load_dotenv:
    load_dotenv()

from asr.engine import ASREngine
from asr.revision import RevisionHandler
from audio.pipeline import AudioPipeline
from config.acronym import AcronymResolver
from config.deployment import DeploymentConfig
from config.glossary import GlossaryManager
from fallback.monitor import HealthMonitor
from rag.engine import RAGEngine
from session.memory import SessionManager
from translation.fast_path import FastPathTranslator
from translation.quality_path import QualityPathTranslator
from worker import run_server


def build_pipeline(tier: str = "server", lang_pair: str = "vi-en") -> dict:
    config = DeploymentConfig(tier=tier, lang_pair=lang_pair)
    return {
        "config": config,
        "model_map": config.get_model_map(),
        "glossary": GlossaryManager(lang_pair=lang_pair),
        "acronym": AcronymResolver(),
        "rag": RAGEngine(),
        "audio": AudioPipeline(tier=config.tier),
        "asr": ASREngine(tier=config.tier),
        "revision": RevisionHandler(),
        "fast": FastPathTranslator(tier=config.tier),
        "quality": QualityPathTranslator(tier=config.tier),
        "monitor": HealthMonitor(),
        "session": SessionManager(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--check", action="store_true", help="initialize modules and exit")
    parser.add_argument("--ingest-doc", action="append", default=[], help="ingest a document into local RAG")
    args = parser.parse_args()

    pipeline = build_pipeline()
    if args.ingest_doc:
        total = 0
        for path in args.ingest_doc:
            total += pipeline["rag"].ingest_document(path)
        print(f"Ingested {total} document chunks.")
        return

    if args.check:
        config = pipeline["config"]
        print(f"Pipeline initialized: tier={config.tier}, lang={config.lang_pair}")
        print("All modules loaded.")
        return

    asyncio.run(run_server(args.host, args.port))


if __name__ == "__main__":
    main()
