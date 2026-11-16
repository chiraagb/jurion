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
    ASK_SESSION_TOKENS: int = 16_000  # one chat session's context budget (the model's window is 128k, but answers get worse long before that); a full session asks you to start a new one
    ASK_MODEL: str = "gpt-4o-mini"  # grades retrieved clauses, rewrites questions, writes answers on the Ask tab

    ASK_DEFAULT_MODE: str = "workflow"  # "agent" or "workflow": what Ask uses when the request does not say. Flipped to agent only after tests.eval_answers shows it holds up (docs/specs/agentic-ask.md)
    AGENT_MODEL: str = "openai:gpt-4o-mini"  # "provider:model" for the agent (LangChain init_chat_model); any allow-listed provider works with no code change
    AGENT_ANSWER_MODEL: str = ""  # empty = same as AGENT_MODEL
    AGENT_ALLOWED_MODELS: list[str] = ["openai:gpt-4o-mini", "openai:gpt-4o", "anthropic:claude-sonnet-5-5", "anthropic:claude-haiku-5-5", "google_genai:gemini-3.5-flash-lite"]
    AGENT_MAX_STEPS: int = 6  # model turns in one investigation
    AGENT_MAX_TOOL_CALLS: int = 10
    AGENT_MAX_TOKENS: int = 20_000  # tokens (estimated) the investigation may use before it must answer

    ENCRYPTION_KEY: str = ""  # Fernet key encrypting API keys stored in Postgres; generate: python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

    GOOGLE_CLIENT_ID: str = ""
    ALLOWED_DOMAIN: str = ""  # e.g. "aviaralabs.com": only this Google Workspace domain may sign in; empty = any Google account
    COOKIE_SECURE: bool = False  # True behind HTTPS (Secure cookies are not sent over plain http)
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    MAX_PAGES: int = 300  # longer PDFs are refused
    PARSE_TIMEOUT_S: int = 45  # a PDF read that takes longer is killed
    PARSE_WORKERS: int = 2  # PDF-reading worker processes
    OCR_MAX_PAGES: int = 20  # a scanned PDF with more scanned pages than this is not OCR-ed here (slow): it goes whole to the AI instead
    OCR_DPI: int = 150  # resolution the pages are rendered at for OCR

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


settings = Settings()
