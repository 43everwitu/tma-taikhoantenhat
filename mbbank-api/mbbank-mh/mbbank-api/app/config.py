from pydantic import BaseModel
import os
from dotenv import load_dotenv

# Load .env if present
load_dotenv()


class Settings(BaseModel):
    mb_username: str | None = None
    mb_password: str | None = None
    mb_captcha: str | None = None
    api_access_token: str | None = None
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


def load_settings() -> Settings:
    return Settings(
        mb_username=os.getenv("MB_USERNAME"),
        mb_password=os.getenv("MB_PASSWORD"),
        mb_captcha=os.getenv("MB_CAPTCHA"),
        api_access_token=os.getenv("API_ACCESS_TOKEN"),
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
    )
