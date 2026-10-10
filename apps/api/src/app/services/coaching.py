from __future__ import annotations

import json
import time
from typing import Any

import requests

from app.config import settings

REQUIRED_KEYS = {"summary", "strengths", "improvements", "drills", "practice_plan"}


def build_coaching_prompt(
    transcript: str,
    metrics: dict[str, Any],
    history: list[dict[str, Any]],
    previous_feedback: dict[str, Any] | None = None,
    active_goals: list[dict[str, Any]] | None = None,
) -> str:
    max_chars = max(1000, settings.coaching_max_transcript_chars)
    truncated = transcript[:max_chars]
    if len(transcript) > max_chars:
        truncated = f"{truncated}\n[transcript truncated]"

    history_lines = []
    for item in history[:10]:
        history_lines.append(
            f"- {item.get('recorded_at', 'unknown')}: score={item.get('overall_score', 0)}, "
            f"wpm={item.get('wpm', 0)}, fillers/min={item.get('filler_rate', 0)}"
        )
    previous = ""
    if previous_feedback:
        previous = f"Previous coaching focus: {json.dumps(previous_feedback, ensure_ascii=False)[:1200]}"
    goal_lines = []
    for goal in active_goals or []:
        target = str(goal.get("target_value", 0))
        if goal.get("comparison") == "between":
            target = f"{target} to {goal.get('target_upper')}"
        goal_lines.append(
            f"- {goal.get('metric_name')}: target {goal.get('comparison')} {target}; "
            f"current={goal.get('current_value', 'not available')}; achieved={goal.get('achieved', False)}"
        )

    return f"""You are a local AI speech coach. Analyze the practice session and return only valid JSON.

Current metrics:
- duration_seconds: {metrics.get("duration_seconds", 0)}
- word_count: {metrics.get("word_count", 0)}
- wpm: {metrics.get("wpm", 0)}
- filler_count: {metrics.get("filler_count", 0)}
- filler_rate: {metrics.get("filler_rate", 0)}
- pause_count: {metrics.get("pause_count", 0)}
- vocabulary_density: {metrics.get("vocabulary_density", 0)}
- speech_score: {metrics.get("speech_score", 0)}
- delivery_score: {metrics.get("delivery_score", 0)}
- overall_score: {metrics.get("overall_score", 0)}
- filler_breakdown: {json.dumps(metrics.get("filler_breakdown") or {}, ensure_ascii=False)}

Recent history:
{chr(10).join(history_lines) if history_lines else "- no prior sessions"}

Active user goals:
{chr(10).join(goal_lines) if goal_lines else "- no active goals"}

{previous}

Transcript:
{truncated}

Return this exact JSON shape, with no markdown:
{{
  "summary": "2-3 sentence assessment",
  "strengths": [
    {{"area": "pace", "detail": "specific observation", "score_contribution": "why it matters"}}
  ],
  "improvements": [
    {{"area": "fillers", "detail": "specific next action", "priority": "high", "example": "optional example"}}
  ],
  "drills": [
    {{"name": "drill name", "description": "steps", "duration_minutes": 5, "targets": "metric"}}
  ],
  "practice_plan": {{
    "focus_areas": ["area"],
    "suggested_duration_minutes": 15,
    "difficulty": "beginner",
    "next_session_goal": "specific measurable goal"
  }},
  "progress_note": "optional progress comment"
}}

Rules:
- Use 2-4 strengths and 2-4 improvements.
- Use 1-3 drills.
- Cite exact metrics where possible.
- Align the next_session_goal and drills with active user goals when present.
- Difficulty must be beginner, intermediate, or advanced.
- If history is empty, progress_note may be empty.
"""


def generate_coaching_feedback(
    transcript: str,
    metrics: dict[str, Any],
    history: list[dict[str, Any]],
    previous_feedback: dict[str, Any] | None = None,
    active_goals: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    prompt = build_coaching_prompt(transcript, metrics, history, previous_feedback, active_goals)
    started = time.perf_counter()
    provider = settings.coaching_provider.lower()
    if provider == "ollama":
        raw_text = _call_ollama(prompt)
    if provider in {"lmstudio", "llamacpp"}:
        raw_text = _call_openai_compatible(prompt, provider)
    if provider not in {"ollama", "lmstudio", "llamacpp"}:
        raise RuntimeError(f"Unsupported coaching provider '{settings.coaching_provider}'")

    parsed = parse_coaching_response(raw_text)
    parsed["raw_response"] = raw_text
    parsed["model_used"] = settings.coaching_model
    parsed["generation_time_ms"] = int((time.perf_counter() - started) * 1000)
    return parsed


def parse_coaching_response(raw_text: str) -> dict[str, Any]:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Local LLM returned invalid JSON: {exc}") from exc
    missing = REQUIRED_KEYS - set(parsed)
    if missing:
        raise RuntimeError(f"Local LLM response missing required keys: {', '.join(sorted(missing))}")
    parsed.setdefault("progress_note", "")
    return parsed


def _call_ollama(prompt: str) -> str:
    url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    response = requests.post(
        url,
        json={
            "model": settings.coaching_model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        },
        timeout=settings.coaching_timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    text = payload.get("response")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Ollama returned an empty coaching response")
    return text


def _call_openai_compatible(prompt: str, provider: str) -> str:
    base_url = settings.lmstudio_base_url if provider == "lmstudio" else settings.llama_cpp_base_url
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    response = requests.post(
        url,
        json={
            "model": settings.coaching_model,
            "temperature": 0.3,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=settings.coaching_timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("OpenAI-compatible provider returned an invalid response") from exc
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("OpenAI-compatible provider returned an empty coaching response")
    return text
