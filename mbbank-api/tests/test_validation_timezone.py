import unittest
import sys
import types
from datetime import datetime as RealDateTime, timezone
from unittest.mock import patch

from pydantic import ValidationError


class DummyHTTPException(Exception):
    pass


fastapi_stub = types.ModuleType("fastapi")
fastapi_stub.HTTPException = DummyHTTPException


class DummyLogger:
    def warning(self, *args, **kwargs):
        pass


logger_stub = types.ModuleType("app.logger")
logger_stub.log_security_event = lambda *args, **kwargs: None
logger_stub.get_logger = lambda _name: DummyLogger()

missing_module = object()
previous_fastapi = sys.modules.get("fastapi", missing_module)
previous_logger = sys.modules.get("app.logger", missing_module)
previous_validation = sys.modules.get("app.validation", missing_module)
sys.modules["fastapi"] = fastapi_stub
sys.modules["app.logger"] = logger_stub
sys.modules.pop("app.validation", None)

try:
    from app.validation import SecureTransactionsRequest
finally:
    if previous_fastapi is missing_module:
        sys.modules.pop("fastapi", None)
    else:
        sys.modules["fastapi"] = previous_fastapi

    if previous_logger is missing_module:
        sys.modules.pop("app.logger", None)
    else:
        sys.modules["app.logger"] = previous_logger

    if previous_validation is missing_module:
        sys.modules.pop("app.validation", None)
    else:
        sys.modules["app.validation"] = previous_validation


class FrozenDateTime(RealDateTime):
    @classmethod
    def now(cls, tz=None):
        instant = RealDateTime(
            2026, 6, 21, 17, 30, tzinfo=timezone.utc
        )
        if tz is None:
            return instant.replace(tzinfo=None)
        return instant.astimezone(tz)


class ValidationTimezoneTest(unittest.TestCase):
    def test_accepts_current_vietnam_date_after_utc_midnight_boundary(self):
        with patch("app.validation.datetime", FrozenDateTime):
            request = SecureTransactionsRequest(
                from_date="2026-06-22",
                to_date="2026-06-22",
            )

        self.assertEqual(request.from_date, "2026-06-22")
        self.assertEqual(request.to_date, "2026-06-22")

    def test_rejects_date_after_current_vietnam_date(self):
        with patch("app.validation.datetime", FrozenDateTime):
            with self.assertRaises(ValidationError):
                SecureTransactionsRequest(
                    from_date="2026-06-23",
                    to_date="2026-06-23",
                )


if __name__ == "__main__":
    unittest.main()
