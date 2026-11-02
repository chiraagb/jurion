import uuid
from typing import AsyncGenerator
from sqlalchemy import String, Text, DateTime, func, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
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


# 2b. Encrypted LLM provider keys (one per provider; single-tenant until user accounts exist)
class LlmApiKey(Base):
    __tablename__ = "llm_api_keys"

    provider: Mapped[str] = mapped_column(String(16), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text)  # Fernet token; the plaintext key is never stored
    hint: Mapped[str] = mapped_column(String(32))  # "sk-…a1b2", safe to show in the UI
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


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
