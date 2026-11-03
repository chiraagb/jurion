import uuid
from typing import AsyncGenerator
from sqlalchemy import Float, ForeignKey, Integer, LargeBinary, String, Text, DateTime, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from pgvector.sqlalchemy import Vector
from neo4j import AsyncGraphDatabase, AsyncDriver
import redis.asyncio as aioredis
from app.config import settings


# 1. Base ORM Model
class Base(DeclarativeBase):
    pass


# 2. PostgreSQL + pgvector Model for Contract Chunks
class ContractChunk(Base):
    __tablename__ = "contract_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(index=True)
    clause_identifier: Mapped[str] = mapped_column(String(64), index=True)
    content: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(1536))
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index(
            "ix_contract_chunks_embedding_hnsw",
            embedding,
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


# 2a. Users, created on first Google sign-in
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    google_sub: Mapped[str] = mapped_column(String(64), unique=True)  # Google's stable account id; email can change
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200), default="")
    picture: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# 2b. Encrypted LLM provider keys, one per user and provider
class LlmApiKey(Base):
    __tablename__ = "llm_api_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(16), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text)  # Fernet token; the plaintext key is never stored
    hint: Mapped[str] = mapped_column(String(32))  # "sk-…a1b2", safe to show in the UI
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# 2c. A saved contract and its parsed clauses
class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer)
    pages: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(16))  # local | gemini | openai
    total_ms: Mapped[float] = mapped_column(Float, default=0)
    confidence = mapped_column(JSONB, nullable=True)  # {score, coverage, numbering, titled}; null for LLM parses
    # ponytail: PDF kept as bytea (<=25 MB, deferred so list queries skip it); move to S3/disk storage when volume grows
    pdf = deferred(mapped_column(LargeBinary))
    # Full text in reading order: [{t: text, p: page, x, y, y1, s: font size, b: bold, tb?: table}]. Null for contracts
    # saved before this existed and for scans with no text layer. Clauses are line ranges over it.
    lines = deferred(mapped_column(JSONB, nullable=True))
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Clause(Base):
    __tablename__ = "clauses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)  # reading order within the document
    clause_identifier: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_identifier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    start_line: Mapped[int | None] = mapped_column(Integer, nullable=True)  # [start_line, end_line) in Document.lines
    end_line: Mapped[int | None] = mapped_column(Integer, nullable=True)


# 3. Connection Engines & Drivers
async_engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    async_engine, expire_on_commit=False, class_=AsyncSession
)

# Exported neo4j_driver instance
neo4j_driver: AsyncDriver = AsyncGraphDatabase.driver(
    settings.NEO4J_URI, auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
)

# Exported redis_client instance
redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)


# 4. Dependency Injection for FastAPI endpoints
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
