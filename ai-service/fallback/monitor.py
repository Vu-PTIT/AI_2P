"""Health monitor and graceful degradation levels for the AI pipeline."""

from dataclasses import dataclass
from enum import IntEnum


class FallbackLevel(IntEnum):
    NORMAL = 0
    REDUCE_CONTEXT = 1
    FAST_PATH_ONLY = 2
    OFFLINE_MODE = 3
    RAW_TRANSCRIPT = 4


@dataclass
class HealthStatus:
    """Current pipeline health."""

    level: FallbackLevel = FallbackLevel.NORMAL
    consecutive_timeouts: int = 0
    gpu_available: bool = True
    network_ok: bool = True
    mic_ok: bool = True


class HealthMonitor:
    """Track failures and choose the fallback level."""

    TIMEOUT_THRESHOLD = 3

    def __init__(self):
        self.status = HealthStatus()

    def report_timeout(self) -> FallbackLevel:
        self.status.consecutive_timeouts += 1
        if self.status.consecutive_timeouts >= self.TIMEOUT_THRESHOLD:
            self.status.level = FallbackLevel.FAST_PATH_ONLY
        elif self.status.consecutive_timeouts >= 1:
            self.status.level = FallbackLevel.REDUCE_CONTEXT
        return self.status.level

    def report_success(self) -> None:
        self.status.consecutive_timeouts = 0
        self.status.network_ok = True
        if self.status.level in (FallbackLevel.REDUCE_CONTEXT, FallbackLevel.FAST_PATH_ONLY):
            self.status.level = FallbackLevel.NORMAL

    def report_network_loss(self) -> FallbackLevel:
        self.status.network_ok = False
        self.status.level = FallbackLevel.OFFLINE_MODE
        return self.status.level

    def report_gpu_failure(self) -> FallbackLevel:
        self.status.gpu_available = False
        self.status.level = FallbackLevel.FAST_PATH_ONLY
        return self.status.level

    def report_mic_loss(self) -> FallbackLevel:
        self.status.mic_ok = False
        if self.status.level < FallbackLevel.REDUCE_CONTEXT:
            self.status.level = FallbackLevel.REDUCE_CONTEXT
        return self.status.level

    def report_mic_ok(self) -> None:
        self.status.mic_ok = True
        if self.status.level == FallbackLevel.REDUCE_CONTEXT and self.status.consecutive_timeouts == 0:
            self.status.level = FallbackLevel.NORMAL

    def report_critical_failure(self) -> FallbackLevel:
        self.status.level = FallbackLevel.RAW_TRANSCRIPT
        return self.status.level

    def get_level(self) -> FallbackLevel:
        return self.status.level
