import re
from datetime import datetime, timedelta
from typing import Optional, Any
from zoneinfo import ZoneInfo
from pydantic import BaseModel, Field, validator, ValidationError
from fastapi import HTTPException
from .logger import log_security_event, get_logger

logger = get_logger("validation")
VIETNAM_TIME_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def current_vietnam_date():
    return datetime.now(VIETNAM_TIME_ZONE).date()


class SecureLoginRequest(BaseModel):
    """Secure login request with validation."""
    username: str = Field(
        ...,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_.-]+$",
        description="Username (alphanumeric, underscore, dash, dot only)"
    )
    password: str = Field(
        ...,
        min_length=6,
        max_length=100,
        description="Password"
    )
    captcha_text: Optional[str] = Field(
        None,
        max_length=20,
        pattern=r"^[a-zA-Z0-9]+$",
        description="Captcha text (alphanumeric only)"
    )

    @validator('username')
    def validate_username(cls, v):
        """Validate username format."""
        if not v or len(v.strip()) == 0:
            raise ValueError('Username cannot be empty')

        # Check for SQL injection patterns
        sql_patterns = [
            r"(\bor\b|\band\b).*=.*",
            r"union.*select",
            r"insert.*into",
            r"delete.*from",
            r"drop.*table",
            r"--;",
            r"\/\*.*\*\/"
        ]

        v_lower = v.lower()
        for pattern in sql_patterns:
            if re.search(pattern, v_lower):
                logger.warning(
                    f"SQL injection attempt detected in username: {v}")
                raise ValueError('Invalid username format')

        return v.strip()

    @validator('password')
    def validate_password(cls, v):
        """Validate password."""
        if not v or len(v.strip()) == 0:
            raise ValueError('Password cannot be empty')

        # Check for common injection patterns
        dangerous_patterns = [
            r"<script.*?>",
            r"javascript:",
            r"vbscript:",
            r"onload\s*=",
            r"onerror\s*=",
            r"eval\s*\(",
            r"expression\s*\("
        ]

        v_lower = v.lower()
        for pattern in dangerous_patterns:
            if re.search(pattern, v_lower):
                logger.warning("XSS attempt detected in password field")
                raise ValueError('Invalid password format')

        return v


class SecureTransactionsRequest(BaseModel):
    """Secure transactions request with validation."""
    account_no: Optional[str] = Field(
        None,
        max_length=20,
        pattern=r"^[0-9]+$",
        description="Account number (digits only)"
    )
    from_date: Optional[str] = Field(
        None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Start date in YYYY-MM-DD format"
    )
    to_date: Optional[str] = Field(
        None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="End date in YYYY-MM-DD format"
    )
    captcha_text: Optional[str] = Field(
        None,
        max_length=20,
        pattern=r"^[a-zA-Z0-9]+$",
        description="Captcha text (alphanumeric only)"
    )

    # Smart filtering parameters
    description_contains: Optional[str] = Field(
        None,
        max_length=50,
        description="Filter transactions by description keyword (case-insensitive)"
    )
    min_amount: Optional[float] = Field(
        None,
        ge=0,
        description="Minimum transaction amount (inclusive)"
    )
    max_amount: Optional[float] = Field(
        None,
        ge=0,
        description="Maximum transaction amount (inclusive)"
    )
    limit: Optional[int] = Field(
        None,
        ge=1,
        le=1000,
        description="Maximum number of results to return (1-1000)"
    )
    sort_order: Optional[str] = Field(
        "desc",
        pattern=r"^(asc|desc)$",
        description="Sort order: 'asc' for ascending, 'desc' for descending"
    )
    poll_cursor: Optional[str] = Field(
        None,
        max_length=128,
        description="Client cursor for idempotent polling windows"
    )

    @validator('from_date')
    def validate_from_date(cls, v):
        """Validate from_date."""
        if v is None:
            return v

        try:
            date_obj = datetime.strptime(v, "%Y-%m-%d").date()
            today = current_vietnam_date()

            # Check if date is not too far in the past (max 2 years)
            two_years_ago = today - timedelta(days=730)
            if date_obj < two_years_ago:
                raise ValueError('From date cannot be more than 2 years ago')

            # Check if date is not in the future
            if date_obj > today:
                raise ValueError('From date cannot be in the future')

            return v

        except ValueError as e:
            if "time data" in str(e):
                raise ValueError('Invalid date format. Use YYYY-MM-DD')
            raise e

    @validator('to_date')
    def validate_to_date(cls, v):
        """Validate to_date."""
        if v is None:
            return v

        try:
            date_obj = datetime.strptime(v, "%Y-%m-%d").date()

            # Check if date is not in the future
            if date_obj > current_vietnam_date():
                raise ValueError('To date cannot be in the future')

            return v

        except ValueError as e:
            if "time data" in str(e):
                raise ValueError('Invalid date format. Use YYYY-MM-DD')
            raise e

    @validator('to_date')
    def validate_date_range(cls, v, values):
        """Validate date range."""
        if v is None or 'from_date' not in values or values['from_date'] is None:
            return v

        from_date = datetime.strptime(values['from_date'], "%Y-%m-%d").date()
        to_date = datetime.strptime(v, "%Y-%m-%d").date()

        # Check if from_date is before to_date
        if from_date > to_date:
            raise ValueError('From date must be before to date')

        # Check if date range is reasonable (max 1 year)
        if (to_date - from_date).days > 365:
            raise ValueError('Date range cannot exceed 365 days')

        return v

    @validator('description_contains')
    def validate_description_contains(cls, v):
        """Validate description_contains filter."""
        if v is None:
            return v

        # Trim whitespace
        v = v.strip()

        if len(v) == 0:
            return None

        # Check for SQL injection patterns
        dangerous_patterns = [
            r"';",
            r"--",
            r"/\*",
            r"\*/",
            r"union.*select",
            r"drop.*table"
        ]

        v_lower = v.lower()
        for pattern in dangerous_patterns:
            if re.search(pattern, v_lower):
                logger.warning(
                    f"Potential SQL injection in description_contains: {v}")
                raise ValueError('Invalid characters in description filter')

        return v

    @validator('max_amount')
    def validate_max_amount(cls, v, values):
        """Validate max_amount is greater than min_amount."""
        if v is None:
            return v

        if 'min_amount' in values and values['min_amount'] is not None:
            if v < values['min_amount']:
                raise ValueError(
                    'Maximum amount must be greater than or equal to minimum amount')

        return v

    @validator('account_no')
    def validate_account_no(cls, v):
        """Validate account number."""
        if v is None:
            return v

        # Remove any whitespace
        v = v.strip()

        if len(v) == 0:
            return None

        # Check length
        if len(v) < 6 or len(v) > 20:
            raise ValueError('Account number must be between 6 and 20 digits')

        return v


