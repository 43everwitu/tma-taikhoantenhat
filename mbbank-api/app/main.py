from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from datetime import datetime
from .mb_client import singleton_client
from .config import load_settings
from .logger import setup_logging, log_business_event, log_security_event, get_logger
from .middleware import (
    logging_middleware,
    security_middleware,
    rate_limit_exceeded_handler,
    rate_limit,
    limiter
)
from .validation import (
    SecureLoginRequest,
    SecureTransactionsRequest,
    validate_request_data,
    check_injection_patterns
)

# Initialize logging
setup_logging()
logger = get_logger("api.main")

app = FastAPI(
    title="MBBank API",
    version="1.0.0",
    description="Secure MBBank Transaction API with rate limiting and logging"
)

settings = load_settings()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://subhub.vn",
        "http://subhub.vn",
        "https://www.subhub.vn",
        "http://www.subhub.vn",
        "https://subhubglobal.com",
        "https://www.subhubglobal.com",
    ],  # Adjust as needed
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Add custom middleware
app.middleware("http")(logging_middleware)
app.middleware("http")(security_middleware)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# Global exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with logging."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    # Log HTTP exceptions
    if exc.status_code >= 500:
        log_security_event(
            event_type="server_error",
            details={
                "status_code": exc.status_code,
                "detail": str(exc.detail),
                "path": request.url.path
            },
            client_ip=client_ip,
            severity="error"
        )
    elif exc.status_code >= 400:
        log_security_event(
            event_type="client_error",
            details={
                "status_code": exc.status_code,
                "detail": str(exc.detail),
                "path": request.url.path
            },
            client_ip=client_ip,
            severity="warning"
        )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "Request failed",
            "detail": exc.detail,
            "request_id": request_id,
            "timestamp": __import__('datetime').datetime.now().isoformat()
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    """Handle validation errors."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    log_security_event(
        event_type="validation_error",
        details={
            "errors": exc.errors(),
            "path": request.url.path
        },
        client_ip=client_ip,
        severity="warning"
    )

    return JSONResponse(
        status_code=422,
        content={
            "error": "Validation failed",
            "detail": "Invalid input format",
            "request_id": request_id,
            "timestamp": __import__('datetime').datetime.now().isoformat()
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, 'request_id', 'unknown')
    return JSONResponse(
        status_code=422,
        content={
            "error": "Validation failed",
            "detail": "Invalid request payload",
            "retryable": False,
            "request_id": request_id,
            "timestamp": datetime.now().isoformat(),
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    # Log unexpected errors
    logger.error(
        "Unexpected error",
        error=str(exc),
        error_type=type(exc).__name__,
        path=request.url.path,
        client_ip=client_ip,
        request_id=request_id
    )

    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": "An unexpected error occurred",
            "request_id": request_id,
            "timestamp": __import__('datetime').datetime.now().isoformat()
        },
        headers={"X-Request-ID": request_id}
    )

# Security scheme
security = HTTPBearer()


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str


class ErrorResponse(BaseModel):
    error: str
    detail: str
    request_id: str = None
    timestamp: str = None


def verify_token(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify the access token with security logging."""
    token = credentials.credentials
    client_ip = get_remote_address(request)

    if settings.require_api_token and not settings.api_access_token:
        logger.error("API access token is required but missing from configuration")
        raise HTTPException(
            status_code=503,
            detail="API authentication is not configured"
        )

    if token != settings.api_access_token:
        # Log failed authentication attempt
        log_security_event(
            event_type="invalid_token",
            details={"token_prefix": token[:8] +
                     "..." if len(token) > 8 else token},
            client_ip=client_ip,
            severity="warning"
        )

        raise HTTPException(
            status_code=401,
            detail="Invalid access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Log successful authentication
    log_business_event(
        event_type="token_verified",
        details={"client_ip": client_ip}
    )

    return token


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Health check endpoint with enhanced information."""
    from datetime import datetime

    return HealthResponse(
        status="ok",
        timestamp=datetime.now().isoformat(),
        version="1.0.0"
    )


@app.post("/login")
@rate_limit("20/minute")
def login(request: Request, payload: dict):
    """Secure login to MBBank with enhanced validation."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    try:
        # Validate input data
        validated_payload = validate_request_data(payload, SecureLoginRequest)

        # Check for injection attempts in raw payload
        for field, value in payload.items():
            if isinstance(value, str) and check_injection_patterns(value, field, client_ip):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid input detected"
                )

        # Log login attempt
        log_business_event(
            event_type="login_attempt",
            details={"username": validated_payload.username,
                     "client_ip": client_ip}
        )

        # Attempt login
        result = singleton_client.login(
            validated_payload.username,
            validated_payload.password,
            validated_payload.captcha_text
        )

        # Log successful login
        log_business_event(
            event_type="login_success",
            details={"username": validated_payload.username,
                     "client_ip": client_ip}
        )

        return JSONResponse({
            "success": True,
            "message": "Login successful",
            "retryable": False,
            "request_id": request_id
        })

    except ValidationError as e:
        log_security_event(
            event_type="validation_failed",
            details={"errors": str(e), "payload_keys": list(payload.keys())},
            client_ip=client_ip,
            severity="warning"
        )
        raise HTTPException(status_code=422, detail="Invalid input format")

    except HTTPException:
        raise

    except Exception as exc:
        # Log login failure
        log_business_event(
            event_type="login_failed",
            details={"error": str(exc), "client_ip": client_ip}
        )

        # Don't expose internal errors
        raise HTTPException(
            status_code=400,
            detail="Login failed. Please check your credentials."
        )


