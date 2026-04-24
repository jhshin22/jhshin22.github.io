#!/usr/bin/env python3
"""
Naver News API collector for loan/finance dashboard.

- Searches Naver News API with predefined loan/finance keywords.
- Appends newly discovered articles to one JSON file only once.
- Deduplicates by normalized URL first, then by title/source/date fallback.

Required environment variables:
  NAVER_CLIENT_ID
  NAVER_CLIENT_SECRET

Default output:
  auto_dash/articles_raw.json
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
NAVER_NEWS_API_URL = "https://openapi.naver.com/v1/search/news.json"

KEYWORDS = [
    "가계대출",
    "신용대출",
    "주택담보대출",
    "주담대",
    "전세대출",
    "보험계약대출",
    "약관대출",
    "대환대출",
    "카드론",
    "현금서비스",
    "마이너스통장",
    "DSR",
    "DTI",
    "LTV",
    "가계부채",
    "연체율",
    "대출 규제",
    "대출 금리",
    "대출 갈아타기",
    "채무조정",
    "개인회생",
    "소상공인 대출",
    "자영업자 대출",
    "금융위원회 대출",
    "금융감독원 대출",
    "은행권 대출",
    "보험사 대출",
    "생명보험 대출",
    "저축은행 대출",
    "카드사 대출",
    "부동산 대출",
    "주택시장 대출",
]

TRUSTED_SOURCES = [
    "연합뉴스",
    "한국경제",
    "매일경제",
    "머니투데이",
    "이데일리",
    "서울경제",
    "파이낸셜뉴스",
    "조선비즈",
    "비즈워치",
    "대한금융신문",
    "금융경제신문",
    "뉴스1",
    "뉴시스",
    "아시아경제",
    "헤럴드경제",
    "디지털타임스",
    "전자신문",
]

EXCLUDE_HINTS = [
    "분양 홍보",
    "모집공고",
    "이벤트",
    "특가",
    "추천주",
    "증시",
    "코인",
    "가상자산",
]

TAG_RE = re.compile(r"<[^>]+>")
TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = TAG_RE.sub("", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url.strip())
    query_pairs = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in TRACKING_QUERY_KEYS
    ]
    query = urllib.parse.urlencode(query_pairs, doseq=True)
    normalized = urllib.parse.urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), query, "")
    )
    return normalized


def article_id(url: str, title: str, source: str, published_at: str) -> str:
    base = normalize_url(url) or f"{title}|{source}|{published_at[:10]}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def parse_naver_pubdate(pubdate: str) -> str | None:
    try:
        dt = parsedate_to_datetime(pubdate)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(KST).isoformat(timespec="seconds")
    except Exception:
        return None


def load_articles(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        backup = path.with_suffix(path.suffix + f".broken-{int(time.time())}")
        path.rename(backup)
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("articles"), list):
        return data["articles"]
    return []


def save_articles(path: Path, articles: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(articles),
        "articles": articles,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def source_from_item(item: dict[str, Any]) -> str:
    # Naver News API does not provide a clean media name field.
    # For now, infer from originallink domain when possible and keep source as unknown.
    # ChatGPT/future enrichment can classify the source later.
    url = item.get("originallink") or item.get("link") or ""
    host = urllib.parse.urlsplit(url).netloc.lower().replace("www.", "")
    return host or "unknown"


def matched_keywords(title: str, description: str, keyword: str) -> list[str]:
    text = f"{title} {description}".lower()
    matched = {keyword}
    for kw in KEYWORDS:
        if kw.lower() in text:
            matched.add(kw)
    return sorted(matched)


def pre_score(title: str, description: str, source: str, keywords: list[str]) -> int:
    text = f"{title} {description}"
    score = 0
    direct_terms = ["대출", "DSR", "가계부채", "연체율", "대환", "담보", "채무조정"]
    institution_terms = ["금융위원회", "금융위", "금융감독원", "금감원", "은행", "보험사", "저축은행", "카드사"]

    score += min(len(keywords) * 8, 32)
    if any(term in text for term in direct_terms):
        score += 30
    if any(term in text for term in institution_terms):
        score += 15
    if any(src in source for src in TRUSTED_SOURCES):
        score += 10
    if any(hint in text for hint in EXCLUDE_HINTS):
        score -= 20
    return max(score, 0)


def search_naver(keyword: str, display: int, start: int, sort: str) -> list[dict[str, Any]]:
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("NAVER_CLIENT_ID and NAVER_CLIENT_SECRET environment variables are required.")

    params = urllib.parse.urlencode(
        {
            "query": keyword,
            "display": display,
            "start": start,
            "sort": sort,
        }
    )
    request = urllib.request.Request(f"{NAVER_NEWS_API_URL}?{params}")
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)

    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    data = json.loads(body)
    return data.get("items", [])


def collect(output_path: Path, days: int, display: int, pages: int, sleep_seconds: float, sort: str) -> tuple[int, int]:
    now = datetime.now(KST)
    cutoff = now - timedelta(days=days)

    articles = load_articles(output_path)
    existing_ids = {a.get("id") for a in articles if a.get("id")}
    existing_urls = {normalize_url(a.get("url", "")) for a in articles if a.get("url")}
    added = 0
    seen_in_run: set[str] = set()

    for keyword in KEYWORDS:
        for page in range(pages):
            start = page * display + 1
            try:
                items = search_naver(keyword=keyword, display=display, start=start, sort=sort)
            except Exception as exc:
                print(f"[WARN] keyword={keyword!r} start={start}: {exc}")
                continue

            for item in items:
                title = clean_text(item.get("title"))
                description = clean_text(item.get("description"))
                url = item.get("originallink") or item.get("link") or ""
                naver_link = item.get("link") or ""
                norm_url = normalize_url(url)
                published_at = parse_naver_pubdate(item.get("pubDate", ""))
                if not title or not norm_url or not published_at:
                    continue

                published_dt = datetime.fromisoformat(published_at)
                if published_dt < cutoff:
                    continue

                source = source_from_item(item)
                aid = article_id(norm_url, title, source, published_at)
                if aid in existing_ids or norm_url in existing_urls or aid in seen_in_run:
                    # Existing article: add newly matched keyword if needed.
                    for article in articles:
                        if article.get("id") == aid or normalize_url(article.get("url", "")) == norm_url:
                            kws = set(article.get("matched_keywords", []))
                            kws.update(matched_keywords(title, description, keyword))
                            article["matched_keywords"] = sorted(kws)
                            break
                    continue

                kws = matched_keywords(title, description, keyword)
                article = {
                    "id": aid,
                    "title": title,
                    "source": source,
                    "published_at": published_at,
                    "collected_at": now.isoformat(timespec="seconds"),
                    "url": norm_url,
                    "naver_link": naver_link,
                    "origin": "naver_news_api",
                    "matched_keywords": kws,
                    "description": description,
                    "pre_score": pre_score(title, description, source, kws),
                    "flags": {
                        "trusted_source": any(src in source for src in TRUSTED_SOURCES),
                        "domestic": True,
                        "loan_related": "대출" in f"{title} {description}" or any(k in kws for k in ["DSR", "DTI", "LTV", "가계부채", "연체율"]),
                        "possible_ad": any(hint in f"{title} {description}" for hint in EXCLUDE_HINTS),
                    },
                }
                articles.append(article)
                existing_ids.add(aid)
                existing_urls.add(norm_url)
                seen_in_run.add(aid)
                added += 1

            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    articles.sort(key=lambda x: (x.get("published_at", ""), x.get("pre_score", 0)), reverse=True)
    save_articles(output_path, articles)
    return added, len(articles)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Naver News API articles into a single deduplicated JSON file.")
    parser.add_argument("--output", default="auto_dash/articles_raw.json", help="Output JSON path")
    parser.add_argument("--days", type=int, default=2, help="Collect articles newer than now - DAYS")
    parser.add_argument("--display", type=int, default=20, help="Naver API results per page, max 100")
    parser.add_argument("--pages", type=int, default=1, help="Pages per keyword")
    parser.add_argument("--sleep", type=float, default=0.2, help="Sleep seconds between API calls")
    parser.add_argument("--sort", choices=["date", "sim"], default="date", help="Naver API sort mode")
    args = parser.parse_args()

    added, total = collect(
        output_path=Path(args.output),
        days=args.days,
        display=min(max(args.display, 1), 100),
        pages=max(args.pages, 1),
        sleep_seconds=max(args.sleep, 0),
        sort=args.sort,
    )
    print(f"Added {added} new articles. Total: {total}")


if __name__ == "__main__":
    main()
