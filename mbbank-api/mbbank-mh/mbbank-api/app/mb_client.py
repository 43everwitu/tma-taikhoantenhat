from __future__ import annotations

import base64
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


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
        # Initialize MB Bank client like Discord bot
        self._client = MBBank(username=username, password=password)
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
            # Use the same method as Discord bot
            response = self._client.getTransactionAccountHistory(
                from_date=from_dt, to_date=to_dt)

            if not response:
                return []

            # Handle response object (not dict)
            if hasattr(response, 'transactionHistoryList'):
                all_transactions = response.transactionHistoryList
            elif isinstance(response, dict) and 'transactionHistoryList' in response:
                all_transactions = response['transactionHistoryList']
            else:
                return []

            # Convert transaction objects to standardized format
            def tx_to_standard(tx):
                # Convert object to dict first
                if hasattr(tx, '__dict__'):
                    tx_dict = tx.__dict__
                elif isinstance(tx, dict):
                    tx_dict = tx
                else:
                    return None

                # Convert to standard format matching the image example
                credit_amount = float(tx_dict.get('creditAmount', '0'))
                debit_amount = float(tx_dict.get('debitAmount', '0'))

                return {
                    "transactionNumber": tx_dict.get('refNo', ''),
                    "amount": credit_amount,  # Only return credit amount for IN transactions
                    "description": tx_dict.get('description', ''),
                    "type": "IN"  # This method only returns credit transactions
                }

            # Process all transactions and filter credits
            standardized_transactions = []
            for tx in all_transactions:
                # Convert object to dict first
                if hasattr(tx, '__dict__'):
                    tx_dict = tx.__dict__
                elif isinstance(tx, dict):
                    tx_dict = tx
                else:
                    continue

                credit_amount = float(tx_dict.get('creditAmount', '0'))

                if credit_amount > 0:  # Only credit transactions (IN)
                    std_tx = tx_to_standard(tx)
                    if std_tx:
                        standardized_transactions.append(std_tx)

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
            response = self._client.getTransactionAccountHistory(
                from_date=from_dt, to_date=to_dt)

            if not response:
                return []

            # Handle response object (not dict)
            if hasattr(response, 'transactionHistoryList'):
                all_transactions = response.transactionHistoryList
            elif isinstance(response, dict) and 'transactionHistoryList' in response:
                all_transactions = response['transactionHistoryList']
            else:
                return []

            # Convert transaction objects to standardized format
            def tx_to_standard(tx):
                # Convert object to dict first
                if hasattr(tx, '__dict__'):
                    tx_dict = tx.__dict__
                elif isinstance(tx, dict):
                    tx_dict = tx
                else:
                    return None

                # Convert to standard format matching the image example
                credit_amount = float(tx_dict.get('creditAmount', '0'))
                debit_amount = float(tx_dict.get('debitAmount', '0'))

                # Determine transaction type and amount based on MBBank logic
                if credit_amount > 0:
                    # Credit transaction = money IN
                    return {
                        "transactionNumber": tx_dict.get('refNo', ''),
                        "amount": credit_amount,
                        "description": tx_dict.get('description', ''),
                        "type": "IN"
                    }
                elif debit_amount > 0:
                    # Debit transaction = money OUT
                    return {
                        "transactionNumber": tx_dict.get('refNo', ''),
                        "amount": debit_amount,
                        "description": tx_dict.get('description', ''),
                        "type": "OUT"
                    }
                else:
                    # No amount, skip this transaction
                    return None

            # Process all transactions
            standardized_transactions = []
            for tx in all_transactions:
                std_tx = tx_to_standard(tx)
                if std_tx:
                    standardized_transactions.append(std_tx)

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
