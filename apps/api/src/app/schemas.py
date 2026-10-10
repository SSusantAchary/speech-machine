from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    is_admin: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int | None = None
    user: UserOut | None = None


class SetupStatus(BaseModel):
    setup_required: bool


GoalMetric = Literal[
    "wpm",
    "filler_rate",
    "overall_score",
    "practice_days_per_week",
    "session_duration_minutes",
    "eye_contact_score",
    "delivery_score",
]
GoalComparison = Literal["gte", "lte", "between"]


class UserGoalCreate(BaseModel):
    metric_name: GoalMetric
    comparison: GoalComparison
    target_value: float = Field(ge=0)
    target_upper: float | None = Field(default=None, ge=0)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_range(self):
        if self.comparison == "between":
            if self.target_upper is None or self.target_upper <= self.target_value:
                raise ValueError("between goals require target_upper greater than target_value")
        elif self.target_upper is not None:
            raise ValueError("target_upper is only valid for between goals")
        return self


class UserGoalUpdate(BaseModel):
    comparison: GoalComparison | None = None
    target_value: float | None = Field(default=None, ge=0)
    target_upper: float | None = Field(default=None, ge=0)
    is_active: bool | None = None


class UserGoalOut(BaseModel):
    id: int
    metric_name: GoalMetric
    comparison: GoalComparison
    target_value: float
    target_upper: float | None
    is_active: bool
    current_value: float | None
    achieved: bool
    created_at: datetime
    updated_at: datetime


class TranscriptionRequest(BaseModel):
    backend: str | None = None
    model: str | None = None


class TranscriptionModelDownloadRequest(BaseModel):
    backend: str
    model: str


class InferenceEngineCheckRequest(BaseModel):
    engine_id: str
    base_url: str | None = None


class InferenceEngineStatusOut(BaseModel):
    id: str
    label: str
    base_url: str
    live: bool
    detail: str
    available_models: list[str] = Field(default_factory=list)


class TranscriptionModelOut(BaseModel):
    id: str
    name: str
    repo_id: str
    description: str
    languages: str
    available: bool = False
    local_path: str | None = None


class TranscriptionBackendOut(BaseModel):
    id: str
    label: str
    supported: bool
    live: bool
    detail: str
    models: list[TranscriptionModelOut] = Field(default_factory=list)
    default_model: str | None = None


class TranscriptionSettingsOut(BaseModel):
    default_backend: str
    backends: list[TranscriptionBackendOut] = Field(default_factory=list)
    text_inference_engines: list[InferenceEngineStatusOut] = Field(default_factory=list)


class TranscriptSegmentCreate(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class TranscriptSegmentOut(TranscriptSegmentCreate):
    id: int

    class Config:
        from_attributes = True


class DocumentBlockOut(BaseModel):
    index: int
    text: str


class SessionDocumentOut(BaseModel):
    name: str
    mime_type: str
    blocks: list[DocumentBlockOut] = Field(default_factory=list)


class MetricsPointCreate(BaseModel):
    t: int
    wpm: float = 0
    rms: float = 0
    eye_contact: float = 0
    smile: float = 0
    yaw: float = 0
    pitch: float = 0
    roll: float = 0
    filler_count: int = 0
    pause_ms: int = 0


class ScoreCreate(BaseModel):
    data: dict


class ScoreOut(ScoreCreate):
    id: int

    class Config:
        from_attributes = True


class SessionCreate(BaseModel):
    title: str | None = None
    mode: str | None = None
    prompt: str | None = None
    goal: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_ms: int = 0
    wpm_avg: float = 0
    filler_count: int = 0
    eye_contact_pct: float = 0
    tags: list[str] = Field(default_factory=list)
    transcript_segments: list[TranscriptSegmentCreate] = Field(default_factory=list)
    metrics: list[MetricsPointCreate] = Field(default_factory=list)
    score: dict | None = None


class SessionOut(BaseModel):
    id: int
    title: str | None
    mode: str | None
    prompt: str | None
    goal: str | None
    started_at: datetime | None
    ended_at: datetime | None
    duration_ms: int
    wpm_avg: float
    filler_count: int
    eye_contact_pct: float
    video_path: str | None
    transcription_status: str
    created_at: datetime
    tags: list[str] = Field(default_factory=list)
    transcript_segments: list[TranscriptSegmentOut] = Field(default_factory=list)
    metrics: list[MetricsPointCreate] = Field(default_factory=list)
    score: dict | None = None
    document: SessionDocumentOut | None = None

    class Config:
        from_attributes = True


class SessionListItem(BaseModel):
    id: int
    title: str | None
    mode: str | None
    duration_ms: int
    wpm_avg: float
    filler_count: int
    eye_contact_pct: float
    created_at: datetime
    transcription_status: str
    score: dict | None = None

    class Config:
        from_attributes = True


class UploadResponse(BaseModel):
    session_id: int
    status: str
    video_path: str | None = None


class ExportResponse(BaseModel):
    zip_path: str
