"""Shared model-loading errors."""


class ModelUnavailableError(RuntimeError):
    """Raised when a required real AI model or dependency is not configured."""
