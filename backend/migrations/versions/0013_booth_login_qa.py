"""Link existing login identities and track QA cash separately."""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("booth_participants") as batch:
        batch.add_column(sa.Column("study_participant_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_booth_study_participant", "participants", ["study_participant_id"], ["id"])
        batch.create_unique_constraint("uq_booth_study_participant", ["study_participant_id"])
    op.add_column("booth_accounts", sa.Column("qa_cash", sa.BigInteger(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("booth_accounts", "qa_cash")
    with op.batch_alter_table("booth_participants") as batch:
        batch.drop_constraint("uq_booth_study_participant", type_="unique")
        batch.drop_constraint("fk_booth_study_participant", type_="foreignkey")
        batch.drop_column("study_participant_id")
