"""One saved copy of a file per user, enforced by the database.

The application checks first (and offers "replace"), but two saves of the same file at the same moment can both pass that check.
A partial unique index closes the race; contracts saved before hashing existed (sha256 NULL) are left alone.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_documents_user_sha256 ON documents (user_id, sha256) WHERE sha256 IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_documents_user_sha256")
