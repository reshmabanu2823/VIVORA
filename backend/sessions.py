"""In-memory store. Nothing is written to disk. Entries expire after SESSION_TIMEOUT_MIN."""
import time
import uuid
from collections import defaultdict, deque

import config


class Store:
    def __init__(self):
        self.uploads: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self._hits: dict[str, deque] = defaultdict(deque)

    @staticmethod
    def new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:10]}"

    def _purge(self):
        cutoff = time.time() - config.SESSION_TIMEOUT_MIN * 60
        for bucket in (self.uploads, self.sessions):
            for k in [k for k, v in bucket.items() if v["touched"] < cutoff]:
                del bucket[k]
                self._hits.pop(k, None)

    def add_upload(self, sections: list[dict]) -> str:
        self._purge()
        uid = self.new_id("u")
        self.uploads[uid] = {"sections": sections, "touched": time.time()}
        return uid

    def get_upload(self, uid: str) -> dict | None:
        self._purge()
        u = self.uploads.get(uid)
        if u:
            u["touched"] = time.time()
        return u

    def add_session(self, data: dict) -> str:
        sid = self.new_id("s")
        data["touched"] = time.time()
        self.sessions[sid] = data
        return sid

    def get_session(self, sid: str) -> dict | None:
        self._purge()
        s = self.sessions.get(sid)
        if s:
            s["touched"] = time.time()
        return s

    def rate_ok(self, sid: str) -> bool:
        """Sliding one-minute window per session to protect the API budget."""
        now, q = time.time(), self._hits[sid]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= config.TURNS_PER_MINUTE_LIMIT:
            return False
        q.append(now)
        return True


store = Store()
