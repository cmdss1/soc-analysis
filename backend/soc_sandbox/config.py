from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_host: str = "0.0.0.0"
    api_port: int = 8000

    cors_origins: str = "http://localhost:3000"

    # Full base URL of this API as reachable from Kasm workspace containers (no trailing slash).
    public_api_base: str = "http://host.docker.internal:8000"

    kasm_base_url: str = ""
    kasm_api_key: str = ""
    kasm_api_secret: str = ""
    kasm_image_id: str = ""
    kasm_user_id: str = ""

    # Set false if Kasm uses a private CA / self-signed cert (typical homelab).
    kasm_verify_tls: bool = True

    block_private_target_ips: bool = True

    mock_kasm: bool = False
    mock_kasm_viewer_url: str = ""

    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ingest_url(self) -> str:
        return f"{self.public_api_base.rstrip('/')}/api/v1/collector/ingest"


settings = Settings()
