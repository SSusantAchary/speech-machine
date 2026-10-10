"""add user goals

Revision ID: 20260904_0003
Revises: 20260608_0002
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa

revision = "20260904_0003"
down_revision = "20260608_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_goals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("metric_name", sa.String(length=50), nullable=False),
        sa.Column("comparison", sa.String(length=10), nullable=False),
        sa.Column("target_value", sa.Float(), nullable=False),
        sa.Column("target_upper", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "metric_name", name="uq_user_goals_user_metric"),
    )
    op.create_index(op.f("ix_user_goals_id"), "user_goals", ["id"], unique=False)
    op.create_index(op.f("ix_user_goals_user_id"), "user_goals", ["user_id"], unique=False)
    op.create_index("ix_user_goals_user_active", "user_goals", ["user_id", "is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_goals_user_active", table_name="user_goals")
    op.drop_index(op.f("ix_user_goals_user_id"), table_name="user_goals")
    op.drop_index(op.f("ix_user_goals_id"), table_name="user_goals")
    op.drop_table("user_goals")
