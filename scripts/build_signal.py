"""신호 차트용 일봉(시가·고가·저가·종가·거래량)을 data/005930.json으로 저장한다.

화면은 최근 5년을 보여 주지만, 첫날부터 20일선과 1년 최고가를 계산할 수 있게
그 앞 1년치를 더 받아 둔다(화면에는 그리지 않음).

    pip install -r scripts/requirements.txt
    python scripts/build_signal.py
"""

import datetime as dt
import json
from pathlib import Path

import FinanceDataReader as fdr

CODE = "005930"
NAME = "삼성전자"
YEARS = 5
WARMUP_YEARS = 1
OUT = Path(__file__).resolve().parent.parent / "data" / f"{CODE}.json"


def years_before(d: dt.date, n: int) -> dt.date:
    try:
        return d.replace(year=d.year - n)
    except ValueError:  # 2월 29일
        return d.replace(year=d.year - n, day=28)


def main():
    today = dt.date.today()
    show_from = years_before(today, YEARS)
    df = fdr.DataReader(CODE, years_before(show_from, WARMUP_YEARS).isoformat(), today.isoformat())
    df = df[df["Close"] > 0]

    rows = [
        [d.date().isoformat(), int(r.Open), int(r.High), int(r.Low), int(r.Close), int(r.Volume)]
        for d, r in df.iterrows()
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "code": CODE,
        "name": NAME,
        "showFrom": show_from.isoformat(),
        "source": "FinanceDataReader DataReader (일봉)",
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "columns": ["date", "open", "high", "low", "close", "volume"],
        "rows": rows,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"{NAME}({CODE}) {rows[0][0]} ~ {rows[-1][0]} {len(rows)}일 → {OUT}")


if __name__ == "__main__":
    main()
