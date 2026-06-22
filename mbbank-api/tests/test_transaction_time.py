import unittest

from app.mb_client import MBBankClient, normalize_bank_transaction_time


class FakeTransaction:
    def __init__(self, transaction_date="22/06/2026 04:30:12"):
        self.transaction_date = transaction_date

    def model_dump(self):
        return {
            "refNo": "FT_TEST",
            "creditAmount": "432000",
            "description": "9PAY",
            "transactionDate": self.transaction_date,
            "postingDate": "22/06/2026 04:30:14",
        }


class NormalizeBankTransactionTimeTest(unittest.TestCase):
    def test_converts_vietnam_seconds_to_utc(self):
        self.assertEqual(
            normalize_bank_transaction_time("22/06/2026 04:30:12"),
            "2026-06-21T21:30:12Z",
        )

    def test_accepts_vietnam_minutes(self):
        self.assertEqual(
            normalize_bank_transaction_time("22/06/2026 04:30"),
            "2026-06-21T21:30:00Z",
        )

    def test_preserves_iso_instant(self):
        self.assertEqual(
            normalize_bank_transaction_time("2026-06-22T04:30:12+07:00"),
            "2026-06-21T21:30:12Z",
        )

    def test_rejects_date_without_time(self):
        self.assertIsNone(normalize_bank_transaction_time("22/06/2026"))

    def test_rejects_invalid_or_naive_iso_value(self):
        self.assertIsNone(normalize_bank_transaction_time("khong-hop-le"))
        self.assertIsNone(
            normalize_bank_transaction_time("2026-06-22T04:30:12")
        )

    def test_standardizes_raw_and_utc_fields(self):
        client = MBBankClient()

        result = client._standardize_transaction(
            FakeTransaction(), "IN", 432000
        )

        self.assertEqual(result["transactionNumber"], "FT_TEST")
        self.assertEqual(result["amount"], 432000)
        self.assertEqual(result["description"], "9PAY")
        self.assertEqual(result["type"], "IN")
        self.assertEqual(result["transactionTime"], "2026-06-21T21:30:12Z")
        self.assertEqual(
            result["transactionDateRaw"], "22/06/2026 04:30:12"
        )
        self.assertEqual(result["postingDateRaw"], "22/06/2026 04:30:14")

        fallback_result = client._standardize_transaction(
            FakeTransaction(transaction_date=""), "IN", 432000
        )
        self.assertEqual(
            fallback_result["transactionTime"], "2026-06-21T21:30:14Z"
        )


if __name__ == "__main__":
    unittest.main()
