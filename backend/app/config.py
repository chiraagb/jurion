from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = (
        "postgresql+asyncpg://lexi_user:secure_password@localhost:5432/jurion_db"
    )
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "secure_graph_password"
    REDIS_URL: str = "redis://localhost:6379/0"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"  # cheapest current Flash-Lite; gemini-2.5-flash(-lite) are retired (404) and gemini-3.8-flash often returns 503

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    ENCRYPTION_KEY: str = ""  # Fernet key encrypting API keys stored in Postgres; generate: python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

    GOOGLE_CLIENT_ID: str = ""
    ALLOWED_DOMAIN: str = ""  # e.g. "aviaralabs.com": only this Google Workspace domain may sign in; empty = any Google account
    COOKIE_SECURE: bool = False  # True behind HTTPS (Secure cookies are not sent over plain http)
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


settings = Settings()