def validate_request_data(data: Any, expected_model: BaseModel) -> BaseModel:
    """Validate request data against expected model."""
    try:
        return expected_model(**data) if isinstance(data, dict) else expected_model.parse_obj(data)

    except ValidationError as e:
        # Log validation failure
        logger.warning(
            "Validation failed",
            errors=e.errors(),
            data_type=expected_model.__name__
        )

        # Extract field errors
        field_errors = []
        for error in e.errors():
            field_name = ".".join(str(x) for x in error["loc"])
            field_errors.append(f"{field_name}: {error['msg']}")

        raise HTTPException(
            status_code=422,
            detail={
                "error": "Validation failed",
                "fields": field_errors
            }
        )


def sanitize_string(value: str, max_length: int = 500) -> str:
    """Sanitize string input."""
    if not value:
        return ""

    # Truncate if too long
    if len(value) > max_length:
        value = value[:max_length]

    # Remove potentially dangerous characters
    # Keep only alphanumeric, spaces, and safe punctuation
    safe_chars = re.sub(r'[^\w\s\-.,@:/()\[\]{}]', '', value)

    return safe_chars.strip()


def check_injection_patterns(value: str, field_name: str, client_ip: str = None) -> bool:
    """Check for common injection patterns."""
    if not value:
        return False

    # SQL injection patterns
    sql_patterns = [
        r"(\bor\b|\band\b).*=.*",
        r"union.*select",
        r"insert.*into",
        r"delete.*from",
        r"drop.*table",
        r"--;",
        r"\/\*.*\*\/",
        r"'.*'",
        r'".*"'
    ]

    # XSS patterns
    xss_patterns = [
        r"<script.*?>",
        r"javascript:",
        r"vbscript:",
        r"onload\s*=",
        r"onerror\s*=",
        r"onclick\s*=",
        r"eval\s*\(",
        r"expression\s*\("
    ]

    # Path traversal patterns
    path_patterns = [
        r"\.\./",
        r"\.\.\\",
        r"/etc/",
        r"\\windows\\",
        r"cmd\.exe",
        r"powershell"
    ]

    value_lower = value.lower()

    # Check all patterns
    all_patterns = sql_patterns + xss_patterns + path_patterns

    for pattern in all_patterns:
        if re.search(pattern, value_lower):
            # Log security event
            log_security_event(
                event_type="injection_attempt",
                details={
                    "field": field_name,
                    "pattern": pattern,
                    "value": value[:100]  # Log first 100 chars only
                },
                client_ip=client_ip or "unknown",
                severity="critical"
            )
            return True

    return False
