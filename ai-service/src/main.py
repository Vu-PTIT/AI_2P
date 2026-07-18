"""Main entry point — WebSocket server on ws://0.0.0.0:8765/ws/session.

realtime-service (AiBridgeService) connects here with:
  ws://host:8765/ws/session?sessionId=<id>&clientId=<id>

Path routing: accept any path (realtime-service hardcodes /ws/session).
"""
from __future__ import annotations

import asyncio
import logging
import signal

import websockets
from websockets.asyncio.server import ServerConnection

from src import config as cfg
from src.audio.processor import init_processor, get_processor
from src.session import SessionWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def handle_connection(ws: ServerConnection) -> None:
    """Spawn a SessionWorker for each incoming WS connection."""
    logger.info("New connection from %s", ws.remote_address)
    worker = SessionWorker(ws, get_processor())
    await worker.run()
    logger.info("Connection closed: %s", ws.remote_address)


async def main() -> None:
    logger.info("Initializing audio models (Silero VAD + DeepFilterNet) …")
    init_processor(vad_threshold=cfg.VAD_THRESHOLD)
    logger.info("Models ready.")

    loop = asyncio.get_running_loop()
    stop: asyncio.Future = loop.create_future()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set_result, None)
        except (NotImplementedError, RuntimeError):
            # Windows — fall back to KeyboardInterrupt
            pass

    async with websockets.asyncio.server.serve(
        handle_connection,
        cfg.WS_HOST,
        cfg.WS_PORT,
        max_size=10 * 1024 * 1024,  # 10 MB — accommodate large audio chunks
    ):
        logger.info(
            "AI worker listening on ws://%s:%d  (path: /ws/session)",
            cfg.WS_HOST,
            cfg.WS_PORT,
        )
        try:
            await stop
        except KeyboardInterrupt:
            pass

    logger.info("AI worker stopped.")


if __name__ == "__main__":
    asyncio.run(main())
