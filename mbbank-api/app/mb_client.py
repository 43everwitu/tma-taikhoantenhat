from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from .config import load_settings


VIETNAM_TIME_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _format_utc_iso(value: datetime) -> str:
    utc_value = value.astimezone(timezone.utc).replace(microsecond=0)
    return utc_value.isoformat().replace("+00:00", "Z")


def normalize_bank_transaction_time(raw_value: Any) -> Optional[str]:
    if raw_value is None:
        return None

    value = str(raw_value).strip()
    if not value:
        return None

    for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            local_value = datetime.strptime(value, pattern).replace(
                tzinfo=VIETNAM_TIME_ZONE
            )
            return _format_utc_iso(local_value)
        except ValueError:
            pass

    try:
        iso_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if iso_value.tzinfo is None:
        return None
    return _format_utc_iso(iso_value)


class LoginRequest(BaseModel):
    username: str
    password: str
    captcha_text: Optional[str] = None


class TransactionsRequest(BaseModel):
    account_no: Optional[str] = None
    from_date: Optional[str] = None  # YYYY-MM-DD
    to_date: Optional[str] = None    # YYYY-MM-DD
    captcha_text: Optional[str] = None


class MBBankClient:
    def __init__(self) -> None:
        self._client = None
        self._logged_in = False
        self._settings = load_settings()

    def _ensure_lib(self):
        try:
            from mbbank import MBBank  # Using sync version like Discord bot
            return MBBank
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "mbbank-lib is not installed or failed to import") from exc

    def is_logged_in(self) -> bool:
        return self._logged_in and self._client is not None

    def login(self, username: str, password: str, captcha_text: Optional[str] = None) -> Dict[str, Any]:
        MBBank = self._ensure_lib()
        # Keep constructor kwargs for compatibility with newer versions.
        self._client = MBBank(username=username, password=password)

        # Newer mbbank-lib versions expose login(captcha_text).
        if captcha_text and hasattr(self._client, "login"):
            login_fn = getattr(self._client, "login")
            if callable(login_fn):
                login_fn(captcha_text)

        self._logged_in = True
        return {"success": True}

    def _parse_date(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        # Accept YYYY-MM-DD
        return datetime.strptime(date_str, "%Y-%m-%d")

    def get_credit_transactions(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        description_contains: Optional[str] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        limit: Optional[int] = None,
        sort_order: str = "desc",
    ) -> List[Dict[str, Any]]:
        """Get credit transactions (money in) with smart filtering."""
        if not self.is_logged_in():
            raise RuntimeError("Not logged in")

        # Default to last 7 days if no dates provided (like Discord bot)
        to_dt = self._parse_date(to_date) or datetime.now()
        from_dt = self._parse_date(from_date) or (to_dt - timedelta(days=7))

        try:
            all_transactions = self._get_transaction_history(from_dt, to_dt)
            if not all_transactions:
                return []

            # Process all transactions and filter credits
            standardized_transactions = []
            for tx in all_transactions:
                tx_dict = self._to_mapping(tx)
                if not tx_dict:
                    continue

                credit_amount = self._parse_amount(tx_dict.get('creditAmount'))

                if credit_amount > 0:  # Only credit transactions (IN)
                    standardized_transactions.append(
                        self._standardize_transaction(
                            tx, "IN", credit_amount
                        )
                    )

            # Apply smart filters
            filtered_transactions = self._apply_filters(
                standardized_transactions,
                description_contains=description_contains,
                min_amount=min_amount,
                max_amount=max_amount,
                limit=limit,
                sort_order=sort_order
            )

            return filtered_transactions

        except Exception as e:
            raise RuntimeError(f"Failed to get transactions: {e}")

    def get_all_transactions(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        description_contains: Optional[str] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        limit: Optional[int] = None,
        sort_order: str = "desc",
    ) -> List[Dict[str, Any]]:
        """Get all transactions (both credit and debit) with smart filtering."""
        if not self.is_logged_in():
            raise RuntimeError("Not logged in")

        # Default to last 7 days if no dates provided
        to_dt = self._parse_date(to_date) or datetime.now()
        from_dt = self._parse_date(from_date) or (to_dt - timedelta(days=7))

        try:
            all_transactions = self._get_transaction_history(from_dt, to_dt)
            if not all_transactions:
                return []

            # Process all transactions
            standardized_transactions = []
            for tx in all_transactions:
                tx_dict = self._to_mapping(tx)
                if not tx_dict:
                    continue

                credit_amount = self._parse_amount(
                    tx_dict.get('creditAmount'))
                debit_amount = self._parse_amount(tx_dict.get('debitAmount'))

                if credit_amount > 0:
                    standardized_transactions.append(
                        self._standardize_transaction(
                            tx, "IN", credit_amount
                        )
                    )
                elif debit_amount > 0:
                    standardized_transactions.append(
                        self._standardize_transaction(
                            tx, "OUT", debit_amount
                        )
                    )

            # Apply smart filters
            filtered_transactions = self._apply_filters(
                standardized_transactions,
                description_contains=description_contains,
                min_amount=min_amount,
                max_amount=max_amount,
                limit=limit,
                sort_order=sort_order
            )

            return filtered_transactions

        except Exception as e:
            raise RuntimeError(f"Failed to get transactions: {e}")

    def _get_transaction_history(self, from_dt: datetime, to_dt: datetime) -> List[Any]:
        attempts = max(1, self._settings.mb_request_max_retries)
        timeout_seconds = max(1, self._settings.mb_request_timeout_seconds)
        last_error: Optional[Exception] = None

        for attempt in range(attempts):
            try:
                response = self._call_with_timeout(
                    timeout_seconds,
                    self._client.getTransactionAccountHistory,
                    from_date=from_dt,
                    to_date=to_dt,
                )
                return self._extract_transaction_list(response)
            except Exception as exc:
                last_error = exc
                if attempt < attempts - 1:
                    time.sleep(0.3 * (attempt + 1))

        raise RuntimeError(f"Failed to fetch transaction history: {last_error}")

    def _call_with_timeout(self, timeout_seconds: int, fn, **kwargs):
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(fn, **kwargs)
            try:
                return future.result(timeout=timeout_seconds)
            except FutureTimeoutError as exc:
                raise RuntimeError(
                    f"MBBank upstream timeout after {timeout_seconds}s"
                ) from exc

    def _extract_transaction_list(self, response: Any) -> List[Any]:
        if not response:
            return []

        if hasattr(response, "transactionHistoryList"):
            raw_transactions = response.transactionHistoryList
            return raw_transactions if isinstance(raw_transactions, list) else []

        response_dict = self._to_mapping(response)
        raw_transactions = response_dict.get("transactionHistoryList")
        return raw_transactions if isinstance(raw_transactions, list) else []

    def _to_mapping(self, value: Any) -> Dict[str, Any]:
        if isinstance(value, dict):
            return value

        model_dump = getattr(value, "model_dump", None)
        if callable(model_dump):
            dumped = model_dump()
            if isinstance(dumped, dict):
                return dumped

        raw_dict = getattr(value, "__dict__", None)
        if isinstance(raw_dict, dict):
            return raw_dict

        return {}

    def _standardize_transaction(
        self,
        tx: Any,
        transaction_type: str,
        amount: float
    ) -> Dict[str, Any]:
        tx_dict = self._to_mapping(tx)
        transaction_date_raw = tx_dict.get("transactionDate")
        posting_date_raw = tx_dict.get("postingDate")
        source_time = transaction_date_raw or posting_date_raw

        return {
            "transactionNumber": tx_dict.get("refNo", ""),
            "amount": amount,
            "description": tx_dict.get("description", ""),
            "type": transaction_type,
            "transactionTime": normalize_bank_transaction_time(source_time),
            "transactionDateRaw": transaction_date_raw,
            "postingDateRaw": posting_date_raw,
        }

    def _parse_amount(self, amount: Any) -> float:
        if amount in (None, ""):
            return 0.0

        try:
            return float(amount)
        except (TypeError, ValueError):
            return 0.0

    def _apply_filters(
        self,
        transactions: List[Dict[str, Any]],
        description_contains: Optional[str] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        limit: Optional[int] = None,
        sort_order: str = "desc"
    ) -> List[Dict[str, Any]]:
        """Apply filters to transaction list."""
        filtered = transactions

        # Filter by description (case-insensitive)
        if description_contains:
            filtered = [
                tx for tx in filtered
                if description_contains.upper() in tx.get('description', '').upper()
            ]

        # Filter by minimum amount
        if min_amount is not None:
            filtered = [
                tx for tx in filtered
                if tx.get('amount', 0) >= min_amount
            ]

        # Filter by maximum amount
        if max_amount is not None:
            filtered = [
                tx for tx in filtered
                if tx.get('amount', 0) <= max_amount
            ]

        # Sort by amount
        if sort_order == "desc":
            filtered = sorted(filtered, key=lambda x: x.get(
                'amount', 0), reverse=True)
        else:
            filtered = sorted(filtered, key=lambda x: x.get('amount', 0))

        # Apply limit
        if limit is not None and limit > 0:
            filtered = filtered[:limit]

        return filtered


singleton_client = MBBankClient()
