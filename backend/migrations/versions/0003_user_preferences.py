"""Per-user switches for optional Ask and Search steps (reranker, follow-up suggestions, graph widening, company facts).

A JSON object rather than one column per switch: a new switch needs no migration, and an empty object means
"server defaults" (app/core/preferences.py fills in whatever is missing).

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS preferences")
