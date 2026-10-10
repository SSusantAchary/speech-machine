import json
import os
import re
import shutil
import tempfile
import textwrap
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app import models, schemas, transcription
from app.auth import get_current_user
from app.config import settings
from app.db import SessionLocal, get_db
from app.scoring import compute_score
from app.services.analytics import compute_session_metrics
from app.storage import storage_client
from app.worker.enqueue import enqueue_transcription

router = APIRouter(prefix="/sessions", tags=["sessions"])

def _resolve_video_format(value: Optional[str]) -> tuple[str, str]:
    if not value:
        return "webm", "video/webm"
    lower = value.lower()
    if "video/" in lower:
        if "mp4" in lower:
            return "mp4", "video/mp4"
        if "quicktime" in lower:
            return "mp4", "video/quicktime"
        if "webm" in lower:
            return "webm", "video/webm"
        return "webm", "video/webm"
    suffix = Path(lower).suffix
    if suffix == ".mp4":
        return "mp4", "video/mp4"
    if suffix == ".mov":
        return "mp4", "video/quicktime"
    if suffix == ".webm":
        return "webm", "video/webm"
    return "webm", "video/webm"


def _detect_media_type(video_path: str, fallback: str) -> str:
    try:
        with open(video_path, "rb") as video_file:
            header = video_file.read(16)
        if len(header) >= 8 and header[4:8] == b"ftyp":
            return "video/mp4"
        if header.startswith(b"\x1a\x45\xdf\xa3"):
            return "video/webm"
    except OSError:
        return fallback
    return fallback


def _file_size_and_header(file_obj, header_size: int = 16) -> tuple[int, bytes]:
    current = file_obj.tell()
    file_obj.seek(0, os.SEEK_END)
    size = file_obj.tell()
    file_obj.seek(0)
    header = file_obj.read(header_size)
    file_obj.seek(current)
    return size, header


def _validate_size(size: int, label: str) -> None:
    if size > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"{label} exceeds the {settings.max_upload_mb} MB upload limit.",
        )


def _validate_video_header(header: bytes, media_type: str) -> None:
    if media_type in {"video/mp4", "video/quicktime"}:
        if len(header) >= 8 and header[4:8] == b"ftyp":
            return
    if media_type == "video/webm" and header.startswith(b"\x1a\x45\xdf\xa3"):
        return
    raise HTTPException(status_code=415, detail="Unsupported or invalid video file.")


def _validate_video_upload(file: UploadFile, media_type: str) -> None:
    size, header = _file_size_and_header(file.file)
    _validate_size(size, "Video")
    _validate_video_header(header, media_type)
    file.file.seek(0)


def _validate_video_path(path: Path, media_type: str) -> None:
    size = path.stat().st_size
    _validate_size(size, "Video")
    with open(path, "rb") as merged:
        header = merged.read(16)
    _validate_video_header(header, media_type)


def _validate_document_upload(file: UploadFile, extension: str, mime_type: str) -> None:
    size, header = _file_size_and_header(file.file)
    _validate_size(size, "Document")
    if extension == ".pdf" and not header.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Invalid PDF file.")
    if mime_type == "text/plain" and b"\x00" in header:
        raise HTTPException(status_code=415, detail="Invalid text file.")
    file.file.seek(0)


def _serialize_transcript_segments(
    transcript_segments: list[models.TranscriptSegment],
) -> list[schemas.TranscriptSegmentOut]:
    return [
        schemas.TranscriptSegmentOut(
            id=segment.id,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            text=segment.text,
        )
        for segment in transcript_segments
    ]


def _deserialize_document_blocks(raw_value: str | None) -> list[schemas.DocumentBlockOut]:
    if not raw_value:
        return []
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return []

    if not isinstance(payload, list):
        return []

    blocks: list[schemas.DocumentBlockOut] = []
    for index, item in enumerate(payload):
        text = item.get("text") if isinstance(item, dict) else item if isinstance(item, str) else ""
        if not isinstance(text, str) or not text.strip():
            continue
        blocks.append(schemas.DocumentBlockOut(index=index, text=text.strip()))
    return blocks


def _serialize_document(session: models.Session) -> schemas.SessionDocumentOut | None:
    blocks = _deserialize_document_blocks(session.document_blocks_json)
    if not session.document_name or not session.document_mime_type or not blocks:
        return None
    return schemas.SessionDocumentOut(
        name=session.document_name,
        mime_type=session.document_mime_type,
        blocks=blocks,
    )


