import logging
import sys
from typing import Any, Dict
import structlog
from pythonjsonlogger import jsonlogger
from .config import load_settings

settings = load_settings()


def setup_logging() -> None:
    """Setup structured logging configuration."""

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Configure standard logging
    if settings.log_format == "json":
        formatter = jsonlogger.JsonFormatter(
            '%(asctime)s %(name)s %(levelname)s %(message)s'
        )
    else:
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    # Set log level
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    # Configure root logger
    logging.basicConfig(
        level=log_level,
        handlers=[handler],
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Configure uvicorn logger
    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.handlers = [handler]
    uvicorn_logger.setLevel(log_level)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)


def log_request(request_id: str, method: str, path: str,
                client_ip: str, user_agent: str = None) -> None:
    """Log incoming request."""
    logger = get_logger("api.request")
    logger.info(
        "Request received",
        request_id=request_id,
        method=method,
        path=path,
        client_ip=client_ip,
        user_agent=user_agent
    )


def log_response(request_id: str, status_code: int,
                 response_time: float, error: str = None) -> None:
    """Log response."""
    logger = get_logger("api.response")

    if error:
        logger.error(
            "Request failed",
            request_id=request_id,
            status_code=status_code,
            response_time=response_time,
            error=error
        )
    else:
        logger.info(
            "Request completed",
            request_id=request_id,
            status_code=status_code,
            response_time=response_time
        )


def log_security_event(event_type: str, details: Dict[str, Any],
                       client_ip: str, severity: str = "warning") -> None:
    """Log security events."""
    logger = get_logger("security")

    log_func = getattr(logger, severity.lower(), logger.warning)
    log_func(
        "Security event",
        event_type=event_type,
        client_ip=client_ip,
        **details
    )


def log_business_event(event_type: str, details: Dict[str, Any]) -> None:
    """Log business logic events."""
    logger = get_logger("business")
    logger.info(
        "Business event",
        event_type=event_type,
        **details
    )
