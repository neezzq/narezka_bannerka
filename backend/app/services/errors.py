from __future__ import annotations


class UserError(Exception):
    """An error whose message (in Russian) can be shown to the user as is."""

    def __init__(self, message: str, code: str = "error", status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