def _serialize_metrics(metrics: list[models.MetricsTimeseries]) -> list[schemas.MetricsPointCreate]:
    return [
        schemas.MetricsPointCreate(
            t=point.t,
            wpm=point.wpm,
            rms=point.rms,
            eye_contact=point.eye_contact,
            smile=point.smile,
            yaw=point.yaw,
            pitch=point.pitch,
            roll=point.roll,
            filler_count=point.filler_count,
            pause_ms=point.pause_ms,
        )
        for point in metrics
    ]


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    return cleaned or "session"


def _session_transcript_filename(session: models.Session, extension: str) -> str:
    title = session.title or session.mode or f"session_{session.id}"
    return f"{_safe_filename(title)}_transcript.{extension}"


def _format_timestamp(ms: int) -> str:
    total_seconds = max(ms, 0) // 1000
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _build_transcript_text(session: models.Session) -> str:
    lines = [
        session.title or session.mode or f"Session {session.id}",
        f"Duration: {_format_timestamp(session.duration_ms)}",
        "",
    ]
    for segment in session.transcript_segments:
        lines.append(f"[{_format_timestamp(segment.start_ms)}] {segment.text}")
    return "\n".join(lines).strip() + "\n"


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf_stream(lines: list[str]) -> bytes:
    commands = ["BT", "/F1 11 Tf", "14 TL", "72 770 Td"]
    first_line = True
    for line in lines:
        wrapped_lines = textwrap.wrap(
            line,
            width=88,
            replace_whitespace=False,
            drop_whitespace=False,
        ) or [""]
        for wrapped in wrapped_lines:
            if first_line:
                commands.append(f"({_escape_pdf_text(wrapped)}) Tj")
                first_line = False
            else:
                commands.append("T*")
                commands.append(f"({_escape_pdf_text(wrapped)}) Tj")
    commands.append("ET")
    return "\n".join(commands).encode("latin-1", errors="replace")


def _build_transcript_pdf(session: models.Session) -> bytes:
    transcript_lines = _build_transcript_text(session).splitlines()
    lines_per_page = 48
    pages = [
        transcript_lines[index:index + lines_per_page]
        for index in range(0, len(transcript_lines), lines_per_page)
    ] or [["Transcript unavailable."]]

    objects: list[bytes] = []
    page_object_numbers: list[int] = []
    current_object = 4

    for page_lines in pages:
        page_object_numbers.append(current_object)
        current_object += 2

    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_object_numbers)} >>".encode("latin-1"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    for index, page_lines in enumerate(pages):
        page_object_number = page_object_numbers[index]
        content_object_number = page_object_number + 1
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_object_number} 0 R >>"
            ).encode("latin-1")
        )
        content_bytes = _pdf_stream(page_lines)
        objects.append(
            b"<< /Length "
            + str(len(content_bytes)).encode("latin-1")
            + b" >>\nstream\n"
            + content_bytes
            + b"\nendstream"
        )

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{object_number} 0 obj\n".encode("latin-1"))
        pdf.extend(body)
        pdf.extend(b"\nendobj\n")

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(pdf)


def _raise_if_transcript_missing(session: models.Session) -> None:
    if not session.transcript_segments:
        raise HTTPException(status_code=400, detail="Transcript not available yet")


def _status_for_missing_video(session: models.Session) -> str:
    if session.transcript_segments:
        return "complete"
    return "idle"


def _resolve_document_format(filename: str | None, content_type: str | None) -> tuple[str, str]:
    suffix = Path(filename or "").suffix.lower()
    normalized_content_type = (content_type or "").split(";")[0].strip().lower()
    if suffix == ".pdf" or normalized_content_type == "application/pdf":
        return ".pdf", "application/pdf"
    if suffix == ".txt" or normalized_content_type == "text/plain":
        return ".txt", "text/plain"
    raise HTTPException(status_code=400, detail="Unsupported document type. Upload a PDF or TXT file.")


def _normalize_document_blocks_payload(raw_value: str) -> str:
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Document blocks payload must be valid JSON.") from exc

    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="Document blocks payload must be a list.")

    blocks = []
    for item in payload:
        text = item.get("text") if isinstance(item, dict) else item if isinstance(item, str) else ""
        if not isinstance(text, str) or not text.strip():
            continue
        blocks.append({"index": len(blocks), "text": text.strip()})

    if not blocks:
        raise HTTPException(status_code=400, detail="Document blocks payload is empty.")

    return json.dumps(blocks, ensure_ascii=False)


