import re
from typing import List

FILLER_WORDS = ["um", "uh", "like", "you know", "actually", "basically", "literally"]
STRUCTURE_WORDS = ["first", "second", "third", "because", "therefore", "however", "so", "thus"]


def tokenize(text: str) -> List[str]:
    return [w for w in re.sub(r"[^a-z0-9\s']", " ", text.lower()).split() if w]


def count_words(segments: List[dict]) -> int:
    return sum(len(tokenize(seg["text"])) for seg in segments)


def count_fillers(segments: List[dict]) -> int:
    text = " ".join(seg["text"].lower() for seg in segments)
    total = 0
    for filler in FILLER_WORDS:
        escaped = re.escape(filler).replace(" ", r"\s+")
        pattern = re.compile(rf"\b{escaped}\b")
        total += len(pattern.findall(text))
    return total


def compute_wpm(word_count: int, duration_ms: int) -> float:
    if duration_ms <= 0:
        return 0
    return round((word_count / (duration_ms / 60000)) * 10) / 10


def score_wpm(wpm: float) -> int:
    if 120 <= wpm <= 160:
        return 18
    if 100 <= wpm < 120 or 160 < wpm <= 180:
        return 10
    return 4


def score_fillers(fillers_per_minute: float) -> int:
    if fillers_per_minute <= 2:
        return 12
    if fillers_per_minute <= 6:
        return 8
    return 3


def score_pauses(pause_events: List[int], duration_ms: int) -> int:
    if not pause_events:
        return 4
    natural = len([p for p in pause_events if 600 <= p <= 1500])
    long = len([p for p in pause_events if p > 1500])
    minutes = max(duration_ms / 60000, 0.1)
    rate = natural / minutes
    if long > max(2, minutes):
        return 4
    if 2 <= rate <= 6:
        return 10
    if rate >= 1:
        return 7
    return 5


def score_eye_contact(eye_contact_pct: float) -> int:
    if eye_contact_pct > 0.7:
        return 15
    if eye_contact_pct >= 0.4:
        return 10
    return 5


def score_smile(smile_avg: float) -> int:
    return round(7 * max(0, min(1, smile_avg)))


def score_head_stability(yaw_var: float, pitch_var: float, roll_var: float) -> int:
    total_var = yaw_var + pitch_var + roll_var
    if total_var < 5:
        return 8
    if total_var < 12:
        return 6
    return 4


def score_structure(segments: List[dict]) -> int:
    words = tokenize(" ".join(seg["text"] for seg in segments))
    count = sum(1 for w in words if w in STRUCTURE_WORDS)
    if count >= 4:
        return 10
    if count >= 2:
        return 7
    return 4


def score_repetition(segments: List[dict]) -> int:
    words = tokenize(" ".join(seg["text"] for seg in segments))
    freq = {}
    for word in words:
        freq[word] = freq.get(word, 0) + 1
    repeated = len([c for c in freq.values() if c >= 6])
    if repeated >= 3:
        return -8
    if repeated >= 1:
        return -4
    return 0


def score_clarity(segments: List[dict]) -> int:
    sentences = [s.strip() for s in re.split(r"[.!?]+", " ".join(seg["text"] for seg in segments)) if s.strip()]
    if not sentences:
        return 0
    lengths = [len(tokenize(s)) for s in sentences]
    avg = sum(lengths) / len(lengths)
    if 8 <= avg <= 20:
        return 12
    if 5 <= avg <= 25:
        return 8
    return 4


def score_keyword_coverage(segments: List[dict], keywords: List[str]) -> int:
    if not keywords:
        return 0
    text = " ".join(seg["text"].lower() for seg in segments)
    covered = sum(1 for k in keywords if k.lower() in text)
    ratio = covered / len(keywords)
    if ratio >= 0.8:
        return 8
    if ratio >= 0.5:
        return 5
    return 2


def avg(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0


def variance(values: List[float]) -> float:
    if not values:
        return 0
    mean = avg(values)
    return avg([(v - mean) ** 2 for v in values])


def compute_score(segments: List[dict], metrics: List[dict], duration_ms: int, keywords: List[str]):
    word_count = count_words(segments)
    wpm = compute_wpm(word_count, duration_ms)
    filler_count = count_fillers(segments)
    minutes = max(duration_ms / 60000, 0.1)
    fillers_per_minute = filler_count / minutes
    pause_events = [m.get("pause_ms", 0) for m in metrics if m.get("pause_ms", 0) > 0]

    wpm_score = score_wpm(wpm)
    filler_score = score_fillers(fillers_per_minute)
    pause_score = score_pauses(pause_events, duration_ms)
    speech = wpm_score + filler_score + pause_score

    eye_contact_pct = avg([m.get("eye_contact", 0) for m in metrics])
    smile_avg = avg([m.get("smile", 0) for m in metrics])
    yaw_var = variance([m.get("yaw", 0) for m in metrics])
    pitch_var = variance([m.get("pitch", 0) for m in metrics])
    roll_var = variance([m.get("roll", 0) for m in metrics])

    eye_score = score_eye_contact(eye_contact_pct)
    smile_score = score_smile(smile_avg)
    head_score = score_head_stability(yaw_var, pitch_var, roll_var)
    delivery = eye_score + smile_score + head_score

    structure_score = score_structure(segments)
    repetition_score = score_repetition(segments)
    clarity_score = score_clarity(segments)
    keyword_score = score_keyword_coverage(segments, keywords)
    content = max(0, structure_score + repetition_score + clarity_score + keyword_score)

    total = max(0, min(100, speech + delivery + content))

    fixes = []
    if wpm_score <= 10:
        fixes.append("Adjust pace to 120-160 WPM.")
    if filler_score <= 8:
        fixes.append("Reduce filler words with pauses.")
    if eye_score <= 10:
        fixes.append("Increase eye contact with the lens.")
    if clarity_score <= 8:
        fixes.append("Shorten sentences for clarity.")
    if keyword_score <= 5 and keywords:
        fixes.append("Cover target keywords.")

    drill = (
        "60-second pace drill"
        if speech < delivery and speech < content
        else "Eye contact mirror drill"
        if delivery < content
        else "Story arc outline drill"
    )

    return {
        "total": total,
        "speech": speech,
        "delivery": delivery,
        "content": content,
        "details": {
            "wpm": wpm_score,
            "fillers": filler_score,
            "pauses": pause_score,
            "eyeContact": eye_score,
            "smile": smile_score,
            "headStability": head_score,
            "structure": structure_score,
            "repetition": repetition_score,
            "clarity": clarity_score,
            "keywordCoverage": keyword_score,
        },
        "topFixes": fixes[:3],
        "recommendedDrill": drill,
    }
