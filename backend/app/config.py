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
    GEMINI_MODEL: str = "gemini-3.8-flash"  # the API rejected gemini-2.5-flash for new users and suggested this one

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    ENCRYPTION_KEY: str = ""  # Fernet key encrypting API keys stored in Postgres; generate: python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


settings = Settings()