def _delete_session_assets(session: models.Session) -> None:
    if session.video_path:
        storage_client.delete_file(session.video_path)
    if session.document_path:
        storage_client.delete_file(session.document_path)


@router.post("", response_model=schemas.SessionOut)
def create_session(
    payload: schemas.SessionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = models.Session(
        user_id=current_user.id,
        title=payload.title,
        mode=payload.mode,
        prompt=payload.prompt,
        goal=payload.goal,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        duration_ms=payload.duration_ms,
        wpm_avg=payload.wpm_avg,
        filler_count=payload.filler_count,
        eye_contact_pct=payload.eye_contact_pct,
        transcription_status="idle",
    )
    db.add(session)
    db.flush()

    for tag in payload.tags:
        db.add(models.Tag(session_id=session.id, name=tag))

    for seg in payload.transcript_segments:
        db.add(
            models.TranscriptSegment(
                session_id=session.id,
                start_ms=seg.start_ms,
                end_ms=seg.end_ms,
                text=seg.text,
            )
        )

    for point in payload.metrics:
        db.add(
            models.MetricsTimeseries(
                session_id=session.id,
                t=point.t,
                wpm=point.wpm,
                rms=point.rms,
                eye_contact=point.eye_contact,
                smile=point.smile,
                yaw=point.yaw,
                pitch=point.pitch,
                roll=point.roll,
                filler_count=point.filler_count,
                pause_ms=point.pause_ms,
            )
        )

    score_payload = payload.score
    if score_payload is None:
        score_payload = compute_score(
            [seg.model_dump() for seg in payload.transcript_segments],
            [point.model_dump() for point in payload.metrics],
            payload.duration_ms,
            [],
        )
    db.add(models.Score(session_id=session.id, data=score_payload))

    db.commit()
    db.refresh(session)
    compute_session_metrics(db, session.id)
    db.refresh(session)

    return _session_to_out(session)


@router.get("", response_model=list[schemas.SessionListItem])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    sessions = (
        db.query(models.Session)
        .filter(models.Session.user_id == current_user.id)
        .order_by(models.Session.created_at.desc())
        .all()
    )
    items = []
    for sess in sessions:
        score_data = sess.score.data if sess.score else None
        items.append(
            schemas.SessionListItem(
                id=sess.id,
                title=sess.title,
                mode=sess.mode,
                duration_ms=sess.duration_ms,
                wpm_avg=sess.wpm_avg,
                filler_count=sess.filler_count,
                eye_contact_pct=sess.eye_contact_pct,
                created_at=sess.created_at,
                transcription_status=sess.transcription_status,
                score=score_data,
            )
        )
    return items


@router.get("/{session_id}", response_model=schemas.SessionOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    return _session_to_out(session)


@router.post("/{session_id}/upload", response_model=schemas.UploadResponse)
def upload_video(
    session_id: int,
    file: UploadFile = File(...),
    chunk_index: Optional[int] = None,
    total_chunks: Optional[int] = None,
    upload_id: Optional[str] = None,
    mime_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    extension, resolved_mime = _resolve_video_format(mime_type or file.content_type or file.filename)

    if chunk_index is not None and total_chunks is not None:
        if not upload_id:
            raise HTTPException(status_code=400, detail="upload_id required")
        chunk_size, _header = _file_size_and_header(file.file)
        _validate_size(chunk_size, "Video chunk")
        file.file.seek(0)
        tmp_dir = Path(settings.storage_dir) / "tmp" / upload_id
        tmp_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = tmp_dir / f"{chunk_index}.part"
        with open(chunk_path, "wb") as out:
            shutil.copyfileobj(file.file, out)

        if chunk_index == total_chunks - 1:
            merged_path = tmp_dir / f"merged.{extension}"
            with open(merged_path, "wb") as merged:
                for idx in range(total_chunks):
                    part_path = tmp_dir / f"{idx}.part"
                    if not part_path.exists():
                        raise HTTPException(status_code=400, detail="missing chunk")
                    with open(part_path, "rb") as part:
                        shutil.copyfileobj(part, merged)
            _validate_video_path(merged_path, resolved_mime)
            key = f"sessions/{session_id}/recording.{extension}"
            with open(merged_path, "rb") as merged_file:
                stored_path = storage_client.save_file(key, merged_file)
            session.video_path = stored_path
            db.commit()
            shutil.rmtree(tmp_dir)
            return {"session_id": session_id, "status": "complete", "video_path": stored_path}

        return {"session_id": session_id, "status": "partial"}

    _validate_video_upload(file, resolved_mime)
    key = f"sessions/{session_id}/recording.{extension}"
    stored_path = storage_client.save_file(key, file.file)
    session.video_path = stored_path
    db.commit()
    return {"session_id": session_id, "status": "complete", "video_path": stored_path}


@router.post("/{session_id}/document", response_model=schemas.SessionDocumentOut)
def upload_document(
    session_id: int,
    file: UploadFile = File(...),
    blocks_json: str = Form(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    extension, mime_type = _resolve_document_format(file.filename, file.content_type)
    _validate_document_upload(file, extension, mime_type)
    normalized_blocks_json = _normalize_document_blocks_payload(blocks_json)

    if session.document_path:
        storage_client.delete_file(session.document_path)

    key = f"sessions/{session_id}/document{extension}"
    stored_path = storage_client.save_file(key, file.file)
    session.document_path = stored_path
    session.document_name = file.filename or f"document{extension}"
    session.document_mime_type = mime_type
    session.document_blocks_json = normalized_blocks_json
    db.commit()
    db.refresh(session)

    document = _serialize_document(session)
    if document is None:
        raise HTTPException(status_code=500, detail="Document was saved but could not be serialized.")
    return document


@router.post("/{session_id}/transcribe")
async def transcribe_session(
    session_id: int,
    payload: schemas.TranscriptionRequest | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    if not session.video_path:
        raise HTTPException(status_code=400, detail="No video uploaded")
    try:
        selected_backend = transcription.resolve_transcription_backend(
            payload.backend if payload else None,
            payload.model if payload else None,
        )
        selected_model = transcription.resolve_transcription_model(
            payload.model if payload else None,
            selected_backend,
        )
        transcription.ensure_transcription_model_ready(selected_backend, selected_model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.transcription_status = "queued"
    db.commit()

    try:
        job_id = await enqueue_transcription(session_id, current_user.id, selected_model, selected_backend)
    except Exception as exc:
        session.transcription_status = "idle"
        db.commit()
        raise HTTPException(status_code=503, detail="Job backend unavailable") from exc
    return {"status": "queued", "job_id": job_id}


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    _delete_session_assets(session)
    db.delete(session)
    db.commit()
    return {"status": "deleted"}


@router.delete("/{session_id}/video")
def delete_video(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    if session.video_path:
        storage_client.delete_file(session.video_path)
        session.video_path = None
    session.transcription_status = _status_for_missing_video(session)
    db.commit()
    return {"status": "deleted", "transcription_status": session.transcription_status}


@router.get("/{session_id}/export")
def export_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    tmp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(tmp_dir, f"session_{session_id}.zip")
    transcript_text = _build_transcript_text(session)
    transcript_pdf = _build_transcript_pdf(session)

    transcript_payload = [
        {"start_ms": segment.start_ms, "end_ms": segment.end_ms, "text": segment.text}
        for segment in session.transcript_segments
    ]
    metrics_payload = [
        {
            "t": point.t,
            "wpm": point.wpm,
            "rms": point.rms,
            "eye_contact": point.eye_contact,
            "smile": point.smile,
            "yaw": point.yaw,
            "pitch": point.pitch,
            "roll": point.roll,
            "filler_count": point.filler_count,
            "pause_ms": point.pause_ms,
        }
        for point in session.metrics
    ]
    score_payload = session.score.data if session.score else {}

    with zipfile.ZipFile(zip_path, "w") as zipf:
        zipf.writestr("transcript.json", json.dumps(transcript_payload, indent=2))
        zipf.writestr("transcript.txt", transcript_text)
        zipf.writestr("transcript.pdf", transcript_pdf)
        zipf.writestr("metrics.json", json.dumps(metrics_payload, indent=2))
        zipf.writestr("score.json", json.dumps(score_payload, indent=2))
        if session.document_blocks_json:
            zipf.writestr("document_blocks.json", session.document_blocks_json)
        if session.video_path:
            try:
                video_path = storage_client.get_local_path(session.video_path)
            except RuntimeError:
                video_path = None
            if video_path and os.path.exists(video_path):
                video_name = f"recording{Path(video_path).suffix or '.webm'}"
                zipf.write(video_path, arcname=video_name)
        if session.document_path:
            try:
                document_path = storage_client.get_local_path(session.document_path)
            except RuntimeError:
                document_path = None
            if document_path and os.path.exists(document_path):
                document_name = session.document_name or f"reading{Path(document_path).suffix or '.txt'}"
                zipf.write(document_path, arcname=document_name)

    return FileResponse(zip_path, filename=f"session_{session_id}.zip")


@router.get("/{session_id}/transcript.txt")
def download_transcript_txt(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    _raise_if_transcript_missing(session)
    filename = _session_transcript_filename(session, "txt")
    return Response(
        content=_build_transcript_text(session),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/transcript.pdf")
def download_transcript_pdf(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    _raise_if_transcript_missing(session)
    filename = _session_transcript_filename(session, "pdf")
    return Response(
        content=_build_transcript_pdf(session),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/video")
def get_video(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = _get_session_or_404(db, current_user.id, session_id)
    if not session.video_path:
        raise HTTPException(status_code=404, detail="Video not found")
    try:
        video_path = storage_client.get_local_path(session.video_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail="Video download unavailable") from exc
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video not found")
    _extension, media_type = _resolve_video_format(video_path)
    media_type = _detect_media_type(video_path, media_type)
    return FileResponse(video_path, media_type=media_type)


def _get_session_or_404(db: Session, user_id: int, session_id: int) -> models.Session:
    session = (
        db.query(models.Session)
        .filter(models.Session.id == session_id, models.Session.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _run_transcription(
    session_id: int,
    user_id: int,
    model_name: str | None = None,
    backend_id: str | None = None,
) -> None:
    db = SessionLocal()
    session: models.Session | None = None
    audio_path: str | None = None
    try:
        session = (
            db.query(models.Session)
            .filter(models.Session.id == session_id, models.Session.user_id == user_id)
            .first()
        )
        if not session or not session.video_path:
            return
        session.transcription_status = "processing"
        db.commit()
        video_path = storage_client.get_local_path(session.video_path)
        audio_path = transcription.extract_audio(video_path)
        segments = transcription.transcribe_audio(audio_path, model_name, backend_id)
        session.transcript_segments.clear()
        db.flush()
        for seg in segments:
            db.add(
                models.TranscriptSegment(
                    session_id=session.id,
                    start_ms=seg["start_ms"],
                    end_ms=seg["end_ms"],
                    text=seg["text"],
                )
            )
        db.flush()
        score_payload = compute_score(
            segments,
            [
                {
                    "t": point.t,
                    "wpm": point.wpm,
                    "rms": point.rms,
                    "eye_contact": point.eye_contact,
                    "smile": point.smile,
                    "yaw": point.yaw,
                    "pitch": point.pitch,
                    "roll": point.roll,
                    "filler_count": point.filler_count,
                    "pause_ms": point.pause_ms,
                }
                for point in session.metrics
            ],
            session.duration_ms,
            [],
        )
        if session.score:
            session.score.data = score_payload
        else:
            db.add(models.Score(session_id=session.id, data=score_payload))
        session.transcription_status = "complete"
        db.commit()
        compute_session_metrics(db, session.id)
    except Exception:
        if session is None and session_id:
            session = db.query(models.Session).filter(models.Session.id == session_id).first()
        if session:
            if session.video_path:
                session.transcription_status = "failed"
            else:
                session.transcription_status = _status_for_missing_video(session)
            db.commit()
    finally:
        if audio_path:
            try:
                audio_file = Path(audio_path)
                if audio_file.exists():
                    audio_file.unlink()
                if audio_file.parent.exists():
                    audio_file.parent.rmdir()
            except OSError:
                pass
        db.close()


def _session_to_out(session: models.Session) -> schemas.SessionOut:
    tags = [tag.name for tag in session.tags]
    score_data = session.score.data if session.score else None
    return schemas.SessionOut(
        id=session.id,
        title=session.title,
        mode=session.mode,
        prompt=session.prompt,
        goal=session.goal,
        started_at=session.started_at,
        ended_at=session.ended_at,
        duration_ms=session.duration_ms,
        wpm_avg=session.wpm_avg,
        filler_count=session.filler_count,
        eye_contact_pct=session.eye_contact_pct,
        video_path=session.video_path,
        transcription_status=session.transcription_status,
        created_at=session.created_at,
        tags=tags,
        transcript_segments=_serialize_transcript_segments(session.transcript_segments),
        metrics=_serialize_metrics(session.metrics),
        score=score_data,
        document=_serialize_document(session),
    )
