from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List

import pandas as pd
import yfinance as yf
from pykrx import stock

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / 'data' / 'problems.json'
SEED = 20260421
VISIBLE_DAYS = 20
PROBLEMS_PER_STOCK = 2

KR_STOCKS: Dict[str, str] = {
    '005930': '삼성전자',
    '000660': 'SK하이닉스',
    '005380': '현대차',
    '035420': 'NAVER',
    '105560': 'KB금융',
    '051910': 'LG화학',
    '005490': 'POSCO홀딩스',
    '207940': '삼성바이오로직스',
}

US_STOCKS: Dict[str, str] = {
    'AAPL': 'Apple',
    'MSFT': 'Microsoft',
    'GOOGL': 'Alphabet',
    'AMZN': 'Amazon',
    'NVDA': 'NVIDIA',
    'META': 'Meta',
    'JPM': 'JPMorgan Chase',
    'BRK-B': 'Berkshire Hathaway',
}


@dataclass
class Problem:
    id: str
    market: str
    symbol: str
    company: str
    source: str
    visibleCandles: List[dict]
    targetCandle: dict


def normalize_ohlcv(df: pd.DataFrame, market: str) -> pd.DataFrame:
    if market == 'KR':
        df = df.rename(columns={'시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'})
        df.index = pd.to_datetime(df.index)
    else:
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] for c in df.columns]
    cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    df = df[cols].copy()
    df = df.dropna()
    df = df[df['Volume'] > 0]
    return df


def fetch_kr(symbol: str) -> pd.DataFrame:
    end = datetime.today().date()
    start = end - timedelta(days=365 * 5)
    df = stock.get_market_ohlcv_by_date(start.strftime('%Y%m%d'), end.strftime('%Y%m%d'), symbol)
    return normalize_ohlcv(df, 'KR')


def fetch_us(symbol: str) -> pd.DataFrame:
    df = yf.download(symbol, period='5y', auto_adjust=False, progress=False)
    return normalize_ohlcv(df, 'US')


def candle_record(date_value, row, prev_close: float | None = None) -> dict:
    open_price = float(row['Open'])
    close_price = float(row['Close'])
    record = {
        'date': pd.Timestamp(date_value).strftime('%Y-%m-%d'),
        'open': round(open_price, 2),
        'high': round(float(row['High']), 2),
        'low': round(float(row['Low']), 2),
        'close': round(close_price, 2),
        'volume': int(row['Volume']),
    }
    if prev_close is not None:
        record['openDirection'] = 'up' if open_price >= prev_close else 'down'
        record['closeDirection'] = 'up' if close_price >= prev_close else 'down'
    return record


def build_problems_from_df(df: pd.DataFrame, market: str, symbol: str, company: str, rng: random.Random) -> List[Problem]:
    if len(df) < VISIBLE_DAYS + 10:
        return []

    candidates = list(range(VISIBLE_DAYS, len(df) - 1))
    rng.shuffle(candidates)
    selected = []

    for idx in candidates:
        if len(selected) >= PROBLEMS_PER_STOCK:
            break
        window = df.iloc[idx - VISIBLE_DAYS: idx]
        target = df.iloc[idx]
        prev_close = float(window.iloc[-1]['Close'])

        visible = [candle_record(date_value, row) for date_value, row in window.iterrows()]
        target_record = candle_record(df.index[idx], target, prev_close=prev_close)

        selected.append(
            Problem(
                id=f'{market.lower()}-{symbol}-{target_record["date"]}',
                market=market,
                symbol=symbol,
                company=company,
                source='generated_from_market_data',
                visibleCandles=visible,
                targetCandle=target_record,
            )
        )
    return selected


def main() -> None:
    rng = random.Random(SEED)
    problems: List[Problem] = []

    for symbol, company in KR_STOCKS.items():
        try:
            df = fetch_kr(symbol)
            problems.extend(build_problems_from_df(df, 'KR', symbol, company, rng))
            print(f'KR ok: {symbol} {company}')
        except Exception as exc:
            print(f'KR failed: {symbol} {company} -> {exc}')

    for symbol, company in US_STOCKS.items():
        try:
            df = fetch_us(symbol)
            problems.extend(build_problems_from_df(df, 'US', symbol, company, rng))
            print(f'US ok: {symbol} {company}')
        except Exception as exc:
            print(f'US failed: {symbol} {company} -> {exc}')

    rng.shuffle(problems)
    payload = {
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'seed': SEED,
        'visible_days': VISIBLE_DAYS,
        'problem_count': len(problems),
        'problems': [p.__dict__ for p in problems],
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Wrote {len(problems)} problems to {DATA_PATH}')


if __name__ == '__main__':
    main()
