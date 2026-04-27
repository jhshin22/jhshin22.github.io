#!/usr/bin/env python3
"""
Build candidate articles for AI selection.

Workflow:
- Calculate today/tomorrow in Korea Standard Time.
- Stop when tomorrow is a non-business day.
- Review dates are all dates from the previous business day through today.
  Example: if today is Monday, review dates are Friday, Saturday, Sunday, Monday.
- Load all raw JSON files for the review dates.
- Keep only articles whose published_at date is one of the review dates.
- Sort by pre_score descending, then published_at descending.
- Deduplicate first by URL, then conservatively by normalized title.
- Save the result to auto_dash/candidates.json so downstream prompts can keep a stable path.

This script intentionally does not modify the raw collection/scoring logic.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
DEFAULT_RAW_ROOT = Path("auto_dash/data/raw")
DEFAULT_LEGACY_ROOT = Path("auto_dash")
DEFAULT_OUTPUT_PATH = Path("auto_dash/candidates.json")
DEFAULT_HOLIDAY_CONFIG = Path("auto_dash/config/kr_holidays.json")
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

# Built-in fallback for 2026 Korea public holidays and substitute holidays.
# Optional dependency support: if the `holidays` package is installed, it is used first.
# Optional config support: auto_dash/config/kr_holidays.json can add/override dates.
BUILTIN_KR_HOLIDAYS: dict[str, str] = {
    "2026-01-01": "신정",
    "2026-02-16": "설날 연휴",
    "2026-02-17": "설날",
    "2026-02-18": "설날 연휴",
    "2026-03-01": "삼일절",
    "2026-03-02": "삼일절 대체공휴일",
    "2026-05-05": "어린이날",
    "2026-05-24": "부처님오신날",
    "2026-05-25": "부처님오신날 대체공휴일",
    "2026-06-03": "전국동시지방선거",
    "2026-06-06": "현충일",
    "2026-08-15": "광복절",
    "2026-08-17": "광복절 대체공휴일",
    "2026-09-24": "추석 연휴",
    "2026-09-25": "추석",
    "2026-09-26": "추석 연휴",
    "2026-10-03": "개천절",
    "2026-10-05": "개천절 대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "성탄절",
}


def kst_today() -> date:
    return datetime.now(KST).date()


def parse_target_date(value: str | None) -> date:
    if not value or value == "today":
        return kst_today()
    if value == "yesterday":
        return kst_today() - timedelta(days=1)
    if value == "tomorrow":
        return kst_today() + timedelta(days=1)
    return date.fromisoformat(value)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_extra_holidays(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        data = read_json(path)
    except Exception as exc:
        print(f"[WARN] Failed to read holiday config {path}: {exc}", file=sys.stderr)
        return {}

    if isinstance(data, dict):
        if isinstance(data.get("holidays"), list):
            result: dict[str, str] = {}
            for item in data["holidays"]:
                if isinstance(item, str):
                    result[item] = "config holiday"
                elif isinstance(item, dict) and item.get("date"):
                    result[str(item["date"])] = str(item.get("name") or "config holiday")
            return result
        return {str(k): str(v) for k, v in data.items()}

    if isinstance(data, list):
        result = {}
        for item in data:
            if isinstance(item, str):
                result[item] = "config holiday"
            elif isinstance(item, dict) and item.get("date"):
                result[str(item["date"])] = str(item.get("name") or "config holiday")
        return result

    return {}


def holiday_name(day: date, extra_holidays: dict[str, str]) -> str | None:
    day_key = day.isoformat()
    if day_key in extra_holidays:
        return extra_holidays[day_key]

    try:
        import holidays  # type: ignore

        kr_holidays = holidays.country_holidays("KR", years=[day.year])
        if day in kr_holidays:
            return str(kr_holidays[day])
    except Exception:
        pass

    return BUILTIN_KR_HOLIDAYS.get(day_key)


def is_business_day(day: date, extra_holidays: dict[str, str]) -> bool:
    if day.weekday() >= 5:
        return False
    return holiday_name(day, extra_holidays) is None


def non_business_reason(day: date, extra_holidays: dict[str, str]) -> str | None:
    if day.weekday() >= 5:
        return "weekend"
    name = holiday_name(day, extra_holidays)
    if name:
        return name
    return None


def previous_business_day(today: date, extra_holidays: dict[str, str]) -> date:
    cursor = today - timedelta(days=1)
    while not is_business_day(cursor, extra_holidays):
        cursor -= timedelta(days=1)
    return cursor


def review_dates_for(today: date, extra_holidays: dict[str, str]) -> list[date]:
    prev = previous_business_day(today, extra_holidays)
    days = []
    cursor = prev
    while cursor <= today:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(str(value))
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
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), query, "")
    )


def article_url_key(article: dict[str, Any]) -> str:
    return normalize_url(str(article.get("url") or article.get("naver_link") or ""))


def normalize_title(title: str) -> str:
    title = clean_text(title).lower()
    title = title.replace("…", "...")
    title = re.sub(r"\s+", " ", title).strip()

    # Conservative cleanup: remove only common leading news labels.
    leading_label_re = re.compile(r"^\s*[\[\(（【](단독|속보|종합|영상|그래픽|포토|인터뷰|르포|해설)[\]\)）】]\s*")
    previous = None
    while previous != title:
        previous = title
        title = leading_label_re.sub("", title).strip()

    # Normalize quotation marks and repeated whitespace, but keep content words and numbers.
    title = re.sub(r"[\"'‘’“”]", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def parse_article_datetime(article: dict[str, Any]) -> datetime | None:
    value = str(article.get("published_at") or article.get("published_date") or "")
    if not value:
        return None
    try:
        if len(value) == 10:
            return datetime.fromisoformat(value).replace(tzinfo=KST)
        return datetime.fromisoformat(value).astimezone(KST)
    except Exception:
        try:
            return datetime.fromisoformat(value[:10]).replace(tzinfo=KST)
        except Exception:
            return None


def article_date(article: dict[str, Any]) -> date | None:
    parsed = parse_article_datetime(article)
    return parsed.date() if parsed else None


def article_sort_key(article: dict[str, Any]) -> tuple[int, str]:
    score = int(article.get("pre_score") or 0)
    published = str(article.get("published_at") or article.get("published_date") or "")
    return (score, published)


def raw_paths_for(day: date, raw_root: Path, legacy_root: Path) -> list[Path]:
    year = f"{day.year:04d}"
    month = f"{day.month:02d}"
    filename = f"articles_raw_{day.isoformat()}.json"
    paths = [
        raw_root / year / month / filename,
        legacy_root / filename,
    ]
    # Keep legacy all-in-one file as a final fallback because older data may still live there.
    if day == kst_today() or (legacy_root / "articles_raw.json").exists():
        paths.append(legacy_root / "articles_raw.json")
    return paths


def extract_articles(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("articles"), list):
        return [item for item in payload["articles"] if isinstance(item, dict)]
    return []


def load_raw_articles(review_dates: list[date], raw_root: Path, legacy_root: Path) -> tuple[list[dict[str, Any]], list[str]]:
    loaded: list[dict[str, Any]] = []
    source_files: list[str] = []
    seen_files: set[Path] = set()

    for day in review_dates:
        for path in raw_paths_for(day, raw_root, legacy_root):
            path = path.resolve()
            if path in seen_files or not path.exists():
                continue
            seen_files.add(path)
            try:
                payload = read_json(path)
            except Exception as exc:
                print(f"[WARN] Failed to read raw JSON {path}: {exc}", file=sys.stderr)
                continue
            articles = extract_articles(payload)
            loaded.extend(articles)
            source_files.append(str(path.relative_to(Path.cwd())) if path.is_relative_to(Path.cwd()) else str(path))

    return loaded, source_files


def filter_by_review_dates(articles: list[dict[str, Any]], review_dates: list[date]) -> list[dict[str, Any]]:
    allowed = {day.isoformat() for day in review_dates}
    result = []
    for article in articles:
        day = article_date(article)
        if day and day.isoformat() in allowed:
            result.append(article)
    return result


def dedupe_by_url(articles: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    seen: set[str] = set()
    result = []
    removed = 0
    for article in articles:
        key = article_url_key(article)
        if key and key in seen:
            removed += 1
            continue
        if key:
            seen.add(key)
        result.append(article)
    return result, removed


def dedupe_by_title_conservative(articles: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    seen: set[str] = set()
    result = []
    removed = 0
    for article in articles:
        title_key = normalize_title(str(article.get("title") or ""))
        # Be conservative: skip title dedupe for short or empty titles.
        if title_key and len(title_key) >= 18:
            if title_key in seen:
                removed += 1
                continue
            seen.add(title_key)
        result.append(article)
    return result, removed


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_skip_payload(today: date, tomorrow: date, reason: str) -> dict[str, Any]:
    return {
        "run_status": "skipped_non_business_tomorrow",
        "reason": reason,
        "today": today.isoformat(),
        "tomorrow": tomorrow.isoformat(),
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "review_dates": [],
        "count": 0,
        "source_files": [],
        "articles": [],
    }


def build_candidates(
    today: date,
    raw_root: Path,
    legacy_root: Path,
    output_path: Path,
    holiday_config_path: Path,
    force: bool = False,
    write_skip_file: bool = True,
) -> dict[str, Any]:
    extra_holidays = load_extra_holidays(holiday_config_path)
    tomorrow = today + timedelta(days=1)
    tomorrow_reason = non_business_reason(tomorrow, extra_holidays)

    if tomorrow_reason and not force:
        payload = build_skip_payload(today, tomorrow, tomorrow_reason)
        if write_skip_file:
            write_json(output_path, payload)
        return payload

    review_dates = review_dates_for(today, extra_holidays)
    raw_articles, source_files = load_raw_articles(review_dates, raw_root, legacy_root)
    filtered = filter_by_review_dates(raw_articles, review_dates)
    filtered.sort(key=article_sort_key, reverse=True)

    url_deduped, url_removed = dedupe_by_url(filtered)
    title_deduped, title_removed = dedupe_by_title_conservative(url_deduped)
    title_deduped.sort(key=article_sort_key, reverse=True)

    payload = {
        "run_status": "ok",
        "today": today.isoformat(),
        "tomorrow": tomorrow.isoformat(),
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "review_dates": [day.isoformat() for day in review_dates],
        "review_start_date": review_dates[0].isoformat() if review_dates else None,
        "review_end_date": review_dates[-1].isoformat() if review_dates else None,
        "count": len(title_deduped),
        "source_files": source_files,
        "stats": {
            "raw_loaded": len(raw_articles),
            "after_review_date_filter": len(filtered),
            "url_duplicates_removed": url_removed,
            "title_duplicates_removed": title_removed,
        },
        "dedupe_policy": {
            "url": "normalize URL and remove common tracking query parameters",
            "title": "exact match after conservative normalization; ignored when normalized title length < 18",
        },
        "articles": title_deduped,
    }
    write_json(output_path, payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build stable candidates.json from raw article JSON files.")
    parser.add_argument("--today", default="today", help="KST today override: today, yesterday, tomorrow, or YYYY-MM-DD")
    parser.add_argument("--raw-root", default=str(DEFAULT_RAW_ROOT), help="Raw JSON root directory")
    parser.add_argument("--legacy-root", default=str(DEFAULT_LEGACY_ROOT), help="Legacy auto_dash root for fallback raw JSON")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Output candidates JSON path")
    parser.add_argument("--holiday-config", default=str(DEFAULT_HOLIDAY_CONFIG), help="Optional holiday config JSON path")
    parser.add_argument("--force", action="store_true", help="Build candidates even when tomorrow is a non-business day")
    parser.add_argument("--no-write-skip", action="store_true", help="Do not write candidates.json when tomorrow is a non-business day")
    args = parser.parse_args()

    today = parse_target_date(args.today)
    payload = build_candidates(
        today=today,
        raw_root=Path(args.raw_root),
        legacy_root=Path(args.legacy_root),
        output_path=Path(args.output),
        holiday_config_path=Path(args.holiday_config),
        force=args.force,
        write_skip_file=not args.no_write_skip,
    )

    print(f"Run status: {payload.get('run_status')}")
    print(f"Today: {payload.get('today')}")
    print(f"Tomorrow: {payload.get('tomorrow')}")
    if payload.get("reason"):
        print(f"Reason: {payload.get('reason')}")
    print(f"Review dates: {', '.join(payload.get('review_dates') or []) or '-'}")
    print(f"Candidates: {payload.get('count')}")
    print(f"Output: {Path(args.output)}")


if __name__ == "__main__":
    main()
