"""Baseline: the schema as it was when migrations began.

Every statement is idempotent (IF NOT EXISTS), so this also runs cleanly on a database that the old start-up code already created,
and the ALTERs bring a database from any earlier state up to the baseline.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = (
    """CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY, google_sub varchar(64) NOT NULL UNIQUE, email varchar(320) NOT NULL,
        name varchar(200) NOT NULL, picture text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS llm_api_keys (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider varchar(16) NOT NULL,
        ciphertext text NOT NULL, hint varchar(32) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, provider))""",
    """CREATE TABLE IF NOT EXISTS documents (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename varchar(255) NOT NULL,
        size_bytes integer NOT NULL, pages integer NOT NULL, method varchar(16) NOT NULL, total_ms double precision NOT NULL,
        confidence jsonb, pdf bytea, lines jsonb, sha256 varchar(64), graph_parties integer, graph_refs integer,
        created_at timestamptz NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS clauses (
        id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE, "position" integer NOT NULL,
        clause_identifier varchar(64) NOT NULL, title text NOT NULL, content text NOT NULL, page_number integer,
        parent_identifier varchar(64), start_line integer, end_line integer, embedding vector(1536))""",
    """CREATE TABLE IF NOT EXISTS query_sessions (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind varchar(8) NOT NULL,
        query text NOT NULL, data jsonb, created_at timestamptz NOT NULL DEFAULT now())""",
)
# Columns added over time by the old start-up code, for databases created before they existed.
COLUMNS = (
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS lines jsonb",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 varchar(64)",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS graph_parties integer",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS graph_refs integer",
    "ALTER TABLE clauses ADD COLUMN IF NOT EXISTS start_line integer",
    "ALTER TABLE clauses ADD COLUMN IF NOT EXISTS end_line integer",
    "ALTER TABLE clauses ADD COLUMN IF NOT EXISTS embedding vector(1536)",
    "UPDATE documents SET sha256 = encode(sha256(pdf), 'hex') WHERE sha256 IS NULL AND pdf IS NOT NULL",  # contracts saved before hashing
)
INDEXES = (
    "CREATE INDEX IF NOT EXISTS ix_documents_user_id ON documents (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_documents_sha256 ON documents (sha256)",
    "CREATE INDEX IF NOT EXISTS ix_clauses_document_id ON clauses (document_id)",
    "CREATE INDEX IF NOT EXISTS ix_query_sessions_user_id ON query_sessions (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_query_sessions_created_at ON query_sessions (created_at)",
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    for stmt in (*TABLES, *COLUMNS, *INDEXES):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("The baseline is not reversible: it would drop every table.")
