"""삼성전자·SK하이닉스·NAVER에 일곱 가지 사고팔기 방법을 backtesting.py로 돌려 data/backtest.json을 만든다.

- 주가: FinanceDataReader DataReader(code) 기본 기간 (2014년 8월부터). 액면분할로 거래가 멈춰 가격이 0인 날은 뺀다.
- 신호는 그날 종가로 보고, 주문은 다음 날 시가에 체결 (backtesting.py 기본: trade_on_close=False)
- 수수료+세금: 살 때 0.25%, 팔 때 0.25%
- 마지막 날까지 들고 있는 거래는 backtesting.py가 마지막 날 '시가'로 정리해서 셈 (finalize_trades=True)

    pip install -r scripts/requirements.txt
    python scripts/backtest.py
"""

import datetime as dt
import json
from pathlib import Path

import backtesting
import FinanceDataReader as fdr
import numpy as np
import pandas as pd
from backtesting import Backtest, Strategy
from backtesting.lib import crossover

OUT = Path(__file__).resolve().parent.parent / "data" / "backtest.json"

STOCKS = {"005930": "삼성전자", "000660": "SK하이닉스", "035420": "NAVER"}
CASH = 100_000_000
FEE = 0.0025
YEAR = 252  # 1년 = 252거래일


def sma(v, n):
    return pd.Series(v).rolling(n).mean()


def rsi(v, n=14):
    # 와일더 방식 RSI
    d = pd.Series(v).diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, min_periods=n, adjust=False).mean()
    down = (-d.clip(upper=0)).ewm(alpha=1 / n, min_periods=n, adjust=False).mean()
    return 100 - 100 / (1 + up / down)


def prior_max(v, n):
    return pd.Series(v).rolling(n).max().shift(1)  # 오늘은 빼고 직전 n일


def prior_min(v, n):
    return pd.Series(v).rolling(n).min().shift(1)


def drop_from_peak(high, low, n):
    """최근 n일(오늘 포함) 최고가에서, 그 최고가 이후 최저가가 얼마나 빠졌나 (0.2 = 20%)."""
    high, low = np.asarray(high), np.asarray(low)
    out = np.full(len(high), np.nan)
    for i in range(n - 1, len(high)):
        top = i - n + 1 + int(np.argmax(high[i - n + 1:i + 1]))
        out[i] = 1 - low[top:i + 1].min() / high[top]
    return out


class BuyHold(Strategy):
    def init(self):
        pass

    def next(self):
        if not self.position:
            self.buy()


class SmaCross(Strategy):
    fast = 5
    slow = 20

    def init(self):
        self.a = self.I(sma, self.data.Close, self.fast, name=f"{self.fast}일선")
        self.b = self.I(sma, self.data.Close, self.slow, name=f"{self.slow}일선")

    def next(self):
        if crossover(self.a, self.b) and not self.position:
            self.buy()
        elif crossover(self.b, self.a) and self.position:
            self.position.close()


class SmaCross5_20(SmaCross):
    fast, slow = 5, 20


class SmaCross20_60(SmaCross):
    fast, slow = 20, 60


class Rsi(Strategy):
    def init(self):
        self.r = self.I(rsi, self.data.Close, name="RSI(14)", overlay=False)

    def next(self):
        if not self.position and self.r[-1] < 30:
            self.buy()
        elif self.position and self.r[-1] > 70:
            self.position.close()


class Breakout(Strategy):
    def init(self):
        self.hi = self.I(prior_max, self.data.High, YEAR, name="직전 1년 최고가")
        self.lo = self.I(prior_min, self.data.Low, 20, name="직전 20일 최저가")

    def next(self):
        c = self.data.Close[-1]
        if not self.position and c > self.hi[-1]:
            self.buy()
        elif self.position and c < self.lo[-1]:
            self.position.close()


class Trend(Strategy):
    def init(self):
        self.m50 = self.I(sma, self.data.Close, 50, name="50일선")
        self.m150 = self.I(sma, self.data.Close, 150, name="150일선")
        self.m200 = self.I(sma, self.data.Close, 200, name="200일선")

    def next(self):
        ok = self.data.Close[-1] > self.m50[-1] > self.m150[-1] > self.m200[-1]
        if ok and not self.position:
            self.buy()
        elif not ok and self.position:
            self.position.close()


class MyRule(Strategy):
    """내 방법: 60일 고점보다 20% 이상 빠진 상태에서, 거래량이 직전 20일 평균의 2배 이상이고
    종가가 전날보다 3% 이상 오른 날 사고, 종가가 산 값보다 +10% 이상이거나 -5% 이하면 판다."""
    drop, drop_days = 0.20, 60
    vol_x, vol_days = 2.0, 20
    bounce = 0.03
    take, stop = 0.10, 0.05

    def init(self):
        self.dd = self.I(drop_from_peak, self.data.High, self.data.Low, self.drop_days, name="60일 고점 대비 하락", overlay=False)
        self.vavg = self.I(lambda v: pd.Series(v).rolling(self.vol_days).mean().shift(1), self.data.Volume, name="직전 20일 평균 거래량", overlay=False)

    def next(self):
        c = self.data.Close
        if not self.position:
            if (self.dd[-1] >= self.drop and self.data.Volume[-1] >= self.vol_x * self.vavg[-1]
                    and c[-1] >= c[-2] * (1 + self.bounce)):
                self.buy()
        else:
            entry = self.trades[-1].entry_price
            if c[-1] >= entry * (1 + self.take) or c[-1] <= entry * (1 - self.stop):
                self.position.close()