@app.post("/transactions/credit")
@rate_limit(f"{settings.rate_limit_requests}/minute")
def get_credit_transactions(
    request: Request,
    payload: dict,
    token: str = Depends(verify_token)
):
    """Get credit transactions with enhanced security and validation."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    try:
        # Validate input data
        validated_payload = validate_request_data(
            payload, SecureTransactionsRequest)

        # Check for injection attempts
        for field, value in payload.items():
            if isinstance(value, str) and check_injection_patterns(value, field, client_ip):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid input detected"
                )

        # Log transaction request
        log_business_event(
            event_type="credit_transactions_requested",
            details={
                "from_date": validated_payload.from_date,
                "to_date": validated_payload.to_date,
                "client_ip": client_ip
            }
        )

        # Check login status
        if not singleton_client.is_logged_in():
            if not settings.mb_username or not settings.mb_password:
                raise HTTPException(
                    status_code=401,
                    detail="Not logged in. Use /login endpoint first."
                )

            # Auto-login with env credentials
            logger.info("Attempting auto-login with environment credentials")
            login_res = singleton_client.login(
                settings.mb_username,
                settings.mb_password,
                validated_payload.captcha_text or settings.mb_captcha,
            )

            if not login_res.get("success"):
                log_business_event(
                    event_type="auto_login_failed",
                    details={"client_ip": client_ip}
                )
                raise HTTPException(
                    status_code=401,
                    detail="Authentication failed. Please login first."
                )

        # Get transactions with smart filters
        data = singleton_client.get_credit_transactions(
            from_date=validated_payload.from_date,
            to_date=validated_payload.to_date,
            description_contains=validated_payload.description_contains,
            min_amount=validated_payload.min_amount,
            max_amount=validated_payload.max_amount,
            limit=validated_payload.limit,
            sort_order=validated_payload.sort_order,
        )

        # Determine if filters were applied
        filters_applied = any([
            validated_payload.description_contains,
            validated_payload.min_amount is not None,
            validated_payload.max_amount is not None,
            validated_payload.limit is not None
        ])

        # Log successful transaction retrieval
        log_business_event(
            event_type="credit_transactions_retrieved",
            details={
                "count": len(data) if data else 0,
                "filtered": filters_applied,
                "client_ip": client_ip
            }
        )

        return JSONResponse({
            "success": True,
            "results": data,
            "count": len(data) if data else 0,
            "filtered": filters_applied,
            "date_range": {
                "from": validated_payload.from_date or __import__('datetime').datetime.now().strftime('%Y-%m-%d'),
                "to": validated_payload.to_date or __import__('datetime').datetime.now().strftime('%Y-%m-%d')
            },
            "retryable": False,
            "request_id": request_id
        })

    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid input format")

    except HTTPException:
        raise

    except Exception as exc:
        logger.error(f"Error getting credit transactions: {str(exc)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve transactions. Please try again later."
        )


@app.post("/transactions/all")
@rate_limit(f"{settings.rate_limit_requests}/minute")
def get_all_transactions(
    request: Request,
    payload: dict,
    token: str = Depends(verify_token)
):
    """Get all transactions with enhanced security and validation."""
    client_ip = get_remote_address(request)
    request_id = getattr(request.state, 'request_id', 'unknown')

    try:
        # Validate input data
        validated_payload = validate_request_data(
            payload, SecureTransactionsRequest)

        # Check for injection attempts
        for field, value in payload.items():
            if isinstance(value, str) and check_injection_patterns(value, field, client_ip):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid input detected"
                )

        # Log transaction request
        log_business_event(
            event_type="all_transactions_requested",
            details={
                "from_date": validated_payload.from_date,
                "to_date": validated_payload.to_date,
                "client_ip": client_ip
            }
        )

        # Check login status
        if not singleton_client.is_logged_in():
            if not settings.mb_username or not settings.mb_password:
                raise HTTPException(
                    status_code=401,
                    detail="Not logged in. Use /login endpoint first."
                )

            # Auto-login with env credentials
            logger.info("Attempting auto-login with environment credentials")
            login_res = singleton_client.login(
                settings.mb_username,
                settings.mb_password,
                validated_payload.captcha_text or settings.mb_captcha,
            )

            if not login_res.get("success"):
                log_business_event(
                    event_type="auto_login_failed",
                    details={"client_ip": client_ip}
                )
                raise HTTPException(
                    status_code=401,
                    detail="Authentication failed. Please login first."
                )

        # Get transactions with smart filters
        data = singleton_client.get_all_transactions(
            from_date=validated_payload.from_date,
            to_date=validated_payload.to_date,
            description_contains=validated_payload.description_contains,
            min_amount=validated_payload.min_amount,
            max_amount=validated_payload.max_amount,
            limit=validated_payload.limit,
            sort_order=validated_payload.sort_order,
        )

        # Determine if filters were applied
        filters_applied = any([
            validated_payload.description_contains,
            validated_payload.min_amount is not None,
            validated_payload.max_amount is not None,
            validated_payload.limit is not None
        ])

        # Log successful transaction retrieval
        log_business_event(
            event_type="all_transactions_retrieved",
            details={
                "count": len(data) if data else 0,
                "filtered": filters_applied,
                "client_ip": client_ip
            }
        )

        return JSONResponse({
            "success": True,
            "results": data,
            "count": len(data) if data else 0,
            "filtered": filters_applied,
            "date_range": {
                "from": validated_payload.from_date or __import__('datetime').datetime.now().strftime('%Y-%m-%d'),
                "to": validated_payload.to_date or __import__('datetime').datetime.now().strftime('%Y-%m-%d')
            },
            "retryable": False,
            "request_id": request_id
        })

    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid input format")

    except HTTPException:
        raise

    except Exception as exc:
        logger.error(f"Error getting all transactions: {str(exc)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve transactions. Please try again later."
        )


# Legacy endpoint for backward compatibility
@app.post("/transactions")
@rate_limit(f"{settings.rate_limit_requests}/minute")
def transactions(
    request: Request,
    payload: dict,
    token: str = Depends(verify_token)
):
    """Legacy endpoint - returns credit transactions by default."""
    return get_credit_transactions(request, payload, token)
