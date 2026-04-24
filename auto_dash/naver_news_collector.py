#!/usr/bin/env python3
"""
Naver News API collector for loan/finance dashboard.

- Loads search/scoring rules from auto_dash/news_rules.json.
- Searches Naver News API with configured keywords.
- Saves articles into a daily JSON file based on Korean date.
- Keeps only articles whose published date matches the target Korean date.
- Appends newly discovered articles to that daily file only once.
- Deduplicates by normalized URL first, then by title/source/date fallback.

Required environment variables:
  NAVER_CLIENT_ID
  NAVER_CLIENT_SECRET

Default output:
  auto_dash/articles_raw_YYYY-MM-DD.json
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
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
NAVER_NEWS_API_URL = "https://openapi.naver.com/v1/search/news.json"
DEFAULT_RULES_PATH = Path(__file__).parent / "news_rules.json"
TAG_RE = re.compile(r"<[^>]+>")
TRACKING_QUERY_KEYS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"
}


def load_rules(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Rules file not found: {path}")
    rules = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rules.get("search_keywords"), list) or not rules["search_keywords"]:
        raise ValueError("news_rules.json must contain non-empty search_keywords list.")
    return rules


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
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), query, "")
    )


def get_domain(url: str) -> str:
    host = urllib.parse.urlsplit(url or "").netloc.lower().replace("www.", "")
    return host


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


def resolve_target_date(value: str | None) -> date:
    if not value or value == "today":
        return datetime.now(KST).date()
    if value == "yesterday":
        return datetime.now(KST).date() - timedelta(days=1)
    return date.fromisoformat(value)


def default_output_path(target_date: date) -> Path:
    return Path(f"auto_dash/articles_raw_{target_date.isoformat()}.json")


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


def save_articles(path: Path, articles: list[dict[str, Any]], target_date: date) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "target_date": target_date.isoformat(),
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(articles),
        "articles": articles,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def source_from_item(item: dict[str, Any], rules: dict[str, Any]) -> tuple[str, str, int]:
    url = item.get("originallink") or item.get("link") or ""
    domain = get_domain(url)
    trusted_domains = rules.get("trusted_domains", {})
    if domain in trusted_domains:
        source_rule = trusted_domains[domain]
        return source_rule.get("name", domain), domain, int(source_rule.get("score", 0))

    # suffix fallback: e.g. subdomain.example.co.kr -> example.co.kr
    for trusted_domain, source_rule in trusted_domains.items():
        if domain.endswith("." + trusted_domain):
            return source_rule.get("name", trusted_domain), domain, int(source_rule.get("score", 0))
    return domain or "unknown", domain or "unknown", 0


def matched_keywords(title: str, description: str, search_keyword: str, rules: dict[str, Any]) -> list[str]:
    text = f"{title} {description}".lower()
    matched = {search_keyword}
    for kw in rules.get("search_keywords", []):
        if str(kw).lower() in text:
            matched.add(str(kw))
    return sorted(matched)


def weighted_term_hits(title: str, description: str, terms: list[str], title_weight: float, description_weight: float) -> list[dict[str, Any]]:
    hits = []
    title_lower = title.lower()
    desc_lower = description.lower()
    for term in terms:
        term_str = str(term)
        term_lower = term_str.lower()
        in_title = term_lower in title_lower
        in_desc = term_lower in desc_lower
        if in_title or in_desc:
            hits.append({
                "term": term_str,
                "in_title": in_title,
                "in_description": in_desc,
                "weight": (title_weight if in_title else 0) + (description_weight if in_desc else 0),
            })
    return hits


def calculate_score(title: str, description: str, source_domain: str, keywords: list[str], rules: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    opt = rules.get("score_options", {})
    title_weight = float(opt.get("title_weight", 2.0))
    description_weight = float(opt.get("description_weight", 1.0))
    min_score = int(opt.get("minimum_score", 0))
    max_score = int(opt.get("maximum_score", 150))

    score = 0.0
    detail: dict[str, Any] = {"groups": {}, "matched_terms": {}}

    kw_bonus = min(
        len(set(keywords)) * int(opt.get("matched_keyword_bonus_per_keyword", 6)),
        int(opt.get("matched_keyword_bonus_max", 30)),
    )
    score += kw_bonus
    detail["keyword_bonus"] = kw_bonus

    for group_name, group in rules.get("positive_groups", {}).items():
        hits = weighted_term_hits(title, description, group.get("terms", []), title_weight, description_weight)
        if hits:
            base = float(group.get("score", 0))
            multiplier = max(hit["weight"] for hit in hits)
            group_score = round(base * multiplier / title_weight)
            score += group_score
            detail["groups"][group_name] = group_score
            detail["matched_terms"][group_name] = hits

    for group_name, group in rules.get("negative_groups", {}).items():
        hits = weighted_term_hits(title, description, group.get("terms", []), title_weight, description_weight)
        if hits:
            base = float(group.get("score", 0))
            multiplier = max(hit["weight"] for hit in hits)
            group_score = round(base * multiplier / title_weight)
            score += group_score
            detail["groups"][group_name] = group_score
            detail["matched_terms"][group_name] = hits

    trusted_domains = rules.get("trusted_domains", {})
    source_score = 0
    if source_domain in trusted_domains:
        source_score = int(trusted_domains[source_domain].get("score", 0))
    else:
        for trusted_domain, source_rule in trusted_domains.items():
            if source_domain.endswith("." + trusted_domain):
                source_score = int(source_rule.get("score", 0))
                break
    score += source_score
    detail["source_bonus"] = source_score

    final_score = max(min_score, min(round(score), max_score))
    detail["raw_score"] = round(score)
    detail["final_score"] = final_score
    return final_score, detail


def validate_env() -> None:
    missing = [name for name in ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"] if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing required GitHub Secrets/env vars: {', '.join(missing)}")


def search_naver(keyword: str, display: int, start: int, sort: str) -> list[dict[str, Any]]:
    client_id = os.environ["NAVER_CLIENT_ID"]
    client_secret = os.environ["NAVER_CLIENT_SECRET"]
    params = urllib.parse.urlencode({"query": keyword, "display": display, "start": start, "sort": sort})
    request = urllib.request.Request(f"{NAVER_NEWS_API_URL}?{params}")
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    data = json.loads(body)
    return data.get("items", [])


def enrich_existing_article(article: dict[str, Any], title: str, description: str, keyword: str, rules: dict[str, Any]) -> None:
    kws = set(article.get("matched_keywords", []))
    kws.update(matched_keywords(title, description, keyword, rules))
    article["matched_keywords"] = sorted(kws)
    source_domain = article.get("source_domain") or get_domain(article.get("url", ""))
    score, detail = calculate_score(article.get("title", title), article.get("description", description), source_domain, article["matched_keywords"], rules)
    article["pre_score"] = score
    article["score_detail"] = detail


def collect(output_path: Path, target_date: date, display: int, pages: int, sleep_seconds: float, sort: str, rules: dict[str, Any]) -> tuple[int, int]:
    validate_env()
    now = datetime.now(KST)
    articles = load_articles(output_path)
    articles = [a for a in articles if str(a.get("published_at", ""))[:10] == target_date.isoformat()]
    existing_ids = {a.get("id") for a in articles if a.get("id")}
    existing_urls = {normalize_url(a.get("url", "")) for a in articles if a.get("url")}
    added = 0
    seen_in_run: set[str] = set()
    error_count = 0

    save_articles(output_path, articles, target_date)

    search_keywords = rules.get("search_keywords", [])
    for keyword in search_keywords:
        for page in range(pages):
            start = page * display + 1
            try:
                items = search_naver(keyword=str(keyword), display=display, start=start, sort=sort)
            except Exception as exc:
                error_count += 1
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
                if datetime.fromisoformat(published_at).date() != target_date:
                    continue

                source_name, source_domain, source_score = source_from_item(item, rules)
                aid = article_id(norm_url, title, source_name, published_at)

                if aid in existing_ids or norm_url in existing_urls or aid in seen_in_run:
                    for article in articles:
                        if article.get("id") == aid or normalize_url(article.get("url", "")) == norm_url:
                            enrich_existing_article(article, title, description, str(keyword), rules)
                            break
                    continue

                kws = matched_keywords(title, description, str(keyword), rules)
                score, score_detail = calculate_score(title, description, source_domain, kws, rules)
                has_negative = any(v < 0 for v in score_detail.get("groups", {}).values())
                has_direct_positive = any(
                    group in score_detail.get("groups", {})
                    for group in ["direct_loan", "policy_regulation", "risk_repayment"]
                )

                article = {
                    "id": aid,
                    "title": title,
                    "source": source_name,
                    "source_domain": source_domain,
                    "published_at": published_at,
                    "published_date": target_date.isoformat(),
                    "collected_at": now.isoformat(timespec="seconds"),
                    "url": norm_url,
                    "naver_link": naver_link,
                    "origin": "naver_news_api",
                    "matched_keywords": kws,
                    "description": description,
                    "pre_score": score,
                    "score_detail": score_detail,
                    "flags": {
                        "trusted_source": source_score > 0,
                        "domestic": True,
                        "loan_related": has_direct_positive,
                        "possible_ad": has_negative,
                    },
                }
                articles.append(article)
                existing_ids.add(aid)
                existing_urls.add(norm_url)
                seen_in_run.add(aid)
                added += 1

            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    if error_count == len(search_keywords) * pages:
        raise RuntimeError("All Naver API calls failed. Check NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, and API activation settings.")

    articles.sort(key=lambda x: (x.get("published_at", ""), x.get("pre_score", 0)), reverse=True)
    save_articles(output_path, articles, target_date)
    return added, len(articles)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Naver News API articles into a daily deduplicated JSON file.")
    parser.add_argument("--target-date", default="today", help="KST date to collect: today, yesterday, or YYYY-MM-DD")
    parser.add_argument("--output", default=None, help="Output JSON path. Default: auto_dash/articles_raw_YYYY-MM-DD.json")
    parser.add_argument("--rules", default=str(DEFAULT_RULES_PATH), help="Rules JSON path")
    parser.add_argument("--display", type=int, default=20, help="Naver API results per page, max 100")
    parser.add_argument("--pages", type=int, default=1, help="Pages per keyword")
    parser.add_argument("--sleep", type=float, default=0.2, help="Sleep seconds between API calls")
    parser.add_argument("--sort", choices=["date", "sim"], default="date", help="Naver API sort mode")
    args = parser.parse_args()

    rules = load_rules(Path(args.rules))
    target_date = resolve_target_date(args.target_date)
    output_path = Path(args.output) if args.output else default_output_path(target_date)
    added, total = collect(
        output_path=output_path,
        target_date=target_date,
        display=min(max(args.display, 1), 100),
        pages=max(args.pages, 1),
        sleep_seconds=max(args.sleep, 0),
        sort=args.sort,
        rules=rules,
    )
    print(f"Target date: {target_date.isoformat()}")
    print(f"Output: {output_path}")
    print(f"Rules: {Path(args.rules)}")
    print(f"Added {added} new articles. Total: {total}")


if __name__ == "__main__":
    main()
