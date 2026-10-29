"""Idempotent administrator cash grants for booth accounts."""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "booth_cash_grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=80), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["booth_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "request_id"),
    )
    op.create_index("ix_booth_cash_grants_account_id", "booth_cash_grants", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_booth_cash_grants_account_id", table_name="booth_cash_grants")
    op.drop_table("booth_cash_grants")
