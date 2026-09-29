from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Guia Turistica - Optimizer"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"

settings = Settings()


