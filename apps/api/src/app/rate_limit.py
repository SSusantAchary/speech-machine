import time
from collections import defaultdict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request, status

WINDOW_SECONDS = 60
_hits: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(limit: int) -> Callable:
    def dependency(request: Request) -> None:
        client = request.client.host if request.client else "unknown"
        key = f"{client}:{request.url.path}"
        now = time.time()
        window_start = now - WINDOW_SECONDS
        bucket = _hits[key]
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Try again shortly.",
            )
        bucket.append(now)

    return dependency
