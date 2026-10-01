"""Read a PDF / DOCX / pasted text and split it into labelled sections."""
import io
import re

MIN_SECTION_WORDS = 40
MAX_SECTION_WORDS = 900
CHUNK_WORDS = 700
CHUNK_OVERLAP = 80

KEYWORD_HEADINGS = {
    "abstract", "introduction", "problem statement", "objectives", "scope", "project scope",
    "methodology", "proposed system", "system architecture", "architecture", "implementation",
    "results", "results and discussion", "challenges", "limitations", "conclusion",
    "future scope", "references", "literature review", "background", "acknowledgement",
}
SKIP_TITLES = {"references", "acknowledgement", "acknowledgements", "index", "table of contents",
               "contents", "bibliography", "declaration", "certificate"}

HEADING_RE = re.compile(r"^(?:(?:chapter|section)\s+)?\d+(?:\.\d+)*[.)]?\s+[A-Za-z][^\n]{2,70}$", re.I)


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        if not text.strip():
            raise ValueError("No readable text found in this PDF (it may be scanned). Paste the text instead.")
        return text
    if name.endswith(".docx"):
        from docx import Document
        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        text = "\n".join(parts)
        if not text.strip():
            raise ValueError("This DOCX has no readable text.")
        return text
    raise ValueError("Unsupported file type. Upload a .pdf or .docx, or paste text.")


def _is_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 80:
        return False
    if HEADING_RE.match(s):
        return True
    if s.lower().rstrip(":") in KEYWORD_HEADINGS:
        return True
    return s.isupper() and 3 <= len(s) <= 60 and len(s.split()) <= 8


def _words(text: str) -> list[str]:
    return text.split()


def _chunk(text: str, size: int = CHUNK_WORDS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    words = _words(text)
    if len(words) <= size:
        return [text.strip()]
    chunks, start = [], 0
    while start < len(words):
        chunks.append(" ".join(words[start:start + size]))
        if start + size >= len(words):
            break
        start += size - overlap
    return chunks


def split_sections(text: str) -> list[dict]:
    text = re.sub(r"\r\n?", "\n", text).strip()
    if not text:
        return []

    raw: list[tuple[str, list[str]]] = []
    title, buf = "Overview", []
    found_heading = False
    for line in text.split("\n"):
        if _is_heading(line):
            found_heading = True
            if buf:
                raw.append((title, buf))
            title, buf = re.sub(r"^\d+(?:\.\d+)*[.)]?\s+", "", line.strip()).rstrip(":").title(), []
        else:
            buf.append(line)
    raw.append((title, buf))

    merged: list[list] = []
    for t, lines in raw:
        body = "\n".join(lines).strip()
        wc = len(_words(body))
        if wc == 0:
            continue
        if wc < MIN_SECTION_WORDS and merged:
            merged[-1][1] += "\n" + body          # fold tiny section into the previous one
        else:
            merged.append([t, body])

    if not found_heading or len(merged) <= 1:
        total = merged[0][1] if merged else text
        if len(_words(total)) > MAX_SECTION_WORDS:
            merged = [[f"Part {i + 1}", c] for i, c in enumerate(_chunk(total))]

    sections: list[dict] = []
    for t, body in merged:
        pieces = _chunk(body, MAX_SECTION_WORDS, CHUNK_OVERLAP) if len(_words(body)) > MAX_SECTION_WORDS else [body]
        for k, piece in enumerate(pieces):
            label = t if len(pieces) == 1 else f"{t} (part {k + 1})"
            sections.append({"id": len(sections) + 1, "title": label, "text": piece,
                             "word_count": len(_words(piece))})
    return sections


def eligible_sections(sections: list[dict]) -> list[dict]:
    ok = [s for s in sections if s["word_count"] >= MIN_SECTION_WORDS and s["title"].lower() not in SKIP_TITLES]
    return ok or sections
