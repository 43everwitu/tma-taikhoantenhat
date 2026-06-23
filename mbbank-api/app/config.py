from pathlib import Path
from pydantic import BaseModel
import os
from dotenv import load_dotenv

# Single source of truth: load repo-root .env. Fall back to local .env if
# someone still keeps mbbank-api/.env for isolated runs.
_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
if _ROOT_ENV.is_file():
    load_dotenv(_ROOT_ENV)
else:
    load_dotenv()


class Settings(BaseModel):
    mb_username: str | None = None
    mb_password: str | None = None
    mb_captcha: str | None = None
    api_access_token: str | None = None
    require_api_token: bool = True
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Rate limiting settings
    rate_limit_requests: int = 60  # requests per minute
    rate_limit_period: int = 60  # seconds

    # Redis settings for rate limiting
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    # Logging settings
    log_level: str = "INFO"
    log_format: str = "json"
    mb_request_timeout_seconds: int = 20
    mb_request_max_retries: int = 2


def load_settings() -> Settings:
    return Settings(
        mb_username=os.getenv("MB_USERNAME"),
        mb_password=os.getenv("MB_PASSWORD"),
        mb_captcha=os.getenv("MB_CAPTCHA"),
        api_access_token=os.getenv("API_ACCESS_TOKEN") or os.getenv("MBBANK_API_TOKEN"),
        require_api_token=os.getenv("REQUIRE_API_TOKEN", "true").lower() in {"1", "true", "yes"},
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"},

        # Rate limiting
        rate_limit_requests=int(os.getenv("RATE_LIMIT_REQUESTS", "60")),
        rate_limit_period=int(os.getenv("RATE_LIMIT_PERIOD", "60")),

        # Redis
        redis_host=os.getenv("REDIS_HOST", "localhost"),
        redis_port=int(os.getenv("REDIS_PORT", "6379")),
        redis_db=int(os.getenv("REDIS_DB", "0")),

        # Logging
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        log_format=os.getenv("LOG_FORMAT", "json"),
        mb_request_timeout_seconds=int(os.getenv("MB_REQUEST_TIMEOUT_SECONDS", "20")),
        mb_request_max_retries=int(os.getenv("MB_REQUEST_MAX_RETRIES", "2")),
    )
