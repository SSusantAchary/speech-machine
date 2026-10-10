"""add analytics and coaching tables

Revision ID: 20260608_0002
Revises: 20260607_0001
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa

revision = "20260608_0002"
down_revision = "20260607_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wpm", sa.Float(), nullable=False, server_default="0"),
        sa.Column("filler_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filler_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pause_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unique_word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vocabulary_density", sa.Float(), nullable=False, server_default="0"),
        sa.Column("eye_contact_score", sa.Float(), nullable=True),
        sa.Column("smile_score", sa.Float(), nullable=True),
        sa.Column("head_stability_score", sa.Float(), nullable=True),
        sa.Column("loudness_score", sa.Float(), nullable=True),
        sa.Column("speech_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("delivery_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("overall_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("filler_breakdown", sa.JSON(), nullable=True),
        sa.Column("wpm_timeline", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index(op.f("ix_session_metrics_id"), "session_metrics", ["id"], unique=False)
    op.create_index(op.f("ix_session_metrics_session_id"), "session_metrics", ["session_id"], unique=False)
    op.create_index(op.f("ix_session_metrics_user_id"), "session_metrics", ["user_id"], unique=False)
    op.create_index("ix_session_metrics_user_date", "session_metrics", ["user_id", "recorded_at"], unique=False)

    op.create_table(
        "daily_aggregates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("practice_date", sa.Date(), nullable=False),
        sa.Column("session_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_duration_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_wpm", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_filler_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_overall_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_speech_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_delivery_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("best_overall_score", sa.Float(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "practice_date", name="uq_daily_aggregates_user_date"),
    )
    op.create_index(op.f("ix_daily_aggregates_id"), "daily_aggregates", ["id"], unique=False)
    op.create_index(op.f("ix_daily_aggregates_user_id"), "daily_aggregates", ["user_id"], unique=False)
    op.create_index("ix_daily_aggregates_user_date", "daily_aggregates", ["user_id", "practice_date"], unique=False)

    op.create_table(
        "coaching_feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("model_used", sa.String(length=100), nullable=True),
        sa.Column("generation_time_ms", sa.Integer(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("strengths", sa.JSON(), nullable=True),
        sa.Column("improvements", sa.JSON(), nullable=True),
        sa.Column("drills", sa.JSON(), nullable=True),
        sa.Column("practice_plan", sa.JSON(), nullable=True),
        sa.Column("raw_response", sa.Text(), nullable=True),
        sa.Column("compared_to_session_id", sa.Integer(), nullable=True),
        sa.Column("trend_context", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index(op.f("ix_coaching_feedback_id"), "coaching_feedback", ["id"], unique=False)
    op.create_index(op.f("ix_coaching_feedback_session_id"), "coaching_feedback", ["session_id"], unique=False)
    op.create_index(op.f("ix_coaching_feedback_user_id"), "coaching_feedback", ["user_id"], unique=False)
    op.create_index("ix_coaching_feedback_user_created", "coaching_feedback", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_coaching_feedback_user_created", table_name="coaching_feedback")
    op.drop_index(op.f("ix_coaching_feedback_user_id"), table_name="coaching_feedback")
    op.drop_index(op.f("ix_coaching_feedback_session_id"), table_name="coaching_feedback")
    op.drop_index(op.f("ix_coaching_feedback_id"), table_name="coaching_feedback")
    op.drop_table("coaching_feedback")

    op.drop_index("ix_daily_aggregates_user_date", table_name="daily_aggregates")
    op.drop_index(op.f("ix_daily_aggregates_user_id"), table_name="daily_aggregates")
    op.drop_index(op.f("ix_daily_aggregates_id"), table_name="daily_aggregates")
    op.drop_table("daily_aggregates")

    op.drop_index("ix_session_metrics_user_date", table_name="session_metrics")
    op.drop_index(op.f("ix_session_metrics_user_id"), table_name="session_metrics")
    op.drop_index(op.f("ix_session_metrics_session_id"), table_name="session_metrics")
    op.drop_index(op.f("ix_session_metrics_id"), table_name="session_metrics")
    op.drop_table("session_metrics")
