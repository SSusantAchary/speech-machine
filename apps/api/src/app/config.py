import json

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./local.db"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    environment: str = "development"
    cors_origins: str = "http://localhost:3000"
    max_upload_mb: int = 500
    redis_host: str = "localhost"
    redis_port: int = 6379
    storage_backend: str = "local"
    local_only_mode: bool = False
    local_admin_email: str = "admin@example.local"
    local_admin_password: str = ""
    storage_dir: str = "/data/storage"
    s3_endpoint: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str | None = None
    s3_region: str | None = None
    transcription_backend: str = "server"
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    mlx_audio_model: str = "mlx-community/parakeet-tdt-0.6b-v3"
    ollama_base_url: str = "http://127.0.0.1:11434"
    lmstudio_base_url: str = "http://127.0.0.1:1234/v1"
    llama_cpp_base_url: str = "http://127.0.0.1:8080"
    local_engine_timeout_seconds: float = 0.75
    coaching_enabled: bool = True
    coaching_provider: str = "ollama"
    coaching_model: str = "llama3.2:3b"
    coaching_timeout_seconds: float = 90
    coaching_max_transcript_chars: int = 8000

    class Config:
        env_prefix = ""
        case_sensitive = False

    @property
    def cors_origin_list(self) -> list[str]:
        value = self.cors_origins.strip()
        if value.startswith("["):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                return [str(origin).strip() for origin in parsed if str(origin).strip()]
        return [origin.strip() for origin in value.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def cookie_secure(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()
