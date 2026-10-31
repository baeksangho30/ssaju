"""공개된 최신 코스피 RS 점수표 + KRX-DESC 업종을 합쳐 data/kospi-rs.json을 만든다.

RS 점수는 https://dalinaum.github.io/rs/ 에 게시된 HTML 표를 읽기만 한다
(그 저장소의 코드는 가져오거나 실행하지 않는다).

    pip install -r scripts/requirements.txt
    python scripts/build_data.py
"""

import datetime as dt
import html
import json
import re
import urllib.request
from pathlib import Path

import FinanceDataReader as fdr

RS_CUT = 80
SITE = "https://dalinaum.github.io"
INDEX_URL = f"{SITE}/rs/"
OUT = Path(__file__).resolve().parent.parent / "data" / "kospi-rs.json"


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ohaeng-rs/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def latest_kospi_post() -> str:
    # 목록 페이지는 최신 글이 위에 온다. 날짜가 들어간 경로라 정렬로 한 번 더 확인한다.
    paths = re.findall(r'href="(/rs/rs/(\d{4})/(\d{2})/(\d{2})/kospi-rs\.html)"', get(INDEX_URL))
    if not paths:
        raise SystemExit("코스피 RS 글을 찾지 못했습니다.")
    return SITE + max(paths, key=lambda p: p[1:])[0]


def strip(cell: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()


def num(s: str) -> float:
    return float(s.replace(",", "").replace("%", "").replace("+", ""))


def parse_scores(page: str):
    title = strip(re.search(r"<title>(.*?)</title>", page, re.S).group(1))
    m = re.search(r"(\d{4})년 (\d{1,2})월 (\d{1,2})일", title)
    as_of = dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()

    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        cells = [strip(c) for c in re.findall(r"<td>(.*?)</td>", tr, re.S)]
        if len(cells) != 6:
            continue
        code, name, prev, close, ret, rs = cells
        rows.append({
            "code": code,
            "name": name,
            "close": int(num(close)),
            "ret1y": num(ret),
            "rs": int(rs.split()[0]),
        })
    return title.split(" - ")[0], as_of, rows


def industries() -> dict:
    df = fdr.StockListing("KRX-DESC")
    df = df[df["Industry"].notna()]
    return dict(zip(df["Code"], df["Industry"]))


def add_history(rows, as_of: str):
    """추천 후보(RS 컷 초과 + 업종 있음)에 점수 기준일까지 1년 종가를 붙인다."""
    end = dt.date.fromisoformat(as_of)
    start = (end - dt.timedelta(days=365)).isoformat()

    for r in rows:
        if r["rs"] <= RS_CUT or not r["industry"]:
            continue
        close = fdr.DataReader(r["code"], start, as_of)["Close"]
        close = close[close > 0]
        r["history"] = {
            "from": close.index[0].date().isoformat(),
            "to": close.index[-1].date().isoformat(),
            "close": [int(c) for c in close],
        }


def main():
    url = latest_kospi_post()
    title, as_of, rows = parse_scores(get(url))
    ind = industries()

    for r in rows:
        code = r["code"]
        if code in ind:
            r["industry"] = ind[code]
        elif code[:5] + "0" in ind:
            # 우선주는 KRX-DESC에 업종이 비어 있어 같은 회사 보통주의 업종을 쓴다.
            r["industry"] = ind[code[:5] + "0"]
            r["industryFrom"] = code[:5] + "0"
        else:
            r["industry"] = None

    add_history(rows, as_of)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "asOf": as_of,
        "sourceTitle": title,
        "sourceUrl": url,
        "industrySource": "FinanceDataReader StockListing('KRX-DESC')",
        "priceSource": "FinanceDataReader DataReader (1년 종가)",
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "stocks": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    missing = sum(1 for r in rows if not r["industry"])
    print(f"{as_of} 기준 {len(rows)}종목, 업종 없음 {missing}종목 → {OUT}")


if __name__ == "__main__":
    main()
