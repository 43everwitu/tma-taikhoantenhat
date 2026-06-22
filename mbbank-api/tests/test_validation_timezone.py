import unittest
import sys
import types
from datetime import datetime as RealDateTime, timezone
from unittest.mock import patch


class DummyHTTPException(Exception):
    pass


fastapi_stub = types.ModuleType("fastapi")
fastapi_stub.HTTPException = DummyHTTPException
sys.modules.setdefault("fastapi", fastapi_stub)


class DummyLogger:
    def warning(self, *args, **kwargs):
        pass


logger_stub = types.ModuleType("app.logger")
logger_stub.log_security_event = lambda *args, **kwargs: None
logger_stub.get_logger = lambda _name: DummyLogger()
sys.modules.setdefault("app.logger", logger_stub)

from app.validation import SecureTransactionsRequest


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


if __name__ == "__main__":
    unittest.main()
