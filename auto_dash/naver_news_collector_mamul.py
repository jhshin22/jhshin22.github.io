#!/usr/bin/env python3
"""
Manual/test runner for Naver News collector.

Purpose:
- Keep auto_dash/naver_news_collector.py unchanged for production automation.
- Reuse the exact same collection/scoring logic and news_rules.json.
- Let the user manually choose a target date for testing or daily-data maintenance.

Notes:
- Naver News API may not return older articles even when --target-date is old.
- This file is intentionally a thin wrapper around naver_news_collector.py.

Examples:
  python auto_dash/naver_news_collector_mamul.py --target-date 2026-04-24
  python auto_dash/naver_news_collector_mamul.py --target-date yesterday --pages 2
  python auto_dash/naver_news_collector_mamul.py --target-date 2026-04-24 --output auto_dash/test_2026-04-24.json
"""

from __future__ import annotations

import argparse
from pathlib import Path

from naver_news_collector import (
    DEFAULT_RULES_PATH,
    collect,
    default_output_path,
    load_rules,
    resolve_target_date,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Manual/test Naver News collector using the same logic as naver_news_collector.py."
    )
    parser.add_argument(
        "--target-date",
        required=True,
        help="KST target date to collect: today, yesterday, or YYYY-MM-DD. Required for manual testing.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output JSON path. Default: auto_dash/articles_raw_YYYY-MM-DD.json",
    )
    parser.add_argument(
        "--rules",
        default=str(DEFAULT_RULES_PATH),
        help="Rules JSON path. Default: auto_dash/news_rules.json",
    )
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

    print("Manual/test collector completed.")
    print(f"Target date: {target_date.isoformat()}")
    print(f"Output: {output_path}")
    print(f"Rules: {Path(args.rules)}")
    print(f"Added {added} new articles. Total: {total}")


if __name__ == "__main__":
    main()
