import time
import uuid
from typing import Callable
from fastapi import Request, Response, HTTPException
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import redis
from .config import load_settings
from .logger import log_request, log_response, log_security_event

settings = load_settings()

# Initialize Redis connection for rate limiting
try:
    redis_client = redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        decode_responses=True
    )
    # Test connection
    redis_client.ping()
    REDIS_AVAILABLE = True
except Exception:
    redis_client = None
    REDIS_AVAILABLE = False

# Initialize rate limiter
if REDIS_AVAILABLE:
    limiter = Limiter(
        key_func=get_remote_address,
        storage_uri=f"redis://{settings.redis_host}:{settings.redis_port}/{settings.redis_db}"
    )
else:
    # Fallback to memory-based rate limiting
    limiter = Limiter(key_func=get_remote_address)


async def logging_middleware(request: Request, call_next: Callable) -> Response:
    """Middleware for request/response logging."""
    # Generate unique request ID
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id

    # Get client information
    client_ip = get_remote_address(request)
    user_agent = request.headers.get("user-agent", "")

    # Log incoming request
    log_request(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        client_ip=client_ip,
        user_agent=user_agent
    )

    # Record start time
    start_time = time.time()

    try:
        # Process request
        response = await call_next(request)

        # Calculate response time
        response_time = time.time() - start_time

        # Log successful response
        log_response(
            request_id=request_id,
            status_code=response.status_code,
            response_time=response_time
        )

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        return response

    except Exception as exc:
        # Calculate response time
        response_time = time.time() - start_time

        # Log error response
        log_response(
            request_id=request_id,
            status_code=500,
            response_time=response_time,
            error=str(exc)
        )

        # Log security event for unexpected errors
        log_security_event(
            event_type="unexpected_error",
            details={"error": str(exc), "path": request.url.path},
            client_ip=client_ip,
            severity="error"
        )

        # Return generic error response
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "request_id": request_id
            },
            headers={"X-Request-ID": request_id}
        )


async def security_middleware(request: Request, call_next: Callable) -> Response:
    """Middleware for security checks."""
    client_ip = get_remote_address(request)

    # Check for suspicious patterns
    suspicious_patterns = [
        "admin", "sql", "script", "javascript:", "vbscript:",
        "onload", "onerror", "onclick", "<script", "</script>",
        "union", "select", "insert", "delete", "drop", "create",
        "../", "..\\", "/etc/", "\\windows\\", "cmd.exe"
    ]

    # Check URL path
    path_lower = request.url.path.lower()
    for pattern in suspicious_patterns:
        if pattern in path_lower:
            log_security_event(
                event_type="suspicious_path",
                details={"path": request.url.path, "pattern": pattern},
                client_ip=client_ip,
                severity="warning"
            )
            break

    # Check query parameters
    if request.url.query:
        query_lower = request.url.query.lower()
        for pattern in suspicious_patterns:
            if pattern in query_lower:
                log_security_event(
                    event_type="suspicious_query",
                    details={"query": request.url.query, "pattern": pattern},
                    client_ip=client_ip,
                    severity="warning"
                )
                break

    # Check User-Agent for known bad bots
    user_agent = request.headers.get("user-agent", "").lower()
    bad_bots = ["sqlmap", "nikto", "nmap", "nessus", "openvas", "w3af"]

    for bot in bad_bots:
        if bot in user_agent:
            log_security_event(
                event_type="malicious_bot",
                details={"user_agent": user_agent, "bot": bot},
                client_ip=client_ip,
                severity="critical"
            )
            return JSONResponse(
                status_code=403,
                content={"error": "Access denied"}
            )

    # Continue with request
    return await call_next(request)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom rate limit exceeded handler."""
    client_ip = get_remote_address(request)

    # Log rate limit violation
    log_security_event(
        event_type="rate_limit_exceeded",
        details={
            "path": request.url.path,
            "limit": str(exc.detail),
            "retry_after": exc.retry_after
        },
        client_ip=client_ip,
        severity="warning"
    )

    return JSONResponse(
        status_code=429,
        content={
            "error": "Rate limit exceeded",
            "detail": "Too many requests",
            "retry_after": exc.retry_after
        },
        headers={"Retry-After": str(exc.retry_after)}
    )


# Rate limiting decorator
def rate_limit(rate: str):
    """Rate limiting decorator."""
    return limiter.limit(rate)