METHODS = [
    ("① 사서 들고 있기", BuyHold),
    ("② 5일선↗20일선", SmaCross5_20),
    ("③ 20일선↗60일선", SmaCross20_60),
    ("④ RSI 30↓ 사고 70↑ 팔기", Rsi),
    ("⑤ 1년 최고가 돌파 / 20일 최저가 이탈", Breakout),
    ("⑥ 종가>50일>150일>200일", Trend),
    ("⑦ 내 방법: 60일 고점 -20% + 거래량 2배 + 3%↑ / +10%·-5% 매도", MyRule),
]


# 화면 설명용 (표의 방법 이름 옆에 펼쳐 보이는 문장)
RULES = [
    "첫날 신호로 사서 마지막 날까지 들고 있기.",
    "5일선이 20일선을 아래에서 위로 뚫으면 사고, 위에서 아래로 뚫으면 팔기.",
    "20일선이 60일선을 아래에서 위로 뚫으면 사고, 위에서 아래로 뚫으면 팔기.",
    "RSI(14)가 30 밑이면 사고, 70을 넘으면 팔기.",
    "종가가 직전 1년(252거래일) 최고가를 넘으면 사고, 직전 20일 최저가 밑으로 빠지면 팔기.",
    "종가 > 50일선 > 150일선 > 200일선일 때만 들고 있기.",
    "60일 고점보다 20% 이상 빠진 상태에서 거래량이 직전 20일 평균의 2배 이상이고 종가가 전날보다 3% 이상 오른 날 사고, "
    "종가가 산 값보다 +10% 이상이거나 -5% 이하면 팔기.",
]


def load(code):
    df = fdr.DataReader(code)
    raw = len(df)
    df = df[(df[["Open", "High", "Low", "Close"]] > 0).all(axis=1)][["Open", "High", "Low", "Close", "Volume"]]
    return df, raw - len(df)


def day(t):
    return str(pd.Timestamp(t).date())


def main():
    stocks, problems = [], []

    for code, name in STOCKS.items():
        df, dropped = load(code)
        results = []
        for n, (label, S) in enumerate(METHODS):
            try:
                st = Backtest(df, S, cash=CASH, commission=FEE, finalize_trades=True).run()
            except Exception as e:  # 안 돌아간 건 숨기지 않고 화면에 그대로 보인다
                problems.append(f"{name} {label}: {type(e).__name__}: {e}")
                results.append({"method": n, "error": f"{type(e).__name__}: {e}"})
                continue
            t = st._trades
            results.append({
                "method": n,
                "firstBuy": day(t["EntryTime"].min()) if len(t) else None,
                "ret": round(float(st["Return [%]"]), 1),
                "profit": round(float(st["Equity Final [$]"]) - CASH),
                "mdd": round(float(st["Max. Drawdown [%]"]), 1),
                "trades": int(st["# Trades"]),
                "wins": int((t["PnL"] > 0).sum()),
                # [산 날, 산 값, 판 날, 판 값, 수익률%(수수료 포함)]
                "fills": [[day(r.EntryTime), round(float(r.EntryPrice)), day(r.ExitTime), round(float(r.ExitPrice)),
                           round(float(r.ReturnPct) * 100, 1)] for r in t.itertuples()],
            })
        ok = [r for r in results if "error" not in r]
        stocks.append({
            "code": code,
            "name": name,
            "droppedZeroDays": dropped,
            "best": max(ok, key=lambda r: r["ret"])["method"] if ok else None,
            "prices": [[day(d), int(r.Open), int(r.High), int(r.Low), int(r.Close)] for d, r in df.iterrows()],
            "results": results,
        })
        for r in results:
            print(name, METHODS[r["method"]][0], r.get("error") or (r["ret"], r["mdd"], r["trades"], r["wins"]))

    first = stocks[0]["prices"]
    OUT.write_text(json.dumps({
        "from": first[0][0],
        "to": first[-1][0],
        "cash": CASH,
        "fee": FEE,
        "priceSource": "FinanceDataReader DataReader (기본 기간 일봉)",
        "engine": f"backtesting.py {backtesting.__version__}",
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "methods": [{"label": label, "rule": rule} for (label, _), rule in zip(METHODS, RULES)],
        "problems": problems,
        "stocks": stocks,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("안 돌아간 것:", problems or "없음", "→", OUT)


if __name__ == "__main__":
    main()
