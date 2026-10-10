from datetime import datetime
from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, JSON, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )
    session_metrics = relationship("SessionMetrics", back_populates="user", cascade="all, delete-orphan")
    daily_aggregates = relationship("DailyAggregate", back_populates="user", cascade="all, delete-orphan")
    coaching_feedback = relationship("CoachingFeedback", back_populates="user", cascade="all, delete-orphan")
    goals = relationship("UserGoal", back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    jti_hash = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_jti_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=True)
    mode = Column(String(80), nullable=True)
    prompt = Column(Text, nullable=True)
    goal = Column(String(255), nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, default=0)
    wpm_avg = Column(Float, default=0)
    filler_count = Column(Integer, default=0)
    eye_contact_pct = Column(Float, default=0)
    video_path = Column(String(1024), nullable=True)
    document_path = Column(String(1024), nullable=True)
    document_name = Column(String(255), nullable=True)
    document_mime_type = Column(String(255), nullable=True)
    document_blocks_json = Column(Text, nullable=True)
    transcription_status = Column(String(32), default="idle")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="sessions")
    transcript_segments = relationship(
        "TranscriptSegment", back_populates="session", cascade="all, delete-orphan"
    )
    metrics = relationship(
        "MetricsTimeseries", back_populates="session", cascade="all, delete-orphan"
    )
    score = relationship("Score", back_populates="session", uselist=False, cascade="all, delete-orphan")
    tags = relationship("Tag", back_populates="session", cascade="all, delete-orphan")
    metrics_snapshot = relationship(
        "SessionMetrics", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    coaching_feedback = relationship(
        "CoachingFeedback", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class SessionMetrics(Base):
    __tablename__ = "session_metrics"
    __table_args__ = (
        Index("ix_session_metrics_user_date", "user_id", "recorded_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recorded_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    duration_seconds = Column(Float, default=0, nullable=False)
    word_count = Column(Integer, default=0, nullable=False)
    wpm = Column(Float, default=0, nullable=False)
    filler_count = Column(Integer, default=0, nullable=False)
    filler_rate = Column(Float, default=0, nullable=False)
    pause_count = Column(Integer, default=0, nullable=False)
    unique_word_count = Column(Integer, default=0, nullable=False)
    vocabulary_density = Column(Float, default=0, nullable=False)

    eye_contact_score = Column(Float, nullable=True)
    smile_score = Column(Float, nullable=True)
    head_stability_score = Column(Float, nullable=True)
    loudness_score = Column(Float, nullable=True)

    speech_score = Column(Float, default=0, nullable=False)
    delivery_score = Column(Float, default=0, nullable=False)
    overall_score = Column(Float, default=0, nullable=False)
    filler_breakdown = Column(JSON, nullable=True)
    wpm_timeline = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="metrics_snapshot")
    user = relationship("User", back_populates="session_metrics")


class DailyAggregate(Base):
    __tablename__ = "daily_aggregates"
    __table_args__ = (
        UniqueConstraint("user_id", "practice_date", name="uq_daily_aggregates_user_date"),
        Index("ix_daily_aggregates_user_date", "user_id", "practice_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    practice_date = Column(Date, nullable=False)
    session_count = Column(Integer, default=0, nullable=False)
    total_duration_seconds = Column(Float, default=0, nullable=False)
    avg_wpm = Column(Float, default=0, nullable=False)
    avg_filler_rate = Column(Float, default=0, nullable=False)
    avg_overall_score = Column(Float, default=0, nullable=False)
    avg_speech_score = Column(Float, default=0, nullable=False)
    avg_delivery_score = Column(Float, default=0, nullable=False)
    best_overall_score = Column(Float, default=0, nullable=False)

    user = relationship("User", back_populates="daily_aggregates")


class CoachingFeedback(Base):
    __tablename__ = "coaching_feedback"
    __table_args__ = (
        Index("ix_coaching_feedback_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), default="pending", nullable=False)
    model_used = Column(String(100), nullable=True)
    generation_time_ms = Column(Integer, nullable=True)
    summary = Column(Text, nullable=True)
    strengths = Column(JSON, nullable=True)
    improvements = Column(JSON, nullable=True)
    drills = Column(JSON, nullable=True)
    practice_plan = Column(JSON, nullable=True)
    raw_response = Column(Text, nullable=True)
    compared_to_session_id = Column(Integer, nullable=True)
    trend_context = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    error_message = Column(Text, nullable=True)

    session = relationship("Session", back_populates="coaching_feedback")
    user = relationship("User", back_populates="coaching_feedback")


class UserGoal(Base):
    __tablename__ = "user_goals"
    __table_args__ = (
        UniqueConstraint("user_id", "metric_name", name="uq_user_goals_user_metric"),
        Index("ix_user_goals_user_active", "user_id", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name = Column(String(50), nullable=False)
    comparison = Column(String(10), nullable=False)
    target_value = Column(Float, nullable=False)
    target_upper = Column(Float, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="goals")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    start_ms = Column(Integer, nullable=False)
    end_ms = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)

    session = relationship("Session", back_populates="transcript_segments")


class MetricsTimeseries(Base):
    __tablename__ = "metrics_timeseries"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    t = Column(Integer, nullable=False)
    wpm = Column(Float, default=0)
    rms = Column(Float, default=0)
    eye_contact = Column(Float, default=0)
    smile = Column(Float, default=0)
    yaw = Column(Float, default=0)
    pitch = Column(Float, default=0)
    roll = Column(Float, default=0)
    filler_count = Column(Integer, default=0)
    pause_ms = Column(Integer, default=0)

    session = relationship("Session", back_populates="metrics")


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, unique=True)
    data = Column(JSON, nullable=False)

    session = relationship("Session", back_populates="score")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    name = Column(String(80), nullable=False)

    session = relationship("Session", back_populates="tags")
