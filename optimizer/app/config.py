from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Guia Turistica - Optimizer"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    valhalla_url: str = "http://localhost:8002"
    valhalla_timeout_segundos: float = 10.0

    class Config:
        env_file = ".env"

settings = Settings()

