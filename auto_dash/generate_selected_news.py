#!/usr/bin/env python3
"""Generate selected news JSON from candidates.json using selected_news_prompt rules.

Policy highlights implemented:
- Stop when tomorrow (KST) is non-business day.
- Stop when candidates list is missing/empty.
- Build selected JSON only from articles whose body text can be fetched from URL.
- Select up to 20 articles with top-score and category balance.
- Conservative dedup by normalized URL and normalized title.
- Save selected articles to auto_dash/data/selected/YYYY/MM/news_YYYY-MM-DD.json.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
CANDIDATES_PATH = Path("auto_dash/candidates.json")
LABEL_RULES_PATH = Path("auto_dash/config/label_rules.json")
HOLIDAY_PATH = Path("auto_dash/config/kr_holidays.json")
SELECTED_ROOT = Path("auto_dash/data/selected")
MIN_BODY_CHARS = 250
MAX_SCAN_CANDIDATES = 80

BOILERPLATE_PATTERNS = [
    "무단전재", "무단 전재", "재배포 금지", "저작권자", "Copyright", "copyright",
    "구독", "댓글", "공유", "기사제보", "광고", "관련기사", "SNS", "페이스북",
    "트위터", "카카오톡", "네이버에서", "기자 페이지", "사진=", "자료=",
]
KEYWORD_STOPWORDS = {
    "기자", "뉴스", "관련", "이번", "지난", "올해", "내년", "최근", "현재", "통해",
    "대한", "위해", "면서", "따르면", "있다", "했다", "한다", "된다", "있는",
    "없는", "것으로", "이라고", "그리고", "하지만", "때문", "경우", "가운데",
    "금융", "대출", "은행", "보험", "시장", "정부",
}


@dataclass
class Candidate:
    raw: dict[str, Any]
    url: str
    naver_link: str
    title: str
    published_at: str
    publisher: str
    pre_score: float
    matched_keywords: list[str]


@dataclass
class VerifiedArticle:
    candidate: Candidate
    body_text: str
    used_url: str


def kst_today() -> date:
    return datetime.now(KST).date()


def parse_target_date(value: str | None) -> date:
    if value in (None, "", "today"):
        return kst_today()
    if value == "yesterday":
        return kst_today() - timedelta(days=1)
    if value == "tomorrow":
        return kst_today() + timedelta(days=1)
    return date.fromisoformat(value)


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", text)


def load_json(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(_strip_trailing_commas(raw))


def load_extra_holidays() -> set[str]:
    if not HOLIDAY_PATH.exists():
        return set()
    try:
        data = load_json(HOLIDAY_PATH)
    except Exception:
        return set()

    days: set[str] = set()
    if isinstance(data, dict):
        if isinstance(data.get("holidays"), list):
            for item in data["holidays"]:
                if isinstance(item, str):
                    days.add(item)
                elif isinstance(item, dict) and item.get("date"):
                    days.add(str(item["date"]))
        else:
            days.update(str(k) for k in data.keys())
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                days.add(item)
            elif isinstance(item, dict) and item.get("date"):
                days.add(str(item["date"]))
    return days


def is_non_business_day(day: date, extra_holidays: set[str]) -> bool:
    if day.weekday() >= 5:
        return True
    return day.isoformat() in extra_holidays


def normalize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url.strip())
    query = urllib.parse.urlencode(sorted(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)))
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), query, ""))


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^0-9A-Za-z가-힣 ]", " ", title.lower())).strip()


def load_candidates(path: Path) -> list[Candidate]:
    if not path.exists():
        return []
    data = load_json(path)
    rows: list[dict[str, Any]]
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict) and isinstance(data.get("articles"), list):
        rows = data["articles"]
    else:
        return []

    candidates: list[Candidate] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        url = str(row.get("url") or row.get("article_url") or row.get("originallink") or "").strip()
        naver_link = str(row.get("naver_link") or row.get("link") or "").strip()
        if not title or not url:
            continue
        candidates.append(
            Candidate(
                raw=row,
                url=url,
                naver_link=naver_link,
                title=title,
                published_at=str(row.get("published_at") or row.get("pubDate") or ""),
                publisher=str(row.get("source") or row.get("publisher") or row.get("press") or "unknown"),
                pre_score=float(row.get("pre_score") or 0),
                matched_keywords=[str(x) for x in (row.get("matched_keywords") or [])],
            )
        )
    candidates.sort(key=lambda c: (c.pre_score, c.published_at), reverse=True)
    return candidates


def load_labels(path: Path) -> list[dict[str, Any]]:
    data = load_json(path)
    return data.get("labels", []) if isinstance(data, dict) else []


def candidate_labels(c: Candidate, labels: list[dict[str, Any]]) -> list[str]:
    kws = set(k.lower() for k in c.matched_keywords)
    out: list[str] = []
    for label in labels:
        lk = [str(x).lower() for x in label.get("keywords", [])]
        if any(k in kws for k in lk):
            out.append(str(label.get("id")))
    return out


def dedup(candidates: list[Candidate]) -> list[Candidate]:
    seen_url: set[str] = set()
    seen_title: set[str] = set()
    out: list[Candidate] = []
    for c in candidates:
        nu = normalize_url(c.url)
        nt = normalize_title(c.title)
        if nu and nu in seen_url:
            continue
        if nt and nt in seen_title:
            continue
        seen_url.add(nu)
        seen_title.add(nt)
        out.append(c)
    return out


def candidate_pool(candidates: list[Candidate], labels: list[dict[str, Any]], max_scan: int = MAX_SCAN_CANDIDATES) -> list[Candidate]:
    """Build a larger ordered pool so failed body fetches can be skipped while still filling up to 20 articles."""
    pool = dedup(candidates)
    ordered: list[Candidate] = []
    seen: set[str] = set()

    def add(c: Candidate) -> None:
        key = normalize_url(c.url)
        if key and key not in seen:
            ordered.append(c)
            seen.add(key)

    for c in pool[:20]:
        add(c)

    for label in sorted(labels, key=lambda x: int(x.get("order", 999))):
        lid = str(label.get("id"))
        count = 0
        for c in pool:
            if lid in candidate_labels(c, labels):
                add(c)
                count += 1
                if count >= 8:
                    break

    for c in pool:
        if len(ordered) >= max_scan:
            break
        add(c)

    return ordered[:max_scan]


def output_path_for(run_day: date) -> Path:
    return SELECTED_ROOT / f"{run_day.year:04d}" / f"{run_day.month:02d}" / f"news_{run_day.isoformat()}.json"


def clean_text(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def remove_boilerplate(text: str) -> str:
    lines = []
    for line in re.split(r"[\r\n]+|(?<=[.!?。])\s+", text):
        line = clean_text(line)
        if len(line) < 25:
            continue
        if any(pattern in line for pattern in BOILERPLATE_PATTERNS):
            continue
        lines.append(line)
    return " ".join(lines)


def extract_jsonld_article_body(page: str) -> str:
    bodies: list[str] = []
    scripts = re.findall(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        page,
        flags=re.IGNORECASE | re.DOTALL,
    )

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key in {"articleBody", "description"} and isinstance(value, str):
                    cleaned = remove_boilerplate(value)
                    if cleaned:
                        bodies.append(cleaned)
                else:
                    walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    for script in scripts:
        try:
            walk(json.loads(html.unescape(script.strip())))
        except Exception:
            continue

    return max(bodies, key=len) if bodies else ""


def extract_paragraph_text(page: str) -> str:
    page = re.sub(r"<!--.*?-->", " ", page, flags=re.DOTALL)
    page = re.sub(r"<(script|style|noscript|svg|header|footer|nav|aside)[^>]*>.*?</\1>", " ", page, flags=re.IGNORECASE | re.DOTALL)

    article_blocks = re.findall(r"<article[^>]*>(.*?)</article>", page, flags=re.IGNORECASE | re.DOTALL)
    target = " ".join(article_blocks) if article_blocks else page

    paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", target, flags=re.IGNORECASE | re.DOTALL)
    if len(paragraphs) < 3:
        paragraphs = re.split(r"</(?:div|section|br|p|li|h[1-6])\s*>", target, flags=re.IGNORECASE)

    cleaned: list[str] = []
    seen: set[str] = set()
    for paragraph in paragraphs:
        text = clean_text(paragraph)
        if len(text) < 35:
            continue
        if any(pattern in text for pattern in BOILERPLATE_PATTERNS):
            continue
        key = text[:80]
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)

    return " ".join(cleaned)


def extract_article_text(page: str) -> str:
    jsonld = extract_jsonld_article_body(page)
    paragraph_text = extract_paragraph_text(page)
    body = jsonld if len(jsonld) > len(paragraph_text) else paragraph_text
    return remove_boilerplate(body)


def fetch_url_text(url: str, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; selected-news-generator/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return ""
        charset = response.headers.get_content_charset() or "utf-8"
        raw = response.read()
    try:
        page = raw.decode(charset, errors="replace")
    except LookupError:
        page = raw.decode("utf-8", errors="replace")
    return extract_article_text(page)


def verify_article(c: Candidate) -> VerifiedArticle | None:
    tried: set[str] = set()
    for url in [c.url, c.naver_link]:
        if not url:
            continue
        normalized = normalize_url(url)
        if normalized in tried:
            continue
        tried.add(normalized)
        try:
            body_text = fetch_url_text(url)
        except Exception as exc:
            print(f"[WARN] 본문 확인 실패: {c.title} / {url} / {exc}")
            continue
        if len(body_text) >= MIN_BODY_CHARS:
            return VerifiedArticle(candidate=c, body_text=body_text, used_url=url)
        print(f"[WARN] 본문 길이 부족: {c.title} / {url}")
    return None


def split_sentences(text: str) -> list[str]:
    text = clean_text(text)
    # Avoid variable-width lookbehind: first mark sentence boundaries, then split.
    text = re.sub(r"([.!?。])\s+", r"\1\n", text)
    text = re.sub(r"((?:다|요|임|음)\.)\s+", r"\1\n", text)
    parts = text.splitlines()
    sentences: list[str] = []
    for part in parts:
        part = part.strip()
        if 35 <= len(part) <= 260:
            sentences.append(part)
    if not sentences:
        sentences = [text[:260]]
    return sentences


def summarize_body(title: str, body_text: str, max_sentences: int = 3) -> str:
    sentences = split_sentences(body_text)
    title_terms = {
        t.lower()
        for t in re.findall(r"[A-Za-z0-9가-힣]{2,}", title)
        if t.lower() not in KEYWORD_STOPWORDS
    }
    finance_terms = {
        "대출", "가계대출", "신용대출", "주담대", "금리", "연체", "DSR", "규제",
        "보험", "은행", "상환", "부동산", "금융위", "금감원", "저신용", "중금리",
    }

    scored: list[tuple[float, int, str]] = []
    for idx, sentence in enumerate(sentences[:25]):
        lower = sentence.lower()
        score = 0.0
        score += max(0, 8 - idx) * 0.35
        score += sum(1.6 for term in title_terms if term in lower)
        score += sum(1.0 for term in finance_terms if term.lower() in lower)
        scored.append((score, idx, sentence))

    selected = sorted(sorted(scored, reverse=True)[:max_sentences], key=lambda x: x[1])
    summary_sentences = [sentence for _, _, sentence in selected]
    return " ".join(summary_sentences)


def extract_keywords_from_body(body_text: str, c: Candidate, labels: list[dict[str, Any]], limit: int = 4) -> list[str]:
    text_lower = body_text.lower()
    keywords: list[str] = []

    def add(term: str) -> None:
        term = term.strip()
        if term and term not in keywords:
            keywords.append(term)

    for term in c.matched_keywords:
        if term and term.lower() in text_lower:
            add(str(term))

    for label in labels:
        for term in label.get("keywords", []):
            term_str = str(term)
            if term_str.lower() in text_lower:
                add(term_str)
            if len(keywords) >= limit:
                return keywords[:limit]

    tokens = re.findall(r"[A-Za-z]{2,}|[가-힣]{2,}", body_text)
    counter: Counter[str] = Counter()
    for token in tokens:
        if token in KEYWORD_STOPWORDS:
            continue
        if len(token) < 2 or len(token) > 12:
            continue
        counter[token] += 1

    for token, _ in counter.most_common(20):
        add(token)
        if len(keywords) >= limit:
            break

    return keywords[:limit] or ["뉴스"]


def reason_from_body(c: Candidate, body_text: str) -> str:
    text = body_text[:1200]
    if any(term in text for term in ["규제", "금융위", "금감원", "DSR", "정책"]):
        return "대출 규제·정책 변화 가능성이 있어 소매여신 영업과 리스크 관리에 참고가 필요함"
    if any(term in text for term in ["연체", "부실", "NPL", "취약차주", "저신용"]):
        return "차주 건전성 및 연체 리스크 흐름을 파악하는 데 참고가 필요함"
    if any(term in text for term in ["금리", "기준금리", "시장금리", "채권"]):
        return "금리 환경 변화가 대출 수요와 상환 흐름에 영향을 줄 수 있음"
    if any(term in text for term in ["주택", "부동산", "주담대", "전세"]):
        return "부동산·주담대 수요 변화가 개인대출 물량 흐름에 영향을 줄 수 있음"
    return "pre_score, 기사 본문 내용, 키워드 매칭을 기준으로 소매여신 업무 참고 가치가 있다고 판단됨"


def rating_from_body(c: Candidate, body_text: str) -> int:
    score = c.pre_score
    body = body_text[:1500]
    if any(term in body for term in ["금융위", "금감원", "DSR", "가계대출", "신용평가", "연체율"]):
        score += 10
    if any(term in body for term in ["보험", "생명보험", "약관대출", "보험사"]):
        score += 8
    if score >= 90:
        return 5
    if score >= 70:
        return 4
    if score >= 45:
        return 3
    if score >= 25:
        return 2
    return 1


def build_record(item_id: str, verified: VerifiedArticle, labels: list[dict[str, Any]]) -> dict[str, Any]:
    c = verified.candidate
    body_text = verified.body_text
    return {
        "id": item_id,
        "title": c.title,
        "publisher": c.publisher,
        "published_at": c.published_at,
        "checkyn": "Y",
        "summary": summarize_body(c.title, body_text),
        "keywords": extract_keywords_from_body(body_text, c, labels),
        "reason": reason_from_body(c, body_text),
        "URL": verified.used_url,
        "rating": rating_from_body(c, body_text),
    }


def assign_ids(selected: list[VerifiedArticle], labels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    for i, verified in enumerate(selected[:5], start=1):
        records.append(build_record(f"top_{i:02d}", verified, labels))

    remaining = selected[5:]
    counts: dict[str, int] = {}
    sorted_labels = sorted(labels, key=lambda x: int(x.get("order", 999)))
    label_ids = [str(x.get("id")) for x in sorted_labels if x.get("id") is not None]
    label_index = {lid: idx + 1 for idx, lid in enumerate(label_ids)}

    for verified in remaining:
        c = verified.candidate
        lids = candidate_labels(c, labels)
        lid = lids[0] if lids else (label_ids[0] if label_ids else "cat1")
        cat_no = label_index.get(lid, 1)
        counts[lid] = counts.get(lid, 0) + 1
        records.append(build_record(f"cat{cat_no}_{counts[lid]:02d}", verified, labels))

    return records


def save_selected(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate selected news JSON from auto_dash/candidates.json")
    parser.add_argument("--run-date", default="today", help="today|yesterday|YYYY-MM-DD (KST)")
    parser.add_argument("--candidates", default=str(CANDIDATES_PATH))
    parser.add_argument("--labels", default=str(LABEL_RULES_PATH))
    parser.add_argument("--max-items", type=int, default=20)
    args = parser.parse_args()

    run_day = parse_target_date(args.run_date)
    tomorrow = run_day + timedelta(days=1)
    holidays = load_extra_holidays()

    if is_non_business_day(tomorrow, holidays):
        print("비영업일이므로 실행 종료")
        return 0

    candidates = load_candidates(Path(args.candidates))
    if not candidates:
        print("기사 후보 목록이 없어 실행 종료")
        return 0

    labels = load_labels(Path(args.labels))
    pool = candidate_pool(candidates, labels)
    verified_articles: list[VerifiedArticle] = []

    for candidate in pool:
        verified = verify_article(candidate)
        if not verified:
            continue
        verified_articles.append(verified)
        if len(verified_articles) >= max(1, args.max_items):
            break

    if not verified_articles:
        print("본문 확인 가능한 최종 선정 기사가 0건이므로 파일 생성 없이 종료")
        return 0

    output_path = output_path_for(run_day)
    rows = assign_ids(verified_articles[: args.max_items], labels)
    save_selected(output_path, rows)

    print(f"본문 확인 완료 기사 {len(rows)}건 저장 완료")
    print(f"저장 경로: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
