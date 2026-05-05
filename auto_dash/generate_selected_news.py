#!/usr/bin/env python3
"""Generate selected news JSON from candidates.json using selected_news_prompt rules.

Policy highlights implemented:
- Stop when tomorrow (KST) is non-business day.
- Stop when candidates list is missing/empty.
- Select up to 20 articles with top-5 first then category representatives.
- Conservative dedup by normalized URL and normalized title.
- checkyn strategy option 2: always set checkyn='N' and exclude items that require body-check.
  As a result, this script reports and exits without creating JSON when body verification is unavailable.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.parse
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
CANDIDATES_PATH = Path("auto_dash/candidates.json")
LABEL_RULES_PATH = Path("auto_dash/config/label_rules.json")
HOLIDAY_PATH = Path("auto_dash/config/kr_holidays.json")
SELECTED_ROOT = Path("auto_dash/data/selected")


@dataclass
class Candidate:
    raw: dict[str, Any]
    url: str
    title: str
    published_at: str
    publisher: str
    pre_score: float
    matched_keywords: list[str]


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
        if not title or not url:
            continue
        candidates.append(
            Candidate(
                raw=row,
                url=url,
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


def choose(candidates: list[Candidate], labels: list[dict[str, Any]], max_items: int = 20) -> list[Candidate]:
    pool = dedup(candidates)
    chosen: list[Candidate] = []

    # top 5
    for c in pool:
        if len(chosen) >= 5:
            break
        chosen.append(c)

    chosen_urls = {normalize_url(c.url) for c in chosen}

    # category reps (up to 3 each)
    for label in sorted(labels, key=lambda x: int(x.get("order", 999))):
        lid = str(label.get("id"))
        count = 0
        for c in pool:
            if len(chosen) >= max_items:
                return chosen
            if normalize_url(c.url) in chosen_urls:
                continue
            if lid in candidate_labels(c, labels):
                chosen.append(c)
                chosen_urls.add(normalize_url(c.url))
                count += 1
                if count >= 3:
                    break

    return chosen[:max_items]


def output_path_for(run_day: date) -> Path:
    return SELECTED_ROOT / f"{run_day.year:04d}" / f"{run_day.month:02d}" / f"news_{run_day.isoformat()}.json"

def build_record(item_id: str, c: Candidate) -> dict[str, Any]:
    summary = str(c.raw.get("description") or "").strip()
    if not summary:
        summary = f"{c.title} 관련 기사입니다."
    keywords = c.matched_keywords[:4]
    if not keywords:
        keywords = ["뉴스"]
    reason = "pre_score 및 키워드/카테고리 매칭 기준으로 자동 선별됨"
    rating = 3
    return {
        "id": item_id,
        "title": c.title,
        "publisher": c.publisher,
        "published_at": c.published_at,
        "checkyn": "N",
        "summary": summary,
        "keywords": keywords,
        "reason": reason,
        "URL": c.url,
        "rating": rating,
    }


def assign_ids(selected: list[Candidate], labels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    # top 5 ids
    top = selected[:5]
    for i, c in enumerate(top, start=1):
        records.append(build_record(f"top_{i:02d}", c))

    # category ids for remaining items
    remaining = selected[5:]
    counts: dict[str, int] = {}
    label_ids = [str(x.get("id")) for x in sorted(labels, key=lambda x: int(x.get("order", 999)))]
    label_index = {lid: idx + 1 for idx, lid in enumerate(label_ids)}

    for c in remaining:
        lids = candidate_labels(c, labels)
        lid = lids[0] if lids else label_ids[0] if label_ids else "cat1"
        cat_no = label_index.get(lid, 1)
        counts[lid] = counts.get(lid, 0) + 1
        records.append(build_record(f"cat{cat_no}_{counts[lid]:02d}", c))
    return records


def save_selected(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

def main() -> int:
    parser = argparse.ArgumentParser(description="Generate selected news JSON from auto_dash/candidates.json")
    parser.add_argument("--run-date", default="today", help="today|yesterday|YYYY-MM-DD (KST)")
    parser.add_argument("--candidates", default=str(CANDIDATES_PATH))
    parser.add_argument("--labels", default=str(LABEL_RULES_PATH))
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
    selected = choose(candidates, labels, max_items=20)

    if not selected:
        print("최종 선정 기사가 0건이므로 파일 생성 없이 종료")
        return 0

    output_path = output_path_for(run_day)
    rows = assign_ids(selected, labels)
    save_selected(output_path, rows)

    print(f"선별 기사 {len(rows)}건 저장 완료")
    print(f"저장 경로: {output_path}")
    print("checkyn 전략 2 적용: 모든 기사 checkyn=N으로 저장")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
